// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Preload bridge.
 *
 * The renderer is sandboxed and has no Node access. The only way for
 * it to talk to main is through `window.cfs.*`, which we expose here
 * via `contextBridge.exposeInMainWorld`.
 *
 * The full surface lives in `@configforge/core/handlers` types (single
 * source of truth — same types power Next.js, Electron, and tests).
 *
 * Phase 0/1/2 sample channels (cfs:ping / cfs:smoke:packaging /
 * cfs:spike:transport[ABC]) were retired in Phase 4 cleanup.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatus } from './auto-updater';
import type {
  HealthStatus,
  CisStatus,
  LibraryListResult,
  LibraryEntryResult,
  LibraryEntryRequest,
  ActivityResult,
  IpcErrorEnvelope,
  CisLookupRequest,
  RevertRequest,
  SaveSnapshotRequest,
  DeleteSnapshotRequest,
  AppendRationaleRequest,
  GenerateDocsRequest,
  BaselineCsvRequest,
  BaselineCsvResult,
  RegisterManifestRequest,
  RegisterManifestResult,
  RestoreManifestRequest,
  RestoreManifestResult,
  DeleteManifestOptions,
  DeleteManifestResult,
  ImportRequest,
  ImportResult,
  AuditPackRequest,
  ExportRequest,
  ExportArtifact,
  DeployRequest,
  DeployResponse,
  DeployProgressEvent,
  UserSettings,
  ManifestListEntry,
} from '@configforge/core/handlers';

/**
 * Renderer-side wrapper: if the IPC reply is an error envelope, throw
 * a regular Error with the status attached so calling code reads
 * naturally. Otherwise return the result as-is.
 */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as
    | T
    | IpcErrorEnvelope;
  if (
    typeof result === 'object' &&
    result !== null &&
    (result as IpcErrorEnvelope).ok === false &&
    typeof (result as IpcErrorEnvelope).status === 'number'
  ) {
    const env = result as IpcErrorEnvelope;
    const err = new Error(env.error) as Error & {
      status: number;
      data?: Record<string, unknown>;
    };
    err.status = env.status;
    // Spread any extra envelope fields (e.g. `missing` for diff matrix).
    const { ok: _ok, status: _s, error: _e, ...rest } = env;
    if (Object.keys(rest).length > 0) err.data = rest as Record<string, unknown>;
    return Promise.reject(err);
  }
  return result as T;
}

