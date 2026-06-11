// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:health:check` and `GET /api/health`.
 *
 * Combines:
 *   - `system.getSystemInfo()` (platform, isAdmin, OS version, …)
 *   - `oscfg.resolveOscfgBinary()` (installed?, version, binary path)
 *   - Windows admin-blocked logic (preview18 quirk)
 *
 * Caches for 60s in-process. Restart the host process to invalidate.
 */
import { getSystemInfo } from '../system';
import { resolveOscfgBinary } from '../oscfg';
import type { HealthStatus } from './contract';
import { OSCFG_CLI_VERSION } from '../oscfg/registered-types';

let cache: { data: HealthStatus; fetchedAt: number } | null = null;
const TTL = 60_000;

/**
 * Force-clear the cache. Test affordance + lets the renderer trigger
 * a fresh probe after the user runs a setup script that installs
 * oscfg without restarting the desktop app.
 */
export function _clearHealthCache(): void {
  cache = null;
}

/**
 * Public alias for `_clearHealthCache` + `getHealthStatus` that the
 * `cfs:health:recheck` IPC channel calls. Used by the "I've already
 * installed it — recheck" CTA in the CLI install modal so the user
 * doesn't need to restart the app after installing OSConfig.
 */
export async function recheckHealth(): Promise<HealthStatus> {
  _clearHealthCache();
  return getHealthStatus();
}

export async function getHealthStatus(): Promise<HealthStatus> {
  if (cache && Date.now() - cache.fetchedAt < TTL) {
    return cache.data;
  }

  try {
    const sys = await getSystemInfo();
    let installed = false;
    let version = '';
    let binaryPath = '';
    let binarySource = '';
    try {
      const info = resolveOscfgBinary();
      installed = true;
      version = info.version;
      binaryPath = info.path;
      binarySource = info.source;
    } catch (err) {
      installed = false;
      version = err instanceof Error ? err.message : 'oscfg not found';
    }

    // Preview18 quirk on Windows: oscfg requires admin even for read-only
    // audits, because file-rotate initializes a log file in a protected
    // directory at startup. Surface this so the UI can warn unelevated
    // users instead of letting them try and hit a confusing failure.
    const requiresAdminForAllOps = sys.platform === 'win32';
    const blocked = requiresAdminForAllOps && !sys.isAdmin;

    // v0.3.0 (#5): mark a version mismatch so the renderer can amber-
    // pill it. `info.version` is the raw `oscfg --version` line (e.g.
    // `"oscfg 1.3.10-preview13"`); compare it as a substring against
    // the constant we shipped against. A loose `.includes()` match is
    // intentional — preview suffix changes (`-preview13` vs
    // `-preview14`) on the same minor should NOT trip this; only
    // major/minor drift does.
    const expectedTrimmed = OSCFG_CLI_VERSION.replace(/-preview\d+$/, '');
    const versionMismatch = installed && !version.includes(expectedTrimmed);

    const data: HealthStatus = {
      status: installed && !blocked ? 'healthy' : 'degraded',
      installed,
      version,
      binaryPath,
      binarySource,
      platform: sys.platform,
      isAdmin: sys.isAdmin,
      serverType: sys.serverType,
      osVersion: sys.osVersion,
      requiresAdminForAllOps,
      adminBlocked: blocked,
      adminMessage: blocked
        ? 'On Windows, the oscfg CLI currently requires Administrator privileges for every operation (including read-only audits). Restart ConfigForge from an elevated shell.'
        : '',
      versionMismatch,
      expectedVersion: `oscfg ${OSCFG_CLI_VERSION}`,
    };
    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      status: 'error',
      installed: false,
      version: '',
      binaryPath: '',
      binarySource: '',
      platform: process.platform,
      isAdmin: false,
      serverType: 'Unknown',
      osVersion: '',
      requiresAdminForAllOps: false,
      adminBlocked: false,
      adminMessage: '',
      error: message,
    };
  }
}
