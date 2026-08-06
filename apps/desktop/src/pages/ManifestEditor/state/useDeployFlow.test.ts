// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase B.2 — unit tests for `useDeployFlow`.
 *
 * Locks in the v0.1.14 cancel-on-unmount contract before the visual
 * extraction (Phase C) moves the deploy controls into a sub-component.
 * Critical invariants:
 *   - jobId is set BEFORE await cfs.deploy.run resolves, so the
 *     unmount-cleanup effect can find it
 *   - unmount with an in-flight jobId calls cfs.deploy.cancel(jobId)
 *     exactly once
 *   - a successfully-completed deploy DOES NOT call cancel on
 *     subsequent unmount
 *   - BYO-CLI gate fires when presence.installed === false (no
 *     confirm dialog, no IPC call)
 *   - mixed-platform manifest is refused before confirm runs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDeployFlow } from './useDeployFlow';

// ── window.cfs.deploy + cfs.revert stub helpers ─────────────────────

function installDeployStubs(overrides?: {
  deployRun?: ReturnType<typeof vi.fn>;
  deployCancel?: ReturnType<typeof vi.fn>;
  revertApply?: ReturnType<typeof vi.fn>;
}) {
  const deployRun = overrides?.deployRun ?? vi.fn();
  const deployCancel = overrides?.deployCancel ?? vi.fn();
  const revertApply = overrides?.revertApply ?? vi.fn();

  if (!overrides?.deployRun) {
    deployRun.mockResolvedValue({
      message: 'Deploy succeeded',
      data: {
        Name: 'sample',
        Deployed: true,
        DeployError: null,
        Hostname: 'host',
        Timestamp: '2026-05-19T00:00:00Z',
        TotalResources: 1,
        Compliant: 1,
        NonCompliant: 0,
        Errors: 0,
        Resources: [
          { name: 'rule', type: 'Microsoft.Windows/Registry', status: 'compliant', reason: '' },
        ],
      },
    });
  }
  if (!overrides?.deployCancel) {
    deployCancel.mockResolvedValue(undefined);
  }
  if (!overrides?.revertApply) {
    revertApply.mockResolvedValue({ message: 'Reverted' });
  }

  Object.assign(window.cfs as Record<string, unknown>, {
    deploy: { run: deployRun, cancel: deployCancel },
    revert: { apply: revertApply },
  });

  return { deployRun, deployCancel, revertApply };
}

function makeParams(overrides?: Partial<Parameters<typeof useDeployFlow>[0]>) {
  return {
    manifestName: 'sample',
    presenceInstalled: true,
    detectedPlatform: 'windows' as const,
    setStatus: vi.fn(),
    setError: vi.fn(),
    fetchData: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  delete (window.cfs as Record<string, unknown>).deploy;
  delete (window.cfs as Record<string, unknown>).revert;
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  delete (window.cfs as Record<string, unknown>).deploy;
  delete (window.cfs as Record<string, unknown>).revert;
});

// ── BYO-CLI gate (v0.2.0) ───────────────────────────────────────────

describe('useDeployFlow — BYO-CLI gate (v0.2.0)', () => {
  it('opens the install-required dialog when presence.installed === false and does NOT call cfs.deploy.run', async () => {
    const { deployRun } = installDeployStubs();
    const params = makeParams({ presenceInstalled: false });
    const { result } = renderHook(() => useDeployFlow(params));

    await act(async () => {
      await result.current.handleDeploy('audit');
    });

    expect(result.current.cliGateFeature).toBe('Audit');
    expect(deployRun).not.toHaveBeenCalled();
  });

  it('uses "Deploy" feature label for enforce mode', async () => {
    installDeployStubs();
    const params = makeParams({ presenceInstalled: false });
    const { result } = renderHook(() => useDeployFlow(params));

    await act(async () => {
      await result.current.handleDeploy('enforce');
    });

    expect(result.current.cliGateFeature).toBe('Deploy');
  });
});

// ── Enforce risk-acknowledgement gate (v0.2.8+) ────────────────────

