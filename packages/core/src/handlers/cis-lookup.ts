// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:cis:lookup` and `GET /api/cis/lookup`.
 *
 * Wraps `findCisRuleForResource` so the manifest editor can show a
 * CIS rule sidebar without bundling the full rule catalog into the
 * client. Supports the property-mapping fallback added in PR26.
 *
 * v0.3.5 (POC): falls through to XCCDF-derived registry index when
 * the JSON catalog doesn't produce a match.
 */
import { findCisRuleForResource } from '../cis/crossref';
import { getCisDataDir } from '../cis/data';
import {
  discoverXccdfFiles,
  getOrParseXccdfCatalog,
  lookupResourceInXccdf,
  lookupNonRegistryInXccdf,
  fuzzyMatchXccdfTitle,
  extractCspPathWords,
  splitPascalCase,
  stripCspCategoryPrefix,
} from '../cis/xccdf-parser';
import { discoverAzurePolicyCisFiles } from '../cis/azure-policy-cis';
import { HandlerError } from './errors';

export interface CisLookupRequest {
  name: string;
  osVersion?: string;
  type?: string;
  /** Inner resource type, e.g. `Microsoft.Windows/CSP`. */
  innerType?: string;
  propertyName?: string;
  propertySubcategory?: string;
  /** Registry key path (e.g. HKEY_LOCAL_MACHINE\...). Passed by the editor when available. */
  registryKeyPath?: string;
  /** Registry value name. */
  registryValueName?: string;
  /**
   * Windows CSP policy path (e.g.
   * `./Vendor/MSFT/Policy/Result/LocalPoliciesSecurityOptions/NetworkAccess_AllowAnonymousSIDOrNameTranslation`).
   * Used to enrich the fuzzy XCCDF title match for resources of type
   * `Microsoft.Windows/CSP`, which have no registry key path.
   */
  cspPath?: string;
  /**
   * Alias for `cspPath` to match the YAML field name (`properties.resource.properties.path`).
   * The renderer extracts this as `path`; we accept either spelling.
   */
  path?: string;
}

