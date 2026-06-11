// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR24: CIS cross-reference for manifest resources.
 *
 * Given a manifest resource (`{type, name, properties}`), return the
 * matching CIS rule from the bundled per-OS rule catalog plus its stable
 * instance GUID from `cis-rule-id-mappings.json`.
 *
 * Match strategy (PR26 expanded):
 *   1. **Strict name match** (`confidence: 1.0`) — `resource.name` matches
 *      a CIS rule name verbatim. This is exactly how the CIS-derived
 *      `.osc.yaml` baselines we ship are emitted, so the one-to-one match
 *      is auditor-defensible.
 *   2. **Property-name fallback** (`confidence: 0.7`) — when strict fails,
 *      we consult `cis-mappings.json` (the global OVAL↔OSConfig table) to
 *      see if the resource is one we recognize:
 *        - `Microsoft.Windows/AccountPolicy`: match `properties.name`
 *          against the `osconfigProperty` field (e.g. `PasswordHistorySize`
 *          → its CIS friendly name) → search the rule catalog for a rule
 *          whose name contains that friendly name.
 *        - `Microsoft.Windows/UserRightsAssignment`: match `properties.name`
 *          (e.g. `SeSecurityPrivilege`) against the `userRights.*.privilege`
 *          field → use the rule's `cisName`.
 *        - `Microsoft.Windows/AuditPolicy`: match `properties.subcategory`
 *          GUID against the audit subcategory mapping.
 *      All fallback matches are returned with `confidence < 1.0` and the
 *      sidebar marks them with a "via property mapping" pill so users
 *      know to verify.
 *
 * All catalog reads go through the lazy/cached loaders in `./data.ts`.
 * This module never re-implements file IO or JSON parsing.
 */
import {
  loadCisGlobalMappings,
  loadCisRuleCatalog,
  loadCisRuleIdMappings,
  type CisGlobalMappings,
  type CisRule,
} from './data';

/** Newest-first so a multi-OS lookup picks the latest catalog. */
const SUPPORTED_OS_VERSIONS = ['2025', '2022', '2019', '2016'] as const;
export type CisOsVersion = (typeof SUPPORTED_OS_VERSIONS)[number];

export interface CrossRefMatch {
  /** Stable OSConfig instance GUID (from cis-rule-id-mappings.json), or
   *  the rule's own `ruleId` from the catalog if the mapping is missing. */
  ruleId: string;
  /** Canonical CIS rule name (e.g. `"X.Y.Z (L1) Ensure 'Example policy' is set to '…'"`). */
  name: string;
  severity: string;
  /** Group-policy path (from the XCCDF), or `null` if not applicable. */
  gpoPath: string | null;
  /** Which catalog the rule came from (newest matched first). */
  osVersion: CisOsVersion;
  /**
   * PR26: confidence of the match. `1.0` for verbatim name match;
   * `0.7` for property-mapping fallback (e.g. `PasswordHistorySize`
   * → its CIS friendly name via cis-mappings.json).
   */
  confidence: number;
  /**
   * PR26: how we found this rule. `'strict'` is the verbatim-name path;
   * `'property-mapping'` is the fallback that walks cis-mappings.json.
   * Lets the UI show a "via property mapping" pill so users know to
   * verify before treating the result as authoritative.
   */
  matchSource: 'strict' | 'property-mapping';
}

export interface ManifestResource {
  type: string;
  name: string;
  properties?: Record<string, unknown>;
}

/**
 * Look up the CIS rule for a single resource.
 *
 * Match priority:
 *   1. Strict `resource.name === rule.name` (confidence 1.0).
 *   2. PR26 fallback: property-mapping via `cis-mappings.json` for
 *      AccountPolicy / UserRightsAssignment / AuditPolicy resources
 *      (confidence 0.7).
 *
 * If `osVersion` is given, only that catalog is consulted; otherwise
 * we walk newest-to-oldest and return the first hit.
 *
 * Returns `null` for unmatched resources, OR when no catalog could be
 * loaded (e.g. running with no CIS data shipped).
 */
export async function findCisRuleForResource(
  resource: ManifestResource,
  osVersion?: string,
): Promise<CrossRefMatch | null> {
  if (!resource || typeof resource.name !== 'string' || !resource.name) {
    // PR26: a resource may have an empty `name` but still be matchable
    // via its property shape (e.g. user manifests where the resource
    // name is the YAML doc-level title, not the rule title). Try the
    // property-mapping fallback before giving up.
    if (resource && resource.type) {
      return findCisRuleByProperty(resource, osVersion);
    }
    return null;
  }

  const versions: readonly string[] = osVersion
    ? [osVersion]
    : SUPPORTED_OS_VERSIONS;

  for (const v of versions) {
    let rule: CisRule | undefined;
    try {
      const catalog = await loadCisRuleCatalog(v);
      if (!catalog) continue;
      rule = catalog.rules.find((r) => r.name === resource.name);
    } catch {
      // Catalog missing for this OS — skip and keep walking. If *every*
      // requested catalog is missing we fall through to `null` which is
      // exactly the contract ("no rules catalog → null").
      continue;
    }
    if (!rule) continue;

    let mappedGuid: string | null = null;
    try {
      const idMap = await loadCisRuleIdMappings();
      mappedGuid = idMap?.[rule.name] ?? null;
    } catch {
      mappedGuid = null;
    }

    return {
      ruleId: mappedGuid ?? rule.ruleId,
      name: rule.name,
      severity: rule.severity,
      gpoPath: rule.groupPolicyPath,
      osVersion: v as CisOsVersion,
      confidence: 1.0,
      matchSource: 'strict',
    };
  }

  // PR26: no strict hit; try the property-mapping fallback.
  return findCisRuleByProperty(resource, osVersion);
}

