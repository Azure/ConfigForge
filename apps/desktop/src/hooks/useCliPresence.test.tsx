// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `useCliPresence`, the renderer hook that exposes CLI
 * install state + recheck affordance to every CLI-gated UI surface.
 *
 * Strategy: mock `window.cfs.health.{check,recheck}` per test and
 * assert the hook surface (installed / loading / error / version /
 * recheck) flips at the right beats. Uses fake timers for the 60s
 * background poll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCliPresence } from './useCliPresence';
import type { HealthStatus } from '@configforge/core/handlers';

function makeHealth(installed: boolean, version = 'oscfg 1.3.9-preview11'): HealthStatus {
  return {
    status: installed ? 'healthy' : 'degraded',
    installed,
    version: installed ? version : 'oscfg binary not found',
    binaryPath: installed ? '/usr/local/bin/oscfg' : '',
    binarySource: installed ? 'path' : '',
    platform: 'linux',
    isAdmin: true,
    serverType: 'WorkstationServer',
    osVersion: 'Ubuntu 22.04',
    requiresAdminForAllOps: false,
    adminBlocked: false,
    adminMessage: '',
  };
}

// `useCliPresence` reads `window.cfs.health.check/recheck`. The
// global stub from vitest.setup.ts doesn't include `health` because
// it's per-test. Wire it up explicitly here.
const fakeHealth = {
  check: vi.fn(),
  recheck: vi.fn(),
};

beforeEach(() => {
  fakeHealth.check.mockReset();
  fakeHealth.recheck.mockReset();
  (window as unknown as { cfs: { health: typeof fakeHealth } }).cfs.health = fakeHealth;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCliPresence', () => {
  it('starts in loading state, then resolves to installed=true when probe succeeds', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(true));

    const { result } = renderHook(() => useCliPresence());

    expect(result.current.loading).toBe(true);
    expect(result.current.installed).toBe(false);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.installed).toBe(true);
    expect(result.current.version).toContain('1.3.9');
    expect(result.current.error).toBe(false);
  });

  it('resolves to installed=false when probe reports binary missing', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));

    const { result } = renderHook(() => useCliPresence());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.installed).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('sets error=true when IPC throws', async () => {
    fakeHealth.check.mockRejectedValue(new Error('IPC unreachable'));

    const { result } = renderHook(() => useCliPresence());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(true);
    expect(result.current.installed).toBe(false);
  });

  it('recheck() flips state from missing to installed after a user installs OSConfig', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));
    fakeHealth.recheck.mockResolvedValue(makeHealth(true));

    const { result } = renderHook(() => useCliPresence());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.installed).toBe(false);

    await act(async () => {
      await result.current.recheck();
    });

    expect(result.current.installed).toBe(true);
    expect(fakeHealth.recheck).toHaveBeenCalledTimes(1);
  });

  it('recheck() returns the new presence state synchronously to the caller', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));
    fakeHealth.recheck.mockResolvedValue(makeHealth(true));

    const { result } = renderHook(() => useCliPresence());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: Awaited<ReturnType<typeof result.current.recheck>> | undefined;
    await act(async () => {
      returned = await result.current.recheck();
    });

    expect(returned?.installed).toBe(true);
  });

  it('registers a 60s background poll interval', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(true));
    const spy = vi.spyOn(window, 'setInterval');

    renderHook(() => useCliPresence());
    await waitFor(() => expect(spy).toHaveBeenCalled());

    // Find the call with our 60_000ms cadence (FluentUI etc. may
    // also register intervals, be specific).
    const ourCall = spy.mock.calls.find(([, ms]) => ms === 60_000);
    expect(ourCall).toBeDefined();
  });

  it('clears the poll interval on unmount', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(true));
    const clearSpy = vi.spyOn(window, 'clearInterval');

    const { unmount } = renderHook(() => useCliPresence());
    await waitFor(() => expect(fakeHealth.check).toHaveBeenCalled());

    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
