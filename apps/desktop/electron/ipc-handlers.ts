// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase 3 + Phase 4 IPC handlers.
 *
 * Each channel is a thin wrapper around a pure handler in
 * `@configforge/core/handlers/`. The wrapper:
 *
 *   1. Catches `HandlerError` and converts it to the IPC error
 *      envelope (`{ ok: false, status, error, ...data }`). Renderer
 *      wrappers re-throw client-side so calling code uses normal
 *      try/catch.
 *
 *   2. Catches generic `Error` and emits status 500.
 *
 *   3. Validates input payload shape with a tiny per-channel guard
 *      so a compromised renderer can't pass arbitrary objects.
 *      (Phase 5 will replace these with zod schemas in core.)
 */
import { ipcMain, dialog, shell, BrowserWindow, nativeTheme } from 'electron';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// v0.2.16: cross-manifest conflict detection reads registered source
// YAML directly from the oscfg registry (not via `manifests.status`,
// which returns the CLI-reported live state and is empty for
// registered-but-not-deployed manifests).
import { getRegistration, getRegistrationSource, sanitizeNamespace } from '@configforge/core/oscfg';
import { isRemoteDesktopSession } from './platform-detection';
import { isCurrentProcessElevated, relaunchElevated } from './elevate';
import { HAS_ACTIVITY_FEED, HAS_DEPLOY } from './flavor';
import {
  MAX_JOB_ID_LEN,
  validateAppendRationaleRequest,
  validateDeleteManifestRequest,
  validateDeleteSnapshotRequest,
  validateDeployRequest,
  validateDocsGenerateRequest,
  validateImportRequest,
  validateListManifestsRequest,
  validateRegisterManifestRequest,
  validateRestoreManifestRequest,
  validateRevertRequest,
  validateSaveSnapshotRequest,
} from './ipc-validators';
// Eager: small/fast handlers that fire on every app open (manifests
// CRUD, deploy, history, system info, library browse, healthchecks).
// We keep these top-level so the renderer's first request doesn't pay
// for a dynamic-import round-trip.
import {
  // Phase 3 (read)
  getHealthStatus,
  recheckHealth,
  getCisStatus,
  _clearCisStatusCache,
  _resetCisStateForRecheck,
  cisBulkLookup,
  getRecentActivity,
  getScenariosUnavailable,
  listLibrary,
  getLibraryEntry,
  setBaselineCatalog,
  isHandlerError,
  type LibraryEntryRequest,
  type BaselineCatalogEntry,
  // Phase 4 pass A (more reads)
  getDriftUnavailable,
  lookupCisRule,
  getSystemConfigSummary,
  getSystemConfigForManifest,
  getRationaleEntries,
  listHistory,
  getHistoryEntry,
  getDocsForManifest,
  getManifestStatus,
  getDiffMatrix,
  getComplianceReport,
  type CisLookupRequest,
  // Phase 4 pass B (mutations) — small ones stay eager
  revertManifest,
  saveHistorySnapshot,
  deleteHistorySnapshot,
  appendRationaleEntry,
  type RevertRequest,
  type SaveSnapshotRequest,
  type DeleteSnapshotRequest,
  type AppendRationaleRequest,
  // Phase 4 pass B2 (manifests CRUD) — hot path
  listManifests,
  registerManifest,
  restoreManifest,
  fetchManifestFromUri,
  deleteManifest,
  getManifest,
  type RegisterManifestRequest,
  type RestoreManifestRequest,
  // Phase 4 pass E (deploy) — hot path
  runDeploy,
  type DeployRequest,
  type DeployProgressEvent,
  // v0.3.1 (#4) — mid-deploy interruption recovery
  listInterruptedDeploys,
  dismissInterruptedDeploy,
  // v0.3.1 (#23) — settings store
  getSettings,
  setSettings,
  type UserSettings,
} from '@configforge/core/handlers';

// v0.1.10 fix — lift readAuditResult to a static import so the asar
// build resolves it correctly. The previous lazy `await import(...)`
// (no `.js` extension) tripped esbuild's resolver in the packaged
// build and threw "Cannot find package '@configforge/core'" on every
// call from the audit-pack page, leaving the "What's included"
// sidebar with no checkmark for the Compliance report row.
import { readAuditResultForRegistration } from '@configforge/core/manifest/audit-results-store.js';

// perf W2 / H10: heavy / rarely-fired handlers stay TYPE-only at the
// top of the module, with runtime imports deferred to inside each
// IPC closure via `await import('@configforge/core/handlers/<mod>')`.
//
// Why this matters: the previous eager import barrel pulled in pdfkit
// (audit-pack), xlsx-builder (matrix-xlsx + audit-pack), the AI
// analyzer chain, and the full set of ~28 handler modules at boot —
// even when the user only ever opens the dashboard. Esbuild bundles
// our CJS output, so dynamic `import()` is rewritten as a deferred
// `require()` inside the closure. Net effect: the first call to
// `cfs:audit-pack:save` (etc.) takes the require hit; subsequent
// calls are warm.
//
// Keep types eager (they're erased at compile time and cost nothing
// at runtime) so `req as AuditPackRequest` etc. compile cleanly.
import type {
  GenerateDocsRequest,
  BaselineCsvRequest,
  ImportRequest,
  AuditPackRequest,
  ExportRequest,
} from '@configforge/core/handlers';

