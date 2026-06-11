// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Bulk CIS lookup for the CIS Diff tab.
 *
 * Computes manifest-vs-benchmark coverage. The primary metric is
 * **compliance percent**: how many of the chosen CIS benchmark's
 * rules are covered by the manifest. NOT how many of the manifest's
 * resources happen to match a CIS rule.
 *
 * Example: a 200-resource manifest where every resource matches CIS
 * is NOT 100% compliant if the CIS benchmark has 364 rules — it's
 * 200/364 = 55%.
 *
 * Inputs:
 *   - namespace: which manifest to scan
 *   - benchmarkFilename: which CIS benchmark to score against. If
 *     omitted, auto-picks the platform-matched benchmark with the
 *     most rules.
 *
 * Returns benchmark info, distinct rules covered (deduped),
 * unmatched rules list (actionable: "these rules are missing"),
 * and the per-resource results array (secondary view).
 */

import yaml from 'js-yaml';
import { getRegistrationSource } from '../oscfg/registry';
import { lookupCisRule, type CisLookupRequest } from './cis-lookup';
import {
  discoverAzurePolicyCisFiles,
  parseAzurePolicyCisJson,
} from '../cis/azure-policy-cis';
import {
  discoverXccdfFiles,
  getOrParseXccdfCatalog,
  canonicalRegistryPath,
  lookupNonRegistryInXccdf,
  fuzzyMatchXccdfTitle,
  extractCspPathWords,
  splitPascalCase,
  stripCspCategoryPrefix,
  linuxFuzzyMatch,
  linuxFuzzyTokenize,
  type XccdfRule,
  type LinuxResourceTokens,
} from '../cis/xccdf-parser';
import { getCisDataDir } from '../cis/data';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CisBulkLookupRequest {
  namespace: string;
  /** Optional: which benchmark to score against. Auto-picked if absent. */
  benchmarkFilename?: string;
}

export interface CisBulkLookupResult {
  resourceName: string;
  resourceType: string;
  innerType: string;
  registryKeyPath: string | null;
  registryValueName: string | null;
  cisMatch: {
    ruleId: string;
    title: string;
    description?: string;
    severity?: string;
    source?: string;
    benchmark?: string;
    fixtext?: string;
    confidence?: string;
  } | null;
}

export interface CisBulkLookupResponse {
  namespace: string;
  /** Total manifest resources scanned. */
  manifestResourceTotal: number;
  /** Manifest resources that matched ANY CIS rule (secondary metric). */
  manifestResourcesWithMatch: number;

  /** Benchmark we scored compliance against. */
  benchmark: {
    filename: string;
    name: string;
    version: string;
    platform: 'windows' | 'linux' | 'unknown';
    totalRules: number;
    /** Where the benchmark rules came from. */
    source: 'azure-policy' | 'xccdf';
  } | null;

  /** Distinct CIS rule IDs from the benchmark covered by the manifest. */
  cisRulesCovered: number;
  /** Rules in the benchmark NOT covered by the manifest. Actionable. */
  cisRulesUnmatched: Array<{
    ruleId: string;
    sectionNumber: string;
    title: string;
    value: string;
  }>;
  /** cisRulesCovered / benchmark.totalRules * 100, or null if no benchmark. */
  compliancePercent: number | null;

  /** Per-resource details (secondary view). */
  results: CisBulkLookupResult[];
}

interface YamlResource {
  name?: string;
  type?: string;
  properties?: {
    resource?: {
      type?: string;
      properties?: {
        keyPath?: string;
        valueName?: string;
        path?: string;
        name?: string;
        subcategory?: string;
      };
    };
    // Group resources nest children here (e.g. Microsoft.OSConfig/Group)
    resources?: YamlResource[];
    name?: string;
    subcategory?: string;
    keyPath?: string;
    valueName?: string;
    path?: string;
  };
}

/**
 * Recursively walk a Linux Group resource's nested children, building
 * the LinuxResourceTokens structure. Each child's type drives whether
 * its tokens are high (KernelModule/User), medium, or low confidence.
 *
 * Called only for Linux benchmarks; never on Windows.
 */
