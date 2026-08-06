// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:compliance:report` and
 * `GET /api/compliance/report?manifest=<ns>&against=<baseline-id>`.
 *
 * Compares a registered manifest against a CIS baseline shipped under
 * the runtime's resolved public asset root. 5-minute cache + in-flight
 * dedup keyed by (manifest, against).
 *
 * The host injects the baseline catalog (via `setBaselineCatalog` in
 * library handler — same instance is shared) so this handler doesn't
 * have to import host-app data.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolvePublicAsset } from '../runtime/paths';
import { parseLosslessYaml } from '../manifest/lossless';
import {
  getRegistrationSource,
  sanitizeNamespace,
} from '../oscfg';
import { computeCompliance, type ComplianceReport } from '../cis/compliance';
import { createCachedDedup } from './cache';
import { HandlerError } from './errors';
import type { BaselineCatalogEntry } from './contract';

// Re-uses the catalog injected for the library handler.
import { _getBaselineCatalog } from './library';

export interface ComplianceResponse {
  manifest: string;
  against: string;
  baselineName: string;
  generatedAt: string;
  report: ComplianceReport;
}

const cacheStore = createCachedDedup<ComplianceResponse>(5 * 60 * 1000);

export function _clearComplianceCache(): void {
  cacheStore._clear();
}

export async function getComplianceReport(
  manifest: string,
  against: string,
): Promise<ComplianceResponse> {
  if (!manifest) throw new HandlerError(400, 'manifest query parameter is required');
  if (!against) throw new HandlerError(400, 'against query parameter is required');

  const namespace = sanitizeNamespace(manifest);
  const key = `${namespace}::${against}`;

  const cached = cacheStore.getCached(key);
  if (cached !== null) return cached;

  let promise = cacheStore.getInflight(key);
  if (!promise) {
    promise = computeReport(namespace, manifest, against).finally(() => {
      cacheStore.clearInflight(key);
    });
    cacheStore.setInflight(key, promise);
  }
  const payload = await promise;
  cacheStore.setCached(key, payload);
  return payload;
}

async function computeReport(
  namespace: string,
  displayName: string,
  baselineId: string,
): Promise<ComplianceResponse> {
  const source = await getRegistrationSource(namespace);
  if (!source) {
    throw new HandlerError(404, `Manifest "${displayName}" is not registered`);
  }

  const baseline = await loadCisBaselineYaml(baselineId);

  let myDoc: unknown;
  let cisDoc: unknown;
  try {
    myDoc = parseLosslessYaml(source);
  } catch (err) {
    throw new HandlerError(
      422,
      `Could not parse user manifest YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    cisDoc = parseLosslessYaml(baseline.content);
  } catch (err) {
    throw new HandlerError(
      500,
      `Could not parse CIS baseline YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const report = await computeCompliance(
    myDoc as { resources?: unknown },
    cisDoc as { resources?: unknown },
  );

  return {
    manifest: displayName,
    against: baselineId,
    baselineName: baseline.entry.name,
    generatedAt: new Date().toISOString(),
    report,
  };
}

async function loadCisBaselineYaml(baselineId: string): Promise<{
  entry: { id: string; name: string };
  content: string;
}> {
  const catalog = _getBaselineCatalog();
  const entry = catalog.find((b: BaselineCatalogEntry) => b.id === baselineId) as
    | (BaselineCatalogEntry & {
        category?: string;
        manifestUrl?: string;
      })
    | undefined;

  if (!entry) {
    throw new HandlerError(404, `Unknown baseline id "${baselineId}"`);
  }
  if (entry.category !== 'cis-benchmark') {
    throw new HandlerError(400, `Baseline "${baselineId}" is not a CIS benchmark`);
  }
  if (entry.source !== 'local' || !entry.manifestUrl) {
    throw new HandlerError(400, `Baseline "${baselineId}" has no local manifestUrl`);
  }

  const publicRoot = resolvePublicAsset('');
  const requested = resolvePublicAsset(entry.manifestUrl);
  if (requested !== publicRoot && !requested.startsWith(publicRoot + path.sep)) {
    throw new HandlerError(400, 'Baseline path escapes public/');
  }
  try {
    const content = await readFile(requested, 'utf-8');
    return { entry: { id: entry.id, name: entry.name }, content };
  } catch (err) {
    throw new HandlerError(
      500,
      `Could not read baseline file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
