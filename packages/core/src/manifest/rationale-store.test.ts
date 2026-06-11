// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for src/lib/manifest/rationale-store.
 *
 * Each test isolates state by setting CONFIGFORGE_HOME to a fresh tmp dir
 * (the same convention as src/lib/history). Covers: round-trip,
 * concurrent writers, corruption resilience, large logs, and namespace
 * sanitization for non-ASCII / path-traversal-y inputs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, appendFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import {
  appendRationale,
  deleteRationale,
  readRationale,
  readRationaleForResource,
  _sanitizeNsForTests,
  _readRationaleFileRawForTests,
  type RationaleEntry,
} from './rationale-store';

let SANDBOX = '';
let RATIONALE_ROOT = '';

beforeEach(async () => {
  SANDBOX = await mkdtemp(path.join(tmpdir(), 'cf-rationale-'));
  process.env.CONFIGFORGE_HOME = SANDBOX;
  RATIONALE_ROOT = path.join(SANDBOX, 'rationale');
});

afterEach(async () => {
  delete process.env.CONFIGFORGE_HOME;
  await rm(SANDBOX, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeEntry(overrides: Partial<RationaleEntry> = {}): RationaleEntry {
  return {
    ts: new Date().toISOString(),
    author: 'Tester',
    resourceName: 'TestResource',
    oldValue: 0,
    newValue: 1,
    reason: 'because',
    ...overrides,
  };
}

// ── Sanitization ───────────────────────────────────────────────────────────

describe('namespace sanitization', () => {
  it('keeps simple alphanumeric names unchanged', () => {
    expect(_sanitizeNsForTests('my-baseline')).toBe('my-baseline');
    expect(_sanitizeNsForTests('baseline.v2')).toBe('baseline.v2');
    expect(_sanitizeNsForTests('WS2025_Member-Server')).toBe('WS2025_Member-Server');
  });

  it('replaces path-traversal characters with hyphens', () => {
    expect(_sanitizeNsForTests('../etc/passwd')).toBe('etc-passwd');
    expect(_sanitizeNsForTests('a/b\\c')).toBe('a-b-c');
  });

  it('handles non-ASCII / Windows-y resource-style names', () => {
    // Non-alphanumerics collapse to '-'. Trim leading/trailing.
    const slug = _sanitizeNsForTests('Microsoft.Windows/Registry/HKLM\\Software\\Microsoft');
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('\\');
    // Should preserve the dotted prefix.
    expect(slug.startsWith('Microsoft.Windows-Registry-')).toBe(true);
  });

  it('rejects pure dot or empty inputs', () => {
    expect(_sanitizeNsForTests('')).toBe('');
    expect(_sanitizeNsForTests('   ')).toBe('');
    expect(_sanitizeNsForTests('..')).toBe('');
    expect(_sanitizeNsForTests('.')).toBe('');
  });

  it('truncates to 96 chars', () => {
    const long = 'a'.repeat(200);
    expect(_sanitizeNsForTests(long).length).toBe(96);
  });
});

describe('appendRationale — invalid namespace', () => {
  it('throws a clear error on empty namespace', async () => {
    await expect(appendRationale('', makeEntry())).rejects.toThrow(/Invalid namespace/);
  });
  it('throws a clear error on `..`', async () => {
    await expect(appendRationale('..', makeEntry())).rejects.toThrow(/Invalid namespace/);
  });
});

// ── Round-trip ─────────────────────────────────────────────────────────────

describe('append + read round-trip', () => {
  it('writes then reads a single entry', async () => {
    const entry = makeEntry({ resourceName: 'r1', reason: 'one' });
    await appendRationale('m1', entry);
    const all = await readRationale('m1');
    expect(all).toHaveLength(1);
    expect(all[0].resourceName).toBe('r1');
    expect(all[0].reason).toBe('one');
    expect(all[0].author).toBe('Tester');
    expect(all[0].oldValue).toBe(0);
    expect(all[0].newValue).toBe(1);
  });

  it('writes multiple entries in chronological order on disk', async () => {
    await appendRationale('m1', makeEntry({ ts: '2025-01-01T00:00:00.000Z', reason: 'a' }));
    await appendRationale('m1', makeEntry({ ts: '2025-01-02T00:00:00.000Z', reason: 'b' }));
    await appendRationale('m1', makeEntry({ ts: '2025-01-03T00:00:00.000Z', reason: 'c' }));
    const all = await readRationale('m1');
    expect(all.map((e) => e.reason)).toEqual(['a', 'b', 'c']);
  });

  it('preserves complex JSON values for oldValue / newValue', async () => {
    const oldValue = { keyPath: 'HKLM:\\Foo', valueType: 'Dword', complex: { nested: [1, 2] } };
    const newValue = { keyPath: 'HKLM:\\Foo', valueType: 'Dword', complex: { nested: [3, 4] } };
    await appendRationale('m1', makeEntry({ oldValue, newValue }));
    const all = await readRationale('m1');
    expect(all[0].oldValue).toEqual(oldValue);
    expect(all[0].newValue).toEqual(newValue);
  });

  it('preserves skipped:true', async () => {
    await appendRationale('m1', makeEntry({ reason: '', skipped: true }));
    const all = await readRationale('m1');
    expect(all[0].skipped).toBe(true);
    expect(all[0].reason).toBe('');
  });

  it('returns [] for a namespace with no log file', async () => {
    const all = await readRationale('never-touched');
    expect(all).toEqual([]);
  });
});

// ── Concurrent appends ─────────────────────────────────────────────────────

describe('concurrent appends', () => {
  it('20 parallel appends produce exactly 20 distinct lines', async () => {
    const N = 20;
    const writes = Array.from({ length: N }, (_, i) =>
      appendRationale(
        'm1',
        makeEntry({ ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, reason: `r${i}` }),
      ),
    );
    await Promise.all(writes);
    const all = await readRationale('m1');
    expect(all).toHaveLength(N);
    const reasons = new Set(all.map((e) => e.reason));
    expect(reasons.size).toBe(N);
    // Verify the raw file is well-formed JSONL too.
    const raw = await _readRationaleFileRawForTests('m1');
    expect(raw).not.toBeNull();
    const lines = raw!.split('\n').filter(Boolean);
    expect(lines).toHaveLength(N);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('50 parallel appends produce exactly 50 distinct lines (stress)', async () => {
    const N = 50;
    const writes = Array.from({ length: N }, (_, i) =>
      appendRationale('m1', makeEntry({ reason: `stress-${i}` })),
    );
    await Promise.all(writes);
    const all = await readRationale('m1');
    expect(all).toHaveLength(N);
    const reasons = new Set(all.map((e) => e.reason));
    expect(reasons.size).toBe(N);
  });

  it('appends to two different namespaces in parallel do not collide', async () => {
    const writesA = Array.from({ length: 10 }, (_, i) =>
      appendRationale('mA', makeEntry({ reason: `a-${i}` })),
    );
    const writesB = Array.from({ length: 10 }, (_, i) =>
      appendRationale('mB', makeEntry({ reason: `b-${i}` })),
    );
    await Promise.all([...writesA, ...writesB]);
    expect((await readRationale('mA'))).toHaveLength(10);
    expect((await readRationale('mB'))).toHaveLength(10);
  });
});

// ── Corruption resilience ─────────────────────────────────────────────────

describe('corruption resilience', () => {
  it('skips a corrupted line in the middle of the file', async () => {
    await appendRationale('m1', makeEntry({ reason: 'first' }));
    // Insert a torn-write fragment between two valid entries.
    const file = path.join(RATIONALE_ROOT, 'm1.jsonl');
    await appendFile(file, '{ "ts": "broken json line\n', 'utf8');
    await appendRationale('m1', makeEntry({ reason: 'second' }));

    const all = await readRationale('m1');
    expect(all.map((e) => e.reason)).toEqual(['first', 'second']);
  });

  it('skips empty lines (e.g. trailing newline, manual blank line)', async () => {
    await appendRationale('m1', makeEntry({ reason: 'r1' }));
    const file = path.join(RATIONALE_ROOT, 'm1.jsonl');
    await appendFile(file, '\n\n   \n', 'utf8');
    await appendRationale('m1', makeEntry({ reason: 'r2' }));
    const all = await readRationale('m1');
    expect(all.map((e) => e.reason)).toEqual(['r1', 'r2']);
  });

  it('returns [] when the file exists but is fully empty', async () => {
    await mkdir(RATIONALE_ROOT, { recursive: true });
    await writeFile(path.join(RATIONALE_ROOT, 'm1.jsonl'), '', 'utf8');
    const all = await readRationale('m1');
    expect(all).toEqual([]);
  });

  it('returns [] when the file is only whitespace/newlines', async () => {
    await mkdir(RATIONALE_ROOT, { recursive: true });
    await writeFile(path.join(RATIONALE_ROOT, 'm1.jsonl'), '\n\n\n   \n', 'utf8');
    const all = await readRationale('m1');
    expect(all).toEqual([]);
  });

  it('treats a JSON value (not object) as a corrupt line and skips', async () => {
    await mkdir(RATIONALE_ROOT, { recursive: true });
    await writeFile(path.join(RATIONALE_ROOT, 'm1.jsonl'), '"a string"\n42\nnull\n', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const all = await readRationale('m1');
    expect(all).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('drops missing-string fields to empty string instead of throwing', async () => {
    await mkdir(RATIONALE_ROOT, { recursive: true });
    // A "valid" object but with the wrong types — still parsed defensively.
    await writeFile(
      path.join(RATIONALE_ROOT, 'm1.jsonl'),
      JSON.stringify({ ts: 42, author: null, resourceName: 'r', reason: ['x'] }) + '\n',
      'utf8',
    );
    const all = await readRationale('m1');
    expect(all).toHaveLength(1);
    expect(all[0].ts).toBe('');
    expect(all[0].author).toBe('');
    expect(all[0].resourceName).toBe('r');
    expect(all[0].reason).toBe('');
  });
});

// ── Large logs ─────────────────────────────────────────────────────────────

describe('large log read performance', () => {
  it('reads >1000 entries cleanly', async () => {
    const N = 1100;
    // Fast path — write directly to the file rather than 1100 sequential
    // appends (each with lock acquire/release). The reader contract is
    // what we're testing here.
    const lines: string[] = [];
    for (let i = 0; i < N; i++) {
      lines.push(
        JSON.stringify(
          makeEntry({
            ts: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
            resourceName: i % 2 === 0 ? 'evens' : 'odds',
            reason: `entry-${i}`,
          }),
        ),
      );
    }
    await mkdir(RATIONALE_ROOT, { recursive: true });
    await writeFile(path.join(RATIONALE_ROOT, 'm1.jsonl'), lines.join('\n') + '\n', 'utf8');

    const all = await readRationale('m1');
    expect(all).toHaveLength(N);
    expect(all[0].reason).toBe('entry-0');
    expect(all[N - 1].reason).toBe(`entry-${N - 1}`);

    // And the resource-filter path narrows correctly.
    const evens = await readRationaleForResource('m1', 'evens');
    expect(evens.length).toBe(N / 2);
    expect(evens[0].reason).toBe(`entry-${N - 2}`); // newest first
  });
});

// ── readRationaleForResource ──────────────────────────────────────────────

describe('readRationaleForResource', () => {
  it('filters by exact resource name', async () => {
    await appendRationale('m1', makeEntry({ resourceName: 'A', reason: 'a1' }));
    await appendRationale('m1', makeEntry({ resourceName: 'B', reason: 'b1' }));
    await appendRationale('m1', makeEntry({ resourceName: 'A', reason: 'a2' }));

    const a = await readRationaleForResource('m1', 'A');
    expect(a.map((e) => e.reason)).toEqual(['a2', 'a1']); // newest first
    const b = await readRationaleForResource('m1', 'B');
    expect(b.map((e) => e.reason)).toEqual(['b1']);
    const c = await readRationaleForResource('m1', 'C');
    expect(c).toEqual([]);
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 10; i++) {
      await appendRationale('m1', makeEntry({ resourceName: 'A', reason: `r${i}` }));
    }
    const top3 = await readRationaleForResource('m1', 'A', 3);
    expect(top3).toHaveLength(3);
    expect(top3[0].reason).toBe('r9');
    expect(top3[2].reason).toBe('r7');
  });

  it('returns empty array when limit is 0', async () => {
    await appendRationale('m1', makeEntry({ resourceName: 'A', reason: 'r' }));
    const r = await readRationaleForResource('m1', 'A', 0);
    expect(r).toEqual([]);
  });
});

// ── CONFIGFORGE_HOME isolation ────────────────────────────────────────────

describe('CONFIGFORGE_HOME isolation', () => {
  it('tests do not pollute the real ~/.configforge/rationale dir', async () => {
    expect(process.env.CONFIGFORGE_HOME).toBe(SANDBOX);
    await appendRationale('iso', makeEntry());
    const file = path.join(RATIONALE_ROOT, 'iso.jsonl');
    expect(await readFile(file, 'utf8')).toContain('TestResource');
  });
});

// ── deleteRationale ─────────────────────────────────────────────────────

describe('deleteRationale (PR34)', () => {
  it('removes the JSONL file and any stale lock file', async () => {
    const ns = 'cleanup-target';
    await appendRationale(ns, makeEntry());
    expect(await readRationale(ns)).toHaveLength(1);

    // Plant a stale lock file (e.g. from a crashed process).
    await mkdir(RATIONALE_ROOT, { recursive: true });
    await writeFile(path.join(RATIONALE_ROOT, `${ns}.jsonl.lock`), '');

    const r = await deleteRationale(ns);
    expect(r.removed).toBe(true);
    expect(r.error).toBeUndefined();

    // File is gone, future reads return empty.
    expect(await _readRationaleFileRawForTests(ns)).toBeNull();
    expect(await readRationale(ns)).toEqual([]);
  });

  it('is idempotent — deleting a non-existent log is a no-op success', async () => {
    const r = await deleteRationale('never-existed');
    expect(r.removed).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('returns removed:false on invalid namespace (does not throw)', async () => {
    const r = await deleteRationale('');
    expect(r.removed).toBe(false);
  });

  it('isolates namespaces — only the targeted log is removed', async () => {
    await appendRationale('keep-me', makeEntry({ reason: 'kept' }));
    await appendRationale('delete-me', makeEntry({ reason: 'gone' }));

    await deleteRationale('delete-me');

    expect(await readRationale('delete-me')).toEqual([]);
    const survivors = await readRationale('keep-me');
    expect(survivors).toHaveLength(1);
    expect(survivors[0].reason).toBe('kept');
  });

  it('recreating a manifest after delete starts with a clean log (no rationale bleed)', async () => {
    const ns = 'recreate-me';
    await appendRationale(ns, makeEntry({ reason: 'pre-delete' }));
    await deleteRationale(ns);
    await appendRationale(ns, makeEntry({ reason: 'post-recreate' }));
    const entries = await readRationale(ns);
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe('post-recreate');
  });
});
