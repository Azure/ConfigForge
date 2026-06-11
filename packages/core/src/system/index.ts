// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { SystemInfo } from './types';

/**
 * Process-lifetime cache for `getSystemInfo`. Admin status, OS version,
 * and server type don't change inside a single Node.js process — once we
 * paid the PowerShell/Bash spawn cost we shouldn't pay it again. This
 * cuts ~200–800 ms off every /api/deploy and /api/health request after
 * the first. See IMPROVEMENTS.md #13.
 *
 * Tests can clear the cache with `_clearSystemInfoCache()`.
 */
let cached: SystemInfo | null = null;
let inFlight: Promise<SystemInfo> | null = null;

/**
 * Dispatch to the correct OS-specific system info getter based on
 * `process.platform`. Used by /api/health and /api/system-config.
 *
 * Memoized for the lifetime of the Node.js process. Concurrent calls
 * during cold start share a single in-flight promise so the spawn only
 * happens once even under request-burst load.
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const info = await detect();
      cached = info;
      return info;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function detect(): Promise<SystemInfo> {
  if (process.platform === 'win32') {
    const { getWindowsSystemInfo } = await import('./windows');
    return getWindowsSystemInfo();
  }
  if (process.platform === 'linux') {
    const { getLinuxSystemInfo } = await import('./linux');
    return getLinuxSystemInfo();
  }
  return {
    platform: process.platform,
    isAdmin: false,
    serverType: `Unsupported platform: ${process.platform}`,
    osVersion: '',
  };
}

/** @internal Clear the memoized result. Tests only. */
export function _clearSystemInfoCache(): void {
  cached = null;
  inFlight = null;
}

export type { SystemInfo };
