// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `revertManifest()`.
 *
 * Three behaviors:
 *   1. snapshot exists with manifestYaml → re-apply that YAML
 *   2. snapshot missing → delete-namespace fallback
 *   3. snapshot exists but has no manifestYaml → delete-namespace fallback
 *
 * Plus input validation + error propagation from the underlying
 * applyManifest / deleteNamespace calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../oscfg', () => ({
  applyManifest: vi.fn(),
  deleteNamespace: vi.fn(),
  deleteRegistration: vi.fn(),
  parseYamlDocument: vi.fn((s: string) => {
    // Lightweight YAML stub: only handles the shapes the tests use.
    // Tests pass either 'resources: []' (valid empty) or
    // 'resources: invalid' (schema-invalid scalar).
    const trimmed = s.trim();
    if (trimmed === 'resources: []') return { resources: [] };
    if (/^resources:\s*\[\s*\]\s*$/.test(trimmed)) return { resources: [] };
    if (trimmed.startsWith('resources: ')) {
      const tail = trimmed.slice('resources: '.length).trim();
      if (tail === '[]' || tail === 'null') return { resources: tail === '[]' ? [] : null };
      // Anything else is "schema-invalid scalar" for our stub.
      return { resources: tail };
    }
    if (trimmed.startsWith('not-yaml:')) {
      // Pretend a malformed YAML throws.
      throw new Error('YAML parse error: stub');
    }
    return null;
  }),
  sanitizeNamespace: vi.fn((s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-')),
}));

vi.mock('../platform', () => ({
  validateManifestSchema: vi.fn((parsed: unknown) => {
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { resources?: unknown }).resources)
    ) {
      return [];
    }
    return ['Manifest must have a resources array'];
  }),
  hasMixedPlatformResources: vi.fn(() => false),
  validateManifestPlatform: vi.fn(() => []),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('../runtime/paths', () => ({
  resolveUserDataDir: vi.fn(() => '/tmp/cfs-test-userdata'),
  resolveTempDir: vi.fn(() => '/tmp/cfs-test-temp'),
}));

import { revertManifest } from './revert';
import * as oscfg from '../oscfg';
import * as platform from '../platform';
import * as fs from 'node:fs/promises';

const applyManifestMock = vi.mocked(oscfg.applyManifest);
const deleteNamespaceMock = vi.mocked(oscfg.deleteNamespace);
const deleteRegistrationMock = vi.mocked(oscfg.deleteRegistration);
const validateSchemaMock = vi.mocked(platform.validateManifestSchema);
const hasMixedMock = vi.mocked(platform.hasMixedPlatformResources);
const validatePlatformMock = vi.mocked(platform.validateManifestPlatform);
const readFileMock = vi.mocked(fs.readFile);
const writeFileMock = vi.mocked(fs.writeFile);
const unlinkMock = vi.mocked(fs.unlink);
const mkdirMock = vi.mocked(fs.mkdir);