const cfsApi = {
  health: {
    check: (): Promise<HealthStatus> => call('cfs:health:check'),
    /**
     * Force-recheck the OSConfig CLI install. Used by the "I've
     * already installed it — recheck" CTA in the CLI install modal
     * so the user doesn't need to restart the app.
     */
    recheck: (): Promise<HealthStatus> => call('cfs:health:recheck'),
  },

  cis: {
    status: (): Promise<CisStatus> => call('cfs:cis:status'),
    lookup: (req: CisLookupRequest) => call<{ name: string; match: unknown }>('cfs:cis:lookup', req),
    revealDataDir: (): Promise<{ ok: true; path: string }> =>
      call('cfs:cis:reveal-data-dir'),
    recheck: (): Promise<CisStatus> => call('cfs:cis:recheck'),
    warmup: (): Promise<{ ok: boolean; xccdfParsed: number; azurePolicyParsed: number }> =>
      call('cfs:cis:warmup'),
    bulkLookup: (namespace: string, benchmarkFilename?: string) =>
      call<{
        namespace: string;
        manifestResourceTotal: number;
        manifestResourcesWithMatch: number;
        benchmark: {
          filename: string;
          name: string;
          version: string;
          platform: 'windows' | 'linux' | 'unknown';
          totalRules: number;
          source: 'azure-policy' | 'xccdf';
        } | null;
        cisRulesCovered: number;
        cisRulesUnmatched: Array<{
          ruleId: string;
          sectionNumber: string;
          title: string;
          value: string;
        }>;
        compliancePercent: number | null;
        results: Array<{
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
          } | null;
        }>;
      }>('cfs:cis:bulk-lookup', { namespace, benchmarkFilename }),
  },

  systemConfig: {
    summary: () =>
      call<{
        data: {
          platform: string;
          isAdmin: boolean;
          serverType: string;
          osVersion: string;
          manifestNames: string[];
        };
      }>('cfs:system-config:summary'),
    forManifest: (name: string) =>
      call<{ data: Record<string, unknown> }>('cfs:system-config:get', { name }),
  },

  library: {
    list: (): Promise<LibraryListResult> => call('cfs:library:list'),
    get: (req: LibraryEntryRequest): Promise<LibraryEntryResult> => call('cfs:library:get', req),
  },

  scenarios: {
    /** Always returns the `not supported` envelope; never throws. */
    list: (): Promise<IpcErrorEnvelope> =>
      ipcRenderer.invoke('cfs:scenarios:list') as Promise<IpcErrorEnvelope>,
  },

  drift: {
    list: (): Promise<IpcErrorEnvelope> =>
      ipcRenderer.invoke('cfs:drift:list') as Promise<IpcErrorEnvelope>,
  },

  activity: {
    recent: (): Promise<ActivityResult> => call('cfs:activity:recent'),
  },

  rationale: {
    list: (id: string) =>
      call<{ entries: unknown[] }>('cfs:rationale:list', id),
    append: (req: AppendRationaleRequest) =>
      call<{ ok: true; entry: unknown }>('cfs:rationale:append', req),
  },

  /**
   * v0.1.6 — last persisted device-audit run for a manifest, sourced
   * from `~/.configforge/audit-results/<ns>.json`. Used by the audit-
   * pack page to populate the "Compliance report" availability badge
   * and (in future) by a "last audited X minutes ago" indicator on
   * the dashboard. Returns `{ snapshot: null }` when no audit has
   * been run yet — never throws.
   */
  auditResults: {
    get: (id: string) =>
      call<{ snapshot: { version: 1; recordedAt: string; mode: 'audit' | 'enforce'; result: unknown } | null }>(
        'cfs:audit-results:get',
        id,
      ),
  },

  history: {
    list: (req: { name: string; id?: string }) =>
      call<{ data: unknown }>('cfs:history:list', req),
    save: (req: SaveSnapshotRequest) =>
      call<{ data: unknown }>('cfs:history:save', req),
    delete: (req: DeleteSnapshotRequest) =>
      call<{ message: string }>('cfs:history:delete', req),
  },

  docs: {
    get: (name: string) =>
      call<{ markdown: string; filename: string }>('cfs:docs:get', { name }),
    generate: (req: GenerateDocsRequest) =>
      call<{ markdown: string; filename: string }>('cfs:docs:generate', req),
  },

  manifests: {
    list: (opts?: {
      live?: boolean;
      includeResources?: boolean;
      lite?: boolean;
      force?: boolean;
    }) =>
      call<{ data: ManifestListEntry[] }>('cfs:manifests:list', opts ?? {}),
    register: (req: RegisterManifestRequest): Promise<RegisterManifestResult> =>
      call('cfs:manifests:register', req),
    restore: (req: RestoreManifestRequest): Promise<RestoreManifestResult> =>
      call('cfs:manifests:restore', req),
    /**
     * v0.2.15: fetch a remote manifest's source YAML *without*
     * registering it. The renderer uses this to load a URL into the
     * editor for review/edit; the user then submits Register to commit.
     */
    fetchUri: (uri: string): Promise<{ content: string }> =>
      call('cfs:manifests:fetch-uri', { uri }),
    delete: (name: string, options: DeleteManifestOptions = {}): Promise<DeleteManifestResult> =>
      call('cfs:manifests:delete', { name, ...options }),
    status: (name: string) => call<unknown>('cfs:manifests:status', { name }),
    /**
     * v0.2.16: registered manifest's source YAML (what the user wrote
     * at register time). Distinct from `status`, which returns the
     * reconstructed YAML of the CLI-reported live state — that's the
     * wrong shape for cross-manifest conflict detection and any other
     * "what did the user write" consumer.
     *
     * Returns `{ data: null }` for unregistered namespaces, mirroring
     * the convention used by `get`/`status`.
     */
    getSource: (name: string) =>
      call<{ data: string | null }>('cfs:manifests:source', { name }),
    /**
     * perf W2 / C5: fetch a single manifest by name. Returns
     * `{ data: null }` (NOT throw) for unknown namespaces — same
     * convention as `status`. Resources[] included by default.
     */
    get: (name: string, opts?: { includeResources?: boolean }) =>
      call<{
        data: {
          Name: string;
          DisplayName: string;
          Source: 'library' | 'oscfg';
          RegistrationSource: 'user' | 'library' | 'import' | null;
          RegistrationSourceId: string | null;
          Deployed: boolean;
          LastAppliedAt: string | null;
          LastAuditedAt: string | null;
          Revision: string | null;
          Platform: string | null;
          ResourceCount: number;
          Validation: unknown;
          Compliance: {
            auditedAt: string;
            total: number;
            compliant: number;
            nonCompliant: number;
            indeterminate: number;
            errors: number;
          } | null;
          RegisteredAt: string | null;
          LastModifiedAt: string | null;
          Resources?: { name: string; type: string }[];
        } | null;
        warning?: string;
      }>('cfs:manifests:get', { name, ...(opts ?? {}) }),
  },

  diff: {
    matrix: (names: string) => call<unknown>('cfs:diff:matrix', names),
    matrixXlsxSave: (names: string) =>
      call<{ ok: true; path: string } | IpcErrorEnvelope>(
        'cfs:diff:matrix-xlsx:save',
        names,
      ),
  },

  compliance: {
    report: (req: { manifest: string; against: string }) =>
      call<unknown>('cfs:compliance:report', req),
  },

  baselineCsv: {
    fetch: (req: BaselineCsvRequest): Promise<BaselineCsvResult> =>
      call('cfs:baseline-csv:fetch', req),
  },

  revert: {
    apply: (req: RevertRequest) => call<unknown>('cfs:revert:apply', req),
  },

  // v0.3.1 (#23): userData-side settings store
  settings: {
    get: (): Promise<UserSettings> => call('cfs:settings:get', undefined),
    set: (patch: Partial<UserSettings>): Promise<UserSettings> =>
      call('cfs:settings:set', patch),
  },

  // v0.3.1 (#4): mid-deploy interruption recovery
  deployRecovery: {
    listInterrupted: (): Promise<{ data: { namespace: string; displayName: string; startedAt: string; sentinelPath: string }[] }> =>
      call('cfs:deploy:list-interrupted', undefined),
    dismiss: (namespace: string): Promise<{ ok: true }> =>
      call('cfs:deploy:dismiss-interrupted', { namespace }),
  },

  importChannel: {
    /** Open OS file picker, read selected file, parse. */
    openAndParse: (): Promise<ImportResult | IpcErrorEnvelope> =>
      ipcRenderer.invoke('cfs:import:openAndParse') as Promise<
        ImportResult | IpcErrorEnvelope
      >,
    /** Parse content the renderer already has (drag-and-drop). */
    fromContent: (req: ImportRequest): Promise<ImportResult> =>
      call('cfs:import:fromContent', req),
  },

  auditPack: {
    save: (req: AuditPackRequest): Promise<{ ok: true; path: string } | IpcErrorEnvelope> =>
      ipcRenderer.invoke('cfs:audit-pack:save', req) as Promise<
        { ok: true; path: string } | IpcErrorEnvelope
      >,
    get: (req: AuditPackRequest) =>
      call<{ filename: string; contentType: string; bytes: Uint8Array }>(
        'cfs:audit-pack:get',
        req,
      ),
  },

  exportChannel: {
    save: (req: ExportRequest): Promise<{ ok: true; path: string } | IpcErrorEnvelope> =>
      ipcRenderer.invoke('cfs:export:save', req) as Promise<
        { ok: true; path: string } | IpcErrorEnvelope
      >,
    get: (req: ExportRequest): Promise<ExportArtifact> => call('cfs:export:get', req),
  },

  deploy: {
    /**
     * Run a deploy or audit. Renderer SHOULD pass `req.jobId` (any
     * unique string — UUID recommended) so that progress events can
     * be correlated and the deploy can be cancelled. If `jobId` is
     * omitted, cancellation is unavailable.
     *
     * `onProgress` receives `DeployProgressEvent` for THIS job only —
     * filtered by jobId on the renderer side. The listener is
     * automatically removed when the invoke settles.
     */
    run: (
      req: DeployRequest,
      onProgress?: (event: DeployProgressEvent) => void,
    ): Promise<DeployResponse> => {
      let cleanup: (() => void) | undefined;
      if (onProgress && req.jobId) {
        const listener = (
          _: Electron.IpcRendererEvent,
          payload: DeployProgressEvent & { jobId: string },
        ) => {
          if (payload.jobId === req.jobId) {
            const { jobId: _jid, ...event } = payload;
            onProgress(event as DeployProgressEvent);
          }
        };
        ipcRenderer.on('cfs:deploy:progress', listener);
        cleanup = () => ipcRenderer.removeListener('cfs:deploy:progress', listener);
      }
      return call<DeployResponse>('cfs:deploy:run', req).finally(() => cleanup?.());
    },

    /**
     * Request cancellation of a running deploy by jobId. Returns
     * `true` if the controller was found, `false` if the job has
     * already completed (or was never registered).
     *
     * For enforce mode, cancellation is only honored BEFORE the
     * apply CLI is invoked. After apply, cancelRequested is recorded
     * but the deploy completes safely (commit + audit + snapshot).
     */
    cancel: (jobId: string): Promise<boolean> =>
      ipcRenderer.invoke('cfs:deploy:cancel', jobId) as Promise<boolean>,
  },

  platform: {
    /**
     * Snapshot of the host platform info, sourced from main process
     * `process.platform` + `os.release()` + `nativeTheme.shouldUseDarkColors`.
     * The renderer-side `useTheme()` and `isWindows11()` helpers in
     * `apps/desktop/src/lib/platform.ts` consume this.
     *
     * `prefersDark` is a snapshot at call time; theme changes are
     * pushed via the `cfs:platform:theme-changed` event.
     */
    info: (): Promise<{
      platform: NodeJS.Platform;
      release: string;
      isWindows11: boolean;
      isRdpSession: boolean;
      prefersDark: boolean;
      arch: string;
    }> => ipcRenderer.invoke('cfs:platform:info'),

    /**
     * Subscribe to OS theme-change events. Returns an `unsubscribe`
     * function — the host emits the event whenever
     * `nativeTheme.on('updated')` fires.
     */
    onThemeChanged: (cb: (prefersDark: boolean) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, prefersDark: boolean) => cb(prefersDark);
      ipcRenderer.on('cfs:platform:theme-changed', listener);
      return () => ipcRenderer.removeListener('cfs:platform:theme-changed', listener);
    },
  },

  /**
   * v0.1.3 — process-elevation surface. The renderer's Settings page
   * uses these to show "Elevate to Administrator" status + button.
   * `isElevated()` is a fresh sync check (NOT cached); use it to
   * decide whether the elevate button should render. `elevate()`
   * relaunches the app via UAC (Win) / pkexec (Linux) and quits the
   * current instance shortly after. macOS returns 'unsupported'.
   */
  system: {
    isElevated: (): Promise<{ isElevated: boolean }> =>
      ipcRenderer.invoke('cfs:system:is-elevated'),
    elevate: (): Promise<{
      status: 'already-elevated' | 'launching' | 'missing-prerequisite' | 'unsupported';
      message?: string;
    }> => ipcRenderer.invoke('cfs:system:elevate'),
  },

  /**
   * Phase 11 — auto-update channel.
   *
   * `electron-updater` runs in the main process and emits status
   * events that drive the renderer's UpdateBanner UI. The renderer
   * uses these methods to subscribe + trigger user-driven actions.
   *
   * See `apps/desktop/electron/auto-updater.ts` for the full state
   * machine + event shape, and
   * `apps/desktop/src/components/UpdateBanner.tsx` for the
   * consuming UI.
   */
  update: {
    /**
     * Get the current update status (one-shot snapshot). Useful
     * on renderer mount before any events have fired.
     */
    getStatus: (): Promise<UpdateStatus> =>
      ipcRenderer.invoke('cfs:update:get-status') as Promise<UpdateStatus>,

    /**
     * Subscribe to update status changes. Returns an `unsubscribe`
     * function — the host emits whenever `autoUpdater` fires
     * checking-for-update / update-available / update-not-available
     * / download-progress / update-downloaded / error.
     */
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, status: UpdateStatus) => cb(status);
      ipcRenderer.on('cfs:update:status', listener);
      return () => ipcRenderer.removeListener('cfs:update:status', listener);
    },

    /**
     * Manually trigger an update check. The initial check fires
     * automatically ~10s after first paint; this is for the
     * "Check for updates" button in Settings.
     */
    check: (): Promise<UpdateStatus> =>
      ipcRenderer.invoke('cfs:update:check') as Promise<UpdateStatus>,

    /**
     * Begin downloading the available update. autoDownload is
     * off in main so this is the explicit trigger.
     */
    download: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cfs:update:download') as Promise<{ ok: boolean; error?: string }>,

    /**
     * Quit the current app and install the downloaded update.
     * The new version boots automatically afterward.
     */
    quitAndInstall: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke('cfs:update:quit-and-install') as Promise<{ ok: true }>,
  },

  /**
   * H4 fix — open `http(s)` URLs in the user's default browser via
   * Electron's `shell.openExternal`. With nodeIntegration disabled,
   * a bare `<a target="_blank">` either gets swallowed by Chromium's
   * popup blocker or opens an in-app BrowserWindow with no chrome,
   * so external links must round-trip through main. The handler
   * validates the scheme; only http(s) is accepted to avoid
   * `file://` / `javascript:` shell-out from a compromised renderer.
   */
  shell: {
    openExternal: (url: string): Promise<void> =>
      call<void>('cfs:shell:open-external', url),
  },
} as const;

contextBridge.exposeInMainWorld('cfs', cfsApi);

export type CfsApi = typeof cfsApi;

// Re-export the UpdateStatus type so the renderer can use the
// same discriminated-union shape autoUpdater emits.
export type { UpdateStatus } from './auto-updater';