/**
 * Bulk variant — preloads each catalog at most once and reuses a Map for
 * O(1) name lookups, so a 350-resource manifest finishes well under the
 * 100ms budget on a cold cache.
 */
export async function findCisRulesForResources(
  resources: ManifestResource[],
  osVersion?: string,
): Promise<Array<CrossRefMatch | null>> {
  const versions: readonly string[] = osVersion
    ? [osVersion]
    : SUPPORTED_OS_VERSIONS;

  const indexes: Array<{ v: string; map: Map<string, CisRule> }> = [];
  for (const v of versions) {
    try {
      const catalog = await loadCisRuleCatalog(v);
      if (!catalog) continue;
      const map = new Map<string, CisRule>();
      for (const r of catalog.rules) map.set(r.name, r);
      indexes.push({ v, map });
    } catch {
      // skip missing catalog
    }
  }

  let idMap: Record<string, string> | null = null;
  try {
    idMap = await loadCisRuleIdMappings();
  } catch {
    idMap = null;
  }

  return resources.map((res) => {
    if (!res || typeof res.name !== 'string' || !res.name) return null;
    for (const { v, map } of indexes) {
      const rule = map.get(res.name);
      if (rule) {
        return {
          ruleId: idMap?.[rule.name] ?? rule.ruleId,
          name: rule.name,
          severity: rule.severity,
          gpoPath: rule.groupPolicyPath,
          osVersion: v as CisOsVersion,
          confidence: 1.0,
          matchSource: 'strict',
        } satisfies CrossRefMatch;
      }
    }
    return null;
  });
}

// ─── PR26: property-mapping fallback ─────────────────────────────────

/**
 * Search the CIS friendly name reverse-mapped from a resource's
 * property values. Walks the global mapping table once, then scans the
 * per-OS rule catalog for a rule whose name *contains* the friendly
 * name. Returns the first match (newest OS first).
 *
 * Why "contains" rather than equals: CIS rule names are verbose
 * (e.g. `"X.Y.Z (L1) Ensure 'Example policy' is set to '…'"`) but the
 * mapping file gives us the short form (just the policy name). A
 * substring match is the most defensible heuristic — case-sensitive,
 * exact-spelling-from-source.
 */
async function findCisRuleByProperty(
  resource: ManifestResource,
  osVersion?: string,
): Promise<CrossRefMatch | null> {
  let mappings: CisGlobalMappings | null;
  try {
    mappings = await loadCisGlobalMappings();
  } catch {
    return null;
  }
  if (!mappings) return null;

  const friendlyName = friendlyNameForResource(resource, mappings);
  if (!friendlyName) return null;

  const versions: readonly string[] = osVersion
    ? [osVersion]
    : SUPPORTED_OS_VERSIONS;

  for (const v of versions) {
    let rule: CisRule | undefined;
    try {
      const catalog = await loadCisRuleCatalog(v);
      if (!catalog) continue;
      rule = catalog.rules.find((r) => r.name.includes(friendlyName));
    } catch {
      continue;
    }
    if (!rule) continue;

    let mappedGuid: string | null = null;
    try {
      const idMap = await loadCisRuleIdMappings();
      mappedGuid = idMap?.[rule.name] ?? null;
    } catch {
      mappedGuid = null;
    }

    return {
      ruleId: mappedGuid ?? rule.ruleId,
      name: rule.name,
      severity: rule.severity,
      gpoPath: rule.groupPolicyPath,
      osVersion: v as CisOsVersion,
      confidence: 0.7,
      matchSource: 'property-mapping',
    };
  }

  return null;
}

/**
 * Reverse-look-up: given a resource shape, return the CIS friendly
 * name implied by its property values.
 *
 * @internal
 */
export function friendlyNameForResource(
  resource: ManifestResource,
  mappings: CisGlobalMappings,
): string | null {
  const props = resource.properties ?? {};
  const propName = typeof props.name === 'string' ? props.name : null;
  const subcat = typeof props.subcategory === 'string' ? props.subcategory : null;

  switch (resource.type) {
    case 'Microsoft.Windows/AccountPolicy': {
      if (!propName) return null;
      for (const entry of Object.values(mappings.accountPolicies)) {
        if (entry.osconfigProperty === propName) return entry.cisName;
      }
      return null;
    }
    case 'Microsoft.Windows/UserRightsAssignment': {
      if (!propName) return null;
      for (const entry of Object.values(mappings.userRights)) {
        if (entry.privilege === propName) return entry.cisName;
      }
      return null;
    }
    case 'Microsoft.Windows/AuditPolicy': {
      if (!subcat) return null;
      for (const [ovalKey, entry] of Object.entries(mappings.auditPolicies)) {
        if (entry.guid === subcat) {
          return ovalKey
            .split('_')
            .map((s) => (s.length ? s[0].toUpperCase() + s.slice(1) : s))
            .join(' ');
        }
      }
      return null;
    }
    default:
      return null;
  }
}
