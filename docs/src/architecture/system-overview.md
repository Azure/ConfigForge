# System overview

ConfigForge **0.3.96** is an Electron desktop app for authoring, validating, comparing, and deploying/auditing OSConfig manifests (`.osc.yaml`). The renderer uses Electron 42, React 18, Fluent UI v9, and Vite; shared business logic lives in the platform-neutral `@configforge/core` package.

There is no HTTP server, database, queue, or microservice layer in the current app. Renderer code calls the Electron preload bridge (`window.cfs.*`), the main process validates IPC payloads, and pure handlers in `packages/core` own filesystem and CLI operations.

## Top-level layers

| Layer | Where | Purpose |
| --- | --- | --- |
| **Renderer** | `apps/desktop/src/` | React pages, forms, sidebar navigation, manifest editor, diff/matrix/CIS UI. Sandboxed; no Node access. |
| **Preload bridge** | `apps/desktop/electron/preload.ts` | Exposes the typed `window.cfs.*` API and wraps `ipcRenderer.invoke`. |
| **Electron main** | `apps/desktop/electron/` | BrowserWindow lifecycle, IPC channel registration, per-channel payload validation, navigation lockdown, custom protocol handling. |
| **Core handlers** | `packages/core/src/handlers/` | Pure handler functions used by IPC and tests. They validate requests, read/write app state, and call core helper modules. |
| **CLI wrapper** | `packages/core/src/oscfg/` | Single operational choke point for the upstream Microsoft OSConfig CLI (`oscfg`). |

## Choke points

| Concern | Module |
| --- | --- |
| `oscfg` operational spawns | `packages/core/src/oscfg/runner.ts` via `runOscfg()` |
| `oscfg` binary discovery | `packages/core/src/oscfg/binary.ts` |
| OS/admin detection | `packages/core/src/system/index.ts` |
| Manifest schema/platform checks | `packages/core/src/platform.ts` |
| Registration metadata and source YAML | `packages/core/src/oscfg/registry.ts` |
| Version-history snapshots | `packages/core/src/history/index.ts` |
| Settings | `packages/core/src/handlers/settings.ts` |
| CIS data path resolution | `packages/core/src/cis/data.ts` via `resolvePublicAsset('_baselines/cis/_data')` |

## State on disk

Runtime state lives under `~/.configforge/` by default. Tests can override this with `CONFIGFORGE_HOME`.

```text
~/.configforge/
├── manifests/
│   ├── <ns>.json              ← registration metadata
│   └── <ns>.source.yaml       ← lossless source manifest
├── history/<ns>/
│   ├── <snapshot-id>.osc.yaml
│   └── <snapshot-id>.osc.yaml.meta
├── rationale/<ns>.jsonl
├── audit-results/<ns>.json
├── snapshots/
│   ├── <ns>.pre-deploy.json
│   ├── <ns>.pre-deploy-<timestamp>.json
│   └── <ns>.deploy-in-progress
└── settings.json
```

Renderer-only preferences, such as welcome-dialog dismissal and theme choices, stay in browser storage.

## CLI invariants

- Exit-code-driven. `0 = success`, non-zero = failure.
- Preamble scrubbing: the preview CLI emits a multi-line telemetry banner before real output; `runner.ts` strips it.
- Stdout/stderr are captured verbatim.
- Concurrency cap of `MAX_CONCURRENT_SPAWNS = 4`.
- stdin always closed to prevent Windows child-process hangs.
- BYO-CLI: the binary is not bundled in installers.

See [`oscfg` CLI contract](./oscfg-cli.md) for the full guarantee.

## Request lifecycle

A typical "register a manifest" call flows like this:

1. Renderer calls `window.cfs.manifests.register({ name, content })`.
2. Preload invokes `ipcRenderer.invoke('cfs:manifests:register', payload)`.
3. Main validates the payload with `validateRegisterManifestRequest()`.
4. Main calls `registerManifest()` from `@configforge/core/handlers`.
5. Core normalizes JSON/YAML input, validates `resources:`, and detects platform with `detectManifestPlatform()`.
6. `saveRegistration()` writes `<ns>.source.yaml` and `<ns>.json` through temp-file + rename writes under a per-namespace mutex.
7. `createSnapshot()` writes a best-effort history snapshot.
8. The handler returns `{ namespace, platform, warnings }` through the IPC channel.

Registration does **not** call `oscfg apply`.

## Sidebar navigation

The sidebar is defined in `apps/desktop/src/components/Sidebar.tsx` and exposes seven top-level pages:

1. **Dashboard** (`/`, `HomePage`)
2. **My Baselines** (`/manifests`)
3. **Microsoft Baselines** (`/library`)
4. **Export Readiness** (`/compliance`, `CompliancePage`)
5. **Diff** (`/diff`)
6. **Benchmark Mapping** (`/cis`, `CisCatalogPage`)
7. **Settings** (`/settings`)

The Diff page has Pairwise, Matrix (N-way), and CIS Diff tabs. The CIS Diff tab is shown when CIS data is available.

## CIS cross-reference system

CIS lookup uses user-supplied data from the resolved CIS data directory:

- Dev: `<repo>/public/_baselines/cis/_data/`
- Packaged app: `<process.resourcesPath>/public-assets/_baselines/cis/_data/`

Lookup uses legacy JSON catalogs, XCCDF + OVAL XML, and Azure Policy CIS JSON. The bulk CIS Diff handler (`handlers/cis-bulk-lookup.ts`) prefers XCCDF when available. For Azure Policy fallback, Linux benchmarks use `linuxFuzzyMatch(buildLinuxResourceTokens(resource))`; Windows CSP resources use CSP-prefix stripping plus exact word-overlap at a `0.8` threshold.

## Settings and deploy recovery

Settings are persisted in `~/.configforge/settings.json` by `packages/core/src/handlers/settings.ts`.

Before enforce-mode deploy, `handlers/deploy.ts` writes a pre-deploy snapshot under `~/.configforge/snapshots/` and then writes `<ns>.deploy-in-progress` before `oscfg apply`. A surviving sentinel on next launch indicates an interrupted deploy that may need audit/revert follow-up.

## What's not in scope

- No HTTP server. No `fetch()` between layers, only IPC.
- No database. No SQL, no migrations, no ORMs.
- No message bus. Long operations are foreground; the UI shows progress.
- No renderer-side logger wrapper yet.
- No multi-tenant story. State is user-local.
