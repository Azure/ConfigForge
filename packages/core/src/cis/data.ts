// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CIS benchmark cross-reference helpers.
 *
 * The CIS pipeline (mc/CIS in the OSConfig repo) emits two kinds of
 * sidecar metadata next to each Windows Server CIS manifest:
 *
 *   1. `_data/cis-mappings.json` — global mapping table from OVAL test
 *      shapes to OSConfig resource types (account policies → property
 *      names, user-rights SE_*_NAME → privilege names, audit subcategory
 *      OVAL keys → GUIDs, registry types → DSC types, principal
 *      patterns, etc).
 *
 *   2. `_data/cis-ws<year>-rules.json` — per-OS rule catalog with
 *      severity, group-policy path, full rule descriptions extracted
 *      from the XCCDF.
 *
 *   3. `_data/cis-rule-id-mappings.json` — stable CIS rule name →
 *      OSConfig instance GUID mapping. Useful for FUTURE features:
 *        - cross-referencing user manifests against the canonical CIS
 *          rule ID so audit packs can cite the GUID (auditors love
 *          stable IDs)
 *        - de-duplication when importing multiple CIS-derived baselines
 *        - producing change reports keyed by GUID so renames in the
 *          rule title don't show up as "deleted/added" pairs
 *      Loader: `loadCisRuleIdMappings()` (added below).
 *
 * These files are static and ship in `public/_baselines/cis/_data/`.
 * Helpers below load them lazily and cache them in-process.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { resolvePublicAsset } from '../runtime/paths';

// ── Public types ────────────────────────────────────────────────────

export interface CisAccountPolicyMapping {
  cisName: string;
  osconfigProperty: string;
  valueType: 'integer' | 'boolean' | 'string';
  note?: string;
}

export interface CisUserRightMapping {
  privilege: string;
  cisName: string;
}

export interface CisAuditPolicyMapping {
  osconfigProperty: string;
  guid: string;
}

export interface CisGlobalMappings {
  accountPolicies: Record<string, CisAccountPolicyMapping>;
  userRights: Record<string, CisUserRightMapping>;
  auditPolicies: Record<string, CisAuditPolicyMapping>;
  sidMappings: Record<string, string>;
  registryTypes: Record<string, string>;
  resourceTypes: Record<string, string>;
}

export interface CisRule {
  ruleId: string;
  /** e.g. "X.Y.Z (L1) Ensure 'Example policy' is set to '…'" */
  name: string;
  /** Full multi-paragraph description from the XCCDF (whitespace-collapsed). */
  fullDescription: string;
  severity: string;
  /** GPO path if this rule maps to one. */
  groupPolicyPath: string | null;
}

export interface CisRuleCatalog {
  id: string;
  version: string;
  rules: CisRule[];
}

// ── Lazy loaders + caches ───────────────────────────────────────────

let _globalMappingsCache: CisGlobalMappings | null = null;
let _ruleIdMappingsCache: Record<string, string> | null = null;
const _ruleCatalogCache = new Map<string, CisRuleCatalog>();

function dataDir(): string {
  return resolvePublicAsset('_baselines/cis/_data');
}

/**
 * Public accessor for the CIS data directory. Used by `getCisStatus`
 * and the CIS Catalog page so users can see the exact path they need
 * to drop files into (and open it in Explorer / Finder).
 */
export function getCisDataDir(): string {
  return dataDir();
}

/**
 * The set of files the CIS integration looks for, with a short
 * human description. Surfaced on the CIS Catalog page so users can
 * see at a glance which files are still missing.
 */
export const CIS_EXPECTED_FILES: Array<{ name: string; description: string; required: boolean }> = [
  { name: 'cis-mappings.json', description: 'Global mappings — required (gates the whole CIS surface)', required: true },
  { name: 'cis-rule-id-mappings.json', description: 'CIS rule name → OSConfig instance GUID map', required: false },
  { name: 'cis-ws2025-rules.json', description: 'Windows Server 2025 rule catalog', required: false },
  { name: 'cis-ws2022-rules.json', description: 'Windows Server 2022 rule catalog', required: false },
  { name: 'cis-ws2019-rules.json', description: 'Windows Server 2019 rule catalog', required: false },
  { name: 'cis-ws2016-rules.json', description: 'Windows Server 2016 rule catalog', required: false },
];

