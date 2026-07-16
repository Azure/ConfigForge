// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const injected = vi.hoisted(() => ({
  failNextLockVerification: false,
  failNextLockStat: false,
  failNextLockWrite: false,
  failNextMetadataUnlink: false,
  failNextSourceUnlink: false,
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const [file, flags] = args;
      if (injected.failNextLockVerification && flags === 'r' && String(file).endsWith('.lock')) {
        injected.failNextLockVerification = false;
        throw Object.assign(new Error('injected lock verification read failure'), {
          code: 'EIO',
        });
      }
      const handle = await actual.open(...args);
      if (flags !== 'wx' || !String(file).endsWith('.lock')) return handle;

      return new Proxy(handle, {
        get(target, property) {
          if (property === 'stat') {
            return async (...statArgs: Parameters<typeof target.stat>) => {
              if (injected.failNextLockStat) {
                injected.failNextLockStat = false;
                throw Object.assign(new Error('injected lock stat failure'), {
                  code: 'EIO',
                });
              }
              return target.stat(...statArgs);
            };
          }
          if (property === 'writeFile') {
            return async (...writeArgs: Parameters<typeof target.writeFile>) => {
              if (injected.failNextLockWrite) {
                injected.failNextLockWrite = false;
                throw Object.assign(new Error('injected lock write failure'), {
                  code: 'EIO',
                });
              }
              return target.writeFile(...writeArgs);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      const [file] = args;
      if (injected.failNextMetadataUnlink && String(file).endsWith('delete-failure.json')) {
        injected.failNextMetadataUnlink = false;
        throw Object.assign(new Error('injected metadata unlink failure'), {
          code: 'EBUSY',
        });
      }
      if (injected.failNextSourceUnlink && String(file).endsWith('delete-failure.source.yaml')) {
        injected.failNextSourceUnlink = false;
        throw Object.assign(new Error('injected source unlink failure'), {
          code: 'EBUSY',
        });
      }
      return actual.unlink(...args);
    },
  };
});

import {
  deleteRegistration,
  getRegistration,
  getRegistrationSource,
  saveRegistration,
  type ManifestRegistration,
} from './registry';

let sandbox = '';

function registration(namespace: string): ManifestRegistration {
  return {
    namespace,
    displayName: namespace,
    platform: 'windows',
    registeredAt: '2026-07-16T00:00:00.000Z',
    source: 'user',
  };
}

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'cf-registry-lock-failure-'));
  process.env.CONFIGFORGE_HOME = sandbox;
});

afterEach(async () => {
  injected.failNextLockVerification = false;
  injected.failNextLockStat = false;
  injected.failNextLockWrite = false;
  injected.failNextMetadataUnlink = false;
  injected.failNextSourceUnlink = false;
  delete process.env.CONFIGFORGE_HOME;
  await rm(sandbox, { recursive: true, force: true });
});

describe('registry lock acquisition failure cleanup', () => {
  async function expectFailureThenReacquisition(namespace: string, message: RegExp): Promise<void> {
    await expect(saveRegistration(registration(namespace), 'resources: []')).rejects.toThrow(
      message,
    );

    const manifestsRoot = path.join(sandbox, 'manifests');
    expect(await readdir(manifestsRoot)).not.toContain(`${namespace}.lock`);
    await expect(
      saveRegistration(registration(namespace), 'resources: []'),
    ).resolves.toBeUndefined();
    expect(await readdir(manifestsRoot)).not.toContain(`${namespace}.lock`);
  }

  it('removes its owned lock and permits immediate reacquisition after verification fails', async () => {
    injected.failNextLockVerification = true;
    await expectFailureThenReacquisition(
      'verification-failure',
      /injected lock verification read failure/,
    );
  });

  it('removes its owned lock and permits immediate reacquisition after initial stat fails', async () => {
    injected.failNextLockStat = true;
    await expectFailureThenReacquisition('stat-failure', /injected lock stat failure/);
  });

  it('removes its owned lock and permits immediate reacquisition after writing fails', async () => {
    injected.failNextLockWrite = true;
    await expectFailureThenReacquisition('write-failure', /injected lock write failure/);
  });
});

describe('recovery-required registration delete failures', () => {
  it('deletes nothing when the registration commit marker cannot be removed', async () => {
    await saveRegistration(registration('delete-failure'), 'resources:\n  - name: original\n');
    injected.failNextMetadataUnlink = true;
    const cleanup = vi.fn();

    await expect(
      deleteRegistration('delete-failure', {
        requireRecovery: true,
        afterDeleteWhileLocked: cleanup,
      }),
    ).rejects.toThrow(/injected metadata unlink failure/);
    expect(cleanup).not.toHaveBeenCalled();
    await expect(getRegistration('delete-failure')).resolves.not.toBeNull();
    await expect(getRegistrationSource('delete-failure')).resolves.toBe(
      'resources:\n  - name: original\n',
    );
  });

  it('returns recovery after committed deletion when source-file cleanup is blocked', async () => {
    await saveRegistration(registration('delete-failure'), 'resources:\n  - name: original\n');
    injected.failNextSourceUnlink = true;

    await expect(
      deleteRegistration('delete-failure', { requireRecovery: true }),
    ).resolves.toMatchObject({
      removed: true,
      recovery: {
        namespace: 'delete-failure',
        sourceYaml: 'resources:\n  - name: original\n',
      },
    });
    await expect(getRegistration('delete-failure')).resolves.toBeNull();
    // This orphan is harmless: list/get use the JSON commit marker and a
    // future save or Undo atomically replaces the source.
    await expect(getRegistrationSource('delete-failure')).resolves.toBe(
      'resources:\n  - name: original\n',
    );
  });
});
