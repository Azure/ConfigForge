// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Bounded-concurrency worker pool + retry helpers for `oscfg exec` calls.
 *
 * Why this exists
 * ---------------
 * The audit fallback in /api/deploy used to spawn 16 simultaneous
 * `oscfg exec resource --mode get` processes using a chunked
 * `Promise.allSettled`. Each oscfg invocation initializes a rotating log
 * file in a protected directory; 16 concurrent opens against the same
 * file path produce transient `PermissionDenied (file-rotate)` panics
 * on busy non-admin Windows boxes. We were classifying those as
 * compliance failures even though they're infrastructure flakes.
 *
 * Two primitives:
 *   - `runWithBoundedConcurrency` — N workers draining a queue, returns
 *     results in input order with successes / errors captured per task.
 *   - `withRetries` — retries a single async operation with jittered
 *     exponential backoff when `shouldRetry` says yes.
 *
 * `isTransientOscfgError` is the default classifier: matches the known
 * file-rotate / PermissionDenied panic and a small set of variants
 * observed in field reports.
 */

export interface ConcurrencyOptions {
  /** Max workers. Clamped to >= 1. */
  concurrency: number;
  /**
   * Optional cancellation signal. When aborted:
   *   - workers stop pulling new tasks from the queue
   *   - already-in-flight tasks complete naturally (we don't kill them)
   *   - the returned array has `undefined` entries for any tasks that
   *     never started; callers should check `signal.aborted` after the
   *     await and decide whether to throw or use partial results
   *
   * Backwards-compatible — existing callers that don't pass `signal`
   * see no behavior change.
   */
  signal?: AbortSignal;
}

export type TaskResult<T> =
  | { ok: true; value: T }
  | { ok: false; value?: undefined; error: unknown };

/**
 * Execute `tasks` with at most `concurrency` in flight at once. Returns
 * results in the same order as the input. Each entry is `{ ok: true, value }`
 * for fulfilled tasks or `{ ok: false, error }` for rejected ones —
 * sibling failures NEVER abort the rest of the queue.
 *
 * If `opts.signal` is provided and aborts, workers stop pulling new
 * tasks but already-in-flight tasks finish; unstarted slots remain
 * `undefined` in the returned array.
 *
 * Implementation: a fixed pool of N workers, each pulling sequential
 * indices from a shared cursor. Lighter and easier to reason about than
 * a Promise.race pool, and good enough for the small task counts we see
 * (typically < 1000 resources per audit).
 */
export async function runWithBoundedConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  opts: ConcurrencyOptions,
): Promise<TaskResult<T>[]> {
  const N = tasks.length;
  if (N === 0) return [];
  const cap = Math.max(1, opts.concurrency | 0);
  const workers = Math.min(cap, N);

  const out: TaskResult<T>[] = new Array(N);
  let cursor = 0;
  const signal = opts.signal;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) return;
      const i = cursor++;
      if (i >= N) return;
      try {
        const value = await tasks[i]();
        out[i] = { ok: true, value };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  }

  const pool: Promise<void>[] = [];
  for (let w = 0; w < workers; w++) pool.push(worker());
  await Promise.all(pool);
  return out;
}

// ── Retries ──────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Max attempts including the first. Clamped to >= 1. Default: 3. */
  attempts?: number;
  /** Base delay before retry #1 (ms). Default: 100. */
  baseDelayMs?: number;
  /** Cap on a single backoff sleep. Default: 2000. */
  maxDelayMs?: number;
  /**
   * Should we retry this error? Returns true → sleep + retry, false →
   * throw immediately. Default: retry every error (conservative caller
   * is expected to override).
   */
  shouldRetry?: (err: unknown) => boolean;
  /** Override the sleep impl (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Optional cancellation signal. When aborted between attempts, the
   * loop short-circuits — the in-flight `op()` finishes (we can't kill
   * it) and the next retry sleep is skipped; the loop throws the
   * already-captured `lastErr` so callers see the failure that
   * triggered the (now-skipped) retry.
   */
  signal?: AbortSignal;
}

export interface RetryHandle {
  /** Number of attempts actually performed. */
  attempts: number;
  /** True if any retry happened (i.e. the first attempt failed). */
  retried: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `op` up to N times with jittered exponential backoff between
 * failed attempts. Mutates `handle` (when supplied) so callers can read
 * back the actual attempt count for instrumentation.
 *
 * Backoff schedule: delay_n = jitter(base * 2^(n-1)), capped at maxDelayMs.
 * Jitter: uniform [0.5, 1.0] of the deterministic delay — full jitter is
 * appropriate when many callers retry simultaneously against the same
 * resource (oscfg log file).
 */
export async function withRetries<T>(
  op: () => Promise<T>,
  opts: RetryOptions = {},
  handle?: RetryHandle,
): Promise<T> {
  const max = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 100;
  const cap = opts.maxDelayMs ?? 2000;
  const sleep = opts.sleep ?? defaultSleep;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    if (handle) handle.attempts = attempt;
    if (opts.signal?.aborted) {
      if (handle) handle.retried = attempt > 1;
      throw lastErr ?? new Error('Aborted before retry');
    }
    try {
      const value = await op();
      if (handle) handle.retried = attempt > 1;
      return value;
    } catch (err) {
      lastErr = err;
      const isLast = attempt >= max;
      if (isLast || !shouldRetry(err) || opts.signal?.aborted) {
        if (handle) handle.retried = attempt > 1;
        throw err;
      }
      const exp = Math.min(base * Math.pow(2, attempt - 1), cap);
      const jittered = Math.floor(exp * (0.5 + Math.random() * 0.5));
      await sleep(jittered);
    }
  }
  // Unreachable; the loop either returns or throws.
  throw lastErr;
}

// ── Default classifier for oscfg transient errors ─────────────────────────

const TRANSIENT_PATTERNS = [
  /PermissionDenied/i,
  /file-rotate/i,
  /access is denied/i,
  /access denied/i,
  /os error 5/i,
];

/**
 * Match the well-known `oscfg` log-rotation race that produces
 * PermissionDenied panics under heavy concurrency. Inputs accepted:
 *   - Error instances (reads .message)
 *   - Plain { error: string } shapes from runOscfg's failure result
 *   - Strings
 *
 * Returns false for null/undefined/permanent-shape errors so callers
 * don't wastefully retry truly broken inputs (invalid schema, etc.).
 */
export function isTransientOscfgError(err: unknown): boolean {
  if (err == null) return false;
  let msg = '';
  if (err instanceof Error) msg = err.message;
  else if (typeof err === 'string') msg = err;
  else if (typeof err === 'object') {
    const e = err as { error?: unknown; message?: unknown };
    if (typeof e.error === 'string') msg = e.error;
    else if (typeof e.message === 'string') msg = e.message;
  }
  if (!msg) return false;
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}
