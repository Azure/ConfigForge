// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase E.1 — unit tests for `useFlashMessage`.
 *
 * Locks in the v0.1.13 timer-cleanup-on-unmount contract before any
 * visual refactor touches the auto-dismiss machinery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlashMessage } from './useFlashMessage';

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFlashMessage — sessionStorage flash on mount', () => {
  it('picks up a stored flash message and removes it from storage', () => {
    sessionStorage.setItem('configforge-flash', 'Saved!');
    const { result } = renderHook(() => useFlashMessage());
    expect(result.current.flashMessage).toBe('Saved!');
    expect(sessionStorage.getItem('configforge-flash')).toBeNull();
  });

  it('auto-dismisses the picked-up flash message after 5 seconds', () => {
    vi.useFakeTimers();
    sessionStorage.setItem('configforge-flash', 'Saved!');
    const { result } = renderHook(() => useFlashMessage());
    expect(result.current.flashMessage).toBe('Saved!');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.flashMessage).toBeNull();
  });
});

describe('useFlashMessage — scheduleAutoDismiss', () => {
  it('runs the callback after the requested delay', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlashMessage());
    const cb = vi.fn();

    act(() => {
      result.current.scheduleAutoDismiss(cb, 1000);
    });
    expect(cb).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('useFlashMessage — unmount cleanup (v0.1.13)', () => {
  it('clears all pending timers on unmount so no late setState fires', () => {
    vi.useFakeTimers();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    const { result, unmount } = renderHook(() => useFlashMessage());

    act(() => {
      result.current.scheduleAutoDismiss(cb1, 1000);
      result.current.scheduleAutoDismiss(cb2, 3000);
      result.current.scheduleAutoDismiss(cb3, 10_000);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    expect(cb3).not.toHaveBeenCalled();
  });
});
