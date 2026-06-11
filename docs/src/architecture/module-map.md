# Module map

A conservative map of the current `apps/desktop/` and `packages/core/` split. It only lists modules that exist on `main`.

## `apps/desktop/electron/` -- Main process + preload

| File | Role |
| --- | --- |
| `main.ts` | BrowserWindow construction, app lifecycle, IPC + protocol registration. |
| `preload.ts` | `contextBridge.exposeInMainWorld('cfs', { … })`. Single contract source for the renderer-side `window.cfs.*` shape. **Flavor-specific**: the macOS author preload omits deploy / elevation / health / auditResults. |
| `ipc-handlers.ts` | Registers every `cfs:*` IPC channel. Each channel is a thin wrapper around a `packages/core/handlers/` export. |
| `ipc-validators.ts` | Typed payload validators per channel (CF-SEC-002). Rejects malformed payloads at the IPC boundary, before they reach handlers. |
| `navigation-guard.ts` | Blocks `will-navigate` outside the bundled UI + file:// navigation (CF-SEC-001). |
| `protocol-handler.ts` | `cfs-blob://` custom protocol for streaming in-process artifacts (PDFs, exports) to the renderer without writing to disk first. |
| `log.ts` | Typed main-process logger (v0.2.1). `scoped(name)`, `setLogger()`, `resetLogger()`, `redact()`. Wraps `electron-log`; falls back to console in vitest. |
| `elevate.ts` | Process elevation. UAC on Windows, `pkexec` on Linux. Uses `scoped('elevate')` for all logging. |
| `platform-detection.ts` | RDP / Wayland / X11 / WSL detection helpers used by elevate + main window creation. |

## `apps/desktop/src/lib/` -- Renderer infrastructure

| File | Role |
| --- | --- |
| `cfs.ts` | Renderer-side typed proxy for `window.cfs`, plus `safeCfs()` / `hasCfsNamespace()` capability checks. |
| `platform.ts` | Renderer platform/theme hooks through the preload bridge. |
| `use-navigation-guard.ts` | Unsaved-changes navigation guard for the HashRouter app. |
| `cn.ts` | Class-name helper. |
| `electron-restore-client.ts` | Renderer client for interrupted deploy recovery UI. |
| `monaco-setup.ts` | Monaco setup shared by editor surfaces. |

## `apps/desktop/src/pages/` -- pages

The five Phase A-E lighthouse pages are directory-based:

```text
<Page>/
├─ index.tsx
├─ state/             # hooks + tests
├─ components/        # optional memoized sub-components
└─ helpers.tsx        # optional pure render helpers
```

| Page directory | State/hooks | Components |
| --- | --- | --- |
| `ManifestEditor/` | `useManifestEditorState`, `useDeployFlow`, `useDocsModal` (+ tests) | `ComplianceTable`, `DeployResultPanel`, `DocsModal`, `ManifestContent`, `ManifestHeader`, `ResourceEditDialog` |
| `Manifests/` | `useManifestList`, `useFlashMessage`, `useBulkSelection` (+ tests) | none extracted yet |
| `ManifestNew/` | `useNewManifestForm` (+ tests) | none extracted yet |
| `Library/` | `useLibraryFilters` (+ tests) | none extracted yet |
| `Diff/` | `useDiffMatrix` (+ tests) | `CisDiffTab`; other panels remain in `index.tsx` |

Other current page files are still flat files: `Home.tsx` (Dashboard), `Compliance.tsx` (Validation), `CisCatalog.tsx` (CIS Mapping), `Settings.tsx`, `ManifestAuditPack.tsx`, `ManifestCompliance.tsx`, `ManifestHistory.tsx`, `ManifestRationale.tsx`, and `NotFound.tsx`.

Routes are wired in `apps/desktop/src/App.tsx`; sidebar labels are wired in `apps/desktop/src/components/Sidebar.tsx`.

## `apps/desktop/src/components/` -- Shared sub-components