// `MAX_IMPORT_BYTES` is a single 4-byte constant. Re-fetching it via
// dynamic import every time the OS file picker opens is silly, so
// memoize after the first import-handler call.
let _maxImportBytes: number | undefined;
async function getMaxImportBytes(): Promise<number> {
  if (_maxImportBytes !== undefined) return _maxImportBytes;
  const mod = await import('@configforge/core/handlers/import.js');
  _maxImportBytes = mod.MAX_IMPORT_BYTES;
  return _maxImportBytes;
}

interface IpcErrorEnvelope {
  ok: false;
  status: number;
  error: string;
  [key: string]: unknown;
}

function envelope(err: unknown): IpcErrorEnvelope {
  if (isHandlerError(err)) {
    const env: IpcErrorEnvelope = {
      ok: false,
      status: err.status,
      error: err.message,
      ...(err.data ?? {}),
    };
    if (err.code) env.code = err.code;
    return env;
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return { ok: false, status: 500, error: message };
}

// --- payload validators (hand-written; Phase 5 swaps for zod) -------
//
// The shape-only `is*Request` predicates below cover read-only and
// low-risk channels. The privileged-channel validators (deploy,
// revert, history mutations, register, import, rationale append,
// docs generate) live in `./ipc-validators.ts` so they can be
// unit-tested without an electron import.

function isLibraryEntryRequest(v: unknown): v is LibraryEntryRequest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (o.content !== undefined && typeof o.content !== 'boolean') return false;
  if (o.fresh !== undefined && typeof o.fresh !== 'boolean') return false;
  return true;
}

function isCisLookupRequest(v: unknown): v is CisLookupRequest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || o.name.length === 0) return false;
  // Allow null OR undefined OR string for optional fields. The renderer
  // passes nulls directly from React state where extraction failed, so
  // rejecting nulls here used to drop legitimate lookups silently.
  for (const k of [
    'osVersion',
    'type',
    'innerType',
    'propertyName',
    'propertySubcategory',
    'registryKeyPath',
    'registryValueName',
    'cspPath',
    'path',
  ] as const) {
    const val = o[k];
    if (val !== undefined && val !== null && typeof val !== 'string') return false;
  }
  return true;
}

function isStringRequest(v: unknown): v is { name: string } {
  if (typeof v !== 'object' || v === null) return false;
  return typeof (v as { name?: unknown }).name === 'string';
}

function isHistoryGetRequest(
  v: unknown,
): v is { name: string; id?: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || o.name.length === 0) return false;
  if (o.id !== undefined && typeof o.id !== 'string') return false;
  return true;
}

function isComplianceRequest(
  v: unknown,
): v is { manifest: string; against: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.manifest === 'string' && typeof o.against === 'string';
}

/**
 * Inject the host-side baseline catalog into the core handler.
 * Called once from main.ts at startup.
 */
export function installBaselineCatalog(catalog: BaselineCatalogEntry[]): void {
  setBaselineCatalog(catalog);
}

