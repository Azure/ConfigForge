// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { spawn } from 'child_process';
import { parseLosslessJson } from '../manifest/lossless';
import { resolveOscfgBinary } from './binary';
import type { OscfgResult } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Maximum concurrent `oscfg` spawns. Beyond this, callers queue.
 *
 * Why: when the manifests list page loads with many registrations,
 * `Promise.all` over per-namespace status calls can fan out 10+ spawns
 * at once. On Windows that triggers Defender real-time scans + DLL
 * load contention on `oscfg_event.dll` (each spawn loads it fresh) —
 * we've seen this manifest as 60s timeouts even though a single CLI
 * invocation completes in ~100ms. Capping at 4 keeps throughput high
 * while avoiding the contention cliff.
 */
const MAX_CONCURRENT_SPAWNS = 4;

function parseOscfgOutput(stdout: string): unknown {
  return parseLosslessJson(stdout);
}

/** @internal exported for tests */
export const _internals = { MAX_CONCURRENT_SPAWNS, parseOscfgOutput };

let activeSpawns = 0;
const waitQueue: Array<() => void> = [];

async function acquireSpawnSlot(): Promise<void> {
  if (activeSpawns < MAX_CONCURRENT_SPAWNS) {
    activeSpawns++;
    return;
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeSpawns++;
      resolve();
    });
  });
}

function releaseSpawnSlot(): void {
  activeSpawns--;
  const next = waitQueue.shift();
  if (next) next();
}

/**
 * Run oscfg with the given args. Captures stdout/stderr, parses JSON on
 * success when `parseJson` is true, otherwise returns raw stdout.
 *
 * PR21: always closes stdin and gates total concurrency to prevent the
 * 60s-timeout-storm we hit when many namespaces are queried in parallel.
 */
export async function runOscfg<T>(
  args: string[],
  options?: { timeoutMs?: number; parseJson?: boolean; stdinInput?: string },
): Promise<OscfgResult<T>> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parseJson = options?.parseJson ?? true;

  let bin;
  try {
    bin = resolveOscfgBinary();
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : 'oscfg binary not found',
      exitCode: -1,
    };
  }

  await acquireSpawnSlot();

  return new Promise<OscfgResult<T>>((resolve) => {
    let settled = false;
    const settle = (result: OscfgResult<T>) => {
      if (settled) return;
      settled = true;
      releaseSpawnSlot();
      resolve(result);
    };

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(bin.path, args, { windowsHide: true });

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    // PR21: ALWAYS close stdin. Without this, on Windows the child can
    // wait indefinitely for stdin EOF before exiting (intermittent, load-
    // dependent). The 60-second timeouts users hit on the manifests
    // detail page were this bug — `get resource -n <ns> --output json`
    // returned in <100ms from PowerShell but consistently 60s from the
    // Next.js spawn pipeline.
    if (options?.stdinInput) {
      child.stdin.write(options.stdinInput);
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle({
        success: false,
        data: null,
        error: `oscfg command timed out after ${timeoutMs}ms`,
        exitCode: -1,
      });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      const stdoutRaw = Buffer.concat(stdoutChunks).toString().trim();
      const stderrRaw = Buffer.concat(stderrChunks).toString().trim();
      const stdout = stripTelemetryPreamble(stdoutRaw);
      const stderr = stderrRaw;

      if (exitCode !== 0) {
        // Prefer structured JSON error from stdout (oscfg emits
        //   { "error": { "message": "..." } }
        // on non-zero exit). Fall back to stderr log noise.
        const structured = tryExtractStructuredError(stdout);
        const rawMsg = structured || stderr || stdout || `oscfg exited with code ${exitCode}`;
        const msg = translateKnownErrors(rawMsg, exitCode);
        settle({
          success: false,
          data: null,
          error: cleanError(msg),
          exitCode,
          stdout,
          stderr,
        });
        return;
      }

      if (!stdout) {
        settle({ success: true, data: null, error: null, exitCode: 0, stdout, stderr });
        return;
      }

      if (!parseJson) {
        settle({ success: true, data: stdout as unknown as T, error: null, exitCode: 0, stdout, stderr });
        return;
      }

      try {
        const parsed = parseOscfgOutput(stdout) as T;
        settle({ success: true, data: parsed, error: null, exitCode: 0, stdout, stderr });
      } catch {
        // CLI didn't emit JSON (maybe YAML or plain text). Hand back as-is.
        settle({ success: true, data: stdout as unknown as T, error: null, exitCode: 0, stdout, stderr });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      settle({
        success: false,
        data: null,
        error: `Failed to launch oscfg: ${err.message}`,
        exitCode: -1,
      });
    });
  });
}