| File | Role |
| --- | --- |
| `manifest-editor.tsx` | Monaco-based YAML/JSON editor + inline validator. Validates against `data/osc-manifest-schema.json` (Monaco JSON mode) AND a custom inline validator that's tighter (e.g. enforces `keyPath` + `valueName` + `valueType` for Registry resources). |
| `resource-picker.tsx` | Visual builder for the YAML/JSON/Visual tabs in ManifestEditor / ManifestNew. |
| `diff-viewer.tsx` | Pairwise diff component used by the Diff page. |
| `ai-analysis-panel.tsx` | AI changelog generation panel (Diff page). |
| `conflict-detector.tsx` | AI-driven conflict detection across selected manifests. |
| `HealthIndicator.tsx` | Footer pill: 🟢/🟠/🔴/⚪ states. Clickable amber opens `CliRequiredModal`. |
| `WelcomeDialog.tsx` | First-run two-card welcome. Persists dismissal via `localStorage['cfs.welcome.dismissedAt']`. |
| `CliRequiredModal.tsx` | Shared install dialog opened by Manifests / ManifestEditor / Layout / WelcomeDialog when `oscfg` is missing. |
| `Layout.tsx` | Top-level layout: sidebar, header, footer, route outlet. Wires HealthIndicator.onInstallClick → CliRequiredModal. |
| `ExternalLink.tsx` | Anchor wrapper that routes through `cfs.shell.openExternal()` so external URLs open in the user's default browser. |
| `AuditProgressCounter.tsx` | Stable-width progress counter for audit operations. Uses monospace digit rendering to prevent layout shift as numbers increment. |
| `Breadcrumb.tsx` | Breadcrumb navigation component. Renders the current page path as clickable segments for quick navigation between parent views. |

## `packages/core/src/handlers/` -- Pure handler functions

Single source of truth for business logic. Each handler is a pure function called from `apps/desktop/electron/ipc-handlers.ts` and directly tested by vitest.

| File | Role |
| --- | --- |
| `index.ts` | Re-exports. |
| `manifests.ts` | List / register / delete manifests. Platform-agnostic register (schema-only); deploy is the platform gate. |
| `deploy.ts` | `runDeploy` (audit + enforce modes). Preflight checks `resolveOscfgBinary()`; throws `cliRequiredError()` if missing. |
| `revert.ts` | `revertManifest`: restore pre-deploy snapshot. Same preflight gate. |
| `health.ts` | `getHealthStatus` + `recheckHealth` (cache-busting reprobe). |
| `import.ts` | File → manifest converter. CSV/TSV/XLSX and JSON security-definition imports both emit Registry resources with all schema-required props (`keyPath` + `valueName` + `valueType`) via `inferRegistryValueType()`. Imports capped at `MAX_IMPORT_BYTES = 10 MB`. |
| `export.ts` | Manifest → YAML/JSON round-trip. |
| `library.ts` | Catalog of bundled baselines. |
| `compliance.ts` | CIS compliance score + per-rule breakdown. |
| `history.ts` | Snapshot store wrappers. |
| `audit-pack.ts` | PDF + markdown audit-pack builder. Uses `escapeMarkdown()` for any user-supplied or AI-generated text (CF-SEC-005/006). |
| `docs.ts`, `docs-write.ts` | Manifest documentation generation/save surfaces. |
| `baseline-csv.ts` | Per-baseline CSV parser. |
| `downloads.ts` | Browser-download surface (filename/MIME negotiation). |
| `rationale.ts`, `rationale-write.ts` | Per-manifest rationale log read/write surfaces. |
| `manifests-status.ts` | Registered/CLI-visible status lookup. |
| `diff-matrix.ts`, `matrix-xlsx.ts` | Matrix diff and XLSX export handlers. |
| `cis-lookup.ts` | Per-resource CIS lookup chain. |
| `cis-bulk-lookup.ts` | Bulk CIS coverage for the Diff page's CIS Diff tab. |
| `cis-status.ts` | CIS data discovery, diagnostics, and cache reset support. |
| `settings.ts` | `~/.configforge/settings.json` preferences, atomic writes, retention resolution. |
| `activity.ts` | Recent activity feed. |
| `compliance-report.ts` | Compliance report handler. |
| `system-config.ts` | System configuration summaries for manifests. |
| `drift.ts`, `scenarios.ts` | Retired/unavailable compatibility surfaces. |
| `errors.ts` | `HandlerError` with `code` field. `cliRequiredError()` factory (status 412, code `CLI_REQUIRED`). `isCliMissingMessage()` substring detector. |
| `contract.ts` | Shared request/response types. |

## `packages/core/src/oscfg/` -- Single CLI choke-point

`runOscfg()` in `runner.ts` is the operational CLI spawn path. `binary.ts` uses `spawnSync` only for discovery/version probes; handlers and renderer code do not spawn `oscfg` directly.

| File | Role |
| --- | --- |
| `index.ts` | Re-exports. |
| `runner.ts` | Bounded worker queue (MAX_CONCURRENT_SPAWNS = 4), preamble scrubbing, translated errors, stdin-EOF management. |
| `binary.ts` | Resolves `oscfg` from `OSCFG_BIN` env, well-known install paths, PATH, WindowsApps alias, MSIX (`Get-AppxPackage`), and the dev-only `resources/oscfg/<plat>/` drop. |
| `apply.ts` | `oscfg apply` wrapper. |
| `get.ts` | `oscfg get namespace` / `get resource -n <ns>`. |
| `exec.ts` | `oscfg exec resource --mode ...` wrapper for direct provider reads. |
| `manage.ts` | Namespace/resource deletion helpers. |
| `registered-types.ts` | Whitelist of resource types accepted by the targeted CLI version (`OSCFG_CLI_VERSION = '1.3.9-preview11'`). Types missing from the list trigger a soft warning at register time; the manifest still registers. |
| `registry-types.ts` | Registry `valueType` mapping (`Dword`, `String`, …). |
| `registry.ts` | Registry resource specifics. |
| `compliance.ts` | Decides `compliant` / `non-compliant` / `indeterminate` from CLI output. |
| `naming.ts` | `isValidNamespace`: refuses path-traversal, control chars. |
| `format.ts` | Pretty-prints CLI output for the UI. |
| `concurrency.ts` | Per-namespace mutex. |

