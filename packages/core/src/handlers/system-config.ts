// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:system-config:get` and `GET /api/system-config`.
 *
 * Two modes:
 *
 *   - No name: returns cheap (disk-only) system context + the names of
 *     all registered manifests. PR45/46 trimmed this down — used to
 *     return full registrations array (127 KB on a 4-manifest tenant)
 *     plus an `oscfg get namespace` CLI spawn that cost ~75 ms warm
 *     on every request. Default path is now disk-only.
 *
 *   - Specific name: returns cheap fields PLUS the registration record
 *     and its source YAML for that one manifest.
 */
import { getSystemInfo } from '../system';
import {
  listRegistrations,
  getRegistration,
  getRegistrationSource,
  sanitizeNamespace,
} from '../oscfg';
import { HandlerError } from './errors';

export interface SystemConfigSummary {
  platform: string;
  isAdmin: boolean;
  serverType: string;
  osVersion: string;
  manifestNames: string[];
}

export interface SystemConfigEntry {
  platform: string;
  isAdmin: boolean;
  serverType: string;
  osVersion: string;
  registration: unknown;
  source: string | null;
}

export async function getSystemConfigSummary(): Promise<{ data: SystemConfigSummary }> {
  const sys = await getSystemInfo();
  const regs = await listRegistrations();
  return {
    data: {
      platform: sys.platform,
      isAdmin: sys.isAdmin,
      serverType: sys.serverType,
      osVersion: sys.osVersion,
      manifestNames: regs.map((r) => r.namespace),
    },
  };
}

export async function getSystemConfigForManifest(name: string): Promise<{
  data: SystemConfigEntry;
}> {
  if (!name || typeof name !== 'string') {
    throw new HandlerError(400, 'name is required');
  }
  // Defense-in-depth: the name is user-supplied and feeds path joins inside
  // the registry layer (`<dir>/<name>.json`, `<dir>/<name>.osc.yaml`). Without
  // this sanitization a value like `../../../etc/passwd` would resolve outside
  // the configforge data dir. Mirrors the gate already in
  // audit-pack.ts:182 and deploy.ts:404.
  const namespace = sanitizeNamespace(name);
  if (!namespace) {
    throw new HandlerError(400, 'name is required');
  }
  const sys = await getSystemInfo();
  const registration = await getRegistration(namespace);
  if (!registration) {
    throw new HandlerError(404, `Manifest "${name}" is not registered.`);
  }
  const source = await getRegistrationSource(namespace).catch(() => null);
  return {
    data: {
      platform: sys.platform,
      isAdmin: sys.isAdmin,
      serverType: sys.serverType,
      osVersion: sys.osVersion,
      registration,
      source,
    },
  };
}