function cleanError(raw: string): string {
  return raw
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '') // strip ANSI color codes
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' ')
    .trim();
}

/**
 * Translate well-known oscfg failure modes into actionable messages for the UI.
 *
 * Exported with @internal JSDoc for unit-test reach; not part of the
 * public module surface (see oscfg/index.ts).
 *
 * @internal
 */
export function translateKnownErrors(raw: string, exitCode: number): string {
  if (
    exitCode === 101 &&
    /PermissionDenied/i.test(raw) &&
    /file-rotate/i.test(raw)
  ) {
    return (
      'oscfg requires Administrator privileges on Windows (the CLI opens a log file in a protected directory on startup). ' +
      'Restart ConfigForge from an elevated PowerShell / command prompt and try again.'
    );
  }

  // Microsoft.Windows/UserRightsAssignment — `LsaEnumerateAccountRights`
  // requires SeSecurityPrivilege. Without admin we get a raw NT status.
  // Surface it as actionable text instead of leaking the hex.
  if (/Microsoft\.Windows\/UserRightsAssignment/i.test(raw) && /0xD0000022|Access Denied/i.test(raw)) {
    return (
      'Microsoft.Windows/UserRightsAssignment requires Administrator privileges to read account rights from LSA. ' +
      'Restart ConfigForge from an elevated PowerShell / command prompt and try again.'
    );
  }

  // Microsoft.Windows/CSP — `0x82F00009` is the SyncML/Policy-CSP error
  // (facility 0x2F0 = SyncML, code 0x09: ResultsRejected / not supported on
  // this SKU or not currently managed). On a non-MDM-managed device, reads
  // against `./Vendor/MSFT/Policy/{Result,Config}/UserRights/*` consistently
  // fail with this code even when admin. The dedicated
  // Microsoft.Windows/UserRightsAssignment provider reads the same data via
  // LsaEnumerateAccountRights and works on any standalone Windows install
  // — recommend it specifically when we recognize a UserRights CSP path.
  if (/Microsoft\.Windows\/CSP/i.test(raw) && /0x82F00009/i.test(raw)) {
    if (/\/UserRights\//i.test(raw) || /UserRights/i.test(raw)) {
      return (
        'Policy CSP read failed (0x82F00009). The CSP layer rejects reads on devices not managed by an MDM ' +
        'authority for this policy. For UserRights specifically, consider using ' +
        'Microsoft.Windows/UserRightsAssignment (e.g. name: SeNetworkLogonRight) — it reads the same data via ' +
        'LSA directly and works on standalone machines.'
      );
    }
    return (
      'Policy CSP read failed (0x82F00009). The Policy CSP layer rejects reads on devices not managed by an MDM ' +
      'authority for this setting, or the SKU does not support it. Try the dedicated provider for this setting ' +
      '(e.g. Microsoft.Windows/Registry, Microsoft.Windows/AccountPolicy, Microsoft.Windows/AuditPolicy) ' +
      'when one is available.'
    );
  }

  return raw;
}

/**
 * The oscfg CLI prints a telemetry / privacy notice on stdout before the
 * actual payload, e.g.:
 *
 *   You are sending required diagnostic data.
 *
 *   We collect diagnostic data that is required to keep OSConfig up-to-date
 *   ...
 *   Learn more at: https://privacy.microsoft.com/en-US/privacystatement
 *
 *   ["namespace1", "namespace2"]
 *
 * Find the first JSON document delimiter (`{` or `[`) and return from there.
 * If none is found, return the raw string so JSON.parse can fail naturally
 * and text-mode callers still see their content.
 */
function stripTelemetryPreamble(raw: string): string {
  if (!raw) return raw;
  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  const candidates = [firstBrace, firstBracket].filter((i) => i >= 0);
  if (candidates.length === 0) return raw.trim();
  const start = Math.min(...candidates);
  return raw.slice(start).trim();
}

/**
 * On non-zero exit, oscfg emits a structured error object on stdout:
 *   { "error": { "message": "..." } }
 * Extract the message if present — it's much more useful than the ANSI-colored
 * tracing log line on stderr.
 */
function tryExtractStructuredError(stdout: string): string | null {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (parsed && typeof parsed === 'object') {
      const err = (parsed as Record<string, unknown>).error;
      if (err && typeof err === 'object') {
        const msg = (err as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.length > 0) return msg;
      }
      if (typeof err === 'string' && err.length > 0) return err;
    }
  } catch {
    // not JSON, fall through
  }
  return null;
}
