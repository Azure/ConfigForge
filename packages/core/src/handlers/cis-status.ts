// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:cis:status` and `GET /api/cis/status`.
 *
 * Reports whether CIS Benchmark mapping data is available on disk
 * under the runtime's resolved public asset root. The mappings file
 * is the smallest required dependency — a user with their own
 * licensed catalog files always also has the mappings file.
 *
 * Caches in-process. Restart the host process after dropping in or
 * removing CIS files.
 */
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadCisGlobalMappings,
  loadCisRuleCatalog,
  getCisDataDir,
  clearAllCisDataCaches,
  CIS_EXPECTED_FILES,
} from '../cis/data';
import { discoverXccdfFiles, clearXccdfCache, type XccdfDiscovery } from '../cis/xccdf-parser';
import { discoverAzurePolicyCisFiles, _clearAzurePolicyDiscoveryCache, type AzurePolicyCisCatalog } from '../cis/azure-policy-cis';
import type { CisStatus } from './contract';

let cached: CisStatus | null = null;

export function _clearCisStatusCache(): void {
  cached = null;
}

/**
 * Force-refresh CIS state: clear both the status cache AND the
 * underlying data caches (loadCisGlobalMappings keeps its own
 * module-scope cache that otherwise short-circuits a recheck).
 * Used by the `cfs:cis:recheck` IPC.
 */
