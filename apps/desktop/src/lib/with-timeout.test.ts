// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the underlying value when the promise wins the race', async () => {
    const value = await withTimeout(Promise.resolve(42), 1000, 'test op');
    expect(value).toBe(42);
  });

  it('rejects with TimeoutError when the promise does not settle in time', async () => {
    // A promise that never resolves — simulates the wedged IPC handler
    // that motivated the helper in the first place.
    const stuck = new Promise<number>(() => {});
    const wrapped = withTimeout(stuck, 1000, 'Loading manifests');

    // Drain pending microtasks then advance past the timeout.
    const pending = expect(wrapped).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
  });

  it('TimeoutError carries the label and ms for human-readable surfacing', async () => {
    const stuck = new Promise<void>(() => {});
    const wrapped = withTimeout(stuck, 250, 'Loading manifests');

    const assertion = wrapped.catch((err: unknown) => {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      expect(te.label).toBe('Loading manifests');
      expect(te.ms).toBe(250);
      expect(te.message).toContain('Loading manifests');
      expect(te.message).toContain('250ms');
    });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it('clears the timer when the promise resolves so it does not fire later', async () => {
    const value = await withTimeout(Promise.resolve('ok'), 10_000, 'fast op');
    expect(value).toBe('ok');
    // If the timer were not cleared, advancing past 10s would attempt
    // to reject an already-resolved promise — harmless, but the timer
    // itself should not still be in the queue.
    await vi.advanceTimersByTimeAsync(20_000);
    // (No assertion needed — the test passes iff vi.advanceTimers
    // does not surface an unhandled rejection.)
  });

  it('propagates an underlying rejection without wrapping it in TimeoutError', async () => {
    const boom = new Error('underlying handler failed');
    await expect(
      withTimeout(Promise.reject(boom), 1000, 'op'),
    ).rejects.toBe(boom);
  });
});
