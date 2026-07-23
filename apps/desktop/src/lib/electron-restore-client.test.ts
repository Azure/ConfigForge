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
      getSource: vi.fn(),
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

  it('reads canonical registered YAML and propagates failures', async () => {
    const client = electronRestoreClient();
    cfsMock.manifests.getSource.mockResolvedValueOnce({ data: 'resources: []\n' });
    await expect(client.fetchCurrentYaml('m1')).resolves.toBe('resources: []\n');
    expect(cfsMock.manifests.getSource).toHaveBeenCalledWith('m1');

    cfsMock.manifests.getSource.mockRejectedValueOnce(new Error('IPC disconnected'));
    await expect(client.fetchCurrentYaml('m1')).rejects.toThrow('IPC disconnected');
  });

  it('returns an empty source when the manifest is currently unregistered', async () => {
    const client = electronRestoreClient();
    cfsMock.manifests.getSource.mockResolvedValueOnce({ data: null });
    await expect(client.fetchCurrentYaml('m1')).resolves.toBe('');
  });

  it('rejects when the canonical source response is malformed', async () => {
    const client = electronRestoreClient();
    cfsMock.manifests.getSource.mockResolvedValueOnce({});
    await expect(client.fetchCurrentYaml('m1')).rejects.toThrow(
      /Canonical source YAML is unavailable/,
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
    cfsMock.manifests.getSource.mockRejectedValueOnce(new Error('status unavailable'));
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
