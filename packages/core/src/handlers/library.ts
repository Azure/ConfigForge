// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handlers for `cfs:library:list`/`cfs:library:get` and the
 * `GET /api/library` route (with and without `?id=…&content=true`).
 *
 * Reads the baseline catalog (a hand-curated TS module in the host
 * app), optionally fetches the manifest/csv body either from a local
 * file under the runtime's resolved public asset root or from a
 * GitHub URL, and converts CSV-format Defender baselines into
 * OSConfig manifest YAML.
 *
 * The host injects the baseline catalog at startup via
 * `setBaselineCatalog()` so this module doesn't have to hard-code
 * the source-of-truth path. Next.js sets it from
 * `@/data/baseline-catalog`; Electron does the same; tests inject a
 * fixture.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBaselineManifest, exportToYaml, parseExcelBaseline } from '../import-export';
import { resolvePublicAsset } from '../runtime/paths';
import { HandlerError } from './errors';
import type {
  BaselineCatalogEntry,
  LibraryEntryRequest,
  LibraryEntryResult,
  LibraryListResult,
} from './contract';

let baselineCatalog: BaselineCatalogEntry[] = [];
const contentCache = new Map<string, { content: string; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Inject the host-side baseline catalog source-of-truth. */
export function setBaselineCatalog(entries: BaselineCatalogEntry[]): void {
  baselineCatalog = entries;
}

/** @internal Read-only accessor for handlers that share this catalog. */
export function _getBaselineCatalog(): BaselineCatalogEntry[] {
  return baselineCatalog;
}

/** @internal Test affordance — clears the content cache. */
export function _clearLibraryContentCache(): void {
  contentCache.clear();
}

export function listLibrary(): LibraryListResult {
  return { data: baselineCatalog };
}

export async function getLibraryEntry(req: LibraryEntryRequest): Promise<LibraryEntryResult> {
  const { id, content: wantContent = false, fresh = false } = req;

  const entry = baselineCatalog.find((b) => b.id === id);
  if (!entry) {
    throw new HandlerError(404, `Baseline '${id}' not found in catalog`);
  }

  if (!wantContent) {
    return { data: entry };
  }

  const url = entry.manifestUrl ?? entry.csvUrl;
  if (!url) {
    return { data: entry, content: null, note: 'No downloadable content available.' };
  }

  if (!fresh) {
    const cached = contentCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { data: entry, content: cached.content };
    }
  }

  let body: string;

  if (entry.source === 'local') {
    // Defense in depth: even though `url` comes from a hard-coded
    // catalog (not user input), verify the resolved path stays under
    // the public asset root.
    const publicRoot = resolvePublicAsset('');
    const requested = resolvePublicAsset(url);
    if (requested !== publicRoot && !requested.startsWith(publicRoot + path.sep)) {
      throw new HandlerError(400, `Catalog entry '${id}' resolves outside the public/ directory`);
    }
    body = await readFile(requested, 'utf-8');
  } else {
    const res = await fetch(url, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new HandlerError(502, `Failed to fetch: ${res.status} ${res.statusText}`);
    }
    body = await res.text();
  }

  if (url.endsWith('.csv')) {
    try {
      body = csvToManifest(body);
    } catch (convErr) {
      const msg = convErr instanceof Error ? convErr.message : 'CSV conversion failed';
      throw new HandlerError(
        422,
        `Failed to convert CSV baseline "${entry.id}" to manifest: ${msg}`,
      );
    }
  }

  if (!/^\s*resources\s*:/m.test(body)) {
    throw new HandlerError(
      422,
      `Baseline "${entry.id}" content is not a valid manifest (missing "resources:" section). This baseline may need regeneration in the catalog.`,
    );
  }

  contentCache.set(id, { content: body, fetchedAt: Date.now() });
  return { data: entry, content: body };
}

/**
 * Defender-style CSV → OSConfig manifest YAML converter.
 *
 * Expected columns (case-insensitive header match):
 *   Name, Registry Key, [Registry Value], [Registry Value Type],
 *   [Expected Value]
 */
export function csvToManifest(csv: string): string {
  const built = buildBaselineManifest(parseExcelBaseline(csv));
  return `# Auto-generated from CSV baseline\n${exportToYaml(built.manifest)}`;
}