describe('useDeployFlow — enforce risk-ack second confirm', () => {
  it('calls confirm twice in enforce mode and proceeds when both are accepted', async () => {
    const { deployRun } = installDeployStubs();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { result } = renderHook(() => useDeployFlow(makeParams()));

    await act(async () => {
      await result.current.handleDeploy('enforce');
    });

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/Deploy baseline/);
    expect(confirmSpy.mock.calls[1][0]).toMatch(/at your own risk/i);
    expect(confirmSpy.mock.calls[1][0]).toMatch(/may break your machine/i);
    expect(deployRun).toHaveBeenCalledTimes(1);
  });

  it('aborts enforce when the risk-ack confirm is dismissed', async () => {
    const { deployRun } = installDeployStubs();
    // First confirm true (proceed past name prompt), second confirm
    // false (user reads the warning and bails out).
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const { result } = renderHook(() => useDeployFlow(makeParams()));

    await act(async () => {
      await result.current.handleDeploy('enforce');
    });

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(deployRun).not.toHaveBeenCalled();
    expect(result.current.deployResult).toBeNull();
  });

  it('does NOT show the risk-ack confirm for audit mode', async () => {
    const { deployRun } = installDeployStubs();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { result } = renderHook(() => useDeployFlow(makeParams()));

    await act(async () => {
      await result.current.handleDeploy('audit');
    });

    // Audit is read-only — one confirm is enough.
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deployRun).toHaveBeenCalledTimes(1);
  });
});

// ── Mixed-platform short-circuit ────────────────────────────────────

describe('useDeployFlow — mixed-platform short-circuit', () => {
  it('refuses to deploy a mixed-platform manifest BEFORE the confirm dialog', async () => {
    const { deployRun } = installDeployStubs();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const params = makeParams({ detectedPlatform: 'mixed' });
    const { result } = renderHook(() => useDeployFlow(params));

    await act(async () => {
      await result.current.handleDeploy('enforce');
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deployRun).not.toHaveBeenCalled();
    expect(result.current.deployResult?.success).toBe(false);
    expect(result.current.deployResult?.message).toMatch(/mixes Windows and Linux/);
  });
});

// ── Happy-path deploy ──────────────────────────────────────────────

describe('useDeployFlow — happy-path deploy', () => {
  it('runs cfs.deploy.run, updates deployResult, and writes the compliance snapshot to setStatus', async () => {
    const { deployRun } = installDeployStubs();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const setStatus = vi.fn();

    const params = makeParams({ setStatus });
    const { result } = renderHook(() => useDeployFlow(params));

    await act(async () => {
      await result.current.handleDeploy('audit');
    });

    expect(deployRun).toHaveBeenCalledTimes(1);
    expect(deployRun.mock.calls[0][0]).toMatchObject({
      name: 'sample',
      mode: 'audit',
    });
    // jobId should be present and non-empty
    expect(typeof deployRun.mock.calls[0][0].jobId).toBe('string');
    expect(deployRun.mock.calls[0][0].jobId.length).toBeGreaterThan(0);
    expect(result.current.deployResult?.success).toBe(true);
    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sample',
      resources: expect.any(Array),
    }));
  });

  it('clears the jobId after the deploy resolves', async () => {
    installDeployStubs();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { result } = renderHook(() => useDeployFlow(makeParams()));

    await act(async () => {
      await result.current.handleDeploy('audit');
    });

    expect(result.current.deployJobIdRef.current).toBeNull();
  });

  it('uses the latest registration revision after rerender', async () => {
    installDeployStubs();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const setStatus = vi.fn();
    const stableParams = makeParams({
      registrationRevision: 'revision-a',
      setStatus,
    });
    const { result, rerender } = renderHook(
      ({ revision }: { revision: string }) =>
        useDeployFlow({
          ...stableParams,
          registrationRevision: revision,
        }),
      { initialProps: { revision: 'revision-a' } },
    );

    rerender({ revision: 'revision-b' });
    await act(async () => {
      await result.current.handleDeploy('audit');
    });

    expect(setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 'revision-b' }),
    );
    expect(JSON.parse(sessionStorage.getItem('configforge-compliance-sample') ?? '{}')).toMatchObject(
      { revision: 'revision-b' },
    );
  });
});

