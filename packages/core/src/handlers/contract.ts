// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Typed IPC contract — the source of truth for every channel exposed
 * by `window.cfs.*`.
 *
 * Both hosts call into the same pure handlers in
 * `packages/core/src/handlers/`. Next.js wraps in NextResponse;
 * Electron main calls the same function and returns the value over IPC.
 *
 * Adding a new channel:
 *   1. Add the handler function to `packages/core/src/handlers/<area>.ts`
 *   2. Add the type to one of the interfaces below
 *   3. Wire it in `apps/desktop/electron/main.ts`
 *   4. Expose it in `apps/desktop/electron/preload.ts`
 *
 * Errors:
 *   Handlers throw `HandlerError(status, message)` when they need to
 *   surface a structured failure. The IPC layer catches that and emits
 *   a standardized error shape `{ ok: false, status, error }`. Renderer
 *   wrappers re-throw client-side so calling code uses a normal
 *   try/catch + `error.status === 404`-style branching.
 */

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'error';
  installed: boolean;
  version: string;
  binaryPath: string;
  binarySource: string;
  platform: string;
  isAdmin: boolean;
  serverType: string;
  osVersion: string;
  requiresAdminForAllOps: boolean;
  adminBlocked: boolean;
  adminMessage: string;
  /**
   * v0.3.0 (#5): true when the resolved binary's version string does
   * not include the version constant ConfigForge was validated
   * against (`OSCFG_CLI_VERSION`). The CLI may still work for most
   * flows but deploy/audit can produce unexpected structured errors.
   * The renderer should surface an amber-state warning when set.
   */
  versionMismatch?: boolean;
  /** Expected oscfg version string the app was validated against. */
  expectedVersion?: string;
  /** Present only when status === 'error' */
  error?: string;
}

export interface CisStatus {
  available: boolean;
  /**
   * The resolved on-disk directory the runtime reads CIS catalog
   * files from. Surfaced so the CIS Catalog page can show the
   * actual path users need to drop files into (which differs
   * between dev and packaged installs).
   */
  dataDir?: string;
  /**
   * Per-expected-file presence map. Each entry is the filename the
   * loader expects plus whether it currently exists on disk. Lets
   * the CIS Catalog page show a checklist so users know which file
   * is still missing (the #1 confusion this page had to solve).
   */
  files?: Array<{ name: string; present: boolean; description: string; required: boolean }>;
  /**
   * Files that exist in the data dir but aren't in the expected
   * list. Surfaced so users can spot the singular-vs-plural class
   * of typos (e.g. `cis-mapping.json` vs `cis-mappings.json`).
   * `didYouMean` is the closest expected filename within 2 edits,
   * or null if there isn't a near match.
   */
  unexpectedFiles?: Array<{ name: string; didYouMean: string | null }>;
  /**
   * Human-readable diagnostic when `cis-mappings.json` exists but
   * has the wrong shape (e.g. user dropped the OSConfig
   * baseline-catalog format instead of the OVAL-mapping format).
   * `null` means either no file or file shape is correct.
   */
  schemaError?: string | null;
  /**
   * Where the CIS data came from: 'json' (legacy JSON catalog),
   * 'xccdf' (auto-detected XCCDF files), or 'both'.
   */
  source?: 'json' | 'xccdf' | 'both';
  /** True only when the legacy global mappings file parsed successfully. */
  legacyMappingsLoaded?: boolean;
  /** Number of legacy per-OS rule catalogs that parsed with at least one rule. */
  legacyRuleCatalogCount?: number;
  /**
   * Discovered XCCDF benchmark files with metadata.
   */
  xccdfFiles?: Array<{
    filename: string;
    platform: 'windows' | 'linux' | 'unknown';
    product: string;
    version: string;
    title: string;
    hasOval: boolean;
  }>;
  /**
   * Discovered Azure Policy CIS baseline JSON files.
   */
  azurePolicyCisFiles?: Array<{
    filename: string;
    platform: 'windows' | 'linux' | 'unknown';
    benchmarkName: string;
    benchmarkVersion: string;
    ruleCount: number;
  }>;
}

export interface BaselineCatalogEntry {
  id: string;
  name: string;
  description?: string;
  source?: 'local' | 'github' | 'official';
  manifestUrl?: string;
  csvUrl?: string;
  /**
   * Hosts may attach additional metadata (platform, version, category,
   * resourceCount, …). The contract surface captures only what the
   * handler needs; the rest passes through unchanged for the renderer.
   */
  [key: string]: unknown;
}

export interface LibraryListResult {
  data: BaselineCatalogEntry[];
}

export interface LibraryEntryResult {
  data: BaselineCatalogEntry;
  content?: string | null;
  note?: string;
}

export interface LibraryEntryRequest {
  id: string;
  /** Pull manifest/csv content alongside the metadata. */
  content?: boolean;
  /** Bypass the in-memory content cache (after editing a local file). */
  fresh?: boolean;
}

export interface ActivityItem {
  type: 'registered' | 'deployed' | 'deployed-audit' | 'deployed-enforce' | 'reverted';
  name: string;
  timestamp: string;
  message?: string;
}

export interface ActivityResult {
  data: ActivityItem[];
}

/**
 * Standardized error envelope returned over IPC when a handler throws.
 * Renderer-side wrappers convert this back into a thrown Error so
 * calling code reads naturally with try/catch.
 */
export interface IpcErrorEnvelope {
  ok: false;
  status: number;
  error: string;
  /**
   * Optional machine-readable discriminator. Defined values:
   *   - `CLI_REQUIRED`, the OSConfig CLI is not installed. Renderer
   *     should open the install modal instead of showing a toast.
   */
  code?: string;
}

/**
 * The Phase 3 surface. Phase 4 + 5 will add the remaining channels.
 */
export interface CfsContract {
  // --- system / runtime -----------------------------------------------
  health: {
    check(): Promise<HealthStatus>;
    /**
     * Force-clear the cached binary lookup and re-probe. Used by the
     * "I've already installed it — recheck" CTA in the CLI install
     * modal so the user doesn't need to restart the app after
     * installing OSConfig.
     */
    recheck(): Promise<HealthStatus>;
  };

  // --- cis ------------------------------------------------------------
  cis: {
    status(): Promise<CisStatus>;
  };

  // --- library --------------------------------------------------------
  library: {
    list(): Promise<LibraryListResult>;
    get(req: LibraryEntryRequest): Promise<LibraryEntryResult>;
  };

  // --- scenarios (legacy / not implemented) --------------------------
  scenarios: {
    /**
     * Always returns the "scenarios are not part of the unified
     * CLI-based app" hint. Kept as a channel so old UI code probing
     * for it gets a clean structured response instead of a network
     * error in Electron.
     */
    list(): Promise<IpcErrorEnvelope>;
  };

  // --- activity -------------------------------------------------------
  activity: {
    recent(): Promise<ActivityResult>;
  };
}