function buildLinuxResourceTokens(r: YamlResource): LinuxResourceTokens {
  const high: string[] = [];
  const med: string[] = [];
  const low: string[] = [];
  const paths = new Set<string>();
  let polaritySource = r.name ?? '';

  // Resource name → medium tokens
  if (r.name) {
    for (const w of linuxFuzzyTokenize(r.name)) med.push(w);
  }

  // Walk children: properties.resource (singular, single-child) and
  // properties.resources[] (plural, Group). Also handle direct props.
  function walk(node: YamlResource, depth: number): void {
    if (depth > 4) return; // safety guard against pathological nesting
    const inner = node.properties?.resource;
    const innerType = inner?.type ?? '';
    const innerProps = inner?.properties ?? {};
    const directProps = node.properties ?? {};

    // KernelModule and User .name = strongest Linux signal
    const isHighSignalType =
      innerType === 'Linux/KernelModule' ||
      innerType === 'Linux/User' ||
      node.type === 'Linux/KernelModule' ||
      node.type === 'Linux/User';

    const propName =
      innerProps.name ?? (directProps as Record<string, unknown>).name;
    if (propName && typeof propName === 'string') {
      const tokens = linuxFuzzyTokenize(propName);
      if (isHighSignalType) {
        for (const w of tokens) high.push(w);
      } else {
        for (const w of tokens) med.push(w);
      }
      polaritySource += ' ' + propName;
    }

    // Paths from properties.path (FileLine, File, CSP-style) and
    // properties.resource.properties.path
    const rawPath =
      innerProps.path ??
      (directProps as Record<string, unknown>).path;
    if (rawPath && typeof rawPath === 'string') {
      const normPath = rawPath.toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '');
      paths.add(normPath);
      // Basename → high (file-specific signal); ancestor dirs → low
      const segs = normPath.split('/').filter(Boolean);
      for (const s of segs.slice(0, -1)) {
        for (const w of linuxFuzzyTokenize(s)) low.push(w);
      }
      const basename = segs[segs.length - 1];
      if (basename) for (const w of linuxFuzzyTokenize(basename)) high.push(w);
    }

    // Recurse into nested children (Group resource pattern)
    if (Array.isArray(node.properties?.resources)) {
      for (const child of node.properties!.resources!) {
        walk(child, depth + 1);
      }
    }
  }
  walk(r, 0);

  return { high, med, low, paths, polaritySource };
}

function extractResourceInfo(r: YamlResource): {
  name: string;
  type: string;
  innerType: string;
  registryKeyPath: string | null;
  registryValueName: string | null;
  cspPath: string | null;
  propertyName: string | null;
  propertySubcategory: string | null;
} {
  const name = r.name ?? '';
  const type = r.type ?? '';
  const inner = r.properties?.resource;
  const innerType = inner?.type ?? '';
  const innerProps = inner?.properties ?? {};

  const registryKeyPath = innerProps.keyPath ?? r.properties?.keyPath ?? null;
  const registryValueName = innerProps.valueName ?? r.properties?.valueName ?? null;
  // CSP resources expose a different key: `properties.resource.properties.path`
  const cspPath = innerProps.path ?? null;
  const propertyName = innerProps.name ?? r.properties?.name ?? null;
  const propertySubcategory = innerProps.subcategory ?? r.properties?.subcategory ?? null;

  return { name, type, innerType, registryKeyPath, registryValueName, cspPath, propertyName, propertySubcategory };
}

function detectManifestPlatform(resources: YamlResource[]): 'windows' | 'linux' | 'unknown' {
  for (const r of resources) {
    const innerType = r.properties?.resource?.type ?? '';
    if (innerType.startsWith('Microsoft.Windows/')) return 'windows';
    if (innerType.startsWith('Microsoft.Linux/')) return 'linux';
  }
  return 'unknown';
}

