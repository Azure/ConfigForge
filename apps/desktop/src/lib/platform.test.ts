// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePlatform, isWindows, isWindows11, isLinux, __resetPlatformCacheForTests } from './platform';

/**
 * Phase 7 component tests — platform.ts hooks.
 *
 * The platform module is foundational: TitleBar, App.tsx Mica
 * activation, and the FluentProvider theme switch all depend on
 * `usePlatform()` returning the right snapshot. This suite verifies
 * the IPC fetch + caching + sync-detector behavior.
 *
 * The module caches platform info at module scope; we reset it
 * between tests via `__resetPlatformCacheForTests` so per-test
 * mocks of `cfs.platform.info` actually take effect.
 */
describe('platform.ts hooks', () => {
  beforeEach(() => {
    __resetPlatformCacheForTests();
    (window.cfs.platform.info as ReturnType<typeof vi.fn>).mockResolvedValue({
      platform: 'win32',
      release: '10.0.26100',
      isWindows11: true,
      isRdpSession: false,
      prefersDark: false,
      arch: 'x64',
    });
  });

  it('usePlatform resolves to the IPC payload', async () => {
    const { result } = renderHook(() => usePlatform());
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current?.platform).toBe('win32');
    expect(result.current?.isWindows11).toBe(true);
  });

  it('sync detectors reflect the cached info once resolved', async () => {
    const { result } = renderHook(() => usePlatform());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(isWindows()).toBe(true);
    expect(isWindows11()).toBe(true);
    expect(isLinux()).toBe(false);
  });

  it('handles linux platform', async () => {
    (window.cfs.platform.info as ReturnType<typeof vi.fn>).mockResolvedValue({
      platform: 'linux',
      release: '6.5.0',
      isWindows11: false,
      isRdpSession: false,
      prefersDark: true,
      arch: 'x64',
    });
    const { result } = renderHook(() => usePlatform());
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current?.platform).toBe('linux');
    expect(result.current?.isWindows11).toBe(false);
    expect(isLinux()).toBe(true);
    expect(isWindows()).toBe(false);
  });

  it('exposes isRdpSession from the IPC payload', async () => {
    // v0.1.1 regression guard: the renderer now needs to know whether
    // it's running over RDP / Azure DevBox so it can skip translucent
    // visuals that don't transport correctly. This test locks the
    // wiring in: PlatformInfo.isRdpSession must come through the IPC
    // payload unchanged.
    (window.cfs.platform.info as ReturnType<typeof vi.fn>).mockResolvedValue({
      platform: 'win32',
      release: '10.0.26100',
      isWindows11: true,
      isRdpSession: true,
      prefersDark: false,
      arch: 'x64',
    });
    const { result } = renderHook(() => usePlatform());
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current?.isRdpSession).toBe(true);
  });
});