/**
 * Force-clear ALL in-process CIS data caches. Distinct from the
 * test-only affordance below in that this is called from the
 * `cfs:cis:recheck` IPC so users can drop a freshly-named catalog
 * file in the data dir and have the renderer pick it up without
 * restarting the app.
 *
 * This must clear `_globalMappingsCache` (otherwise the next
 * `getCisStatus` short-circuits on the still-null cached result),
 * not just the higher-level status cache.
 */
export function clearAllCisDataCaches(): void {
  _globalMappingsCache = null;
  _ruleIdMappingsCache = null;
  _ruleCatalogCache.clear();
}

export async function loadCisGlobalMappings(): Promise<CisGlobalMappings | null> {
  if (_globalMappingsCache) return _globalMappingsCache;
  try {
    const raw = await readFile(join(dataDir(), 'cis-mappings.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Validate the shape: the legacy OVAL-mapping format has these keys.
    // Files with { standard, baselineSettings } are Azure Policy CIS
    // and should NOT be treated as the legacy catalog.
    if (
      !parsed.accountPolicies ||
      !parsed.userRights ||
      !parsed.auditPolicies
    ) {
      return null;
    }
    _globalMappingsCache = parsed as unknown as CisGlobalMappings;
    return _globalMappingsCache;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Could not load cis-mappings.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Load the CIS rule name → GUID mapping. Keyed by the canonical
 * CIS rule name (e.g. `"X.Y.Z (L1) Ensure 'Example policy' is set to '…'"`)
 * → an OSConfig instance GUID (`"263cf970-bb6b-489e-b3c7-..."`).
 *
 * Reserved for future audit-pack and cross-baseline correlation work.
 * Cached after first read. Returns `null` when the data file is absent
 * (CIS data is not bundled by default — see
 * `public/_baselines/cis/README.md`).
 */
export async function loadCisRuleIdMappings(): Promise<Record<string, string> | null> {
  if (_ruleIdMappingsCache) return _ruleIdMappingsCache;
  try {
    const raw = await readFile(join(dataDir(), 'cis-rule-id-mappings.json'), 'utf-8');
    _ruleIdMappingsCache = JSON.parse(raw) as Record<string, string>;
    return _ruleIdMappingsCache;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Could not load cis-rule-id-mappings.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function loadCisRuleCatalog(osVersion: string): Promise<CisRuleCatalog | null> {
  const cached = _ruleCatalogCache.get(osVersion);
  if (cached) return cached;
  const path = join(dataDir(), `cis-ws${osVersion}-rules.json`);
  try {
    const raw = await readFile(path, 'utf-8');
    const catalog = JSON.parse(raw) as CisRuleCatalog;
    _ruleCatalogCache.set(osVersion, catalog);
    return catalog;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Could not load cis-ws${osVersion}-rules.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function findCisNameForOsconfigProperty(
  osconfigProperty: string,
): Promise<string | null> {
  const m = await loadCisGlobalMappings();
  if (!m) return null;
  for (const entry of Object.values(m.accountPolicies)) {
    if (entry.osconfigProperty === osconfigProperty) return entry.cisName;
  }
  return null;
}

export async function findCisNameForPrivilege(privilege: string): Promise<string | null> {
  const m = await loadCisGlobalMappings();
  if (!m) return null;
  for (const entry of Object.values(m.userRights)) {
    if (entry.privilege === privilege) return entry.cisName;
  }
  return null;
}

export async function findCisRule(name: string): Promise<{ osVersion: string; rule: CisRule } | null> {
  for (const osVersion of ['2025', '2022', '2019', '2016']) {
    try {
      const catalog = await loadCisRuleCatalog(osVersion);
      if (!catalog) continue;
      const match = catalog.rules.find((r) => r.name === name);
      if (match) return { osVersion, rule: match };
    } catch {
      // Catalog not present — skip.
    }
  }
  return null;
}

/** @internal Test affordance — clear the in-process caches. */
export function _clearCisDataCacheForTests(): void {
  _globalMappingsCache = null;
  _ruleIdMappingsCache = null;
  _ruleCatalogCache.clear();
}