export function registerCfsIpcHandlers(): void {
  // --- system / runtime ---------------------------------------------
  ipcMain.handle('cfs:health:check', async () => {
    try {
      return await getHealthStatus();
    } catch (err) {
      return envelope(err);
    }
  });

  // v0.2.0, bring-your-own-CLI. Lets the renderer trigger a fresh
  // probe after the user installs OSConfig without restarting the app.
  ipcMain.handle('cfs:health:recheck', async () => {
    try {
      return await recheckHealth();
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:system-config:summary', async () => {
    try {
      return await getSystemConfigSummary();
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:system-config:get', async (_evt, req: unknown) => {
    if (!isStringRequest(req)) {
      return envelope(new Error('payload must be { name: string }'));
    }
    try {
      return await getSystemConfigForManifest(req.name);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- cis ----------------------------------------------------------
  ipcMain.handle('cfs:cis:status', async () => {
    try {
      return await getCisStatus();
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:cis:lookup', async (_evt, req: unknown) => {
    if (!isCisLookupRequest(req)) {
      return envelope(new Error('invalid payload'));
    }
    try {
      return await lookupCisRule(req);
    } catch (err) {
      return envelope(err);
    }
  });

  // v0.3.2 — open the resolved CIS catalog directory in Explorer /
  // Finder so users don't have to manually navigate to
  // `<resourcesPath>/public-assets/_baselines/cis/_data/`. Creates
  // the directory if it doesn't exist yet (typical for fresh
  // installs — the CIS data ships gitignored). Also invalidates the
  // in-process status cache so a subsequent `cfs:cis:status` call
  // picks up newly dropped files without an app restart.
  ipcMain.handle('cfs:cis:reveal-data-dir', async () => {
    try {
      const status = await getCisStatus();
      const dir = status.dataDir;
      if (!dir) {
        return envelope(new Error('CIS data directory could not be resolved'));
      }
      await mkdir(dir, { recursive: true });
      _resetCisStateForRecheck();
      const err = await shell.openPath(dir);
      if (err) {
        return envelope(new Error(`Could not open folder: ${err}`));
      }
      return { ok: true as const, path: dir };
    } catch (err) {
      return envelope(err);
    }
  });

  // Force-refresh the CIS status cache (used by the "Re-check
  // catalog" button on the CIS Catalog page so users don't have to
  // restart the app after dropping JSONs).
  ipcMain.handle('cfs:cis:recheck', async () => {
    try {
      _resetCisStateForRecheck();
      return await getCisStatus();
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:cis:bulk-lookup', async (_evt, req: unknown) => {
    if (!req || typeof req !== 'object') {
      return envelope(new Error('payload must be an object'));
    }
    const o = req as { namespace?: unknown; benchmarkFilename?: unknown };
    if (typeof o.namespace !== 'string') {
      return envelope(new Error('payload.namespace must be a string'));
    }
    if (o.benchmarkFilename !== undefined && o.benchmarkFilename !== null && typeof o.benchmarkFilename !== 'string') {
      return envelope(new Error('payload.benchmarkFilename must be a string or omitted'));
    }
    try {
      return await cisBulkLookup({
        namespace: o.namespace,
        benchmarkFilename: typeof o.benchmarkFilename === 'string' ? o.benchmarkFilename : undefined,
      });
    } catch (err) {
      return envelope(err);
    }
  });

  // Background warm-up: parse all discovered XCCDF catalogs + Azure
  // Policy JSON ahead of the first user click on a resource. Fire-and-
  // forget — the renderer doesn't await the result. Without this, the
  // first CIS lookup triggers a multi-MB OVAL XML parse on the main
  // thread (3-5s stall). With it, the parse happens during idle time
  // after the editor opens.
  //
  // XCCDF catalogs are the heavy lift (~4MB OVAL XML each).
  // Azure Policy JSONs are smaller (~100-200KB each) but also pre-fired
  // so the inline drawer's name-fuzzy fallback path is hot on first
  // click.
  ipcMain.handle('cfs:cis:warmup', async () => {
    try {
      const { discoverXccdfFiles, getOrParseXccdfCatalog } = await import(
        '@configforge/core/cis/xccdf-parser'
      );
      const { discoverAzurePolicyCisFiles } = await import(
        '@configforge/core/cis/azure-policy-cis'
      );
      const { getCisDataDir } = await import('@configforge/core/cis/data');
      const dataDir = getCisDataDir();

      // Discovery + parse in parallel for both benchmark types.
      const [xccdfs, azurePolicyCatalogs] = await Promise.all([
        discoverXccdfFiles(dataDir),
        discoverAzurePolicyCisFiles(dataDir),
      ]);

      // XCCDFs need a second pass — discovery is cheap, full parse is heavy.
      await Promise.all(
        xccdfs
          .filter((x) => x.ovalPath !== null)
          .map((x) =>
            getOrParseXccdfCatalog(x.xccdfPath, x.ovalPath!).catch(() => null),
          ),
      );

      return {
        ok: true,
        xccdfParsed: xccdfs.filter((x) => x.ovalPath).length,
        azurePolicyParsed: azurePolicyCatalogs.length,
      };
    } catch (err) {
      return envelope(err);
    }
  });

  // --- library ------------------------------------------------------
  ipcMain.handle('cfs:library:list', async () => {
    try {
      return listLibrary();
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:library:get', async (_evt, req: unknown) => {
    if (!isLibraryEntryRequest(req)) {
      return envelope(new Error('invalid payload'));
    }
    try {
      return await getLibraryEntry(req);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- scenarios + drift (legacy, always 501) -----------------------
  ipcMain.handle('cfs:scenarios:list', () => getScenariosUnavailable());
  ipcMain.handle('cfs:drift:list', () => getDriftUnavailable());

  // --- activity -----------------------------------------------------
  if (HAS_ACTIVITY_FEED) {
    ipcMain.handle('cfs:activity:recent', async () => {
      try {
        const data = await getRecentActivity(10, HAS_DEPLOY);
        return { data };
      } catch (err) {
        return envelope(err);
      }
    });
  }

  // --- rationale (read) ---------------------------------------------
  ipcMain.handle('cfs:rationale:list', async (_evt, req: unknown) => {
    // v0.1.11 — cap length at 256 chars. Without a cap, a compromised
    // renderer could pass an arbitrarily large string and the
    // downstream readRationale call would happily try to open a path
    // built from it. The downstream rationale-store sanitizer caps
    // at 96, so 256 is generous; we just want a hard upper bound so
    // we don't waste cycles allocating multi-MB strings before the
    // sanitizer rejects them.
    if (typeof req !== 'string' || req.length === 0 || req.length > 256) {
      return envelope(new Error('payload must be a non-empty string id (max 256 chars)'));
    }
    try {
      return await getRationaleEntries(req);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- audit-results (read) -----------------------------------------
  // v0.1.6: returns the cached `~/.configforge/audit-results/<ns>.json`
  // written by deploy.ts at the end of each audit/enforce. Used by:
  //   - the audit-pack renderer to populate the "Device Audit"
  //     availability badge instead of the v0.1.5 hard-coded `false`
  //     stub
  //   - future "last audited X minutes ago" badges on the manifest
  //     detail / dashboard pages
  // Returns `{ snapshot: null }` when no audit has run yet — never
  // throws, since stale or missing cache is the most common case.
  ipcMain.handle('cfs:audit-results:get', async (_evt, req: unknown) => {
    // v0.1.11 — same length cap as cfs:rationale:list above. See
    // there for the full rationale.
    if (typeof req !== 'string' || req.length === 0 || req.length > 256) {
      return envelope(new Error('payload must be a non-empty string id (max 256 chars)'));
    }
    try {
      // v0.1.10 fix — used to be `await import('@configforge/core/manifest/audit-results-store')`
      // (no `.js` extension), which esbuild + the asar packaging
      // couldn't resolve at runtime. The packaged main.js threw
      // `Cannot find package '@configforge/core' imported from
      // …\app.asar\dist\electron\main.js` on every call. The
      // audit-pack page silently swallowed the rejection in its
      // Promise.allSettled and rendered the "What's included"
      // sidebar with no checkmark for Compliance report — even
      // when the on-disk JSON existed and the PDF had the data.
      // No reason for the lazy load: this module is ~80 lines, no
      // heavy deps. Static import bundles cleanly.
      const namespace = sanitizeNamespace(req);
      const registration = await getRegistration(namespace);
      const snapshot = registration
        ? await readAuditResultForRegistration(namespace, {
            modifiedAt: registration.modifiedAt ?? registration.registeredAt,
            revision: registration.revision,
          })
        : null;
      return { snapshot };
    } catch (err) {
      return envelope(err);
    }
  });

  // --- history (read) -----------------------------------------------
  ipcMain.handle('cfs:history:list', async (_evt, req: unknown) => {
    if (!isHistoryGetRequest(req)) {
      return envelope(new Error('payload must be { name, id? }'));
    }
    try {
      if (req.id) return await getHistoryEntry(req.name, req.id);
      return await listHistory(req.name);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- docs (read) --------------------------------------------------
  ipcMain.handle('cfs:docs:get', async (_evt, req: unknown) => {
    if (!isStringRequest(req)) {
      return envelope(new Error('payload must be { name: string }'));
    }
    try {
      return await getDocsForManifest(req.name);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- manifests/status ---------------------------------------------
  ipcMain.handle('cfs:manifests:status', async (_evt, req: unknown) => {
    if (!isStringRequest(req)) {
      return envelope(new Error('payload must be { name: string }'));
    }
    try {
      return await getManifestStatus(req.name);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- manifests/source ---------------------------------------------
  //
  // v0.2.16: returns the registered manifest's *source* YAML. Distinct
  // from `manifests/status`, which returns reconstructed YAML of the
  // CLI-reported live state — that path produced empty stubs for
  // registered-but-not-deployed manifests and broke cross-manifest
  // conflict detection. The conflict detector and other "what did
  // the user write" consumers should call this instead.
  ipcMain.handle('cfs:manifests:source', async (_evt, req: unknown) => {
    if (!isStringRequest(req)) {
      return envelope(new Error('payload must be { name: string }'));
    }
    try {
      const namespace = sanitizeNamespace(req.name);
      const content = await getRegistrationSource(namespace);
      if (content === null) {
        return { data: null };
      }
      return { data: content };
    } catch (err) {
      return envelope(err);
    }
  });

  // --- diff/matrix --------------------------------------------------
  ipcMain.handle('cfs:diff:matrix', async (_evt, req: unknown) => {
    if (typeof req !== 'string') {
      return envelope(new Error('payload must be a comma-separated names string'));
    }
    try {
      return await getDiffMatrix(req);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- compliance/report --------------------------------------------
  ipcMain.handle('cfs:compliance:report', async (_evt, req: unknown) => {
    if (!isComplianceRequest(req)) {
      return envelope(new Error('payload must be { manifest, against }'));
    }
    try {
      return await getComplianceReport(req.manifest, req.against);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- Phase 4 pass B: mutations ------------------------------------

  ipcMain.handle('cfs:revert:apply', async (_evt, req: unknown) => {
    // CF-SEC-002: was only checking { name: string } shape and casting
    // straight to RevertRequest. Tighten to non-empty + bounded.
    const verr = validateRevertRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      return await revertManifest(req as RevertRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:history:save', async (_evt, req: unknown) => {
    // CF-SEC-002: previously no shape validation at all — cast unknown
    // straight to SaveSnapshotRequest.
    const verr = validateSaveSnapshotRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      return await saveHistorySnapshot(req as SaveSnapshotRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:history:delete', async (_evt, req: unknown) => {
    // CF-SEC-002: previously no shape validation at all.
    const verr = validateDeleteSnapshotRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      return await deleteHistorySnapshot(req as DeleteSnapshotRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:rationale:append', async (_evt, req: unknown) => {
    // CF-SEC-002: previously no IPC-layer shape/size guard. Core
    // handler does strict namespace + reason validation; the IPC
    // bound caps outer string sizes before they cross the trust
    // boundary.
    const verr = validateAppendRationaleRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      return await appendRationaleEntry(req as AppendRationaleRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:docs:generate', async (_evt, req: unknown) => {
    // CF-SEC-002: docs-write handler validates name + content
    // internally, but the IPC layer is the first chance to fail
    // before lazy-loading the (potentially heavy) template pipeline.
    const verr = validateDocsGenerateRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      // perf W2 / H10: docs generation pulls in template + markdown
      // tooling that's only needed when the user clicks Generate Docs.
      const { generateDocsFromContent } = await import('@configforge/core/handlers/docs-write.js');
      return generateDocsFromContent(req as GenerateDocsRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:baseline-csv:fetch', async (_evt, req: unknown) => {
    try {
      // perf W2 / H10: HTTP fetch + parse, never on the boot path.
      const { fetchBaselineCsv } = await import('@configforge/core/handlers/baseline-csv.js');
      return await fetchBaselineCsv(req as BaselineCsvRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- Phase 4 pass B2: manifests CRUD ------------------------------

  ipcMain.handle('cfs:manifests:list', async (_evt, req: unknown) => {
    const verr = validateListManifestsRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      const opts =
        (req as {
          live?: boolean;
          includeResources?: boolean;
          lite?: boolean;
          force?: boolean;
        }) ?? {};
      return await listManifests(opts);
    } catch (err) {
      return envelope(err);
    }
  });

  // perf W2 / C5: single-manifest fetch. Replaces the renderer pattern of
  // calling `cfs.manifests.list({})` and discarding N-1 entries (~5-10 MB
  // wasted for a 50-manifest / 326-resource tenant). Always includes
  // Resources by default — if a future caller doesn't need them, pass
  // `{ includeResources: false }` in the payload.
  ipcMain.handle('cfs:manifests:get', async (_evt, req: unknown) => {
    if (!isStringRequest(req)) {
      return envelope(new Error('payload must be { name: string }'));
    }
    const opts = req as { name: string; includeResources?: boolean };
    try {
      return await getManifest(opts.name, {
        includeResources: opts.includeResources,
      });
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:manifests:register', async (_evt, req: unknown) => {
    // CF-SEC-002: previously no IPC-layer validation; core handler
    // does the full content/uri/path normalization but the renderer
    // could otherwise pass a multi-GB content blob before any
    // downstream guard fired.
    const verr = validateRegisterManifestRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      return await registerManifest(req as RegisterManifestRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:manifests:restore', async (_evt, req: unknown) => {
    const verr = validateRestoreManifestRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      return await restoreManifest(req as RestoreManifestRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  // v0.2.15: fetch-only URL preview. Lets the renderer import a
  // manifest from a URL, load it into the editor, allow the user to
  // edit it, and only commit via `register` when they're ready.
  // Does NOT touch disk, does NOT register with the CLI.
  ipcMain.handle('cfs:manifests:fetch-uri', async (_evt, req: unknown) => {
    if (
      !req ||
      typeof req !== 'object' ||
      typeof (req as { uri?: unknown }).uri !== 'string'
    ) {
      return envelope(new Error("payload must be { uri: string }"));
    }
    try {
      const content = await fetchManifestFromUri((req as { uri: string }).uri);
      return { content };
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:manifests:delete', async (_evt, req: unknown) => {
    const validationError = validateDeleteManifestRequest(req);
    if (validationError) {
      return envelope(new Error(validationError));
    }
    const deleteRequest = req as {
      name: string;
      requireRecovery?: boolean;
    };
    try {
      return await deleteManifest(deleteRequest.name, {
        ...(deleteRequest.requireRecovery === true ? { requireRecovery: true } : {}),
      });
    } catch (err) {
      return envelope(err);
    }
  });

  // --- Phase 4 pass C: file upload (import) -------------------------

  /**
   * Import via OS file picker. Opens dialog.showOpenDialog, reads the
   * selected file from disk (with size cap), and delegates to the
   * pure `importFile` handler. The dialog is bound to the focused
   * BrowserWindow when one is available so it appears as a sheet on
   * macOS and modal on Windows/Linux.
   */
  ipcMain.handle('cfs:import:openAndParse', async () => {
    try {
      const window = BrowserWindow.getFocusedWindow() ?? undefined;
      const dialogResult = await (window
        ? dialog.showOpenDialog(window, importDialogOptions)
        : dialog.showOpenDialog(importDialogOptions));
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { ok: false, status: 0, error: 'cancelled' };
      }
      const filePath = dialogResult.filePaths[0];
      const filename = path.basename(filePath);

      // CF-SEC-003: stat() BEFORE reading the file so a multi-GB
      // selection can't OOM the main process between dialog dismiss
      // and the existing post-read size check. Also rejects non-files
      // (symlinks pointing at devices, directories, FIFOs) up front.
      // The original post-read length check stays as a belt-and-
      // suspenders guard for the (rare) symlink-races / sparse files
      // where stat lies about the on-disk byte count.
      const maxBytes = await getMaxImportBytes();
      let preReadSize: number | null = null;
      try {
        const st = await stat(filePath);
        if (!st.isFile()) {
          return envelope(
            Object.assign(new Error('Selected path is not a regular file.'), { status: 400 }),
          );
        }
        preReadSize = st.size;
        if (st.size > maxBytes) {
          return envelope(
            Object.assign(
              new Error(
                `File too large (${st.size.toLocaleString()} bytes). Limit: ${maxBytes.toLocaleString()} bytes (10 MB).`,
              ),
              { status: 413 },
            ),
          );
        }
      } catch (err) {
        // stat failures (permissions, ENOENT, etc.) — surface to the
        // renderer rather than crashing on the readFile below.
        const message = err instanceof Error ? err.message : 'stat failed';
        return envelope(Object.assign(new Error(message), { status: 400 }));
      }

      // perf W2 / H10: import module is lazy — yaml + csv parsers
      // load on first import, not at app boot.
      const { importFile } = await import('@configforge/core/handlers/import.js');
      const fullBuffer = await readFile(filePath);
      if (fullBuffer.byteLength > maxBytes) {
        // Defense-in-depth: the file grew between stat() and readFile()
        // (or the FS lied about size); fail closed.
        return envelope(
          Object.assign(new Error(
            `File too large (${fullBuffer.byteLength.toLocaleString()} bytes). Limit: ${maxBytes.toLocaleString()} bytes (10 MB).`,
          ), { status: 413 }),
        );
      }
      // Optional sanity log when the on-disk size shrinks unexpectedly
      // post-stat (sparse files, truncate-races). Best-effort only.
      void preReadSize;
      const content = fullBuffer.toString('utf-8');
      return importFile({ filename, content });
    } catch (err) {
      return envelope(err);
    }
  });

  /**
   * Import from already-loaded content (e.g. drag-and-drop in renderer
   * or programmatic test). Bypasses the dialog.
   */
  ipcMain.handle('cfs:import:fromContent', async (_evt, req: unknown) => {
    // CF-SEC-002: previously no IPC-layer validation; the core
    // `importFile` handler validates but only after the payload has
    // already crossed the trust boundary at full size.
    const verr = validateImportRequest(req);
    if (verr) return envelope(new Error(verr));
    try {
      const { importFile } = await import('@configforge/core/handlers/import.js');
      return importFile(req as ImportRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  // --- Phase 4 pass D: streamed downloads ---------------------------

  /**
   * Audit-pack: builds the artifact in core and either:
   *   - saves to a user-chosen path via dialog.showSaveDialog, or
   *   - returns the bytes/text inline so the renderer can preview
   *     in an iframe via the `cfs-blob://` protocol (Phase 4-F).
   */
  ipcMain.handle('cfs:audit-pack:save', async (_evt, req: unknown) => {
    try {
      // perf W2 / H10: audit-pack pulls in pdfkit (~1 MB) + the
      // markdown builder + provenance loader. None of that should run
      // until the user actually exports an audit pack.
      const { buildAuditPackArtifact } = await import('@configforge/core/handlers/audit-pack.js');
      const artifact = await buildAuditPackArtifact(req as AuditPackRequest);
      const window = BrowserWindow.getFocusedWindow() ?? undefined;
      const saveResult = await (window
        ? dialog.showSaveDialog(window, {
            title: 'Save audit pack',
            defaultPath: artifact.filename,
            filters: artifactFilters(artifact.filename),
          })
        : dialog.showSaveDialog({
            title: 'Save audit pack',
            defaultPath: artifact.filename,
            filters: artifactFilters(artifact.filename),
          }));
      if (saveResult.canceled || !saveResult.filePath) {
        return { ok: false, status: 0, error: 'cancelled' };
      }
      await writeArtifactBytes(saveResult.filePath, artifact.body);
      return { ok: true, path: saveResult.filePath, filename: path.basename(saveResult.filePath) };
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:audit-pack:get', async (_evt, req: unknown) => {
    try {
      const { buildAuditPackArtifact } = await import('@configforge/core/handlers/audit-pack.js');
      const artifact = await buildAuditPackArtifact(req as AuditPackRequest);
      // Convert string body → Uint8Array so the IPC payload shape is
      // consistent across formats; the renderer always wraps the
      // bytes in a Blob.
      const bytes =
        typeof artifact.body === 'string'
          ? new TextEncoder().encode(artifact.body)
          : artifact.body;
      return {
        filename: artifact.filename,
        contentType: artifact.contentType,
        bytes,
      };
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:diff:matrix-xlsx:save', async (_evt, req: unknown) => {
    try {
      if (typeof req !== 'string') {
        return envelope(new Error('payload must be a comma-separated names string'));
      }
      // perf W2 / H10: xlsx-builder is heavy (zip + workbook XML). Lazy.
      const { buildMatrixXlsx } = await import('@configforge/core/handlers/matrix-xlsx.js');
      const artifact = await buildMatrixXlsx(req);
      const window = BrowserWindow.getFocusedWindow() ?? undefined;
      const saveResult = await (window
        ? dialog.showSaveDialog(window, {
            title: 'Save matrix as Excel',
            defaultPath: artifact.filename,
            filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
          })
        : dialog.showSaveDialog({
            title: 'Save matrix as Excel',
            defaultPath: artifact.filename,
            filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
          }));
      if (saveResult.canceled || !saveResult.filePath) {
        return { ok: false, status: 0, error: 'cancelled' };
      }
      await writeFile(saveResult.filePath, Buffer.from(artifact.body));
      return { ok: true, path: saveResult.filePath };
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:export:save', async (_evt, req: unknown) => {
    try {
      // perf W2 / H10: export module shells out to multiple format
      // converters (yaml/json/mof/csv/azurepolicy). Lazy on first use.
      const { exportManifest } = await import('@configforge/core/handlers/export.js');
      const artifact = await exportManifest(req as ExportRequest);
      const window = BrowserWindow.getFocusedWindow() ?? undefined;
      const saveResult = await (window
        ? dialog.showSaveDialog(window, {
            title: 'Save export',
            defaultPath: artifact.filename,
            filters: artifactFilters(artifact.filename),
          })
        : dialog.showSaveDialog({
            title: 'Save export',
            defaultPath: artifact.filename,
            filters: artifactFilters(artifact.filename),
          }));
      if (saveResult.canceled || !saveResult.filePath) {
        return { ok: false, status: 0, error: 'cancelled' };
      }
      await writeFile(saveResult.filePath, artifact.body, 'utf-8');
      return { ok: true, path: saveResult.filePath };
    } catch (err) {
      return envelope(err);
    }
  });

  ipcMain.handle('cfs:export:get', async (_evt, req: unknown) => {
    try {
      const { exportManifest } = await import('@configforge/core/handlers/export.js');
      return await exportManifest(req as ExportRequest);
    } catch (err) {
      return envelope(err);
    }
  });

  // ── Phase 4-E: deploy with progress + cancellation ────────────────
  //
  // `cfs:deploy:run` invokes the deploy handler. The renderer SHOULD
  // pass `req.jobId` (any unique string). For the duration of the
  // call:
  //
  //   - main stores an AbortController in `activeDeploys` keyed by jobId
  //   - progress events are emitted via webContents.send('cfs:deploy:progress',
  //     { jobId, ...event }) — the renderer filters by jobId
  //   - on completion (success or error) the controller is removed
  //
  // `cfs:deploy:cancel(jobId)` looks up the controller and calls
  // abort(). Returns true if found, false if the deploy already
  // settled or never registered.
  ipcMain.handle('cfs:deploy:run', async (evt, req: unknown) => {
    // CF-SEC-002: previously the only checks were `typeof req ===
    // 'object'` + `name` + `mode`. Now we also bound `jobId`,
    // `platform`, `scenarioName` lengths and types up front so a
    // compromised renderer can't allocate large strings on the main-
    // process side before the deploy pipeline starts.
    const verr = validateDeployRequest(req);
    if (verr) return envelope(new Error(verr));
    const r = req as DeployRequest;

    // v0.3.0 (#1): main-process confirmation gate for enforce mode.
    // The renderer's `window.confirm()` can be bypassed by a
    // compromised renderer dispatching `cfs.deploy.run` directly
    // from devtools or an injected script. UAC elevation alone
    // confirms ONLY elevation, not user intent — once a session is
    // elevated the user won't see a second UAC prompt for a stealth
    // deploy. This native dialog requires explicit user intent for
    // every enforce.
    if (r.mode === 'enforce') {
      const win = BrowserWindow.fromWebContents(evt.sender) ?? BrowserWindow.getFocusedWindow();
      try {
        const { response } = await dialog.showMessageBox(win ?? undefined as unknown as BrowserWindow, {
          type: 'warning',
          buttons: ['Cancel', 'Apply baseline'],
          defaultId: 0,
          cancelId: 0,
          title: 'Confirm enforce mode',
          message: `Apply baseline "${r.name}" to this machine?`,
          detail: 'This will modify system settings (registry, audit policy, user rights, etc). A pre-deploy snapshot is written before changes — you can Revert from the Manifests page if needed.',
        });
        if (response !== 1) {
          return envelope(new Error('User cancelled enforce'));
        }
      } catch (err) {
        // If the dialog itself fails (no window context, etc), refuse
        // the request rather than silently proceeding.
        return envelope(err instanceof Error ? err : new Error('confirm-dialog failed'));
      }
    }

    const jobId = typeof r.jobId === 'string' && r.jobId.length > 0 ? r.jobId : undefined;
    const controller = new AbortController();
    if (jobId) activeDeploys.set(jobId, controller);

    const sender = evt.sender;
    const onProgress = (event: DeployProgressEvent) => {
      // Renderer may have navigated away or window closed — guard.
      if (sender.isDestroyed()) return;
      try {
        sender.send('cfs:deploy:progress', { jobId: jobId ?? null, ...event });
      } catch {
        /* renderer disconnected; nothing we can do */
      }
    };

    try {
      const response = await runDeploy(r, {
        onProgress,
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      return envelope(err);
    } finally {
      if (jobId) activeDeploys.delete(jobId);
    }
  });

  ipcMain.handle('cfs:deploy:cancel', async (_evt, jobId: unknown) => {
    if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > MAX_JOB_ID_LEN) {
      return false;
    }
    const controller = activeDeploys.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  });

  // ── v0.3.1 (#23): userData-side settings store ────────────────────
  //
  // Reads return the full UserSettings object (defaults if no file
  // exists yet); writes accept a partial and merge atomically.
  // Renderer-only preferences (theme, dismissal flags) stay in
  // localStorage — this store is for things the main process also
  // needs to honor (history retention, snapshot retention, etc).
  ipcMain.handle('cfs:settings:get', async () => {
    try {
      return await getSettings();
    } catch (err) {
      return envelope(err);
    }
  });
  ipcMain.handle('cfs:settings:set', async (_evt, req: unknown) => {
    if (!req || typeof req !== 'object') {
      return envelope(new Error('payload must be a partial UserSettings object'));
    }
    try {
      return await setSettings(req as Partial<UserSettings>);
    } catch (err) {
      return envelope(err);
    }
  });

  // ── v0.3.1 (#4): mid-deploy interruption recovery ─────────────────
  ipcMain.handle('cfs:deploy:list-interrupted', async () => {
    try {
      return { data: await listInterruptedDeploys() };
    } catch (err) {
      return envelope(err);
    }
  });
  ipcMain.handle('cfs:deploy:dismiss-interrupted', async (_evt, req: unknown) => {
    if (!req || typeof req !== 'object' || typeof (req as { namespace?: unknown }).namespace !== 'string') {
      return envelope(new Error('payload must be { namespace: string }'));
    }
    const ns = (req as { namespace: string }).namespace;
    // CF-SEC: reject path traversal at the IPC boundary too.
    if (
      ns.length === 0 ||
      ns.length > 96 ||
      ns.includes('..') ||
      ns.includes('/') ||
      ns.includes('\\') ||
      ns.includes('\0') ||
      !/^[A-Za-z0-9._-]+$/.test(ns)
    ) {
      return envelope(new Error('namespace contains invalid characters'));
    }
    try {
      await dismissInterruptedDeploy(ns);
      return { ok: true };
    } catch (err) {
      return envelope(err);
    }
  });

  // ── Phase 6: platform info + theme tracking ───────────────────────
  //
  // The renderer needs to know:
  //   - whether this is Windows 11 22000+ (for Mica + custom titlebar)
  //   - the OS theme preference (so FluentProvider can switch themes)
  //
  // `cfs:platform:info` returns a snapshot. `cfs:platform:theme-changed`
  // is a webContents.send event the renderer subscribes to via the
  // preload bridge. nativeTheme.on('updated') fires whenever the OS
  // theme changes — even mid-session — so the app reacts live.
  ipcMain.handle('cfs:platform:info', async () => {
    const release = os.release();
    const platform = process.platform;
    let isWindows11 = false;
    if (platform === 'win32') {
      // Windows 11 reports a 10.0.x build where x >= 22000 (Sun Valley).
      // os.release() returns e.g. "10.0.22631" on Win11 23H2.
      const parts = release.split('.');
      const build = parseInt(parts[2] ?? '0', 10);
      isWindows11 = parts[0] === '10' && build >= 22000;
    }
    // v0.1.1: surface RDP / Azure DevBox detection so the renderer can
    // skip translucency-dependent visuals (acrylic, transparent body)
    // that look broken when DirectComposition surfaces don't transport
    // through the RDP framebuffer channel. Mica is already gated off
    // for RDP at the BrowserWindow level (see main.ts `micaSupported`).
    return {
      platform,
      release,
      isWindows11,
      isRdpSession: isRemoteDesktopSession(),
      prefersDark: nativeTheme.shouldUseDarkColors,
      arch: process.arch,
    };
  });

  // Wire native-theme subscription. We register once per renderer
  // (BrowserWindow.getAllWindows() at fire time) so multiple windows
  // see the same event.
  //
  // v0.1.0 hot-fix: dropped the `setTitleBarOverlay` symbolColor
  // theme-update branch; we no longer use a frameless titlebar
  // overlay (see main.ts). The renderer-side theme update via
  // `cfs:platform:theme-changed` still fires so FluentProvider
  // can swap themes.
  nativeTheme.on('updated', () => {
    const prefersDark = nativeTheme.shouldUseDarkColors;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send('cfs:platform:theme-changed', prefersDark);
        } catch {
          /* renderer disconnected */
        }
      }
    }
  });

  // --- system / elevation ------------------------------------------
  //
  // v0.1.3: in-app process elevation. The renderer needs two things:
  //   1. A cheap synchronous check ("am I admin right now?") so the
  //      Settings page can show / hide the Elevate button — this is
  //      separate from the cached `cfs:health:check` snapshot which
  //      may be stale.
  //   2. A trigger to relaunch the app elevated. Returns immediately
  //      with status; the actual `app.quit()` is scheduled inside
  //      `relaunchElevated()` so the IPC reply flushes before the
  //      window closes.
  //
  // Both wrap pure helpers in `elevate.ts` for testability.
  ipcMain.handle('cfs:system:is-elevated', async () => {
    return { isElevated: isCurrentProcessElevated() };
  });

  ipcMain.handle('cfs:system:elevate', async () => {
    return relaunchElevated();
  });

  // --- shell --------------------------------------------------------
  // H4 fix — surface `electron.shell.openExternal` to the renderer so
  // bare `<a target="_blank">` links (Library "Source"/"CSV", Settings
  // docs, AI analysis citations) actually launch the system browser.
  // Scheme is restricted to http/https; anything else (file://, custom
  // protocol handlers, javascript:) is rejected with a 400-style
  // envelope. URL parsing happens through `URL` so embedded `\` or
  // whitespace can't smuggle a non-http payload past a regex.
  ipcMain.handle('cfs:shell:open-external', async (_evt, url: unknown) => {
    if (typeof url !== 'string' || url.length === 0) {
      return envelope(new Error('url must be a non-empty string'));
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return envelope(new Error('only http(s) URLs are allowed'));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return envelope(new Error('only http(s) URLs are allowed'));
    }
    try {
      await shell.openExternal(parsed.toString());
      return { ok: true } as const;
    } catch (err) {
      return envelope(err);
    }
  });
}

/**
 * Per-jobId AbortControllers for in-flight deploys. Module-scope so
 * `cfs:deploy:cancel` can find the controller registered by
 * `cfs:deploy:run`. Cleaned up in the run handler's finally block.
 */
const activeDeploys = new Map<string, AbortController>();

/**
 * Filename → reasonable file-picker filters. Best-effort; we always
 * include "All files" so the user can override.
 */
function artifactFilters(filename: string): Electron.FileFilter[] {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const map: Record<string, { name: string; extensions: string[] }> = {
    pdf: { name: 'PDF Document', extensions: ['pdf'] },
    md: { name: 'Markdown', extensions: ['md'] },
    yaml: { name: 'YAML', extensions: ['yaml', 'yml'] },
    yml: { name: 'YAML', extensions: ['yaml', 'yml'] },
    json: { name: 'JSON', extensions: ['json'] },
    mof: { name: 'MOF', extensions: ['mof'] },
    csv: { name: 'CSV', extensions: ['csv'] },
    xlsx: { name: 'Excel Workbook', extensions: ['xlsx'] },
  };
  const filters: Electron.FileFilter[] = [];
  if (map[ext]) filters.push(map[ext]);
  filters.push({ name: 'All files', extensions: ['*'] });
  return filters;
}

async function writeArtifactBytes(
  filePath: string,
  body: string | Uint8Array,
): Promise<void> {
  if (typeof body === 'string') {
    await writeFile(filePath, body, 'utf-8');
  } else {
    await writeFile(filePath, Buffer.from(body));
  }
}

const importDialogOptions: Electron.OpenDialogOptions = {
  title: 'Import baseline or manifest',
  properties: ['openFile'],
  filters: [
    { name: 'OSConfig manifest', extensions: ['yaml', 'yml', 'json'] },
    { name: 'Baseline spreadsheet', extensions: ['csv', 'tsv', 'xlsx'] },
    { name: 'All files', extensions: ['*'] },
  ],
};
