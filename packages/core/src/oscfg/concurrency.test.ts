// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import {
  isTransientOscfgError,
  runWithBoundedConcurrency,
  withRetries,
  type RetryHandle,
} from './concurrency';

// ── runWithBoundedConcurrency ─────────────────────────────────────────────

describe('runWithBoundedConcurrency', () => {
  it('returns results in input order', async () => {
    const out = await runWithBoundedConcurrency(
      [1, 2, 3, 4, 5].map((n) => async () => n * 10),
      { concurrency: 2 },
    );
    expect(out.map((r) => (r.ok ? r.value : null))).toEqual([10, 20, 30, 40, 50]);
  });

  it('captures errors as { ok: false } without aborting siblings', async () => {
    const out = await runWithBoundedConcurrency(
      [
        () => Promise.resolve('a'),
        () => Promise.reject(new Error('boom')),
        () => Promise.resolve('c'),
      ],
      { concurrency: 3 },
    );
    expect(out[0]).toEqual({ ok: true, value: 'a' });
    expect(out[1].ok).toBe(false);
    expect((out[1].error as Error).message).toBe('boom');
    expect(out[2]).toEqual({ ok: true, value: 'c' });
  });

  it('respects the concurrency cap (no more than N in flight)', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 'ok';
    });
    await runWithBoundedConcurrency(tasks, { concurrency: 4 });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles empty input gracefully', async () => {
    const out = await runWithBoundedConcurrency<number>([], { concurrency: 4 });
    expect(out).toEqual([]);
  });

  it('clamps concurrency to a minimum of 1', async () => {
    const out = await runWithBoundedConcurrency(
      [() => Promise.resolve(1), () => Promise.resolve(2)],
      { concurrency: 0 },
    );
    expect(out.map((r) => r.value)).toEqual([1, 2]);
  });

  it('stops scheduling new tasks when signal is aborted before run', async () => {
    const ac = new AbortController();
    ac.abort();
    let started = 0;
    const out = await runWithBoundedConcurrency(
      [1, 2, 3, 4, 5].map(() => async () => {
        started++;
        return 'ok';
      }),
      { concurrency: 2, signal: ac.signal },
    );
    expect(started).toBe(0);
    expect(out.every((r) => r === undefined)).toBe(true);
  });

  it('lets in-flight tasks finish but stops scheduling on mid-run abort', async () => {
    const ac = new AbortController();
    let started = 0;
    let completed = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      started++;
      // Trigger abort once 2 tasks have started so we know the signal
      // races with worker pickup.
      if (i === 1) ac.abort();
      await new Promise((r) => setTimeout(r, 5));
      completed++;
      return i;
    });
    const out = await runWithBoundedConcurrency(tasks, {
      concurrency: 2,
      signal: ac.signal,
    });
    // The 2 already-started tasks finish; the other 8 should not start.
    expect(started).toBe(2);
    expect(completed).toBe(2);
    // Count populated slots (filter skips sparse holes, so iterate).
    let resultCount = 0;
    for (let i = 0; i < out.length; i++) if (i in out) resultCount++;
    expect(resultCount).toBe(2);
  });
});

// ── withRetries ───────────────────────────────────────────────────────────

describe('withRetries', () => {
  const noSleep = () => Promise.resolve();

  it('returns the result on first success without retrying', async () => {
    let calls = 0;
    const r = await withRetries(async () => {
      calls++;
      return 'ok';
    }, { sleep: noSleep });
    expect(r).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on transient errors and eventually succeeds', async () => {
    let calls = 0;
    const handle: RetryHandle = { attempts: 0, retried: false };
    const r = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw new Error('PermissionDenied (file-rotate)');
        return 'ok';
      },
      { attempts: 5, sleep: noSleep, shouldRetry: (e) => isTransientOscfgError(e) },
      handle,
    );
    expect(r).toBe('ok');
    expect(calls).toBe(3);
    expect(handle.retried).toBe(true);
    expect(handle.attempts).toBe(3);
  });

  it('does NOT retry when shouldRetry returns false', async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new Error('permanent failure');
        },
        { attempts: 5, sleep: noSleep, shouldRetry: () => false },
      ),
    ).rejects.toThrow('permanent failure');
    expect(calls).toBe(1);
  });

  it('throws the LAST error after exhausting attempts', async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new Error(`attempt-${calls}`);
        },
        { attempts: 3, sleep: noSleep },
      ),
    ).rejects.toThrow('attempt-3');
    expect(calls).toBe(3);
  });

  it('observes the requested attempt count', async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new Error('boom');
        },
        { attempts: 7, sleep: noSleep },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(7);
  });

  it('clamps attempts to a minimum of 1', async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new Error('boom');
        },
        { attempts: 0, sleep: noSleep },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('uses jittered exponential backoff between attempts', async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new Error('boom');
        },
        {
          attempts: 4,
          baseDelayMs: 100,
          maxDelayMs: 1000,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(4);
    expect(delays).toHaveLength(3);
    // Each delay should be in [base/2, base * 2^(attempt-1)]
    expect(delays[0]).toBeGreaterThanOrEqual(50);
    expect(delays[0]).toBeLessThanOrEqual(100);
    expect(delays[1]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeLessThanOrEqual(200);
    expect(delays[2]).toBeGreaterThanOrEqual(200);
    expect(delays[2]).toBeLessThanOrEqual(400);
  });

  it('throws immediately when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          return 'never-reached';
        },
        { sleep: noSleep, signal: ac.signal },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it('skips remaining retries when signal aborts mid-attempt', async () => {
    const ac = new AbortController();
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          if (calls === 1) ac.abort();
          throw new Error('PermissionDenied (file-rotate)');
        },
        {
          attempts: 5,
          sleep: noSleep,
          shouldRetry: (e) => isTransientOscfgError(e),
          signal: ac.signal,
        },
      ),
    ).rejects.toThrow('PermissionDenied');
    expect(calls).toBe(1);
  });
});

// ── isTransientOscfgError ─────────────────────────────────────────────────

describe('isTransientOscfgError', () => {
  it.each([
    'thread main panicked at PermissionDenied (os error 5) inside file-rotate',
    'PermissionDenied (os error 5)',
    'file-rotate failed: access denied',
    'access is denied. (os error 5) — failed to open log: oscfg.log',
  ])('classifies %s as transient', (msg) => {
    expect(isTransientOscfgError(new Error(msg))).toBe(true);
  });

  it.each([
    'invalid manifest schema: resources[0].name must be a non-empty string',
    'unsupported resource type: Microsoft.Mythical/Provider',
    'CLI exited with code 1',
    null,
    undefined,
    '',
  ])('does NOT classify %s as transient', (msg) => {
    expect(isTransientOscfgError(msg ? new Error(String(msg)) : msg as null)).toBe(false);
  });

  it('reads from the {error: string} shape too', () => {
    expect(isTransientOscfgError({ error: 'PermissionDenied (file-rotate)' })).toBe(true);
    expect(isTransientOscfgError({ error: 'invalid input' })).toBe(false);
  });
});