// ── Verified enforcement result ───────────────────────────────────

describe('useDeployFlow — verified enforcement result', () => {
  it('renders enforce verification failure while retaining resources and the status cache', async () => {
    const deployRun = vi.fn().mockResolvedValue({
      message: 'Enforcement incomplete for "sample"',
      warning:
        'Inspect the noncompliant resource results and the OSConfig provider, installed version, and logs.',
      data: {
        Name: 'sample',
        Deployed: false,
        DeployError:
          'OSConfig accepted the apply command, but 1 resource remains noncompliant after verification.',
        Hostname: 'host',
        Timestamp: '2026-08-05T00:00:00Z',
        TotalResources: 1,
        Compliant: 0,
        NonCompliant: 1,
        Indeterminate: 0,
        Errors: 0,
        Resources: [
          {
            name: 'FailedRule',
            type: 'Microsoft.Windows/Registry',
            status: 'noncompliant',
            reason: 'Expected 1, found 0',
          },
        ],
      },
    });
    installDeployStubs({ deployRun });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const setStatus = vi.fn();
    const fetchData = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDeployFlow(
        makeParams({
          registrationRevision: 'revision-1',
          setStatus,
          fetchData,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleDeploy('enforce');
    });

    expect(result.current.deployResult).toMatchObject({
      success: false,
      message: expect.stringMatching(/enforcement incomplete/i),
      data: {
        Deployed: false,
        NonCompliant: 1,
        Resources: [
          expect.objectContaining({
            name: 'FailedRule',
            status: 'noncompliant',
          }),
        ],
      },
    });
    expect(setStatus).toHaveBeenCalledWith({
      name: 'sample',
      revision: 'revision-1',
      resources: [
        expect.objectContaining({
          name: 'FailedRule',
          compliance: {
            status: 'noncompliant',
            reason: 'Expected 1, found 0',
          },
        }),
      ],
    });
    expect(JSON.parse(sessionStorage.getItem('configforge-compliance-sample') ?? '{}')).toMatchObject({
      name: 'sample',
      revision: 'revision-1',
      resources: [
        expect.objectContaining({
          name: 'FailedRule',
          compliance: expect.objectContaining({ status: 'noncompliant' }),
        }),
      ],
    });
    expect(fetchData).toHaveBeenCalledTimes(1);
  });

  it('keeps audit observationally successful when resources are noncompliant', async () => {
    const deployRun = vi.fn().mockResolvedValue({
      message: 'Audited "sample" on host',
      data: {
        Name: 'sample',
        Deployed: false,
        DeployError: null,
        Hostname: 'host',
        Timestamp: '2026-08-05T00:00:00Z',
        TotalResources: 1,
        Compliant: 0,
        NonCompliant: 1,
        Indeterminate: 0,
        Errors: 0,
        Resources: [
          {
            name: 'ObservedRule',
            type: 'Microsoft.Windows/Registry',
            status: 'noncompliant',
            reason: 'Expected 1, found 0',
          },
        ],
      },
    });
    installDeployStubs({ deployRun });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const setStatus = vi.fn();
    const { result } = renderHook(() =>
      useDeployFlow(makeParams({ setStatus })),
    );

    await act(async () => {
      await result.current.handleDeploy('audit');
    });

    expect(result.current.deployResult).toMatchObject({
      success: true,
      data: {
        NonCompliant: 1,
      },
    });
    expect(setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: [
          expect.objectContaining({
            name: 'ObservedRule',
            compliance: expect.objectContaining({ status: 'noncompliant' }),
          }),
        ],
      }),
    );
  });
});

// ── jobId cancel-on-unmount (v0.1.14) — the regression-prone case ─