export async function lookupCisRule(req: CisLookupRequest): Promise<{
  name: string;
  match: unknown;
  source?: 'json' | 'xccdf';
  confidence?: 'high' | 'medium' | 'low';
}> {
  if (!req.name || typeof req.name !== 'string') {
    throw new HandlerError(400, 'name is required');
  }

  // The renderer may pass the CSP path under either `cspPath` or `path`
  // (the latter matches the YAML field name in `properties.resource.properties.path`).
  const cspPath = req.cspPath ?? req.path;

  const properties: Record<string, string> = {};
  if (req.propertyName) properties.name = req.propertyName;
  if (req.propertySubcategory) properties.subcategory = req.propertySubcategory;

  // 1) Try the JSON catalog first (highest fidelity)
  const jsonMatch = await findCisRuleForResource(
    {
      type: req.type ?? '',
      name: req.name,
      properties: Object.keys(properties).length ? properties : undefined,
    },
    req.osVersion,
  );

  if (jsonMatch) {
    return { name: req.name, match: jsonMatch, source: 'json', confidence: 'high' };
  }

  // 2) Fall through to XCCDF-derived registry index (exact match)
  if (req.registryKeyPath) {
    try {
      const dataDir = getCisDataDir();
      const discovered = await discoverXccdfFiles(dataDir);
      // Find Windows XCCDFs with OVAL companions
      const windowsXccdfs = discovered.filter(
        (d) => d.platform === 'windows' && d.ovalPath,
      );

      for (const xf of windowsXccdfs) {
        const catalog = await getOrParseXccdfCatalog(xf.xccdfPath, xf.ovalPath);
        const rule = await lookupResourceInXccdf(
          catalog,
          req.registryKeyPath,
          req.registryValueName,
        );
        if (rule) {
          return {
            name: req.name,
            match: {
              ruleId: rule.ruleId,
              title: rule.title,
              description: rule.description,
              severity: rule.severity,
              fixtext: rule.fixtext,
              source: 'xccdf',
              benchmark: catalog.benchmarkTitle,
            },
            source: 'xccdf',
            confidence: 'high',
          };
        }
      }
    } catch {
      // XCCDF fallback is best-effort
    }
  }

  // 3) XCCDF fuzzy-title fallback (NEW v0.3.24).
  //
  // CSP-based manifest resources have neither a registryKeyPath nor a
  // direct OVAL registry-object mapping, so the exact-match step above
  // returns null. Instead, fuzzy-match the resource name (and, for CSP
  // resources, the CSP-path policy segment) against XCCDF rule titles.
  // Also covers non-registry types (UserRights/AuditPolicy/AccountPolicy)
  // via the catalog's specialized indices first.
  try {
    const dataDir = getCisDataDir();
    const discovered = await discoverXccdfFiles(dataDir);
    const windowsXccdfs = discovered.filter(
      (d) => d.platform === 'windows' && d.ovalPath,
    );

    // If a CSP-style path was supplied, extract its policy words. This
    // works whether or not `innerType` was passed (CSP paths starting
    // with `./Vendor/MSFT/` are themselves a strong signal, and the
    // renderer doesn't always include `innerType`).
    const isCsp = (req.innerType ?? '').endsWith('/CSP')
      || (cspPath?.startsWith('./Vendor/MSFT/') ?? false);
    const cspWords = isCsp && cspPath ? extractCspPathWords(cspPath) : [];

    // Two-pass: try the high-fidelity non-registry indices across ALL
    // catalogs first, then fall back to fuzzy across all catalogs.
    // Otherwise a smaller catalog (e.g. Azure Compute, which lacks
    // some rules) could win a fuzzy match before a fuller catalog
    // (e.g. WS2025) had a chance to do a non-registry exact match.
    const catalogs = await Promise.all(
      windowsXccdfs.map(async (xf) => ({
        xf,
        catalog: await getOrParseXccdfCatalog(xf.xccdfPath, xf.ovalPath),
      })),
    );

    // Pass 1: non-registry exact (UserRights / AuditPolicy / AccountPolicy).
    for (const { catalog } of catalogs) {
      const nonRegHit = lookupNonRegistryInXccdf(
        catalog,
        req.innerType ?? req.type ?? '',
        req.name,
        req.propertyName,
        req.propertySubcategory,
        cspPath ?? undefined,
      );
      if (nonRegHit) {
        return {
          name: req.name,
          match: {
            ruleId: nonRegHit.ruleId,
            title: nonRegHit.title,
            description: nonRegHit.description,
            severity: nonRegHit.severity,
            fixtext: nonRegHit.fixtext,
            source: 'xccdf',
            benchmark: catalog.benchmarkTitle,
            confidence: 'high',
          },
          source: 'xccdf',
          confidence: 'high',
        };
      }
    }

    // Pass 2: fuzzy title match. Strip CSP category prefix from the
    // resource name (e.g. "UserRightsDebugPrograms" → "DebugPrograms")
    // so the category word ("UserRights") doesn't dilute the match ratio.
    const fuzzyName = isCsp ? stripCspCategoryPrefix(req.name, cspPath) : req.name;
    for (const { catalog } of catalogs) {
      const fuzzyHit = fuzzyMatchXccdfTitle(catalog, fuzzyName, 0.8, cspWords);
      if (fuzzyHit) {
        return {
          name: req.name,
          match: {
            ruleId: fuzzyHit.ruleId,
            title: fuzzyHit.title,
            description: fuzzyHit.description,
            severity: fuzzyHit.severity,
            fixtext: fuzzyHit.fixtext,
            source: 'xccdf',
            benchmark: catalog.benchmarkTitle,
            confidence: 'medium',
          },
          source: 'xccdf',
          confidence: 'medium',
        };
      }
    }
  } catch {
    // best-effort
  }

  // 4) Fall through to Azure Policy CIS JSON (name-based matching)
  try {
    const dataDir = getCisDataDir();
    const catalogs = await discoverAzurePolicyCisFiles(dataDir);

    for (const catalog of catalogs) {
      if (catalog.ruleCount === 0) continue;

      // Try matching by resource name against CIS rule titles using the
      // same PascalCase splitter the XCCDF path uses (ABBR→Word boundary
      // handled correctly).
      const words = splitPascalCase(req.name);
      if (words.length === 0) continue;

      for (const rule of catalog.rules) {
        const titleWordSet = new Set(splitPascalCase(rule.title));
        const matchedWords = words.filter((w) => titleWordSet.has(w));
        const matchRatio = matchedWords.length / words.length;

        if (matchRatio >= 0.8) {
          return {
            name: req.name,
            match: {
              ruleId: rule.ruleId,
              title: `${rule.sectionNumber} ${rule.title}`,
              description: `Value: ${rule.value || '(not specified)'}`,
              severity: '',
              source: 'azure-policy',
              benchmark: catalog.benchmarkName,
              confidence: 'high',
            },
            source: 'xccdf' as const,
            confidence: 'high' as const,
          };
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[cis-lookup] Azure Policy fallback failed:', err instanceof Error ? err.message : err);
  }

  return { name: req.name, match: null };
}
