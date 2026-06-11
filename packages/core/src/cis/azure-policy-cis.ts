// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Parser for Azure Policy CIS baseline JSON files.
 *
 * Customers who download CIS baselines from Azure Policy get a JSON
 * with this shape:
 *
 *   {
 *     "standard": "CIS",
 *     "baselineSettings": [{
 *       "name": "CIS Ubuntu Linux 22.04 LTS Benchmark",
 *       "version": "2.0.0",
 *       "settings": [
 *         { "ruleId": "...", "name": "1.1.1.1 Ensure cramfs ...", "value": "" },
 *         ...
 *       ]
 *     }]
 *   }
 *
 * This is NOT the same as XCCDF+OVAL (no registry paths, no OVAL
 * cross-references). The matching strategy here is rule-name-based:
 * extract the CIS section number + description, match against OSConfig
 * resource names via normalized keyword overlap.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

/** Discovery cache keyed by dataDir+fingerprint to avoid re-parsing JSON on every status() call. */
const azurePolicyDiscoveryCache = new Map<string, { fingerprint: string; catalogs: AzurePolicyCisCatalog[] }>();

// ── Types ────────────────────────────────────────────────────────────

export interface AzurePolicyCisRule {
  ruleId: string;
  /** e.g. "1.1.1.1 Ensure cramfs kernel module is not available;DesiredObjectValue" */
  rawName: string;
  /** Section number extracted from name, e.g. "1.1.1.1" */
  sectionNumber: string;
  /** Human title after the section number, e.g. "Ensure cramfs kernel module is not available" */
  title: string;
  value: string;
}

export interface AzurePolicyCisCatalog {
  filename: string;
  standard: string;
  platform: 'windows' | 'linux' | 'unknown';
  benchmarkName: string;
  benchmarkVersion: string;
  rules: AzurePolicyCisRule[];
  ruleCount: number;
}

// ── Platform detection ───────────────────────────────────────────────

function detectPlatformFromName(name: string): 'windows' | 'linux' | 'unknown' {
  if (/windows/i.test(name)) return 'windows';
  if (/ubuntu|rhel|red\s*hat|debian|suse|centos|alma|rocky|oracle\s*linux|amazon\s*linux|linux/i.test(name)) {
    return 'linux';
  }
  return 'unknown';
}

// ── Parser ───────────────────────────────────────────────────────────

function parseRuleName(raw: string): { sectionNumber: string; title: string } {
  // Strip Azure Policy suffixes like ";DesiredObjectValue", ";Value"
  const cleaned = raw.replace(/;(DesiredObjectValue|Value)$/i, '').trim();
  // Extract section number (e.g. "1.1.1.1", "2.3.10.8", "1.1.1 (L1)")
  const m = cleaned.match(/^([\d.]+(?:\s*\(L\d+\))?)\s+(.+)$/);
  if (m) {
    return { sectionNumber: m[1].trim(), title: m[2] };
  }
  return { sectionNumber: '', title: cleaned };
}

/**
 * Returns true if the given JSON object looks like an Azure Policy CIS
 * baseline (has `standard` and `baselineSettings` keys).
 */
export function isAzurePolicyCisJson(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.standard === 'string' &&
    Array.isArray(o.baselineSettings)
  );
}

export function parseAzurePolicyCisJson(
  raw: unknown,
  filename: string,
): AzurePolicyCisCatalog | null {
  if (!isAzurePolicyCisJson(raw)) return null;

  const obj = raw as {
    standard: string;
    baselineSettings: Array<{
      name?: string;
      version?: string;
      settings?: Array<{ ruleId?: string; name?: string; value?: string }>;
    }>;
  };

  // Take the first non-empty benchmark
  const benchmark = obj.baselineSettings.find(
    (b) => b.settings && b.settings.length > 0,
  );
  if (!benchmark) {
    // File is valid but has no rules (e.g. the empty Windows placeholder)
    const firstBm = obj.baselineSettings[0];
    return {
      filename,
      standard: obj.standard,
      platform: detectPlatformFromName(firstBm?.name ?? filename),
      benchmarkName: firstBm?.name ?? 'Unknown',
      benchmarkVersion: firstBm?.version ?? '',
      rules: [],
      ruleCount: 0,
    };
  }

  const rules: AzurePolicyCisRule[] = (benchmark.settings ?? []).map((s) => {
    const { sectionNumber, title } = parseRuleName(s.name ?? '');
    return {
      ruleId: s.ruleId ?? '',
      rawName: s.name ?? '',
      sectionNumber,
      title,
      value: s.value ?? '',
    };
  });

  return {
    filename,
    standard: obj.standard,
    platform: detectPlatformFromName(benchmark.name ?? filename),
    benchmarkName: benchmark.name ?? 'Unknown',
    benchmarkVersion: benchmark.version ?? '',
    rules,
    ruleCount: rules.length,
  };
}

/**
 * Scan a directory for Azure Policy CIS JSON files and parse them.
 *
 * Caches results by directory + mtime/size fingerprint so repeated
 * calls (e.g. from cis.status() on every manifest open) don't re-read
 * + re-parse multi-hundred-KB JSON files.
 */
export async function discoverAzurePolicyCisFiles(
  dataDir: string,
): Promise<AzurePolicyCisCatalog[]> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) return [];

  // Fingerprint by mtime + size so external edits invalidate the cache.
  const stats = await Promise.all(
    jsonFiles.map(async (jf) => {
      try {
        const s = await stat(join(dataDir, jf));
        return `${jf}:${s.mtimeMs}:${s.size}`;
      } catch {
        return `${jf}:?`;
      }
    }),
  );
  const fingerprint = stats.join('|');
  const cached = azurePolicyDiscoveryCache.get(dataDir);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.catalogs;
  }

  // Parallel read + parse.
  const results = (await Promise.all(
    jsonFiles.map(async (jf) => {
      try {
        const raw = await readFile(join(dataDir, jf), 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        return parseAzurePolicyCisJson(parsed, jf);
      } catch {
        return null;
      }
    }),
  )).filter((c): c is AzurePolicyCisCatalog => c !== null);

  azurePolicyDiscoveryCache.set(dataDir, { fingerprint, catalogs: results });
  return results;
}

/** @internal Test affordance. */
export function _clearAzurePolicyDiscoveryCache(): void {
  azurePolicyDiscoveryCache.clear();
}
