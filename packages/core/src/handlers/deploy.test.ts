// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the `runDeploy` handler. The handler is the largest in
 * the project — it orchestrates an admin pre-check, source YAML read,
 * platform validation, CLI apply, post-apply audit, and snapshot.
 *
 * Strategy: mock all I/O collaborators (oscfg, history, system,
 * platform). Test real behavior of the orchestration itself —
 * cancellation semantics, response envelope shape, progress event
 * sequence — not the collaborators' internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as oscfg from '../oscfg';
import * as history from '../history';
import * as system from '../system';
import * as platform from '../platform';
import {
  runDeploy,
  withDeployLock,
  _clearDeployLocksForTests,
  type DeployProgressEvent,
} from './deploy';
import { isHandlerError } from './errors';
import * as fsPromises from 'node:fs/promises';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('../oscfg', async () => {
  const actual = await vi.importActual<typeof import('../oscfg')>('../oscfg');
  return {
    ...actual,
    applyManifest: vi.fn(),
    getResources: vi.fn(),
    getRegistration: vi.fn(),
    getRegistrationSource: vi.fn(),
    updateRegistration: vi.fn(),
    execResource: vi.fn(),
    // Phase B: deploy preflight calls resolveOscfgBinary. Default mock
    // returns a healthy binary so existing tests behave as before;
    // the preflight-specific tests override per-call.
    resolveOscfgBinary: vi.fn().mockReturnValue({
      path: '/mock/oscfg',
      version: 'oscfg 1.3.9-preview11',
      platform: process.platform,
      source: 'env',
    }),
  };
});

vi.mock('../history', () => ({
  getHistory: vi.fn(),
  getSnapshot: vi.fn(),
}));

vi.mock('../system', () => ({
  getSystemInfo: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([] as string[]),
  unlink: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true, isDirectory: () => false, mtimeMs: 0, size: 0 }),
}));

const mocked = oscfg as unknown as {
  applyManifest: ReturnType<typeof vi.fn>;
  getResources: ReturnType<typeof vi.fn>;
  getRegistration: ReturnType<typeof vi.fn>;
  getRegistrationSource: ReturnType<typeof vi.fn>;
  updateRegistration: ReturnType<typeof vi.fn>;
  execResource: ReturnType<typeof vi.fn>;
  resolveOscfgBinary: ReturnType<typeof vi.fn>;
};

const mockedHistory = history as unknown as {
  getHistory: ReturnType<typeof vi.fn>;
  getSnapshot: ReturnType<typeof vi.fn>;
};

const mockedSystem = system as unknown as {
  getSystemInfo: ReturnType<typeof vi.fn>;
};

// Map process.platform to the platform helper's returned values.
const SAMPLE_RESOURCE = {
  type: process.platform === 'win32' ? 'Windows.Registry' : 'Linux.Sysctl',
  name: 'r1',
  properties: { foo: 'bar' },
};
const SAMPLE_YAML = `name: sample\nresources:\n  - type: ${SAMPLE_RESOURCE.type}\n    name: r1\n    properties:\n      foo: bar\n`;

// ── Helpers ───────────────────────────────────────────────────────