export async function cisBulkLookup(req: CisBulkLookupRequest): Promise<CisBulkLookupResponse> {
  const source = await getRegistrationSource(req.namespace);
  if (!source) {
    throw new Error(`Manifest "${req.namespace}" not found or has no source YAML`);
  }

  const parsed = yaml.load(source) as { resources?: YamlResource[] } | null;
  const resources = parsed?.resources ?? [];
  const manifestPlatform = detectManifestPlatform(resources);

  // 1. Discover BOTH benchmark types. XCCDF benchmarks are full CIS
  // standard with registry-exact matching; Azure Policy is the
  // Microsoft-curated subset with fuzzy name matching.
  const dataDir = getCisDataDir();
  const [azurePolicyCatalogs, xccdfDiscovered] = await Promise.all([
    discoverAzurePolicyCisFiles(dataDir),
    discoverXccdfFiles(dataDir),
  ]);
  const validAzurePolicy = azurePolicyCatalogs.filter((c) => c.ruleCount > 0);
  const validXccdf = xccdfDiscovered.filter((x) => x.ovalPath !== null);

  // Resolve the chosen benchmark — XCCDF takes precedence when filename
  // matches an XCCDF file, otherwise falls back to Azure Policy lookup.
  let chosenXccdf: typeof validXccdf[number] | undefined;
  let chosenAzurePolicy: typeof validAzurePolicy[number] | undefined;

  if (req.benchmarkFilename) {
    chosenXccdf = validXccdf.find((x) => x.filename === req.benchmarkFilename);
    if (!chosenXccdf) {
      chosenAzurePolicy = validAzurePolicy.find((c) => c.filename === req.benchmarkFilename);
    }
    if (!chosenXccdf && !chosenAzurePolicy) {
      throw new Error(`Benchmark "${req.benchmarkFilename}" not found or has no rules`);
    }
  } else {
    // Auto-pick: prefer XCCDF (full standard) for platform; fall back to Azure Policy.
    const xccdfSamePlat = validXccdf.filter((x) => x.platform === manifestPlatform);
    chosenXccdf = xccdfSamePlat[0] ?? validXccdf[0];
    if (!chosenXccdf) {
      const apSamePlat = validAzurePolicy.filter((c) => c.platform === manifestPlatform);
      chosenAzurePolicy = apSamePlat.sort((a, b) => b.ruleCount - a.ruleCount)[0]
        ?? validAzurePolicy.sort((a, b) => b.ruleCount - a.ruleCount)[0];
    }
  }

  // 2. Load the chosen benchmark's rules.
  let benchmarkRules: Array<{ ruleId: string; sectionNumber: string; title: string; value: string }> = [];
  let benchmarkInfo: CisBulkLookupResponse['benchmark'] = null;
  let xccdfCatalog: Awaited<ReturnType<typeof getOrParseXccdfCatalog>> | null = null;

  if (chosenXccdf && chosenXccdf.ovalPath) {
    try {
      xccdfCatalog = await getOrParseXccdfCatalog(chosenXccdf.xccdfPath, chosenXccdf.ovalPath);
      benchmarkRules = xccdfCatalog.rules.map((r: XccdfRule) => {
        // XCCDF rule IDs typically end with the section number (e.g. xccdf_org.cisecurity.benchmarks_rule_1.1.1_*)
        const sectionMatch = r.ruleId.match(/rule_([\d.]+)/);
        return {
          ruleId: r.ruleId,
          sectionNumber: sectionMatch ? sectionMatch[1] : '',
          title: r.title,
          value: r.fixtext ? r.fixtext.substring(0, 200) : '',
        };
      });
      benchmarkInfo = {
        filename: chosenXccdf.filename,
        name: xccdfCatalog.benchmarkTitle || chosenXccdf.title,
        version: xccdfCatalog.benchmarkVersion || chosenXccdf.version,
        platform: chosenXccdf.platform,
        totalRules: xccdfCatalog.ruleCount,
        source: 'xccdf',
      };
    } catch {
      xccdfCatalog = null;
    }
  } else if (chosenAzurePolicy) {
    try {
      const raw = await readFile(join(dataDir, chosenAzurePolicy.filename), 'utf-8');
      const parsedJson: unknown = JSON.parse(raw);
      const catalog = parseAzurePolicyCisJson(parsedJson, chosenAzurePolicy.filename);
      if (catalog) {
        benchmarkRules = catalog.rules.map((r) => ({
          ruleId: r.ruleId,
          sectionNumber: r.sectionNumber,
          title: r.title,
          value: r.value,
        }));
        benchmarkInfo = {
          filename: catalog.filename,
          name: catalog.benchmarkName,
          version: catalog.benchmarkVersion,
          platform: catalog.platform,
          totalRules: catalog.ruleCount,
          source: 'azure-policy',
        };
      }
    } catch {
      // Fall through with benchmarkInfo = null
    }
  }

  // Build a registry-index lookup for XCCDF matching: ruleId -> Set of canonical paths
  // (use the catalog's own registryIndex inverted)
  let xccdfRuleIdByRegistryPath: Map<string, string> | null = null;
  if (xccdfCatalog) {
    xccdfRuleIdByRegistryPath = new Map();
    for (const [canon, indices] of xccdfCatalog.registryIndex.entries()) {
      for (const idx of indices) {
        const rule = xccdfCatalog.rules[idx];
        if (rule) xccdfRuleIdByRegistryPath.set(canon, rule.ruleId);
      }
    }
  }

  // 3. Walk manifest resources. For compliance counting we match each
  // resource DIRECTLY against the chosen benchmark's rules using
  // best-match name fuzzy matching (not first-match-wins). We also
  // call lookupCisRule for the per-resource cisMatch display so the
  // UI still shows XCCDF/JSON matches when those are richer.
  const results: CisBulkLookupResult[] = [];
  const matchedRuleIds = new Set<string>();
  let manifestResourcesWithMatch = 0;

  for (const r of resources) {
    const info = extractResourceInfo(r);
    if (!info.name) continue;

    // 3a. Find compliance match against the chosen benchmark.
    // - XCCDF: registry-key exact match first (high fidelity), then
    //   non-registry indices (UserRights/AuditPolicy/AccountPolicy),
    //   then fuzzy XCCDF title match (catches CSP-based resources)
    // - Azure Policy: best-match name fuzzy matching only
    let benchmarkMatch: typeof benchmarkRules[number] | null = null;
    if (benchmarkInfo?.source === 'xccdf' && xccdfCatalog) {
      let xccdfHit: XccdfRule | null = null;
      // (i) registry-key exact match
      if (info.registryKeyPath && xccdfRuleIdByRegistryPath) {
        const firstSlash = info.registryKeyPath.indexOf('\\');
        if (firstSlash > 0) {
          const hive = info.registryKeyPath.substring(0, firstSlash);
          const key = info.registryKeyPath.substring(firstSlash + 1);
          const canon = canonicalRegistryPath(hive, key, info.registryValueName ?? '').canonical;
          const ruleId = xccdfRuleIdByRegistryPath.get(canon);
          if (ruleId) xccdfHit = xccdfCatalog.rules.find((r) => r.ruleId === ruleId) ?? null;
        }
      }
      // (ii) non-registry resource type indices (UserRights/AuditPolicy/AccountPolicy).
      // Pass cspPath so CSP-style resources route through these specialized
      // indices via their /UserRights/<Name> path segment.
      if (!xccdfHit) {
        xccdfHit = lookupNonRegistryInXccdf(
          xccdfCatalog,
          info.innerType,
          info.name,
          info.propertyName ?? undefined,
          info.propertySubcategory ?? undefined,
          info.cspPath ?? undefined,
        );
      }
      // (iii) fuzzy title fallback for CSP paths or anything else.
      // For Windows /CSP resources, feed the policy-path words to the
      // matcher in addition to the resource name. The CSP path's last
      // segment (e.g. `NetworkAccess_AllowAnonymousSIDOrNameTranslation`)
      // is a strong title-overlap signal. We also strip the CSP category
      // prefix from the resource name (e.g. "UserRightsDebugPrograms" →
      // "DebugPrograms") because the category is the CSP node name and
      // doesn't appear in CIS rule titles, just noise that drags the
      // overlap ratio below threshold.
      //
      // Linux XCCDF gets a completely different matcher (linuxFuzzyMatch)
      // because Linux titles are verbose natural language with paths.
      if (!xccdfHit) {
        if (xccdfCatalog.platform === 'linux') {
          const linuxTokens = buildLinuxResourceTokens(r);
          const result = linuxFuzzyMatch(xccdfCatalog.rules, linuxTokens);
          xccdfHit = result?.rule ?? null;
        } else {
          const isCsp = info.innerType.endsWith('/CSP');
          const cspWords = isCsp && info.cspPath
            ? extractCspPathWords(info.cspPath)
            : [];
          const fuzzyName = isCsp
            ? stripCspCategoryPrefix(info.name, info.cspPath)
            : info.name;
          xccdfHit = fuzzyMatchXccdfTitle(xccdfCatalog, fuzzyName, 0.8, cspWords);
        }
      }
      if (xccdfHit) {
        benchmarkMatch = benchmarkRules.find((r) => r.ruleId === xccdfHit!.ruleId) ?? null;
      }
    } else if (benchmarkInfo && benchmarkRules.length > 0) {
      // Azure Policy fuzzy matching.
      //
      // Linux Azure Policy gets the dedicated linuxFuzzyMatch matcher
      // — it handles natural-language titles, nested kernel module
      // names, path disambiguation, polarity guards, and best-vs-
      // runner-up margin. The PascalCase matcher below misses ~93% of
      // Linux rules due to stopword noise + 0.8 threshold.
      //
      // Windows Azure Policy continues to use the PascalCase matcher.
      // For Windows CSP resources, the CSP category prefix is stripped
      // and cspPath path-component words are fed in. Without this,
      // names like `LocalPoliciesSecurityOptions_NetworkAccess_...`
      // get dragged below threshold by the category-prefix noise.
      if (benchmarkInfo.platform === 'linux') {
        const linuxTokens = buildLinuxResourceTokens(r);
        const result = linuxFuzzyMatch(benchmarkRules, linuxTokens);
        benchmarkMatch = result?.rule ?? null;
      } else {
        const isCsp = info.innerType.endsWith('/CSP');
        const baseName = isCsp ? stripCspCategoryPrefix(info.name, info.cspPath) : info.name;
        const nameWords = splitPascalCase(baseName);
        const cspWords = isCsp && info.cspPath ? extractCspPathWords(info.cspPath) : [];
        // Merge unique tokens from name + cspPath. cspPath tokens are
        // additive — they don't replace name tokens, and they don't
        // inflate the denominator unless they're new info.
        const wordSet = new Set<string>();
        for (const w of nameWords) wordSet.add(w);
        for (const w of cspWords) wordSet.add(w);
        const words = Array.from(wordSet);
        if (words.length > 0) {
          let bestRatio = 0;
          for (const rule of benchmarkRules) {
            // Exact-word match using the same PascalCase splitter on the
            // rule title — prevents short tokens substring-matching unrelated
            // longer words in titles.
            const titleWordSet = new Set(splitPascalCase(rule.title));
            const matchedWords = words.filter((w) => titleWordSet.has(w));
            const ratio = matchedWords.length / words.length;
            if (ratio > bestRatio) {
              bestRatio = ratio;
              benchmarkMatch = rule;
            }
          }
          if (bestRatio < 0.8) benchmarkMatch = null;
        }
      }
    }
    if (benchmarkMatch) {
      matchedRuleIds.add(benchmarkMatch.ruleId);
    }

    // 3b. Per-resource display match (editor-priority: JSON > XCCDF > Azure Policy).
    const lookupReq: CisLookupRequest = {
      name: info.name,
      type: info.type,
      registryKeyPath: info.registryKeyPath ?? undefined,
      registryValueName: info.registryValueName ?? undefined,
      cspPath: info.cspPath ?? undefined,
      innerType: info.innerType,
      propertyName: info.propertyName ?? undefined,
      propertySubcategory: info.propertySubcategory ?? undefined,
    };
    const result = await lookupCisRule(lookupReq);
    const match = result.match as Record<string, unknown> | null;

    let cisMatch = match ? {
      ruleId: String(match.ruleId ?? ''),
      title: String(match.title ?? match.name ?? ''),
      description: match.description ? String(match.description) : undefined,
      severity: match.severity ? String(match.severity) : undefined,
      source: String(match.source ?? result.source ?? ''),
      benchmark: match.benchmark ? String(match.benchmark) : undefined,
      fixtext: match.fixtext ? String(match.fixtext) : undefined,
      confidence: String(result.confidence ?? match.confidence ?? ''),
    } : null;

    // Fallback: when lookupCisRule (legacy per-resource display path)
    // returns null but the new compliance-counting path (benchmarkMatch)
    // found a hit, surface it in the per-row display. Without this the
    // top-level "X% covered" counter says e.g. 38/299 but every Linux
    // row in the table still shows "No CIS rule". This is the typical
    // case for Linux now that linuxFuzzyMatch is wired only into the
    // benchmarkMatch path.
    if (!cisMatch && benchmarkMatch) {
      cisMatch = {
        ruleId: benchmarkMatch.ruleId,
        title: benchmarkMatch.title,
        description: undefined,
        severity: undefined,
        source: benchmarkInfo?.source ?? '',
        benchmark: benchmarkInfo?.filename,
        fixtext: undefined,
        confidence: 'fuzzy',
      };
    }

    if (cisMatch || benchmarkMatch) {
      manifestResourcesWithMatch++;
    }

    results.push({
      resourceName: info.name,
      resourceType: info.type,
      innerType: info.innerType,
      registryKeyPath: info.registryKeyPath,
      registryValueName: info.registryValueName,
      cisMatch,
    });
  }

  // 4. Build the unmatched-rules list and compliance %.
  const cisRulesUnmatched = benchmarkRules.filter((r) => !matchedRuleIds.has(r.ruleId));
  const cisRulesCovered = benchmarkInfo
    ? benchmarkInfo.totalRules - cisRulesUnmatched.length
    : matchedRuleIds.size;
  const compliancePercent = benchmarkInfo && benchmarkInfo.totalRules > 0
    ? (cisRulesCovered / benchmarkInfo.totalRules) * 100
    : null;

  return {
    namespace: req.namespace,
    manifestResourceTotal: results.length,
    manifestResourcesWithMatch,
    benchmark: benchmarkInfo,
    cisRulesCovered,
    cisRulesUnmatched,
    compliancePercent,
    results,
  };
}