beforeEach(() => {
  vi.clearAllMocks();
  // default success returns
  applyManifestMock.mockResolvedValue({ success: true, error: null, exitCode: 0, data: null });
  deleteNamespaceMock.mockResolvedValue({ success: true, error: null, exitCode: 0, data: null });
  deleteRegistrationMock.mockResolvedValue();
  writeFileMock.mockResolvedValue();
  unlinkMock.mockResolvedValue();
  mkdirMock.mockResolvedValue(undefined);
  // Default: snapshot YAML is valid.
  validateSchemaMock.mockReturnValue([]);
  hasMixedMock.mockReturnValue(false);
  validatePlatformMock.mockReturnValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('revertManifest', () => {
  it('rejects empty name with 400', async () => {
    await expect(revertManifest({ name: '' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/required/i),
    });
  });

  it('rejects missing payload with 400', async () => {
    await expect(revertManifest(undefined as never)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('re-applies the manifest YAML when snapshot has manifestYaml', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        name: 'mybase',
        manifestYaml: 'resources: []',
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );

    const result = await revertManifest({ name: 'MyBase' });

    expect(result.data.Method).toBe('reapply-manifest');
    expect(result.data.preDeployTimestamp).toBe('2026-01-01T00:00:00Z');
    expect(applyManifestMock).toHaveBeenCalledTimes(1);
    // Should NOT fall through to deleteNamespace.
    expect(deleteNamespaceMock).not.toHaveBeenCalled();
    // Temp file should be written then cleaned up.
    expect(writeFileMock).toHaveBeenCalled();
    // Snapshot file + temp file = 2 unlinks.
    expect(unlinkMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to delete-namespace when snapshot missing entirely', async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await revertManifest({ name: 'NoSnap' });

    expect(result.data.Method).toBe('delete-namespace');
    expect(result.message).toMatch(/no pre-deploy snapshot found/i);
    expect(deleteNamespaceMock).toHaveBeenCalledTimes(1);
    expect(deleteRegistrationMock).toHaveBeenCalledTimes(1);
    expect(applyManifestMock).not.toHaveBeenCalled();
  });

  it('falls back to delete-namespace when snapshot has no manifestYaml', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({ name: 'partial' }));

    const result = await revertManifest({ name: 'partial' });

    expect(result.data.Method).toBe('delete-namespace');
    expect(deleteNamespaceMock).toHaveBeenCalled();
    // Snapshot file gets unlinked since it existed but was incomplete.
    expect(unlinkMock).toHaveBeenCalled();
  });

  it('surfaces applyManifest failure as 500', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ name: 'x', manifestYaml: 'resources: []' }),
    );
    applyManifestMock.mockResolvedValueOnce({
      success: false,
      error: 'oscfg crashed',
      exitCode: 1,
      data: null,
    });

    await expect(revertManifest({ name: 'x' })).rejects.toMatchObject({
      status: 500,
      message: 'oscfg crashed',
    });
  });

  it('surfaces deleteNamespace failure as 500', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT'));
    deleteNamespaceMock.mockResolvedValueOnce({
      success: false,
      error: 'permission denied',
      exitCode: 1,
      data: null,
    });

    await expect(revertManifest({ name: 'x' })).rejects.toMatchObject({
      status: 500,
      message: 'permission denied',
    });
  });

  // ── H6 regression: re-validate snapshot YAML before applying ──────
  describe('H6 — pre-revert validation', () => {
    it('refuses to re-apply a malformed snapshot (schema invalid)', async () => {
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({
          name: 'broken',
          manifestYaml: 'resources: not-an-array',
        }),
      );
      validateSchemaMock.mockReturnValueOnce(['`resources` must be an array (sequence), not a map']);

      await expect(revertManifest({ name: 'broken' })).rejects.toMatchObject({
        status: 500,
        message: expect.stringMatching(/schema is invalid/i),
      });
      // Critical: applyManifest must NOT have run.
      expect(applyManifestMock).not.toHaveBeenCalled();
      // And we must NOT have fallen through to delete-namespace either —
      // we surface the error so the user can investigate.
      expect(deleteNamespaceMock).not.toHaveBeenCalled();
    });

    it('refuses to re-apply a snapshot mixing Windows and Linux types', async () => {
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({ name: 'mixed', manifestYaml: 'resources: []' }),
      );
      hasMixedMock.mockReturnValueOnce(true);

      await expect(revertManifest({ name: 'mixed' })).rejects.toMatchObject({
        status: 500,
        message: expect.stringMatching(/mixes Windows and Linux/),
      });
      expect(applyManifestMock).not.toHaveBeenCalled();
    });

    it('refuses to re-apply a snapshot whose platform does not match the host', async () => {
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({ name: 'wrongos', manifestYaml: 'resources: []' }),
      );
      validatePlatformMock.mockReturnValueOnce([
        'r1: type Windows.Registry not valid on linux',
      ]);

      await expect(revertManifest({ name: 'wrongos' })).rejects.toMatchObject({
        status: 500,
        message: expect.stringMatching(/different platform/i),
      });
      expect(applyManifestMock).not.toHaveBeenCalled();
    });

    it('still applies a valid snapshot YAML (regression: validation must not break the happy path)', async () => {
      readFileMock.mockResolvedValueOnce(
        JSON.stringify({ name: 'ok', manifestYaml: 'resources: []' }),
      );
      // Defaults from beforeEach have everything green.
      const result = await revertManifest({ name: 'ok' });
      expect(result.data.Method).toBe('reapply-manifest');
      expect(applyManifestMock).toHaveBeenCalledTimes(1);
    });
  });
});