function makeRegistration(overrides: Record<string, unknown> = {}) {
  return {
    name: 'sample',
    platform: 'cross-platform',
    lastAppliedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function setHappyPath() {
  mocked.getRegistration.mockResolvedValue(makeRegistration());
  mocked.getRegistrationSource.mockResolvedValue(SAMPLE_YAML);
  mocked.getResources.mockResolvedValue({
    success: true,
    data: [{ name: 'r1', type: SAMPLE_RESOURCE.type, properties: { foo: 'bar' } }],
  });
  mocked.applyManifest.mockResolvedValue({ success: true });
  mocked.updateRegistration.mockResolvedValue(makeRegistration());
  mocked.execResource.mockResolvedValue({
    success: true,
    data: { name: 'r1', type: SAMPLE_RESOURCE.type, properties: { foo: 'bar' } },
  });
  mockedHistory.getHistory.mockResolvedValue([]);
  mockedHistory.getSnapshot.mockResolvedValue(null);
  mockedSystem.getSystemInfo.mockResolvedValue({ isAdmin: true });

  // platform helpers — partial spies; pass through default behavior
  vi.spyOn(platform, 'hasMixedPlatformResources').mockReturnValue(false);
  vi.spyOn(platform, 'validateManifestPlatform').mockReturnValue([]);
  vi.spyOn(platform, 'detectManifestPlatform').mockReturnValue(
    process.platform === 'win32' ? 'windows' : 'linux',
  );
  vi.spyOn(platform, 'extractResourceSummary').mockReturnValue([]);
  vi.spyOn(platform, 'extractResourcesFull').mockReturnValue([
    {
      type: SAMPLE_RESOURCE.type,
      name: 'r1',
      properties: { foo: 'bar' },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Validation failures ───────────────────────────────────────────

describe('runDeploy — validation', () => {
  it('throws 400 when name is missing', async () => {
    setHappyPath();
    await expect(runDeploy({ name: '' })).rejects.toMatchObject({
      status: 400,
      message: 'name is required',
    });
  });

  it('throws 403 when not admin (enforce mode)', async () => {
    setHappyPath();
    mockedSystem.getSystemInfo.mockResolvedValue({ isAdmin: false });
    await expect(runDeploy({ name: 'sample', mode: 'enforce' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('does NOT require admin for audit mode', async () => {
    setHappyPath();
    mockedSystem.getSystemInfo.mockResolvedValue({ isAdmin: false });
    const r = await runDeploy({ name: 'sample', mode: 'audit' });
    expect(r.data.DeployMode).toBe('audit');
  });

  it('throws 404 when registration source is missing (enforce)', async () => {
    setHappyPath();
    mocked.getRegistrationSource.mockResolvedValue(null);
    await expect(runDeploy({ name: 'sample', mode: 'enforce' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws 404 when manifest is not registered (audit)', async () => {
    setHappyPath();
    mocked.getRegistration.mockResolvedValue(null);
    mocked.getRegistrationSource.mockResolvedValue(null);
    await expect(runDeploy({ name: 'unknown', mode: 'audit' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws 400 for mixed-platform manifests (audit)', async () => {
    setHappyPath();
    mocked.getRegistration.mockResolvedValue(makeRegistration({ platform: 'mixed' }));
    await expect(runDeploy({ name: 'sample', mode: 'audit' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/mixes Windows and Linux/),
    });
  });

  it('throws 400 for cross-platform mismatch (audit)', async () => {
    setHappyPath();
    const wrongOs = process.platform === 'win32' ? 'linux' : 'windows';
    mocked.getRegistration.mockResolvedValue(makeRegistration({ platform: wrongOs }));
    await expect(runDeploy({ name: 'sample', mode: 'audit' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(new RegExp(wrongOs)),
    });
  });

  it('throws 400 for mixed-platform source YAML (enforce)', async () => {
    setHappyPath();
    vi.spyOn(platform, 'hasMixedPlatformResources').mockReturnValue(true);
    await expect(runDeploy({ name: 'sample', mode: 'enforce' })).rejects.toMatchObject({
      status: 400,
      message: 'Manifest mixes Windows and Linux resource types',
    });
  });

  it('throws 400 when source platform mismatches host (enforce)', async () => {
    setHappyPath();
    vi.spyOn(platform, 'validateManifestPlatform').mockReturnValue([
      'r1: type Windows.Registry not valid on linux',
    ]);
    await expect(runDeploy({ name: 'sample', mode: 'enforce' })).rejects.toMatchObject({
      status: 400,
    });
  });
});

// ── Phase B: CLI presence preflight ───────────────────────────────────

describe('runDeploy — CLI preflight (Phase B)', () => {
  it('throws cliRequiredError before withDeployLock when CLI is missing', async () => {
    setHappyPath();
    mocked.resolveOscfgBinary.mockImplementationOnce(() => {
      throw new Error('oscfg binary not found. Looked at: ...');
    });

    await expect(runDeploy({ name: 'sample', mode: 'enforce' })).rejects.toMatchObject({
      status: 412,
      code: 'CLI_REQUIRED',
    });
  });

  it('does NOT call applyManifest when preflight fails', async () => {
    setHappyPath();
    mocked.resolveOscfgBinary.mockImplementationOnce(() => {
      throw new Error('oscfg binary not found');
    });

    await expect(runDeploy({ name: 'sample', mode: 'enforce' })).rejects.toMatchObject({
      code: 'CLI_REQUIRED',
    });
    expect(mocked.applyManifest).not.toHaveBeenCalled();
  });

  it('gates audit mode too — CLI is still required for `oscfg get`', async () => {
    setHappyPath();
    mocked.resolveOscfgBinary.mockImplementationOnce(() => {
      throw new Error('oscfg binary not found');
    });

    await expect(runDeploy({ name: 'sample', mode: 'audit' })).rejects.toMatchObject({
      status: 412,
      code: 'CLI_REQUIRED',
    });
  });

  it('proceeds when CLI is present (default mock returns healthy binary)', async () => {
    setHappyPath();
    // No override — default mock returns { path, version, ... } so preflight passes.
    const r = await runDeploy({ name: 'sample', mode: 'audit' });
    expect(r.data.DeployMode).toBe('audit');
  });
});

// ── Audit mode happy path ─────────────────────────────────────────

describe('runDeploy — audit mode', () => {
  it('returns response with DeployMode=audit and ResourcesUI populated', async () => {
    setHappyPath();
    const r = await runDeploy({ name: 'sample', mode: 'audit' });

    expect(r.data.DeployMode).toBe('audit');
    expect(r.data.Name).toBe('sample');
    expect(r.data.Resources).toHaveLength(1);
    expect(r.data.Compliant + r.data.NonCompliant + r.data.Indeterminate + r.data.Errors).toBe(1);
    expect(r.cancelRequested).toBe(false);
    expect(r.cancelled).toBe(false);
  });

  it('emits validate, audit (with progress), finalize events', async () => {
    setHappyPath();
    const events: DeployProgressEvent[] = [];
    await runDeploy(
      { name: 'sample', mode: 'audit' },
      { onProgress: (e) => events.push(e) },
    );
    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe('validate');
    expect(phases.includes('audit')).toBe(true);
    expect(phases[phases.length - 1]).toBe('finalize');
    // Should NOT include apply or snapshot
    expect(phases.includes('apply')).toBe(false);
    expect(phases.includes('snapshot')).toBe(false);
  });

  it('emits warning when bulk get fails', async () => {
    setHappyPath();
    mocked.getResources.mockResolvedValue({
      success: false,
      error: 'CLI panic: file-rotate',
      data: null,
    });
    const r = await runDeploy({ name: 'sample', mode: 'audit' });
    // Either bulkFailed warning or fallbackErrors warning depending on
    // whether per-resource execResource succeeds. Our happy-path
    // execResource returns success, so we expect the bulkFailed warning.
    expect(r.warning).toMatch(/bulk audit call errored/i);
  });

  it('updates lastAuditedAt registration', async () => {
    setHappyPath();
    await runDeploy({ name: 'sample', mode: 'audit' });
    expect(mocked.updateRegistration).toHaveBeenCalledWith(
      'sample',
      expect.objectContaining({ lastAuditedAt: expect.any(String) }),
    );
  });
});

// ── Enforce mode happy path ───────────────────────────────────────

describe('runDeploy — enforce mode', () => {
  it('returns Deployed=true on successful apply', async () => {
    setHappyPath();
    const r = await runDeploy({ name: 'sample', mode: 'enforce' });
    expect(r.data.Deployed).toBe(true);
    expect(r.data.DeployMode).toBe('enforce');
    expect(r.data.DeployError).toBeNull();
  });

  it('emits validate, apply, audit, snapshot, finalize phases', async () => {
    setHappyPath();
    const events: DeployProgressEvent[] = [];
    await runDeploy(
      { name: 'sample', mode: 'enforce' },
      { onProgress: (e) => events.push(e) },
    );
    const seen = new Set(events.map((e) => e.phase));
    expect(seen).toEqual(new Set(['validate', 'apply', 'audit', 'snapshot', 'finalize']));
  });

  it('returns Deployed=false with DeployError when apply fails and CLI sees nothing', async () => {
    setHappyPath();
    mocked.applyManifest.mockResolvedValue({ success: false, error: 'CLI exited 1' });
    mocked.getResources.mockResolvedValue({ success: true, data: [] });
    const r = await runDeploy({ name: 'sample', mode: 'enforce' });
    expect(r.data.Deployed).toBe(false);
    expect(r.data.DeployError).toBe('CLI exited 1');
    expect(r.message).toMatch(/Deployment failed/);
  });

  it('returns Deployed=true with DeployError when apply errors but CLI sees state', async () => {
    setHappyPath();
    mocked.applyManifest.mockResolvedValue({ success: false, error: 'partial-apply panic' });
    mocked.getResources.mockResolvedValue({
      success: true,
      data: [{ name: 'r1', type: SAMPLE_RESOURCE.type, properties: { foo: 'bar' } }],
    });
    const r = await runDeploy({ name: 'sample', mode: 'enforce' });
    expect(r.data.Deployed).toBe(true);
    expect(r.data.DeployError).toBe('partial-apply panic');
    expect(r.message).toMatch(/with warnings/);
  });

  it('refreshes registration with lastAppliedAt + resourceSummary on success', async () => {
    setHappyPath();
    vi.spyOn(platform, 'extractResourceSummary').mockReturnValue([
      { type: SAMPLE_RESOURCE.type, name: 'r1' },
    ]);
    await runDeploy({ name: 'sample', mode: 'enforce' });
    expect(mocked.updateRegistration).toHaveBeenCalledWith(
      'sample',
      expect.objectContaining({
        lastAppliedAt: expect.any(String),
        lastAuditedAt: expect.any(String),
        resourceSummary: [{ type: SAMPLE_RESOURCE.type, name: 'r1' }],
      }),
    );
  });
});

// ── Cancellation ──────────────────────────────────────────────────

describe('runDeploy — cancellation', () => {
  it('throws 499 when audit is cancelled before validate', async () => {
    setHappyPath();
    const ac = new AbortController();
    ac.abort();
    await expect(
      runDeploy({ name: 'sample', mode: 'audit' }, { signal: ac.signal }),
    ).rejects.toMatchObject({ status: 499 });
  });

  it('throws 499 when enforce is cancelled before apply', async () => {
    setHappyPath();
    const ac = new AbortController();
    ac.abort();
    await expect(
      runDeploy({ name: 'sample', mode: 'enforce' }, { signal: ac.signal }),
    ).rejects.toMatchObject({ status: 499 });
    // Critical: applyManifest must NOT have run.
    expect(mocked.applyManifest).not.toHaveBeenCalled();
  });

  it('post-apply cancellation does NOT throw — returns response with cancelRequested=true', async () => {
    setHappyPath();
    const ac = new AbortController();
    // Trigger abort right after apply returns success.
    mocked.applyManifest.mockImplementation(async () => {
      ac.abort();
      return { success: true };
    });
    const r = await runDeploy(
      { name: 'sample', mode: 'enforce' },
      { signal: ac.signal },
    );
    expect(r.cancelRequested).toBe(true);
    expect(r.cancelled).toBe(false); // never aborted commit
    expect(r.data.Deployed).toBe(true);
    expect(r.warning).toMatch(/before cancellation could take effect|could not be verified/);
  });

  it('audit cancelled via signal propagates as 499', async () => {
    setHappyPath();
    const ac = new AbortController();
    // Force fallback mode by making bulk return empty, so signal
    // matters during the per-resource loop.
    mocked.getResources.mockResolvedValue({ success: true, data: [] });
    // Trigger cancel during the very first execResource fallback.
    mocked.execResource.mockImplementation(async () => {
      ac.abort();
      return { success: false, error: 'cancelled mid-audit' };
    });
    await expect(
      runDeploy({ name: 'sample', mode: 'audit' }, { signal: ac.signal }),
    ).rejects.toMatchObject({ status: 499, message: 'Audit cancelled' });
  });

  it('cancelRequested=false in events when no signal supplied', async () => {
    setHappyPath();
    const events: DeployProgressEvent[] = [];
    await runDeploy(
      { name: 'sample', mode: 'enforce' },
      { onProgress: (e) => events.push(e) },
    );
    expect(events.every((e) => e.cancelRequested === false)).toBe(true);
  });
});

// ── HandlerError integrity ────────────────────────────────────────

describe('runDeploy — error shape', () => {
  it('all thrown validation errors are HandlerError instances', async () => {
    setHappyPath();
    try {
      await runDeploy({ name: '' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(isHandlerError(err)).toBe(true);
    }
  });
});

// ── H8 regression: pre-deploy snapshot must exist BEFORE apply ────
describe('runDeploy — H8 pre-apply snapshot ordering', () => {
  beforeEach(() => {
    _clearDeployLocksForTests();
  });

  it('writes the pre-deploy snapshot BEFORE applyManifest is called', async () => {
    setHappyPath();
    const writeFileMock = vi.mocked(fsPromises.writeFile);
    const callOrder: string[] = [];
    writeFileMock.mockImplementation(async () => {
      callOrder.push('writeFile');
      return undefined;
    });
    mocked.applyManifest.mockImplementation(async () => {
      callOrder.push('applyManifest');
      return { success: true };
    });

    await runDeploy({ name: 'sample', mode: 'enforce' });

    const writeIdx = callOrder.indexOf('writeFile');
    const applyIdx = callOrder.indexOf('applyManifest');
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(applyIdx).toBeGreaterThan(writeIdx);
  });

  it('refuses to apply when the snapshot write fails (fail-fast)', async () => {
    setHappyPath();
    const writeFileMock = vi.mocked(fsPromises.writeFile);
    writeFileMock.mockRejectedValueOnce(new Error('disk full'));

    await expect(runDeploy({ name: 'sample', mode: 'enforce' })).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/snapshot write failed/i),
    });
    // Critical: applyManifest must NOT have run.
    expect(mocked.applyManifest).not.toHaveBeenCalled();
  });

  it('audit mode does NOT write a pre-deploy snapshot', async () => {
    setHappyPath();
    const writeFileMock = vi.mocked(fsPromises.writeFile);
    writeFileMock.mockClear();

    await runDeploy({ name: 'sample', mode: 'audit' });

    // v0.1.6: audit mode does write the audit-result CACHE
    // (~/.configforge/audit-results/<ns>.json) but must NOT write a
    // pre-deploy snapshot. Distinguish by path — snapshot writes go
    // under `history/<ns>/`, audit-result writes under
    // `audit-results/<ns>.json`. Only the former is a regression of
    // the H8 invariant.
    const snapshotWrites = writeFileMock.mock.calls.filter((args) => {
      const target = String(args[0] ?? '');
      return /[\\/]history[\\/]/.test(target);
    });
    expect(snapshotWrites).toHaveLength(0);
  });
});

// ── M2 regression: per-namespace deploy serialization ─────────────
describe('withDeployLock', () => {
  beforeEach(() => {
    _clearDeployLocksForTests();
  });

  it('serializes concurrent calls for the same namespace', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withDeployLock('ns-a', async () => {
      events.push('first-start');
      await firstReady;
      events.push('first-end');
      return 1;
    });
    const second = withDeployLock('ns-a', async () => {
      events.push('second-start');
      events.push('second-end');
      return 2;
    });

    // Yield once to let both kick off; second must NOT have started yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first-start']);

    releaseFirst();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('runs in parallel for different namespaces', async () => {
    const events: string[] = [];
    const both = await Promise.all([
      withDeployLock('ns-a', async () => {
        events.push('a-start');
        await new Promise((r) => setTimeout(r, 10));
        events.push('a-end');
        return 'a';
      }),
      withDeployLock('ns-b', async () => {
        events.push('b-start');
        await new Promise((r) => setTimeout(r, 10));
        events.push('b-end');
        return 'b';
      }),
    ]);
    expect(both).toEqual(['a', 'b']);
    // Both should have started before either ended (true parallelism).
    expect(events.indexOf('a-start')).toBeLessThan(events.indexOf('b-end'));
    expect(events.indexOf('b-start')).toBeLessThan(events.indexOf('a-end'));
  });

  it('releases the lock even when the wrapped function throws', async () => {
    await expect(
      withDeployLock('ns-c', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow(/boom/);

    // Subsequent calls must not deadlock.
    const result = await withDeployLock('ns-c', async () => 'next');
    expect(result).toBe('next');
  });

  it('serializes two runDeploy calls for the same name', async () => {
    setHappyPath();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstApplyReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let applyCount = 0;
    mocked.applyManifest.mockImplementation(async () => {
      applyCount += 1;
      const myCall = applyCount;
      order.push(`apply${myCall}-start`);
      if (myCall === 1) await firstApplyReady;
      order.push(`apply${myCall}-end`);
      return { success: true };
    });

    const first = runDeploy({ name: 'sample', mode: 'enforce' });
    const second = runDeploy({ name: 'sample', mode: 'enforce' });

    // Give event loop a chance to run.
    await new Promise((r) => setTimeout(r, 5));
    // Only the first apply should have started.
    expect(order).toEqual(['apply1-start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual([
      'apply1-start',
      'apply1-end',
      'apply2-start',
      'apply2-end',
    ]);
  });
});
