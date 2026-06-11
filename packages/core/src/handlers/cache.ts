// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Generic short-TTL response cache + in-flight dedup helper.
 *
 * Used by handlers whose expensive computation is read-only and where
 * stale-by-a-few-seconds is fine (status, compliance report). Each
 * caller instantiates one of these per logical key space; the cache
 * is closed over by the handler module so tests can clear it.
 */
export interface CachedDeduped<T> {
  /** Read a cached payload if one exists and is still fresh. */
  getCached(key: string): T | null;

  /** Store a payload under the given key with current timestamp. */
  setCached(key: string, payload: T): void;

  /**
   * Get the in-flight promise for this key, if one is currently
   * resolving. Concurrent callers should await this instead of
   * stampeding the underlying compute.
   */
  getInflight(key: string): Promise<T> | undefined;

  /** Register a new in-flight promise for the given key. */
  setInflight(key: string, promise: Promise<T>): void;

  /** Release the in-flight slot (call from .finally on the promise). */
  clearInflight(key: string): void;

  /** @internal Reset both caches; used by unit tests. */
  _clear(): void;
}

export function createCachedDedup<T>(ttlMs: number): CachedDeduped<T> {
  const cache = new Map<string, { at: number; payload: T }>();
  const inflight = new Map<string, Promise<T>>();
  return {
    getCached(key) {
      const entry = cache.get(key);
      if (entry && Date.now() - entry.at < ttlMs) return entry.payload;
      return null;
    },
    setCached(key, payload) {
      cache.set(key, { at: Date.now(), payload });
    },
    getInflight(key) {
      return inflight.get(key);
    },
    setInflight(key, promise) {
      inflight.set(key, promise);
    },
    clearInflight(key) {
      inflight.delete(key);
    },
    _clear() {
      cache.clear();
      inflight.clear();
    },
  };
}
