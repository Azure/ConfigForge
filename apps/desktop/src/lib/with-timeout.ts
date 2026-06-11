// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.53 — small race helper for guarding renderer-side IPC calls.
 *
 * The Electron `ipcRenderer.invoke()` call has no client-side timeout,
 * so if the main-process handler hangs (e.g. wedged disk I/O on
 * Windows, a stuck cache/inFlight promise, or a leaked semaphore
 * permit), the renderer's await sits forever. That in turn locks any
 * UI gated on a `loading` flag fed from the `finally` of that await
 * (e.g. the Diff page's `disabled={loadingManifests}` selects), which
 * is exactly the "select dropdown won't open until restart" symptom
 * reported in the Diff stability bug.
 *
 * Wrapping the IPC promise with `withTimeout` causes the renderer to
 * reject after the cap, the gated UI to unstick, and a recoverable
 * error to surface in the page banner — the user can retry instead of
 * being forced to restart.
 */
export class TimeoutError extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Resolves with `promise`'s value if it settles within `ms` ms,
 * otherwise rejects with a `TimeoutError`. The original promise is
 * NOT cancelled — there's no upstream signal for `ipcRenderer.invoke`
 * — but its eventual resolution is harmless (no side effects on the
 * renderer side once the wrapper has rejected).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