## `packages/core/src/ai/` -- AI guardrails

| File | Role |
| --- | --- |
| `analyzer.ts` | The actual AI call surface. `analyzeDiff`, `generateChangelog`, `renderChangelogMarkdown`. Output is tagged via `tagAsAiGenerated` before it leaves the system. |
| `provenance.ts` | `AiSource` + `Provenance` types, `normalizeUrl` (strips utm_*, etc.), `dedupeSources`, `computeCitationCoverage`, `decorateWithProvenance`. |
| `circular-guard.ts` | `tagAsAiGenerated` / `isAiGenerated` / `assertNotAiGenerated` / `stripAiMarker`. **Spoof-resistant** (CF-SEC-007) via an in-process content-hash registry (FNV-1a 64-bit, browser-safe) in addition to the inline `<!-- ai-generated:rev=N -->` marker. Pure JS hash, no `crypto` import, so the module is safe to pull into the renderer bundle. |

## `packages/core/src/markdown/` -- Output escaping

| File | Role |
| --- | --- |
| `escape.ts` | `escapeMarkdown(text)`: escapes `<`, `>`, `&`, etc. so user-supplied or AI-generated content rendered as markdown can't inject HTML / script (CF-SEC-005/006). |

## `packages/core/src/manifest/` -- Registration metadata

| File | Role |
| --- | --- |
| `rationale-store.ts` | Per-manifest JSONL rationale log. |
| `audit-results-store.ts` | Per-manifest audit-result store. |

## `packages/core/src/history/` -- Snapshot store

| File | Role |
| --- | --- |
| `index.ts` | `saveSnapshot` / `createSnapshot`, `listSnapshots`, `getSnapshot`. Dedupe + retention sweep. |
| `restore.ts` | Pre-restore snapshot + replay. |
| `author.ts` | `resolveAuthor()`: env → git → OS user → `unknown`. |

## `packages/core/src/diff/` -- Pairwise + matrix

| File | Role |
| --- | --- |
| `matrix.ts` | N-way matrix builder. |
| `xlsx-builder.ts` | Excel export. |

## `packages/core/src/audit-pack/` -- Auditor deliverable

| File | Role |
| --- | --- |
| `index.ts` | PDF builder. Streams to a `Readable`. |
| `sections.ts` | One function per section: header, compliance, history, rationale, citations, footer. |
| `markdown.ts` | Markdown emitter. Uses `escapeMarkdown()` for user-supplied text. |
| `rationale-loader.ts` | Loads + filters per-manifest rationale entries for the pack. |

## `packages/core/src/cis/` -- Microsoft/CIS cross-reference

> The data files this module reads are **not** bundled in the repo or
> installer (license restrictions). Users drop their own legally
> licensed CIS benchmark files into the data directory at runtime.
> Loaders return `null` when files are absent and the UI hides every
> CIS surface.

| File | Role |
| --- | --- |
| `data.ts` | Loads user-supplied JSON catalogs from the CIS data directory. Returns `null` on `ENOENT`. |
| `crossref.ts` | Strict-name match + property-mapping fallback. |
| `compliance.ts` | `{matched, mismatched, missing, score}`. |
| `xccdf-parser.ts` | XCCDF + OVAL XML parser. Uses `fast-xml-parser` to extract benchmark metadata, check definitions, and rule-to-control mappings from user-supplied XML files. Second tier of the three-tier CIS lookup chain. |
| `azure-policy-cis.ts` | Azure Policy CIS JSON parser. Matches CIS rule IDs to Azure Policy display names for compliance alignment. Third tier of the lookup chain. |

## `packages/core/src/system/` -- OS dispatch

| File | Role |
| --- | --- |
| `index.ts` | `getSystemInfo`: memoized for the process lifetime. |
| `windows.ts` | PowerShell calls for admin check, server type, OS version. |
| `linux.ts` | Bash calls for the same. |
| `types.ts` | Shared shape. |

## `packages/core/src/import-export/`

| File | Role |
| --- | --- |
| `index.ts` | YAML / JSON round-trips + `parseExcelBaseline` for CSV/TSV/XLSX import. |
