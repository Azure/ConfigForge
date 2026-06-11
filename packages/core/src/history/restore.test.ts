// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it, vi } from 'vitest';
import { safeRestore, type RestoreClient } from './restore';

/**
 * Builds a RestoreClient where each method is a vi.fn() so tests can
 * (a) override individual behaviors and (b) assert call ordering.
 */
function buildClient(overrides: Partial<RestoreClient> = {}): {
  client: RestoreClient;
  calls: string[];
} {
  const calls: string[] = [];
  const client: RestoreClient = {
    fetchSnapshotContent: vi.fn(async (n, id) => {
      calls.push(`fetchSnapshotContent(${n},${id})`);
      return 'snapshot-yaml';
    }),
    fetchCurrentYaml: vi.fn(async (n) => {
      calls.push(`fetchCurrentYaml(${n})`);
      return 'current-yaml';
    }),
    saveAutoSnapshot: vi.fn(async (n, _yaml, msg) => {
      calls.push(`saveAutoSnapshot(${n},${msg})`);
    }),
    registerManifest: vi.fn(async (n, yaml) => {
      calls.push(`registerManifest(${n},${yaml})`);
    }),
    ...overrides,
  };
  return { client, calls };
}

describe('safeRestore', () => {
  it('happy path: auto-snapshots current then re-registers with snapshot', async () => {
    const { client, calls } = buildClient();
    const r = await safeRestore('m1', 'snap-1', client);
    expect(r).toEqual({ ok: true, autoSnapshotted: true });
    expect(calls).toEqual([
      'fetchSnapshotContent(m1,snap-1)',
      'fetchCurrentYaml(m1)',
      'saveAutoSnapshot(m1,Auto-snapshot before restore of snap-1)',
      'registerManifest(m1,snapshot-yaml)',
    ]);
  });

  it('skips auto-snapshot when there is no current YAML and still restores', async () => {
    const { client, calls } = buildClient({
      fetchCurrentYaml: vi.fn(async () => ''),
    });
    const r = await safeRestore('m1', 'snap-1', client);
    expect(r).toEqual({ ok: true, autoSnapshotted: false });
    expect(calls.includes('saveAutoSnapshot(m1,Auto-snapshot before restore of snap-1)')).toBe(false);
    expect(calls.at(-1)).toBe('registerManifest(m1,snapshot-yaml)');
  });

  it('treats fetchCurrentYaml errors as "no current YAML"', async () => {
    const { client } = buildClient({
      fetchCurrentYaml: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const r = await safeRestore('m1', 'snap-1', client);
    expect(r.ok).toBe(true);
    expect(r.autoSnapshotted).toBe(false);
  });

  it('refuses to restore when auto-snapshot fails (preserves recovery invariant)', async () => {
    const { client, calls } = buildClient({
      saveAutoSnapshot: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const r = await safeRestore('m1', 'snap-1', client);
    expect(r.ok).toBe(false);
    expect(r.autoSnapshotted).toBe(false);
    expect(r.error).toMatch(/Auto-snapshot failed/);
    // Crucially, registerManifest must NOT have run.
    expect(calls.includes('registerManifest(m1,snapshot-yaml)')).toBe(false);
  });

  it('reports auto-snapshot success even if register fails (so caller can recover)', async () => {
    const { client } = buildClient({
      registerManifest: vi.fn(async () => {
        throw new Error('CLI exploded');
      }),
    });
    const r = await safeRestore('m1', 'snap-1', client);
    expect(r.ok).toBe(false);
    expect(r.autoSnapshotted).toBe(true);
    expect(r.error).toMatch(/Restore failed.*CLI exploded/);
  });

  it('aborts cleanly when snapshot fetch fails (no auto-snapshot, no register)', async () => {
    const { client } = buildClient({
      fetchSnapshotContent: vi.fn(async () => {
        throw new Error('not found');
      }),
    });
    const r = await safeRestore('m1', 'missing', client);
    expect(r.ok).toBe(false);
    expect(r.autoSnapshotted).toBe(false);
    expect(r.error).toMatch(/Snapshot fetch failed/);
    // No side-effecting calls past the failed fetch.
    expect(client.fetchCurrentYaml).not.toHaveBeenCalled();
    expect(client.saveAutoSnapshot).not.toHaveBeenCalled();
    expect(client.registerManifest).not.toHaveBeenCalled();
  });

  it('uses the snapshot id in the auto-snapshot message', async () => {
    const { client } = buildClient();
    await safeRestore('mname', 'my-snap-id-7', client);
    expect(client.saveAutoSnapshot).toHaveBeenCalledWith(
      'mname',
      'current-yaml',
      'Auto-snapshot before restore of my-snap-id-7',
    );
  });

  it('order: snapshot fetch happens BEFORE any side-effecting call', async () => {
    const { client, calls } = buildClient();
    await safeRestore('m1', 'x', client);
    const snapshotFetchIdx = calls.indexOf('fetchSnapshotContent(m1,x)');
    const autoIdx = calls.findIndex((c) => c.startsWith('saveAutoSnapshot'));
    const regIdx = calls.findIndex((c) => c.startsWith('registerManifest'));
    expect(snapshotFetchIdx).toBeLessThan(autoIdx);
    expect(autoIdx).toBeLessThan(regIdx);
  });
});
