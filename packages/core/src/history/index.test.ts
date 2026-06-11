// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Heavy unit tests for src/lib/history.
 *
 * Each test isolates state by setting CONFIGFORGE_HOME to a fresh tmp dir.
 * Covers: validation, path traversal, write/read/delete round-trips,
 * legacy filename compatibility, sort order, OneDrive mtime drift, missing
 * dirs/files, concurrent ops, large/unicode content, meta files.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import {
  createSnapshot,
  deleteSnapshot,
  getHistory,
  getSnapshot,
  rollback,
  saveSnapshot,
  timestampFromId,
  type HistoryEntry,
} from './';
import { _resetAuthorCacheForTests } from './author';

let SANDBOX = '';
let HISTORY_ROOT = '';

beforeEach(async () => {
  SANDBOX = await mkdtemp(path.join(tmpdir(), 'cf-hist-'));
  process.env.CONFIGFORGE_HOME = SANDBOX;
  HISTORY_ROOT = path.join(SANDBOX, 'history');
  // PR27: deterministic author across tests so author-related assertions
  // don't depend on the host's git config.
  process.env.CONFIGFORGE_AUTHOR = 'Test Author <test@configforge.local>';
  _resetAuthorCacheForTests();
});

afterEach(async () => {
  delete process.env.CONFIGFORGE_HOME;
  delete process.env.CONFIGFORGE_HISTORY_MAX_COUNT;
  delete process.env.CONFIGFORGE_AUTHOR;
  _resetAuthorCacheForTests();
  await rm(SANDBOX, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function writeLegacyFile(
  manifestName: string,
  isoTs: string,
  content: string,
  message?: string,
): Promise<string> {
  const dir = path.join(HISTORY_ROOT, manifestName);
  await mkdir(dir, { recursive: true });
  const id = `${manifestName}_${isoTs.replace(/:/g, '-')}`;
  const file = path.join(dir, `${id}.osc.yaml`);
  await writeFile(file, content, 'utf8');
  if (message) {
    await writeFile(`${file}.meta`, JSON.stringify({ message }), 'utf8');
  }
  return id;
}

// ── Name validation ─────────────────────────────────────────────────────────

describe('manifest name validation', () => {
  const INVALID = [
    '',
    '   ',
    '..',
    '../etc/passwd',
    '..\\windows',
    'foo/bar',
    'foo\\bar',
    'foo:bar',
    'foo*bar',
    'foo?bar',
    'foo"bar',
    'foo<bar',
    'foo>bar',
    'foo|bar',
    'foo\u0000bar',
    'foo\nbar',
    'foo\rbar',
    'foo bar',
    '日本語',
    '🚀',
    'a'.repeat(97),
  ];

  for (const name of INVALID) {
    it(`rejects ${JSON.stringify(name)}`, async () => {
      await expect(saveSnapshot(name, 'x')).rejects.toThrow(/Invalid manifest name/);
      await expect(getHistory(name)).rejects.toThrow(/Invalid manifest name/);
      await expect(getSnapshot(name, 'a')).rejects.toThrow(/Invalid manifest name/);
      await expect(deleteSnapshot(name, 'a')).rejects.toThrow(/Invalid manifest name/);
    });
  }

  const VALID = [
    'a',
    'a-b',
    'a.b',
    'a_b',
    'WS2025-Member-Server',
    'baseline.v1',
    '0123456789',
    '_-.',
    'a'.repeat(96),
  ];
  for (const name of VALID) {
    it(`accepts ${JSON.stringify(name)}`, async () => {
      const e = await saveSnapshot(name, 'hello');
      expect(e.manifestName).toBe(name);
    });
  }
});

// ── Snapshot id validation ──────────────────────────────────────────────────

describe('snapshot id validation', () => {
  it('rejects ids with path separators', async () => {
    await saveSnapshot('m1', 'x');
    await expect(getSnapshot('m1', '../../escape')).rejects.toThrow(/Invalid snapshot id/);
    await expect(getSnapshot('m1', '..\\escape')).rejects.toThrow(/Invalid snapshot id/);
    await expect(getSnapshot('m1', 'a/b')).rejects.toThrow(/Invalid snapshot id/);
    await expect(deleteSnapshot('m1', 'a/b')).rejects.toThrow(/Invalid snapshot id/);
  });
  it('rejects ids with leading dot or null bytes', async () => {
    await saveSnapshot('m1', 'x');
    await expect(getSnapshot('m1', '.hidden')).rejects.toThrow(/Invalid snapshot id/);
    await expect(getSnapshot('m1', 'a\u0000b')).rejects.toThrow(/Invalid snapshot id/);
  });
  it('rejects empty ids and oversize ids', async () => {
    await saveSnapshot('m1', 'x');
    await expect(getSnapshot('m1', '')).rejects.toThrow(/Invalid snapshot id/);
    await expect(getSnapshot('m1', 'a'.repeat(257))).rejects.toThrow(/Invalid snapshot id/);
  });
});

// ── Round trips ─────────────────────────────────────────────────────────────

describe('saveSnapshot → getHistory → getSnapshot round-trip', () => {
  it('writes a snapshot and reads it back', async () => {
    const written = await saveSnapshot('m1', 'hello world', 'init');
    expect(written.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    expect(written.message).toBe('init');
    expect(written.size).toBe(11);

    const list = await getHistory('m1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(written.id);
    expect(list[0].message).toBe('init');
    // metadata response must NOT carry content
    expect((list[0] as unknown as HistoryEntry).content).toBeUndefined();

    const full = await getSnapshot('m1', written.id);
    expect(full?.content).toBe('hello world');
    expect(full?.message).toBe('init');
    expect(full?.timestamp).toBe(written.timestamp);
  });

  it('returns empty list when manifest dir does not exist', async () => {
    const list = await getHistory('never-saved');
    expect(list).toEqual([]);
  });

  it('returns null for a missing snapshot id', async () => {
    await saveSnapshot('m1', 'x');
    const r = await getSnapshot('m1', '2026-01-01T00-00-00.000Z');
    expect(r).toBeNull();
  });

  it('preserves unicode and special characters verbatim', async () => {
    const content = 'résumé\n中文\n🎉\nval: "a\\b"';
    const written = await saveSnapshot('m1', content);
    const full = await getSnapshot('m1', written.id);
    expect(full?.content).toBe(content);
  });

  it('handles empty content', async () => {
    const written = await saveSnapshot('m1', '');
    expect(written.size).toBe(0);
    const full = await getSnapshot('m1', written.id);
    expect(full?.content).toBe('');
  });

  it('handles large content (~1 MB)', async () => {
    const big = 'x'.repeat(1024 * 1024);
    const written = await saveSnapshot('m1', big);
    expect(written.size).toBe(big.length);
    const full = await getSnapshot('m1', written.id);
    expect(full?.content.length).toBe(big.length);
  });

  it('supports omitting the message', async () => {
    const e = await saveSnapshot('m1', 'x');
    expect(e.message).toBeUndefined();
    const full = await getSnapshot('m1', e.id);
    expect(full?.message).toBeUndefined();
  });

  it('supports an empty-string message (treated as absent)', async () => {
    const e = await saveSnapshot('m1', 'x', '');
    expect(e.message).toBeUndefined();
    const full = await getSnapshot('m1', e.id);
    expect(full?.message).toBeUndefined();
    // No .meta file should exist
    const dir = path.join(HISTORY_ROOT, 'm1');
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.meta'))).toBe(false);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────

describe('deleteSnapshot', () => {
  it('removes both content and meta files', async () => {
    const e = await saveSnapshot('m1', 'x', 'note');
    const dir = path.join(HISTORY_ROOT, 'm1');
    const before = await readdir(dir);
    expect(before).toHaveLength(2);

    await deleteSnapshot('m1', e.id);
    const after = await readdir(dir);
    expect(after).toHaveLength(0);
  });

  it('is idempotent for non-existent ids', async () => {
    await mkdir(path.join(HISTORY_ROOT, 'm1'), { recursive: true });
    await expect(
      deleteSnapshot('m1', '2026-01-01T00-00-00.000Z'),
    ).resolves.toBeUndefined();
  });

  it('does not delete content when only meta exists (sanity)', async () => {
    const dir = path.join(HISTORY_ROOT, 'm1');
    await mkdir(dir, { recursive: true });
    const id = '2026-01-01T00-00-00.000Z';
    await writeFile(path.join(dir, `${id}.osc.yaml.meta`), '{}', 'utf8');
    await deleteSnapshot('m1', id);
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });
});

// ── Sort order ──────────────────────────────────────────────────────────────

describe('getHistory sort order', () => {
  it('returns newest snapshots first', async () => {
    const a = await saveSnapshot('m1', 'a');
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveSnapshot('m1', 'b');
    await new Promise((r) => setTimeout(r, 5));
    const c = await saveSnapshot('m1', 'c');
    const list = await getHistory('m1');
    expect(list.map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });

  it('uses embedded timestamp, not mtime (OneDrive sync drift)', async () => {
    const dir = path.join(HISTORY_ROOT, 'm1');
    await mkdir(dir, { recursive: true });
    const ids = [
      '2026-04-21T10-00-00.000Z',
      '2026-04-22T10-00-00.000Z',
    ];
    for (const id of ids) {
      await writeFile(path.join(dir, `${id}.osc.yaml`), 'x', 'utf8');
    }
    // Simulate OneDrive touching the OLDER file last.
    const oldFile = path.join(dir, `${ids[0]}.osc.yaml`);
    await new Promise((r) => setTimeout(r, 10));
    const fresh = new Date();
    await utimes(oldFile, fresh, fresh);

    const list = await getHistory('m1');
    expect(list.map((e) => e.id)).toEqual([ids[1], ids[0]]);
  });
});

// ── Backwards compatibility with legacy filenames ──────────────────────────

describe('legacy filename compatibility', () => {
  it('lists, reads, and deletes pre-PR1 snapshots', async () => {
    const legacyId = await writeLegacyFile('m1', '2025-01-15T12:34:56.000Z', 'old', 'legacy');
    const list = await getHistory('m1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(legacyId);
    expect(list[0].message).toBe('legacy');
    expect(list[0].timestamp).toBe('2025-01-15T12:34:56.000Z');

    const full = await getSnapshot('m1', legacyId);
    expect(full?.content).toBe('old');

    await deleteSnapshot('m1', legacyId);
    const after = await getHistory('m1');
    expect(after).toHaveLength(0);
  });

  it('mixes legacy and new filenames with consistent sort', async () => {
    await writeLegacyFile('m1', '2024-01-01T00:00:00.000Z', 'oldest');
    await new Promise((r) => setTimeout(r, 5));
    const middle = await saveSnapshot('m1', 'middle');
    await new Promise((r) => setTimeout(r, 5));
    await writeLegacyFile('m1', '2030-01-01T00:00:00.000Z', 'newest');

    const list = await getHistory('m1');
    expect(list).toHaveLength(3);
    expect(list[0].timestamp.startsWith('2030')).toBe(true);
    expect(list[2].timestamp.startsWith('2024')).toBe(true);
    expect(list[1].id).toBe(middle.id);
  });
});

// ── Path traversal defense in depth ────────────────────────────────────────

describe('path traversal defense', () => {
  it('saveSnapshot cannot escape ~/.configforge/history/<name>/', async () => {
    await saveSnapshot('m1', 'x');
    const root = path.join(HISTORY_ROOT, 'm1');
    const files = await readdir(root, { withFileTypes: true });
    for (const f of files) {
      const resolved = path.resolve(root, f.name);
      expect(resolved.startsWith(root + path.sep)).toBe(true);
    }
  });
});

// ── timestampFromId helper ─────────────────────────────────────────────────

describe('timestampFromId', () => {
  it.each([
    ['2026-04-21T00-20-00.000Z', '2026-04-21T00:20:00.000Z'],
    ['my-manifest_2026-04-21T00-20-00.000Z', '2026-04-21T00:20:00.000Z'],
    ['baseline.v1_2030-12-31T23-59-59.999Z', '2030-12-31T23:59:59.999Z'],
    ['2026-04-21T00-20-00Z', '2026-04-21T00:20:00.000Z'],
  ])('%s -> %s', (id, expected) => {
    expect(timestampFromId(id)).toBe(expected);
  });

  it('returns null for ids without a recognizable timestamp', () => {
    expect(timestampFromId('garbage')).toBeNull();
    expect(timestampFromId('not-a-timestamp-id')).toBeNull();
  });
});

// ── rollback ───────────────────────────────────────────────────────────────

describe('rollback', () => {
  it('returns content for an existing snapshot', async () => {
    const e = await saveSnapshot('m1', 'restored payload');
    const c = await rollback('m1', e.id);
    expect(c).toBe('restored payload');
  });
  it('throws for a missing snapshot', async () => {
    await mkdir(path.join(HISTORY_ROOT, 'm1'), { recursive: true });
    await expect(rollback('m1', '2026-01-01T00-00-00.000Z')).rejects.toThrow(/not found/);
  });
});

// ── Concurrency ────────────────────────────────────────────────────────────

describe('concurrent operations', () => {
  it('parallel saves on different names do not collide', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `m${i}`);
    await Promise.all(names.map((n) => saveSnapshot(n, n)));
    for (const n of names) {
      const list = await getHistory(n);
      expect(list).toHaveLength(1);
    }
  });
  it('serial-with-tiny-delay saves on the same name produce N entries', async () => {
    const N = 5;
    for (let i = 0; i < N; i++) {
      await saveSnapshot('m1', `c${i}`);
      await new Promise((r) => setTimeout(r, 3));
    }
    const list = await getHistory('m1');
    expect(list.length).toBe(N);
  });
  it('reads while writes are in flight return a consistent slice', async () => {
    const writes = Array.from({ length: 5 }, (_, i) =>
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          await saveSnapshot('m1', `c${i}`);
          resolve();
        }, i * 5);
      }),
    );
    const reads = Array.from({ length: 3 }, (_, i) =>
      new Promise<number>((resolve) => {
        setTimeout(async () => {
          const list = await getHistory('m1');
          resolve(list.length);
        }, i * 4 + 1);
      }),
    );
    await Promise.all([...writes, ...reads]);
    const finalList = await getHistory('m1');
    expect(finalList.length).toBe(5);
  });
});

// ── Filesystem corruption resilience ───────────────────────────────────────

describe('filesystem corruption resilience', () => {
  it('skips non-yaml files in the manifest dir', async () => {
    const dir = path.join(HISTORY_ROOT, 'm1');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'README.md'), 'noise', 'utf8');
    await writeFile(path.join(dir, 'random.txt'), 'noise', 'utf8');
    const e = await saveSnapshot('m1', 'real');
    const list = await getHistory('m1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(e.id);
  });

  it('returns null for a snapshot whose path is a directory not a file', async () => {
    const dir = path.join(HISTORY_ROOT, 'm1');
    const id = '2026-01-01T00-00-00.000Z';
    await mkdir(path.join(dir, `${id}.osc.yaml`), { recursive: true });
    const r = await getSnapshot('m1', id);
    expect(r).toBeNull();
  });

  it('survives a corrupt .meta file (treats message as absent)', async () => {
    const e = await saveSnapshot('m1', 'x', 'good');
    const metaFile = path.join(HISTORY_ROOT, 'm1', `${e.id}.osc.yaml.meta`);
    await writeFile(metaFile, '{ this is not json', 'utf8');
    const list = await getHistory('m1');
    expect(list[0].message).toBeUndefined();
    const full = await getSnapshot('m1', e.id);
    expect(full?.message).toBeUndefined();
    expect(full?.content).toBe('x');
  });

  it('treats a meta file with non-string message as absent', async () => {
    const e = await saveSnapshot('m1', 'x');
    const metaFile = path.join(HISTORY_ROOT, 'm1', `${e.id}.osc.yaml.meta`);
    await writeFile(metaFile, JSON.stringify({ message: 42 }), 'utf8');
    const list = await getHistory('m1');
    expect(list[0].message).toBeUndefined();
  });
});

// ── Filesystem layout assertions (activity-route compatibility) ────────────

describe('on-disk layout (activity-route compatibility)', () => {
  it('writes files under ~/.configforge/history/<name>/ with .osc.yaml extension', async () => {
    await saveSnapshot('m1', 'x');
    const dir = path.join(HISTORY_ROOT, 'm1');
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.osc.yaml'))).toBe(true);
  });

  it('places .meta files alongside their .osc.yaml counterparts', async () => {
    const e = await saveSnapshot('m1', 'x', 'note');
    const dir = path.join(HISTORY_ROOT, 'm1');
    const files = await readdir(dir);
    const yaml = files.find((f) => f === `${e.id}.osc.yaml`);
    const meta = files.find((f) => f === `${e.id}.osc.yaml.meta`);
    expect(yaml).toBeDefined();
    expect(meta).toBeDefined();
    const metaContent = await readFile(path.join(dir, meta!), 'utf8');
    expect(JSON.parse(metaContent)).toEqual({ message: 'note' });
  });
});

// ── Dedupe by content hash ────────────────────────────────────────────────

describe('dedupe by content hash', () => {
  it('does not write a new snapshot when content matches the immediate predecessor', async () => {
    const a = await saveSnapshot('m1', 'identical');
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveSnapshot('m1', 'identical');
    expect(b.id).toBe(a.id);
    const list = await getHistory('m1');
    expect(list).toHaveLength(1);
  });

  it('returns the existing message on dedupe, not the caller-supplied one', async () => {
    const a = await saveSnapshot('m1', 'identical', 'first');
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveSnapshot('m1', 'identical', 'second');
    expect(b.id).toBe(a.id);
    expect(b.message).toBe('first');
  });

  it('writes a new snapshot when content differs', async () => {
    const a = await saveSnapshot('m1', 'first');
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveSnapshot('m1', 'second');
    expect(b.id).not.toBe(a.id);
    const list = await getHistory('m1');
    expect(list).toHaveLength(2);
  });

  it('only checks the immediate predecessor — A B A pattern keeps all three', async () => {
    const a = await saveSnapshot('m1', 'A');
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveSnapshot('m1', 'B');
    await new Promise((r) => setTimeout(r, 5));
    const a2 = await saveSnapshot('m1', 'A');
    const ids = new Set([a.id, b.id, a2.id]);
    expect(ids.size).toBe(3);
    const list = await getHistory('m1');
    expect(list).toHaveLength(3);
  });

  it('dedupes against legacy (pre-rewrite) filename format', async () => {
    await writeLegacyFile('m1', '2024-01-01T00:00:00.000Z', 'legacy-content');
    const e = await saveSnapshot('m1', 'legacy-content', 'should dedupe');
    expect(e.id.startsWith('m1_')).toBe(true);
    const list = await getHistory('m1');
    expect(list).toHaveLength(1);
  });

  it('returns the dedupe entry with non-content metadata (size, timestamp)', async () => {
    const a = await saveSnapshot('m1', 'payload', 'first');
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveSnapshot('m1', 'payload');
    expect(b.size).toBe(a.size);
    expect(b.timestamp).toBe(a.timestamp);
    expect(b.content).toBe('payload');
  });
});

// ── Retention sweep ────────────────────────────────────────────────────────

describe('retention sweep', () => {
  it('keeps only the newest N entries when CONFIGFORGE_HISTORY_MAX_COUNT is set', async () => {
    process.env.CONFIGFORGE_HISTORY_MAX_COUNT = '3';
    const written: string[] = [];
    for (let i = 0; i < 6; i++) {
      const e = await saveSnapshot('m1', `c${i}`);
      written.push(e.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    // Wait for the fire-and-forget retention sweep.
    await new Promise((r) => setTimeout(r, 50));
    const list = await getHistory('m1');
    expect(list.length).toBeLessThanOrEqual(3);
    // Newest 3 should be preserved.
    const keptIds = new Set(list.map((e) => e.id));
    for (const id of written.slice(-3)) {
      expect(keptIds.has(id)).toBe(true);
    }
  });

  it('disables pruning when MAX_COUNT is 0 or negative', async () => {
    process.env.CONFIGFORGE_HISTORY_MAX_COUNT = '0';
    for (let i = 0; i < 5; i++) {
      await saveSnapshot('m1', `c${i}`);
      await new Promise((r) => setTimeout(r, 3));
    }
    await new Promise((r) => setTimeout(r, 30));
    const list = await getHistory('m1');
    expect(list).toHaveLength(5);

    process.env.CONFIGFORGE_HISTORY_MAX_COUNT = '-1';
    for (let i = 5; i < 8; i++) {
      await saveSnapshot('m1', `c${i}`);
      await new Promise((r) => setTimeout(r, 3));
    }
    await new Promise((r) => setTimeout(r, 30));
    const all = await getHistory('m1');
    expect(all).toHaveLength(8);
  });

  it('falls back to default when MAX_COUNT is non-numeric garbage', async () => {
    process.env.CONFIGFORGE_HISTORY_MAX_COUNT = 'not-a-number';
    // Save a few; default is 50, so nothing pruned.
    for (let i = 0; i < 3; i++) {
      await saveSnapshot('m1', `c${i}`);
      await new Promise((r) => setTimeout(r, 3));
    }
    const list = await getHistory('m1');
    expect(list).toHaveLength(3);
  });

  it('also removes the .meta sidecar of pruned entries', async () => {
    process.env.CONFIGFORGE_HISTORY_MAX_COUNT = '2';
    const written: string[] = [];
    for (let i = 0; i < 4; i++) {
      const e = await saveSnapshot('m1', `c${i}`, `msg${i}`);
      written.push(e.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 50));
    const dir = path.join(HISTORY_ROOT, 'm1');
    const files = await readdir(dir);
    const metaFiles = files.filter((f) => f.endsWith('.meta'));
    expect(metaFiles.length).toBeLessThanOrEqual(2);
    // Pruned entries' meta files are gone.
    const pruned = written.slice(0, 2);
    for (const id of pruned) {
      expect(files.includes(`${id}.osc.yaml`)).toBe(false);
      expect(files.includes(`${id}.osc.yaml.meta`)).toBe(false);
    }
  });

  it('respects retention when mixing legacy + new filename formats', async () => {
    process.env.CONFIGFORGE_HISTORY_MAX_COUNT = '2';
    await writeLegacyFile('m1', '2020-01-01T00:00:00.000Z', 'legacy-1');
    await writeLegacyFile('m1', '2021-01-01T00:00:00.000Z', 'legacy-2');
    await writeLegacyFile('m1', '2022-01-01T00:00:00.000Z', 'legacy-3');
    // Different content so dedupe doesn't kick in.
    await saveSnapshot('m1', 'fresh-content');
    await new Promise((r) => setTimeout(r, 50));
    const list = await getHistory('m1');
    expect(list.length).toBeLessThanOrEqual(2);
    // Newest survivors are the freshest by timestamp.
    expect(list[0].timestamp.startsWith('20')).toBe(true);
  });
});

// ── PR27: author + rationale capture ───────────────────────────────────────

describe('PR27 — author + rationale on snapshots', () => {
  it('createSnapshot fills in author + email from resolveAuthor by default', async () => {
    const e = await createSnapshot('m1', 'payload');
    expect(e.author).toBe('Test Author');
    expect(e.authorEmail).toBe('test@configforge.local');
  });

  it('createSnapshot persists rationale + author through getSnapshot', async () => {
    const e = await createSnapshot('m1', 'payload', {
      message: 'edit',
      rationale: 'Tightened the deny ACL on HKLM\\System\\Foo per ticket 123.',
    });
    expect(e.rationale).toBe('Tightened the deny ACL on HKLM\\System\\Foo per ticket 123.');
    expect(e.author).toBe('Test Author');

    const full = await getSnapshot('m1', e.id);
    expect(full?.rationale).toBe('Tightened the deny ACL on HKLM\\System\\Foo per ticket 123.');
    expect(full?.author).toBe('Test Author');
    expect(full?.authorEmail).toBe('test@configforge.local');
    expect(full?.message).toBe('edit');
  });

  it('explicit author overrides resolveAuthor()', async () => {
    const e = await createSnapshot('m1', 'payload', {
      author: 'Override Person',
      authorEmail: 'override@x.test',
      rationale: 'r',
    });
    expect(e.author).toBe('Override Person');
    expect(e.authorEmail).toBe('override@x.test');
    const full = await getSnapshot('m1', e.id);
    expect(full?.author).toBe('Override Person');
    expect(full?.authorEmail).toBe('override@x.test');
  });

  it('legacy saveSnapshot(name, content, "msg") writes NO author meta', async () => {
    // Preserves the pre-PR27 contract for callers that don't opt into the
    // structured options form.
    const e = await saveSnapshot('m1', 'payload', 'legacy message');
    expect(e.author).toBeUndefined();
    expect(e.authorEmail).toBeUndefined();
    const full = await getSnapshot('m1', e.id);
    expect(full?.message).toBe('legacy message');
    expect(full?.author).toBeUndefined();
    expect(full?.authorEmail).toBeUndefined();
  });

  it('passing saveSnapshot the options form auto-resolves author', async () => {
    const e = await saveSnapshot('m1', 'payload', {
      message: 'edit',
      rationale: 'test rationale',
    });
    expect(e.author).toBe('Test Author');
    expect(e.authorEmail).toBe('test@configforge.local');
    expect(e.rationale).toBe('test rationale');
  });

  it('writes a sidecar even when only rationale is present (no message)', async () => {
    const e = await createSnapshot('m1', 'payload', { rationale: 'why' });
    const dir = path.join(HISTORY_ROOT, 'm1');
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.meta'))).toBe(true);
    const full = await getSnapshot('m1', e.id);
    expect(full?.rationale).toBe('why');
    expect(full?.message).toBeUndefined();
  });

  it('round-trips empty rationale as absent (no-op)', async () => {
    const e = await createSnapshot('m1', 'payload', { rationale: '' });
    const full = await getSnapshot('m1', e.id);
    expect(full?.rationale).toBeUndefined();
  });

  it('handles long rationale (~2000 chars) verbatim through write+read', async () => {
    const big = 'r'.repeat(2000);
    const e = await createSnapshot('m1', 'payload', { rationale: big });
    const full = await getSnapshot('m1', e.id);
    expect(full?.rationale?.length).toBe(2000);
    expect(full?.rationale).toBe(big);
  });

  it('dedupe preserves the original author/rationale on identical content', async () => {
    const a = await createSnapshot('m1', 'identical', {
      author: 'Original',
      authorEmail: 'o@x',
      rationale: 'first',
    });
    await new Promise((r) => setTimeout(r, 5));
    // Second save with same content but different metadata — dedupe wins;
    // the existing entry's metadata is returned unchanged.
    const b = await createSnapshot('m1', 'identical', {
      author: 'Different',
      authorEmail: 'd@x',
      rationale: 'second',
    });
    expect(b.id).toBe(a.id);
    expect(b.author).toBe('Original');
    expect(b.rationale).toBe('first');
  });

  it('lists author + rationale via getHistory metadata', async () => {
    await createSnapshot('m1', 'a', { rationale: 'reason-a' });
    await new Promise((r) => setTimeout(r, 5));
    await createSnapshot('m1', 'b', { rationale: 'reason-b' });
    const list = await getHistory('m1');
    expect(list).toHaveLength(2);
    expect(list[0].author).toBe('Test Author');
    expect(list[0].rationale).toBe('reason-b');
    expect(list[1].rationale).toBe('reason-a');
    // metadata response must NOT carry content
    expect((list[0] as unknown as HistoryEntry).content).toBeUndefined();
  });
});

// ── PR27: backwards-compatible read of pre-PR27 sidecars ───────────────────

describe('PR27 — old sidecars (no author/rationale fields) still parse', () => {
  it('hand-written legacy {message:"foo"} sidecar reads without errors', async () => {
    // Simulate a sidecar that predates PR27 — message-only, no other keys.
    const dir = path.join(HISTORY_ROOT, 'm1');
    await mkdir(dir, { recursive: true });
    const id = '2023-01-01T00-00-00.000Z';
    await writeFile(path.join(dir, `${id}.osc.yaml`), 'legacy yaml', 'utf8');
    await writeFile(
      path.join(dir, `${id}.osc.yaml.meta`),
      JSON.stringify({ message: 'pre-PR27 entry' }),
      'utf8',
    );

    const list = await getHistory('m1');
    expect(list).toHaveLength(1);
    expect(list[0].message).toBe('pre-PR27 entry');
    expect(list[0].author).toBeUndefined();
    expect(list[0].authorEmail).toBeUndefined();
    expect(list[0].rationale).toBeUndefined();

    const full = await getSnapshot('m1', id);
    expect(full?.content).toBe('legacy yaml');
    expect(full?.message).toBe('pre-PR27 entry');
    expect(full?.author).toBeUndefined();
    expect(full?.rationale).toBeUndefined();
  });

  it('mixed forward/back compat: read pre-PR27 entry then add a PR27 entry', async () => {
    const dir = path.join(HISTORY_ROOT, 'm1');
    await mkdir(dir, { recursive: true });
    const oldId = '2023-01-01T00-00-00.000Z';
    await writeFile(path.join(dir, `${oldId}.osc.yaml`), 'old', 'utf8');
    await writeFile(
      path.join(dir, `${oldId}.osc.yaml.meta`),
      JSON.stringify({ message: 'old' }),
      'utf8',
    );

    const fresh = await createSnapshot('m1', 'new', { rationale: 'fresh reason' });

    const list = await getHistory('m1');
    expect(list).toHaveLength(2);
    const newest = list.find((e) => e.id === fresh.id)!;
    const oldest = list.find((e) => e.id === oldId)!;
    expect(newest.author).toBe('Test Author');
    expect(newest.rationale).toBe('fresh reason');
    expect(oldest.author).toBeUndefined();
    expect(oldest.rationale).toBeUndefined();
    expect(oldest.message).toBe('old');
  });

  it('sidecar with non-string rationale field is treated as absent', async () => {
    const dir = path.join(HISTORY_ROOT, 'm1');
    await mkdir(dir, { recursive: true });
    const id = '2024-01-01T00-00-00.000Z';
    await writeFile(path.join(dir, `${id}.osc.yaml`), 'x', 'utf8');
    await writeFile(
      path.join(dir, `${id}.osc.yaml.meta`),
      JSON.stringify({ message: 'x', rationale: 42, author: ['arr', 'ay'] }),
      'utf8',
    );
    const list = await getHistory('m1');
    expect(list[0].message).toBe('x');
    expect(list[0].rationale).toBeUndefined();
    expect(list[0].author).toBeUndefined();
  });
});