export function _resetCisStateForRecheck(): void {
  cached = null;
  clearAllCisDataCaches();
  clearXccdfCache();
  _clearAzurePolicyDiscoveryCache();
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Edit-distance approximation for "did you mean?" hints. Returns the
 * Levenshtein distance between two strings. Used to catch the
 * `cis-mapping.json` vs `cis-mappings.json` (1-char) class of mistakes.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Detect whether `cis-mappings.json` (if present) has the expected
 * shape. Returns a human-readable diagnostic string when the file is
 * present but malformed, otherwise null.
 */
async function detectSchemaMismatch(dataDir: string): Promise<string | null> {
  const mappingsPath = join(dataDir, 'cis-mappings.json');
  if (!(await fileExists(mappingsPath))) return null;
  try {
    const raw = await readFile(mappingsPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'cis-mappings.json is not a JSON object.';
    }
    const obj = parsed as Record<string, unknown>;
    const expectedKeys = ['accountPolicies', 'userRights', 'auditPolicies', 'sidMappings', 'registryTypes', 'resourceTypes'];
    const missing = expectedKeys.filter((k) => !(k in obj));
    if (missing.length === expectedKeys.length) {
      // No expected keys at all. Probably a different format.
      const isBaselineCatalog = 'baselineSettings' in obj || 'standard' in obj;
      if (isBaselineCatalog) {
        // This is an Azure Policy CIS JSON. It's supported via the
        // Azure Policy ingestion path, NOT the legacy loader. Not an
        // error — just a different (and valid) format.
        return null;
      }
      const foundKeys = Object.keys(obj).slice(0, 4).join(', ');
      return (
        `cis-mappings.json doesn\u2019t look like a recognized CIS format. ` +
        `Found top-level keys: ${foundKeys}. Expected either Azure Policy ` +
        `format (standard, baselineSettings) or legacy OVAL mapping format ` +
        `(${expectedKeys.join(', ')}).`
      );
    }
    if (missing.length > 0) {
      return `cis-mappings.json is missing required keys: ${missing.join(', ')}.`;
    }
    return null;
  } catch (err) {
    return `cis-mappings.json could not be parsed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function getCisStatus(): Promise<CisStatus> {
  if (cached !== null) return cached;
  const dataDir = getCisDataDir();
  const expectedNames = new Set(CIS_EXPECTED_FILES.map((f) => f.name));

  const files = await Promise.all(
    CIS_EXPECTED_FILES.map(async (f) => ({
      name: f.name,
      description: f.description,
      required: f.required,
      present: await fileExists(join(dataDir, f.name)),
    })),
  );

  // What is actually in the data directory? Surfaces the
  // singular-vs-plural class of typos.
  let unexpectedFiles: CisStatus['unexpectedFiles'] = [];
  try {
    const entries = await readdir(dataDir);
    unexpectedFiles = entries
      .filter((name) => !expectedNames.has(name))
      .map((name) => {
        // Suggest the closest expected name if it's within 2 edits.
        let bestMatch: string | null = null;
        let bestDist = Infinity;
        for (const exp of expectedNames) {
          const d = editDistance(name.toLowerCase(), exp.toLowerCase());
          if (d < bestDist) {
            bestDist = d;
            bestMatch = exp;
          }
        }
        return {
          name,
          didYouMean: bestDist > 0 && bestDist <= 2 ? bestMatch : null,
        };
      });
  } catch {
    // Directory missing or unreadable. unexpectedFiles stays [].
  }

  const schemaError = await detectSchemaMismatch(dataDir);

  // Discover XCCDF files (lightweight -- filename + title sniff only)
  const xccdfFiles = await discoverXccdfFiles(dataDir);

  // Discover Azure Policy CIS JSON files
  const azurePolicyCisFiles = await discoverAzurePolicyCisFiles(dataDir);
  const azurePolicyAvailable = azurePolicyCisFiles.some((c) => c.ruleCount > 0);

  // Filter unexpected files: exclude anything successfully detected
  // as XCCDF or Azure Policy CIS (those aren't "unrecognized").
  const recognizedFilenames = new Set([
    ...xccdfFiles.map((xf) => xf.filename),
    // Also include OVAL companions
    ...xccdfFiles.filter((xf) => xf.ovalPath).map((xf) => {
      const prefix = xf.filename.replace(/-xccdf\.xml$/, '');
      return `${prefix}-oval.xml`;
    }),
    ...azurePolicyCisFiles.map((c) => c.filename),
  ]);
  const filteredUnexpected = unexpectedFiles.filter(
    (f) => !recognizedFilenames.has(f.name),
  );

  // If cis-mappings.json is present but has the wrong schema, mark
  // it as NOT truly present in the expected-files list (it doesn't
  // satisfy the legacy JSON loader).
  const correctedFiles = schemaError
    ? files.map((f) =>
        f.name === 'cis-mappings.json' && f.present
          ? { ...f, present: false }
          : f,
      )
    : files;

  const azurePolicySummary = azurePolicyCisFiles.map((c) => ({
    filename: c.filename,
    platform: c.platform,
    benchmarkName: c.benchmarkName,
    benchmarkVersion: c.benchmarkVersion,
    ruleCount: c.ruleCount,
  }));
  const xccdfSummary = xccdfFiles.map((xf) => ({
    filename: xf.filename,
    platform: xf.platform,
    product: xf.product,
    version: xf.version,
    title: xf.title,
    hasOval: xf.ovalPath !== null,
  }));
  const legacyRuleCatalogs = await Promise.all(
    ['2025', '2022', '2019', '2016'].map(async (version) => {
      try {
        return await loadCisRuleCatalog(version);
      } catch {
        return null;
      }
    }),
  );
  const legacyRuleCatalogCount = legacyRuleCatalogs.filter(
    (catalog) => catalog && Array.isArray(catalog.rules) && catalog.rules.length > 0,
  ).length;

  try {
    const m = await loadCisGlobalMappings();
    const jsonAvailable = m !== null;
    const xccdfAvailable = xccdfFiles.length > 0;
    const anyAvailable = jsonAvailable || xccdfAvailable || azurePolicyAvailable;
    let source: 'json' | 'xccdf' | 'both' | undefined;
    if (jsonAvailable && xccdfAvailable) source = 'both';
    else if (jsonAvailable) source = 'json';
    else if (xccdfAvailable || azurePolicyAvailable) source = 'xccdf';

    cached = {
      available: anyAvailable,
      dataDir,
      files: correctedFiles,
      unexpectedFiles: filteredUnexpected,
      schemaError,
      source,
      legacyMappingsLoaded: jsonAvailable,
      legacyRuleCatalogCount,
      xccdfFiles: xccdfSummary,
      azurePolicyCisFiles: azurePolicySummary,
    };
  } catch {
    cached = {
      available: xccdfFiles.length > 0 || azurePolicyAvailable,
      dataDir,
      files: correctedFiles,
      unexpectedFiles: filteredUnexpected,
      schemaError,
      source: xccdfFiles.length > 0 ? 'xccdf' : azurePolicyAvailable ? 'xccdf' : undefined,
      legacyMappingsLoaded: false,
      legacyRuleCatalogCount,
      xccdfFiles: xccdfSummary,
      azurePolicyCisFiles: azurePolicySummary,
    };
  }
  return cached;
}