describe('useDeployFlow — cancel-on-unmount (v0.1.14)', () => {
  it('calls cfs.deploy.cancel(jobId) exactly once when unmounted mid-deploy', async () => {
    // Build a deferred so the deploy hangs indefinitely.
    let resolveDeploy!: (v: unknown) => void;
    const slowDeploy = new Promise((resolve) => {
      resolveDeploy = resolve;
    });
    const deployRun = vi.fn().mockReturnValue(slowDeploy);
    const deployCancel = vi.fn().mockResolvedValue(undefined);
    installDeployStubs({ deployRun, deployCancel });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { result, unmount } = renderHook(() => useDeployFlow(makeParams()));

    // Start the deploy but DO NOT await its completion.
    let pending: Promise<void>;
    act(() => {
      pending = result.current.handleDeploy('enforce');
    });

    // Wait until the hook has registered the jobId.
    await waitFor(() => {
      expect(result.current.deployJobIdRef.current).not.toBeNull();
    });
    const jobId = result.current.deployJobIdRef.current!;

    // Unmount mid-deploy.
    unmount();

    expect(deployCancel).toHaveBeenCalledTimes(1);
    expect(deployCancel).toHaveBeenCalledWith(jobId);

    // Settle the dangling promise so vitest doesn't complain about
    // unhandled rejections.
    resolveDeploy({
      message: 'late',
      data: undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await pending!.catch(() => undefined);
  });

  it('does NOT call cfs.deploy.cancel after a deploy completes normally + later unmount', async () => {
    const { deployCancel } = installDeployStubs();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { result, unmount } = renderHook(() => useDeployFlow(makeParams()));

    await act(async () => {
      await result.current.handleDeploy('audit');
    });

    // jobId cleared on successful resolution
    expect(result.current.deployJobIdRef.current).toBeNull();
    unmount();

    expect(deployCancel).not.toHaveBeenCalled();
  });

  it('cancel-on-unmount only fires once even with multiple rapid unmounts', async () => {
    // Edge case: simulated re-mount cycles. The cleanup nullifies
    // deployJobIdRef.current so the second cleanup sees no jobId.
    let resolveDeploy!: (v: unknown) => void;
    const slowDeploy = new Promise((resolve) => {
      resolveDeploy = resolve;
    });
    const deployRun = vi.fn().mockReturnValue(slowDeploy);
    const deployCancel = vi.fn().mockResolvedValue(undefined);
    installDeployStubs({ deployRun, deployCancel });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { result, unmount } = renderHook(() => useDeployFlow(makeParams()));

    let pending: Promise<void>;
    act(() => {
      pending = result.current.handleDeploy('enforce');
    });

    await waitFor(() => {
      expect(result.current.deployJobIdRef.current).not.toBeNull();
    });

    unmount();
    expect(deployCancel).toHaveBeenCalledTimes(1);

    // No second cleanup possible since the hook is unmounted, but
    // sanity-check that we don't have a stray cancel queued up.
    expect(deployCancel).toHaveBeenCalledTimes(1);

    resolveDeploy({ message: 'late', data: undefined });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await pending!.catch(() => undefined);
  });
});

// ── Revert flow ────────────────────────────────────────────────────

describe('useDeployFlow — revert', () => {
  it('calls cfs.revert.apply, then fetchData to refresh the page state', async () => {
    const { revertApply } = installDeployStubs();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeployFlow(makeParams({ fetchData })));

    await act(async () => {
      await result.current.handleRevert();
    });

    expect(revertApply).toHaveBeenCalledWith({ name: 'sample' });
    expect(result.current.deployResult?.success).toBe(true);
    expect(fetchData).toHaveBeenCalledTimes(1);
    expect(result.current.reverting).toBe(false);
  });

  it('surfaces a failure message without calling fetchData', async () => {
    const revertApply = vi.fn().mockRejectedValue(new Error('disk locked'));
    installDeployStubs({ revertApply });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeployFlow(makeParams({ fetchData })));

    await act(async () => {
      await result.current.handleRevert();
    });

    expect(result.current.deployResult?.success).toBe(false);
    expect(result.current.deployResult?.message).toMatch(/disk locked/);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it('aborts the revert when confirm is dismissed', async () => {
    const { revertApply } = installDeployStubs();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const { result } = renderHook(() => useDeployFlow(makeParams()));

    await act(async () => {
      await result.current.handleRevert();
    });

    expect(revertApply).not.toHaveBeenCalled();
    expect(result.current.reverting).toBe(false);
  });
});
