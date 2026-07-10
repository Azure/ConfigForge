// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cfsMock } = vi.hoisted(() => ({
  cfsMock: {
    history: {
      list: vi.fn(),
      save: vi.fn(),
    },
    manifests: {
      status: vi.fn(),
      register: vi.fn(),
    },
  },
}));

vi.mock('./cfs', () => ({ cfs: cfsMock }));

import { safeRestore } from '@configforge/core/history/restore';
import { electronRestoreClient } from './electron-restore-client';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('electronRestoreClient', () => {
  it('returns snapshot content and rejects missing snapshots', async () => {
    cfsMock.history.list.mockResolvedValueOnce({ data: { content: 'snapshot-yaml' } });
    const client = electronRestoreClient();
    await expect(client.fetchSnapshotContent('m1', 's1')).resolves.toBe('snapshot-yaml');

    cfsMock.history.list.mockResolvedValueOnce({ data: null });
    await expect(client.fetchSnapshotContent('m1', 'missing')).rejects.toThrow(
      /Snapshot 'missing' not found/,
    );
  });

  it('distinguishes a successful missing registration from an IPC failure', async () => {
    const client = electronRestoreClient();
    cfsMock.manifests.status.mockResolvedValueOnce({ data: null });
    await expect(client.fetchCurrentYaml('m1')).resolves.toBe('');

    cfsMock.manifests.status.mockRejectedValueOnce(new Error('IPC disconnected'));
    await expect(client.fetchCurrentYaml('m1')).rejects.toThrow('IPC disconnected');
  });

  it('preserves string YAML and serializes structured status responses', async () => {
    const client = electronRestoreClient();
    cfsMock.manifests.status.mockResolvedValueOnce({ data: 'resources: []\n' });
    await expect(client.fetchCurrentYaml('m1')).resolves.toBe('resources: []\n');

    cfsMock.manifests.status.mockResolvedValueOnce({ data: { resources: [] } });
    await expect(client.fetchCurrentYaml('m1')).resolves.toBe(
      JSON.stringify({ resources: [] }, null, 2),
    );
  });

  it('forwards auto-snapshot and registration writes exactly', async () => {
    cfsMock.history.save.mockResolvedValueOnce(undefined);
    cfsMock.manifests.register.mockResolvedValueOnce({ ok: true });
    const client = electronRestoreClient();

    await client.saveAutoSnapshot('m1', 'current-yaml', 'before restore');
    await client.registerManifest('m1', 'snapshot-yaml');

    expect(cfsMock.history.save).toHaveBeenCalledWith({
      name: 'm1',
      content: 'current-yaml',
      message: 'before restore',
    });
    expect(cfsMock.manifests.register).toHaveBeenCalledWith({
      name: 'm1',
      content: 'snapshot-yaml',
    });
  });

  it('safeRestore never writes when current-state lookup fails', async () => {
    cfsMock.history.list.mockResolvedValueOnce({ data: { content: 'snapshot-yaml' } });
    cfsMock.manifests.status.mockRejectedValueOnce(new Error('status unavailable'));
    const result = await safeRestore('m1', 's1', electronRestoreClient());

    expect(result).toMatchObject({
      ok: false,
      autoSnapshotted: false,
      error: expect.stringMatching(/Current manifest fetch failed.*status unavailable/),
    });
    expect(cfsMock.history.save).not.toHaveBeenCalled();
    expect(cfsMock.manifests.register).not.toHaveBeenCalled();
  });
});
