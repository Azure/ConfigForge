// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { _clearSystemInfoCache, getSystemInfo } from './index';

afterEach(() => {
  _clearSystemInfoCache();
  vi.restoreAllMocks();
});

describe('getSystemInfo memoization', () => {
  it(
    'only runs the OS-specific detector once across many calls',
    async () => {
      // Ensure cold cache
      _clearSystemInfoCache();
      // We can't easily count actual spawns without owning the import, but
      // we CAN assert that two sequential calls return the SAME object
      // reference — proof the result was cached, not recomputed.
      const a = await getSystemInfo();
      const b = await getSystemInfo();
      const c = await getSystemInfo();
      expect(a).toBe(b);
      expect(b).toBe(c);
    },
    30_000, // cold PS spawn on GH Actions Windows runners can be > 5s
  );

  it(
    'shares a single in-flight promise across concurrent cold-start calls',
    async () => {
      _clearSystemInfoCache();
      // Fan out 10 callers before the first await resolves; they should all
      // resolve to the same object (one detect() call, not ten).
      const results = await Promise.all(Array.from({ length: 10 }, () => getSystemInfo()));
      const first = results[0];
      for (const r of results) expect(r).toBe(first);
    },
    30_000,
  );

  it(
    'refreshes after _clearSystemInfoCache (test affordance)',
    async () => {
      _clearSystemInfoCache();
      const a = await getSystemInfo();
      _clearSystemInfoCache();
      const b = await getSystemInfo();
      // Different object references after a clear — the second call ran
      // detect() afresh.
      expect(a).not.toBe(b);
      // But the SHAPE is identical for a stable host.
      expect(a.platform).toBe(b.platform);
      expect(a.isAdmin).toBe(b.isAdmin);
    },
    30_000,
  );
});
