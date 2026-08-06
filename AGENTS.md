# AGENTS.md: ConfigForge

Instructions for AI coding agents (GitHub Copilot CLI, Claude Code, Cursor, etc.) working on this repository. Human contributors: see `README.md` and [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Project in one paragraph

ConfigForge is an Electron 42 + React 18 + FluentUI v9 desktop app for authoring, validating, comparing, and (when the CLI is installed) deploying / auditing OSConfig security baseline manifests. **Two parallel flavors:**

- **`main` branch** — Windows + Linux full build with deploy, elevation, health probe, audit-results store.
- **`mac-author-build` branch** — macOS author-only flavor. It includes authoring, validation, Microsoft Baselines, Diff, Benchmark Mapping, history, rationale, and Audit Pack export. It excludes device operations and their preload namespaces.

The renderer is built with Vite and routes through a typed IPC bridge (`window.cfs.*`) to a Node main process. The same pure handlers in `packages/core/src/handlers/` power Electron IPC; the Next.js host was retired in Phase 10. Any reference to `src/app/api/` or `Microsoft.OSConfig` PowerShell modules in older commits is **historical**.

### Current repository snapshot

The following release references were verified on 2026-08-06:

| Line | Reference | State |
|---|---|---|
| `main` | `v0.3.99` | Current Windows/Linux release. It verifies Enforce results, preserves exact QWords, keeps Revert safe, repairs WS2022 readability, and adds Machine Configuration Set compatibility. |
| `mac-author-build` | `mac-v0.3.98-author.1` | Current author-only macOS tagged source. The matching GitHub release is a draft and unpublished with the same public documentation corrections. |

On `mac-author-build`, the root package, desktop package, and lockfile records
use `0.3.98-author.1`. The current macOS Author tagged source is
`mac-v0.3.98-author.1`, and its matching GitHub release remains a draft and
unpublished. The Full-edition package versions are `0.3.99`; do not copy
macOS package metadata to `main`.

### Current feature inventory

- **Baseline creation:** blank Windows/Linux baseline, starter template,
  in-place Microsoft Baseline selection, public URL, local
  `.osc.yaml`/`.json`/`.csv`, and binary `.xlsx` import.
- **Authoring:** YAML, JSON, and Visual modes; Test and Group preservation;
  typed and lossless spreadsheet edits; exact QWord handling; per-baseline
  Code/Visual preference; read-only guidance; Undo; history; and rationale.
- **Workspace and comparison:** localized My Baselines catalog, local-calendar
  Date Modified values, persistent tabs, unsaved-close/navigation guards, and
  Pairwise/CIS/Matrix Diff. Exactly two selected baselines open Pairwise;
  three through ten open Matrix.
- **Benchmark and evidence:** user-supplied XCCDF, OVAL, OCIL, CPE dictionary,
  and Azure Policy data; CIS cross-reference; and Audit Pack PDF/Markdown
  export. Audit Pack generation is an authoring feature and is available in
  the macOS flavor; device audit is not.
- **PR #76/#77 nested editing:** Enter commits and moves down, final Enter
  appends and focuses a value, Tab commits and moves right, empty arrays become
  focusable, invalid drafts retain focus, and Shift+Enter remains a newline
  for structured values. PR #76 landed on `main`; PR #77 ports the series to
  `mac-author-build`.

### Flavor capability boundary

The author build uses compile-time renderer flags in
`apps/desktop/src/lib/flavor.ts`. Its preload removes these exact namespaces:

- `HAS_DEPLOY=false`: `health`, `deploy`, `deployRecovery`, and `revert`
- `HAS_DEVICE_AUDIT=false`: `auditResults`
- `HAS_ELEVATION=false`: `system` (the elevation methods live under
  `cfs.system`; there is no `cfs.elevation` namespace)

Shared renderer code must use `safeCfs()` or `hasCfsNamespace()` for those
namespaces. Authoring namespaces, including Diff and Audit Pack generation,
remain available.

Targeted upstream CLI version: **`oscfg 1.3.9-preview11`**.

---

## Branches / remote

- **`main`** — active Windows/Linux full-build line. Shared behavior lands here first.
- **`mac-author-build`** — parallel macOS author-only line. Port the specific
  shared commits needed for parity.
- **Remote:** `Azure/ConfigForge`.
- Do not cross-merge `main` and `mac-author-build`. Cherry-pick or manually
  port reviewed shared commits through a branch PR.
- Pull requests and pushes to both active branches run `PR check`
  automatically. Manual dispatch remains available for explicit re-runs:

  ```powershell
  gh workflow run "PR check" --repo Azure/ConfigForge --ref mac-author-build
  ```

### Parallel worktree pattern

When working on both branches in one session, use `git worktree` so you don't lose progress to branch-switch conflicts:

```bash
git worktree add ../configforge-mac mac-author-build
# Now ./ is main and ../configforge-mac is mac-author-build,
# both checked out simultaneously.
```

### Cherry-pick conflict pattern (mac-author-build)

Cherry-picks from `main` to `mac-author-build` almost always conflict on `package.json` + `apps/desktop/package.json` (different version streams) and frequently on `CHANGELOG.md` / `docs/src/changelog.md`. Standard resolution:

1. Keep the macOS branch's package versions unless the PR is the final
   release-preparation change.
2. Reconcile changelogs manually so both branch-specific and shared history
   remain accurate.
3. **Don't blindly take theirs for renderer files.** A main-only import can
   break the author bundle. Restore the macOS file and port only the reviewed
   behavior when the trees differ.

### Release versioning conventions

- Full Windows/Linux releases use package version `X.Y.Z` and tag `vX.Y.Z`.
- macOS Author releases use package version `X.Y.Z-author.N` and tag
  `mac-vX.Y.Z-author.N`.
- The root and desktop `package.json` versions plus matching
  `package-lock.json` records must agree in a release-preparation commit.
  Do not change them in an earlier documentation or feature-port PR.
- The macOS tag must resolve to the exact final validated commit on
  `mac-author-build`. `scripts/ship-mac.ps1` accepts only the `mac-v` form and
  defaults to `Azure/ConfigForge`.
- The `0.3.98-author.1` release contract expects exactly these asset names:

  | Asset | Exact name |
  |---|---|
  | DMG | `ConfigForge-Author-0.3.98-author.1-mac-arm64.dmg` |
  | Blockmap | `ConfigForge-Author-0.3.98-author.1-mac-arm64.dmg.blockmap` |
  | Update metadata | `latest-mac.yml` |
  | CycloneDX SBOM | `sbom-macos-author.cdx.json` |
  | SHA-256 manifest | `SHA256SUMS-macos-author.txt` |

### CI dispatch

- Tag push on `main` → auto-triggers **Release** + **docs** workflows.
- A macOS tag push does **not** auto-trigger a build. Create the matching
  GitHub release as a draft, then dispatch the protected `main` workflow
  definition with the immutable macOS tag as input:

  ```powershell
  gh workflow run "Release (macOS author)" `
    --repo Azure/ConfigForge `
    --ref main `
    -f release_tag=mac-v0.3.98-author.1
  ```

- `--ref main` selects the reviewed workflow definition, not the source to
  package. `release-mac.yml` must check out `release_tag` explicitly and
  verify that `HEAD` resolves to that tag before installing or building.
- Never publish automatically. The GitHub release remains a draft until a
  maintainer explicitly approves publication after asset verification.
- Audit scripts: `scripts/audit-linux-fuzzy.mjs` (Linux SFF coverage diagnostic) and `scripts/audit-windows-xccdf.mjs` (Windows XCCDF coverage diagnostic) — run these after touching anything in `xccdf-parser.ts`, `cis-bulk-lookup.ts`, or `cis-lookup.ts` to verify no regression in either platform's coverage numbers.

---

## How to run anything

```bash
npm ci                          # clean install (use ci not install for PRs)
npm run core:build              # compile packages/core
npm run desktop:dev             # vite + electron, hot-reload
npm run desktop:build           # core + renderer + electron main
npm run desktop:dist            # full installer build (Win/Linux per host)
npm test                        # vitest full suite
npm run lint                    # eslint, apps/desktop (0 errors expected; warnings OK)
npm run format                  # prettier (added v0.2.1; no mass-format run shipped)
npm run format:check            # prettier --check (not gated in CI; advisory)

# mac-author-build only
npm run build:author -w @configforge/desktop
npm run dist:mac:author -w @configforge/desktop  # Apple Silicon host required
```

**Electron launch prerequisite:** `build:renderer` runs Vite with an empty
output directory and removes `apps/desktop/dist/electron/main.js`. Never run
the renderer-only build immediately before launching Electron, Playwright, or
an installer smoke check. Run `npm run desktop:build` so the Electron main and
preload bundles are restored after Vite.

**Windows note:** the preview `oscfg` opens its log file in a protected directory on every invocation, including read-only audits, so Deploy / Audit require an elevated PowerShell session. The in-app footer pill and Settings panel surface this as "admin required."

**npm and lockfile caveats:**

- The committed `package-lock.json` is a public-registry lockfile. Every
  package `resolved` URL must remain on `registry.npmjs.org`; never commit a
  Microsoft-mirror or private-registry URL.
- A Microsoft package mirror may lag the public registry on corporate
  machines. A locally restored `node_modules` tree from that mirror is useful
  for validation but is not authoritative for the public lockfile. GitHub CI
  must run `npm ci` against the committed public lockfile.
- The lockfile carries optional Rollup binaries for Windows and Linux. Do not
  regenerate it on Windows without `--include=optional`; npm issue
  [#4828](https://github.com/npm/cli/issues/4828) can remove the Linux binary
  and break `ubuntu-latest`.
- Use `npm ci` for routine work because it does not rewrite the lockfile. For a
  dependency or version change, preserve optional cross-platform packages and
  inspect every changed `resolved` URL before committing.

---

## Directory map

| Path | Purpose | Rules |
| --- | --- | --- |
| `apps/desktop/src/` | Electron renderer (React + FluentUI v9 + Vite) | UI lives here; route via `apps/desktop/src/App.tsx` |
| `apps/desktop/src/pages/<Page>/` | Lighthouse pages split into directories (Phase A→E) | Each has `index.tsx` (composition), `state/` (hooks + tests), `components/` (memo'd sub-components), optional `helpers.tsx`. See ManifestEditor as the reference example |
| `apps/desktop/src/lib/cfs.ts` | Renderer IPC bridge + `safeCfs()` / `hasCfsNamespace()` capability helpers | Feature-detect the exact author-omitted namespaces: `health`, `deploy`, `deployRecovery`, `revert`, `auditResults`, and `system` |
| `apps/desktop/electron/` | Electron main + preload bridge | Only the preload calls into IPC; main wires handlers |
| `apps/desktop/electron/log.ts` | Typed main-process logger (v0.2.1) | Use `scoped('elevate').info(...)` not `console.info(...)`. Lazy-requires `electron-log`; falls back to console under vitest |
| `apps/desktop/electron/ipc-handlers.ts` | IPC channel registrations | Every channel is a thin wrapper around a `packages/core/handlers/` export |
| `apps/desktop/electron/preload.ts` | `window.cfs.*` API surface | Single contract source for renderer ↔ main |
| `packages/core/src/handlers/` | Pure handler functions | **Single source of truth** for business logic, used by Electron IPC + tests |
| `packages/core/src/handlers/import.ts` | File → manifest converter | CSV/TSV/XLSX and security-definition JSON now emit `valueName` + `inferRegistryValueType(expectedValue)` so the editor's schema validator accepts the result (CSV-import schema fix) |
| `packages/core/src/oscfg/` | CLI wrapper | `runOscfg` is the **single choke point**, never `child_process.spawn('oscfg', …)` from a handler |
| `packages/core/src/handlers/errors.ts` | `HandlerError`, `cliRequiredError()`, `isCliMissingMessage()` | v0.2.0 typed gates; preserve `code: 'CLI_REQUIRED'` semantics |
| `packages/core/src/ai/circular-guard.ts` | AI-content provenance: marker tag + spoof-resistant per-process content-hash registry (FNV-1a 64-bit) | Browser-safe hash (no Node `crypto`). Use `tagAsAiGenerated()` whenever AI output leaves the system. `assertNotAiGenerated()` (refuses marked/hash-matched content) is available but **not currently wired** into the analyzer ingestion path — marking is active, enforcement is not |
| `apps/desktop/src/hooks/useCliPresence.ts` | Renderer hook for CLI install state | Wraps `cfs.health.{check,recheck}` |
| `apps/desktop/src/components/CliRequiredModal.tsx` | Shared install dialog | Single component opened by Manifests, ManifestEditor, Layout, WelcomeDialog |
| `apps/desktop/src/components/WelcomeDialog.tsx` | First-run two-card welcome | Persists dismissal via `localStorage['cfs.welcome.dismissedAt']` |
| `apps/desktop/src/components/HealthIndicator.tsx` | Footer pill | Drives off `useCliPresence`; clickable when amber |
| `apps/desktop/src/pages/ManifestEditor/components/VisualManifestViewer.tsx` | Shared read-only + editable visual table | Inline cell editing, selection/delete, and direct row addition; reused by Baseline Detail and Register New Baseline |
| `apps/desktop/src/pages/ManifestEditor/visual-viewer.ts` | Pure visual projection and mutation helpers | Lossless QWord parsing/dumping, Test/Group source paths, typed cell coercion, add/delete helpers |
| `apps/desktop/src/components/use-rationale-prompt.tsx` | Rationale modal hook + component | `requestSave(beforeYaml, afterYaml)` compares; "before" must come from `savedContent`, NOT `formatCache.current.yaml` |
| `apps/desktop/src/components/use-cis-available.ts` | Renderer cache for CIS data presence | Module-level `_cached` boolean; 3s warmup-deferral on `cfs.cis.warmup()`; invalidate via `_resetCisAvailableCacheForTests()` after recheck |
| `apps/desktop/src/components/conflict-detector.tsx` | Cross-manifest conflict UI | Fixed-height scrollable (max-h 400px); count badge in header |
| `apps/desktop/src/pages/CisCatalog.tsx` | CIS Mapping page (sidebar tab) | Lists detected CIS files, Re-check button (calls `_resetCisAvailableCacheForTests()` after `cfs.cis.recheck()` so Diff tab appears without app restart) |
| `apps/desktop/src/pages/Diff/components/CisDiffTab.tsx` | CIS Diff tab inside `/diff` | Sortable Status column (tri-state); red filled X / green ✓ icons; whitespace-nowrap source badge |
| `packages/core/src/cis/xccdf-parser.ts` | XCCDF + OVAL XML parser (~900 LOC) | Owns `splitPascalCase`, `tokenizeXccdfTitle`, `extractCspPathWords`, `stripCspCategoryPrefix`, `fuzzyMatchXccdfTitle`, `OSCONFIG_USER_RIGHT_ALIASES` (14-entry table), `lookupNonRegistryInXccdf` (two-pass across catalogs) |
| `packages/core/src/cis/azure-policy-cis.ts` | Azure Policy JSON parser | Name-only matching; no registry/CSP paths in JSON |
| `packages/core/src/cis/data.ts` | CIS data dir resolver + lazy-loaders | `getCisDataDir()` is the public path; `clearAllCisDataCaches()` powers the recheck IPC |
| `packages/core/src/handlers/cis-lookup.ts` | 4-step CIS rule lookup (JSON → XCCDF registry → XCCDF non-registry → XCCDF fuzzy → Azure Policy fuzzy with CSP-prefix-strip → **Linux fuzzy for SFF baselines, v0.3.50+**) | Powers the editor drawer |
| `packages/core/src/handlers/cis-bulk-lookup.ts` | Bulk CIS compliance counter | Backs the Diff page's CIS Diff tab. Azure Policy branch (v0.3.43+) uses `stripCspCategoryPrefix` + `extractCspPathWords` for CSP resources. Linux SFF branch (v0.3.50+) uses `linuxFuzzyMatch` + `buildLinuxResourceTokens`. **v0.3.51 fix**: when legacy `lookupCisRule` returns null but `benchmarkMatch` is set, populate `cisMatch` from `benchmarkMatch` so the per-row "CIS Rule" display column matches the top counter
| `packages/core/src/handlers/cis-status.ts` | CIS data discovery + diagnostics | 100x perf fix: 8KB head-read for XCCDF discovery + mtime fingerprint cache |
| `packages/core/src/diff/matrix.ts` | **RENDERER-loaded**: cross-baseline matrix + value canonicalization | DUPLICATE helpers from `cis/xccdf-parser.ts`, never import. Owns `normalizeKeyPath` (HKLM ↔ HKEY_LOCAL_MACHINE), `extractNameWords` (strips 17 category prefixes), `mergeRowsByWordSetOverlap` (Jaccard ≥0.75 or intersection ≥4 + Jaccard ≥0.55), and `canonicalize()` (booleans, empty arrays, numerics, **Windows paths via `normalizePathLike`**) |
| `resources/oscfg/<platform>-x64/` | **Dev-only convenience drop** for contributors who bring their own binary | **Never shipped to users.** No `extraResources` entry in `electron-builder.yml` |
| `public/_baselines/` | Microsoft-authored OSConfig baselines (Defender, LAPS, Secured Core, WS2016-25 variants, Linux SFF); user-supplied CIS data is kept in an excluded subdirectory | Microsoft-authored `.osc.yaml` and `.csv` files ship via `extraResources`. **Note:** the Windows SSH baseline (`ssh.osc.yaml` / `ssh.csv`) was removed in v0.3.52 |
| `public/_baselines/cis/_data/` | **User-supplied** CIS data (XCCDF + OVAL + Azure Policy JSON) | NEVER commit or package (CIS license). `.gitignore` excludes the directory, and the public-package guard blocks CIS assets |
| `~/.configforge/` | User-scoped runtime state (manifests, history, rationale, audit-results) | Never write from tests |
| `scripts/verify-no-cli-binary.sh` | Manual belt-and-suspenders release check | Available for manual verification that no `oscfg*` file appears under `apps/desktop/release/`; not currently invoked by CI |
| `scripts/verify-public-package-assets.mjs` | Dependency-free public packaging guard | Wired into PR checks, release workflows, and desktop `dist*` scripts; fails if CIS benchmark files could enter public assets, CIS `extraResources` filters are unsafe, or package-lock URLs use a non-public registry host |
| `scripts/capture-screenshots.mjs` | Playwright-electron README screenshot capture | Requires `npm run desktop:build` first. Uses `playwright._electron.launch()` with the Node `require` resolved electron binary |
| `scripts/ship-mac.ps1` | One-command mac release helper | Creates draft GitHub release + dispatches `release-mac.yml` |

Retired surfaces — do **not** re-introduce:

- `src/app/api/` / `src/lib/oscfg/` (Next.js era; deleted in Phase 10 cutover).
- `/api/scenarios` (returned `501`); catalog keeps `scenarioName` as metadata only.
- `/api/drift` (removed entirely).
- `Microsoft.OSConfig` PowerShell module and any cmdlet from it.
- Bundling the `oscfg` binary in installers (removed in v0.2.0 Phase A).
- Treating `Unsupported resource type` as a hard failure — it's a soft warning.

---

## Page-split convention (Phase A→E pattern)

All five lighthouse pages now live in subdirectories. When extending one, follow the established pattern:

```
apps/desktop/src/pages/<PageName>/
├─ index.tsx                # JSX composition + page-level state
├─ helpers.tsx              # pure render helpers (optional)
├─ state/
│  ├─ use<X>.ts             # custom hooks: state + effects + derived values
│  ├─ use<X>.test.ts        # vitest covers race-guards, timer cleanup, etc.
│  └─ ...
└─ components/
   ├─ <SubComponent>.tsx    # React.memo'd visual sub-components
   └─ ...
```

Reference implementations (most → least mature):

| Page | Hooks (tests) | Sub-components |
| --- | --- | --- |
| `ManifestEditor/` | `useManifestEditorState` (13), `useDeployFlow` (11) | `AddSettingsPane`, `ComplianceTable`, `DeployResultPanel`, `ManifestContent`, `ManifestDetailFooter`, `ManifestHeader`, `VisualManifestViewer` |
| `Diff/` | `useDiffMatrix` (9, includes race-guard regression) | `CisDiffTab` (CIS Diff tab inside /diff), plus inline `ResourceChangesPanel` and `ResourceChangesSection` (module-scope hoist for stable identity across expand/collapse) |
| `Manifests/` | `useManifestList` (6), `useFlashMessage` (5), `useBulkSelection` (6) | (visual extraction queued) |
| `ManifestNew/` | `useNewManifestForm` (14) | (visual extraction queued) |
| `Library/` | `useLibraryFilters` (6) | (visual extraction queued) |
| `CisCatalog/` | (no hooks — single-purpose page) | (no extraction needed) |

**Hook-first, tests-before-visual extraction** — this is non-negotiable for the regression-prone hooks. Race-guards (`fetchToken`, `deployJobIdRef`, `listTokenRef`, `matrixLoadTokenRef`), timer cleanup (`docsCopiedTimerRef`, `timersRef`), and selection invariants (`removeFromSelection` ghost-selection fix) have all bitten production previously. Every change to one of those must include or extend the corresponding hook test.

---

## v0.2.0 bring-your-own-CLI contract

Architecturally the most important addition since the Electron migration. Agents touching UI / IPC / handlers must understand it.

### Renderer flow

```
useCliPresence()                       // installed | loading | error | version | health | recheck
   │
   ├── HealthIndicator (footer)        // 🟢/🟠/🔴/⚪ pill; clickable amber opens modal
   ├── Layout                          // wires HealthIndicator.onInstallClick → CliRequiredModal
   ├── WelcomeDialog                   // first-run; "Author + deploy" opens CliRequiredModal
   └── pages/{Manifests,ManifestEditor}.handle{Deploy,Revert}
                                       // preflight: if !installed, open CliRequiredModal
```

### Handler flow

```
runDeploy / revertManifest             // preflight checks resolveOscfgBinary()
   │
   ├── on missing → throw cliRequiredError() (status 412, code 'CLI_REQUIRED')
   └── otherwise → runOscfg (via applyManifest, getResources, etc.)
```

### IPC envelope

```
{ ok: false, status: 412, error: '…', code: 'CLI_REQUIRED' }
   │
   └── preload `call<T>` re-throws as Error with `.status` + `.code`
```

When adding a new CLI-gated handler, either:

1. Add the preflight pattern at the top of the handler (preferred — fails fast, never spawns), or
2. Catch `OscfgResult.success === false` with `isCliMissingMessage(err)` → throw `cliRequiredError()`.

---

## CLI contract (things `runOscfg` guarantees)

- **Exit-code driven.** `0` = success, non-zero = failure. Stdout/stderr captured verbatim; we do not parse free-form human text as if it were JSON.
- **Preamble scrubbing.** The preview CLI emits a telemetry / privacy banner on stdout before the real payload; `runner.ts` strips it.
- **Concurrency cap.** `MAX_CONCURRENT_SPAWNS = 4` to avoid the 60s timeout storm we hit on bulk audits when Defender + DLL contention spiked on Windows.
- **stdin always closed.** Prevents the Windows-only "child waits for stdin EOF" hang that produced consistent 60s deploys from the Next.js spawn pipeline.
- **Admin surfacing.** `getHealthStatus()` reports `adminBlocked` and the resolved binary path + source (`env` / `path` / `bundled` / `installed` / `msix`). `bundled` is reachable only on dev boxes with a binary dropped into `resources/oscfg/<plat>/`.
- **Translated errors.** Known failure modes (`oscfg requires Administrator privileges`, `Policy CSP 0x82F00009`) are rewritten in `runner.translateKnownErrors` to actionable text.

---

## Registration semantics

**Register is platform-agnostic. Deploy / Audit are the platform gates.**

- `POST cfs:manifests:register` — schema-only validation. Any manifest with a valid `resources:` array is accepted. Persists source YAML + `resourceSummary` + detected platform to `~/.configforge/manifests/<ns>.json`. **Never** calls `oscfg apply`.
- **Hard blocks (400):** schema errors only.
- **Soft warnings (registered but `warnings[]` populated):**
  - Manifest platform doesn't match host platform.
  - Manifest has `'mixed'` platform (Windows + Linux types).
  - Manifest uses types unknown to this host's `oscfg` install (only surfaced when the manifest targets this host).
- **`cfs:deploy:run`** enforces the real gates: CLI present (v0.2.0 preflight), admin on Windows, host platform matches manifest platform. `'mixed'` is always rejected.

### Fast-path list enrichment

`cfs:manifests:list` unions `oscfg get namespace` (CLI-visible) with `listRegistrations()` (disk). For every registered namespace we use `resourceSummary` from JSON — **zero CLI spawns** on the hot list path. Wrapped in a race-guard (`listTokenRef`) so rapid Refresh clicks don't get stale results.

---

## Manifest schema (oscfg 1.3.9-preview11)

```yaml
resources:                       # REQUIRED, top-level ARRAY
  - name: <string>               # REQUIRED
    type: <string>               # REQUIRED, slash-notation
    properties: { ... }          # OPTIONAL, per-type
```

Whitelist of registered types lives in `packages/core/src/oscfg/registered-types.ts`. When the bundled binary is upgraded:

1. Re-probe with `scripts/probe-types.ps1`.
2. Update `REGISTERED_WINDOWS_TYPES` / `REGISTERED_LINUX_TYPES`.
3. Bump `OSCFG_CLI_VERSION` to match.

Unknown types trigger a soft warning at register time. Never a 400.

### Registry resource requirements

`Microsoft.Windows/Registry` resources must declare **all three** of `keyPath`, `valueName`, and `valueType` (see `apps/desktop/src/data/osc-manifest-schema.json`). The current upstream microsoft/osconfig `schema/.document.json` and published Registry examples use canonical `REG_*` names:

- `REG_SZ` / `REG_EXPAND_SZ` / `REG_BINARY` → string value
- `REG_DWORD` / `REG_QWORD` → integer value
- `REG_MULTI_SZ` → string-array value

The CSV / security-definition import (`packages/core/src/handlers/import.ts`) infers `valueType` from `expectedValue` via `inferRegistryValueType()` — DWORD-range integers → `REG_DWORD`, larger exact integers → `REG_QWORD`, everything else → `REG_SZ`. Compatibility aliases such as `Dword`, `QWord`, `String`, and `MultiString` are accepted as input but normalized to the upstream `REG_*` provider forms before direct execution or apply. Adding new import sources? Re-use that helper.

Repository-wide baseline guards should import `canonicalizeRegistryValueType()` and `normalizeRegistryKeyPath()` from `@configforge/core/oscfg`. Compare each source value with the helper result to detect legacy aliases or colon-less recognized hives without rewriting baseline files.

---

## Security audit (CF-SEC-001 through 015) — all closed

The full 15-finding audit landed in v0.2.0 → v0.2.1. Don't regress any of these:

| ID | What was done |
| --- | --- |
| CF-SEC-001 | File:// navigation lockdown via `navigation-guard.ts` |
| CF-SEC-002 | IPC payload validators on every channel (`ipc-validators.ts`) |
| CF-SEC-003 | Import payload size cap (10 MB) |
| CF-SEC-005/006 | Markdown HTML escape (`packages/core/src/markdown/escape.ts`) |
| CF-SEC-007 | AI-content marker + spoof-resistant per-process hash registry (FNV-1a 64-bit, browser-safe) |
| CF-SEC-008 | Dev-signing docs warn about non-secret throwaway password; runtime banner on the cert generator |
| CF-SEC-009 | mdbook-mermaid checksum pinning |
| CF-SEC-010 | SHA256SUMS published per platform for download integrity. (Signing gate removed — artifacts are unsigned by design; see "Code signing".) |
| CF-SEC-011 | Release tooling pinned via `npx --no-install` |
| CF-SEC-012 | CycloneDX SBOM generated per platform + uploaded to release artifacts |
| CF-SEC-013 | Postinstall script audited |
| CF-SEC-014 | `npm audit --omit=dev --audit-level=high` gate in release workflow; `electron` + `electron-builder` pinned with tilde (`~`) instead of caret (`^`) |
| CF-SEC-015 | `safeCfs(key)` + `hasCfsNamespace(key)` helpers for flavor-conditional renderer code; the author preload omits `health`, `deploy`, `deployRecovery`, `revert`, `auditResults`, and `system` |

If you add a new preload namespace that's flavor-conditional, document it on `cfs.ts` and update any renderer call sites to use `safeCfs()`.

---

## Filing upstream bugs

Report reproducible `oscfg` CLI problems through
[ConfigForge GitHub Issues](https://github.com/Azure/ConfigForge/issues).
Include the CLI version, operating system, exact command, minimal manifest,
logs, and expected versus actual behavior. Maintainers will triage whether the
problem belongs to ConfigForge or the upstream CLI.

---

## Testing & validation expectations

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full test-gate protocol. Minimum bar before opening a PR:

1. `node scripts/verify-public-package-assets.mjs` and
   `node --test scripts/verify-public-package-assets.node-test.mjs` pass.
2. Run the smallest focused Vitest selection that covers the change.
3. `npm test` — the full Vitest suite passes on the active branch.
4. `npm run lint` — 0 errors. Tracked `max-lines`,
   `max-lines-per-function`, and `complexity` warnings are non-blocking.
5. `npm run desktop:build` — clean. This catches renderer-bundling errors
   that Vitest alone misses.
6. `npm audit --omit=dev --audit-level=high` — zero high or critical
   production findings.
7. `node scripts/review-locales.mjs` after locale-bearing changes — zero
   placeholder, glossary, and plural issues.
8. Sweep product code for the banned legacy strings `Drop the oscfg binary`
   and `place the binary in resources/oscfg`. Test fixtures may contain them
   only as negative assertions.

When touching IPC contracts or `packages/core/src/handlers/`, exercise the channel against the live `oscfg` binary in an elevated shell on Windows. CI's Linux side is currently unverified end-to-end (no Linux runner with `oscfg` installed); flag any change that's likely to behave differently on Linux.

### Current validation evidence

- PR #75 at `3086ef0` passed 1,584 Vitest tests in 117 files, lint with
  0 errors, the desktop build, and locale review with 0 placeholder, glossary,
  or plural issues.
- PR #76 at `278dad6` passed 32 focused Visual Manifest Viewer tests, the full
  Vitest suite, lint with 0 errors, the desktop build, and a production audit
  with 0 vulnerabilities.
- PR #77 at `aec0775` ported all five PR #76 commits and passed 79 focused
  Manifest Editor tests, two isolated Playwright scenarios, lint with 0
  errors, the desktop build, and a production audit with 0 vulnerabilities.
- Historical `0.3.93-author.1` and `0.3.93-author.2` validation records are
  superseded; their tags/releases no longer exist. Use the current
  `mac-v0.3.98-author.1` unpublished draft release metadata and current GitHub
  checks as the authority for macOS Author build and asset status.
- The current macOS Author tagged source is `mac-v0.3.98-author.1`, with an
  unpublished draft release. Use current GitHub checks and release metadata
  as the authority for build and asset status rather than recording a merge
  SHA or workflow run here.

---

## Coding conventions

- **TypeScript strict mode** is on; don't silence it with `any` unless there's a comment explaining why.
- No new dependencies without a line in the PR description explaining the need.
- `async`/`await`, not raw promises.
- **Main-process logging:** use `scoped('module').info/warn/error/debug` from `apps/desktop/electron/log.ts`. Migrate any `console.*` you touch. The wrapper redacts common secret-key patterns (`CSC_KEY_PASSWORD`, `GH_TOKEN`, etc.) before emitting.
- **Renderer logging:** still `console.*` for now (no renderer-side wrapper yet).
- HTML in API responses must be escaped; the UI renders warnings and errors as plain text.
- Renderer uses FluentUI v9 for primitives, Tailwind utility classes for layout. Match existing patterns; don't introduce a new design system.
- **Hash anything in `@configforge/core` with a browser-safe primitive.** The core package is pulled into the renderer bundle via Vite. `import { createHash } from 'crypto'` will break the build — use the FNV-1a pattern in `circular-guard.ts` or add an explicit Node-only escape hatch.

Commits follow the existing short imperative style (see `git log`). When working as an AI agent, include the trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

---

## Localization (i18n)

The desktop app uses `react-i18next`. English is the source language; FR / DE / ES are machine-translated and pending human linguistic review. Do not duplicate the full locale docs here.

Reference docs:

- Contributor workflow: [`apps/desktop/src/locales/README.md`](./apps/desktop/src/locales/README.md).
- Translation review: [`apps/desktop/src/locales/REVIEW.md`](./apps/desktop/src/locales/REVIEW.md).
- Visual overflow QA: [`apps/desktop/src/locales/VISUAL-QA.md`](./apps/desktop/src/locales/VISUAL-QA.md).
- Rollout history: [`CHANGELOG.md`](./CHANGELOG.md) entries v0.3.54-v0.3.61.

**Architecture in one breath:** `apps/desktop/src/lib/locale.ts` mirrors `useThemePreference`; `apps/desktop/src/locales/index.ts` eager-globs JSON catalogs at build time; Settings → Language is `apps/desktop/src/pages/Settings.tsx::LanguageSection`; `apps/desktop/src/main.tsx` catches i18n init failures so the app still boots.

When adding user-visible strings:

1. Pick the right namespace: `common`, `sidebar`, `settings`, `home`, `manifests`, `manifest-editor`, `diff`, `history`, `compliance`, `cis-catalog`, `audit-pack`, `welcome`, or `dialogs`.
2. Add the key + EN value to `apps/desktop/src/locales/en/<namespace>.json`. Alphabetize within nesting groups. Prefer nested objects (`section.sectionTitle`, `section.options.foo`) and lowercase-with-hyphens for multi-word keys.
3. Consume with `const { t } = useTranslation('<namespace>')` then `t('section.key')`. For multiple namespaces, use `useTranslation(['ns1', 'ns2'])` and `t('ns2:key')`.
4. Interpolate with `t('foo', { name: 'Amir' })` and values like `Hello {{name}}`. Keep `{{name}}` placeholders intact.
5. Pluralize with i18next `_one` / `_other` suffixes.
6. Format dates / numbers via `apps/desktop/src/lib/format.ts` hooks (`useDateFormatter`, `useNumberFormatter`, `useRelativeTimeFormatter`) — not `toLocaleString()`.
7. Do not translate FR / DE / ES by hand. Run `scripts/translate-locales.mjs` (Azure Translator / DeepL / manual CSV adapters); placeholders and glossary terms are preserved there.
8. After adding strings, run `node scripts/review-locales.mjs` and verify placeholder integrity is clean.

Hard carve-outs — do NOT translate:

- Manifest YAML / source text.
- OSConfig CLI output.
- `packages/core` error messages.
- CIS rule titles and rule IDs.
- Baseline filenames.
- Audit-pack PDF export contents; it stays English for auditors.
- Brand names: ConfigForge, Azure Local, OSConfig, ALDO.
- Keyboard shortcuts (`Ctrl+S`, etc.).
- `localStorage` keys.
- Telemetry event names.
- Version numbers.
- Schema validation stock messages.
- Monaco editor chrome: find / replace, suggestions, parameter hints.

Kill-switch / revert policy: if a localization change breaks app boot, Settings, or tests, revert it with `git revert <commit>`. The localization Waves shipped as atomic v0.3.54-v0.3.61 commits for this reason. Stuck preference recovery: `localStorage.removeItem('configforge-locale')`.

Maintainer-only follow-up — agents should not auto-complete it:

- Review machine translations per [`apps/desktop/src/locales/REVIEW.md`](./apps/desktop/src/locales/REVIEW.md).
- Run the per-locale visual QA pass, especially German; see [`apps/desktop/src/locales/VISUAL-QA.md`](./apps/desktop/src/locales/VISUAL-QA.md) for the 30 flagged length-overflow risks.

---

## CI minute budget

The repo runs on private-repo Actions minutes. **Each PR check costs ~17 min** (lint + vitest + Playwright on ubuntu, ~+5 min on windows for E2E). Be intentional:

- **Batch commits per phase per push** — one CI run per phase, not per individual file change.
- **Run lint + vitest + build locally before pushing** — these reproduce ~95% of what CI checks. Only Playwright E2E is CI-only.
- Mac branch ports run `PR check` automatically on pull requests and pushes.
  Use `gh workflow run "PR check" --ref mac-author-build` only for an explicit
  manual re-run.
- The release workflow (`release.yml`) only runs on tag push or workflow_dispatch — supply-chain changes (SBOM, audit gate) don't burn PR-check minutes.

When budget is tight (<200 min remaining for the month), favor doc-only commits or local-only refactor work over feature pushes.

---

## CIS data integration (v0.3.x)

CIS Benchmark data is **not bundled** (licensing). The app reads three formats from `<repo>/public/_baselines/cis/_data/` (dev) or `<process.resourcesPath>/public-assets/_baselines/cis/_data/` (production):

1. **Azure Policy CIS JSON** — Microsoft-curated subset; name-only rule matching (no registry / CSP paths in the JSON).
2. **XCCDF + OVAL XML** — full CIS standards; rich rule data with registry paths and OVAL definitions.
3. **JSON catalogs** — legacy per-platform rule catalogs (`cis-ws2025-rules.json` etc.).

### Match priority

`packages/core/src/handlers/cis-lookup.ts` walks them in this order:

1. JSON catalog exact match
2. XCCDF registry-path exact (canonicalized hive + key + value name)
3. XCCDF non-registry indices (UserRights / AuditPolicy / AccountPolicy / Password) — keyed by name
4. XCCDF fuzzy title match — Jaccard word overlap ≥ 0.6
5. Azure Policy fuzzy title match — same Jaccard, but with **CSP-prefix stripping + cspPath word union** so a noisy CSP-style resource name (with `LocalPoliciesSecurityOptions_…` category prefix) still overlaps with the CIS rule title even though the prefix words don't appear in any CIS rule.
6. **Linux fuzzy title match (v0.3.50+)** — for Linux SFF resources where the CIS rule name carries kernel-module / file-permission / sysctl semantics that the Windows-oriented tokenizers don't capture. Uses `linuxFuzzyMatch` + `buildLinuxResourceTokens` from `xccdf-parser.ts`. Took Linux SFF baseline coverage from 7.36% → 82.98% resource hit, with no regression on Windows XCCDF (Server 2025 vs CIS Azure 2022 still at 75.10%). Verified by `scripts/audit-linux-fuzzy.mjs` and `scripts/audit-windows-xccdf.mjs`.

### CSP matching specifics

CSP resources (`Microsoft.Windows/CSP`) have:
- `properties.path` — the OMA-URI (e.g. `./Device/Vendor/MSFT/Policy/Config/LocalPoliciesSecurityOptions/...`)
- The resource `name` is usually a noisy PascalCase concat of the path segments

Both XCCDF and Azure Policy matchers use the same helpers from `xccdf-parser.ts`:
- `extractCspPathWords(cspPath)` — splits the path into atomic word tokens
- `stripCspCategoryPrefix(name, cspPath)` — drops noise prefixes like `LocalPoliciesSecurityOptions_` so the salient suffix matches the CIS title
- `OSCONFIG_USER_RIGHT_ALIASES` — 14-entry table for asymmetric Win32 names (`BypassTraverseChecking → SE_CHANGE_NOTIFY_NAME`, etc.)

### CIS Diff (bulk lookup)

`packages/core/src/handlers/cis-bulk-lookup.ts` is the bulk compliance counter behind the `/diff` page's CIS Diff tab. **Critical detail:** compliance % is `unique CIS rules covered / total benchmark rules`, NOT `resources matched / total resources`. Multiple resources can map to the same CIS rule (e.g. WS2025 has both a Registry and a CSP version of many settings, both mapping to the same CIS title).

### CIS Diff two-code-path gotcha (v0.3.51 lesson)

`cis-bulk-lookup.ts` runs each resource through **two independent paths** that must stay in sync:

1. **`benchmarkMatch`** — feeds the top-of-page counter ("X% / N of M CIS rules covered"). New matchers (e.g. `linuxFuzzyMatch` in v0.3.50) get wired here first.
2. **`lookupCisRule` → `cisMatch`** — feeds the per-row "CIS Rule" display column. This still routes through the legacy match table.

When you add a new matcher, **wire it into BOTH paths** or the counter and the per-row column will disagree. v0.3.50 only wired `benchmarkMatch`, which made every Linux resource show "No CIS rule" in the table even though the counter correctly reported 83%. v0.3.51 added a fallback in the resource walker: if `lookupCisRule` returns null but `benchmarkMatch` is non-null, populate `cisMatch` from `benchmarkMatch` (preserving the `description`/`severity`/`fixtext` fields as `undefined` to satisfy the type contract).

### Linux fuzzy matcher specifics (v0.3.50+)

`linuxFuzzyMatch` lives in `packages/core/src/cis/xccdf-parser.ts` (~line 881+) alongside its tokenizer `linuxFuzzyTokenize` and the resource-token builder `buildLinuxResourceTokens` (which lives in `cis-bulk-lookup.ts` lines ~130-220). The matcher is platform-gated — XCCDF (line ~416) and Azure Policy (line ~448) branches only invoke it when `benchmarkInfo.platform === 'linux'`. Test coverage: 29 cases in `packages/core/src/cis/linux-fuzzy.test.ts`.

### useCisAvailable invalidation

`apps/desktop/src/components/use-cis-available.ts` has a module-level `_cached` boolean. After `cfs.cis.recheck()` runs (in `CisCatalog.tsx`), call `_resetCisAvailableCacheForTests()` to invalidate so the Diff tab and editor drawer pick up newly-dropped data without app restart.

### `matrix.ts` import gotcha (CRITICAL)

`packages/core/src/diff/matrix.ts` is loaded by the **renderer** (via `apps/desktop/src/pages/Diff/state/useDiffMatrix.ts`). Importing from `cis/xccdf-parser.ts` would pull `node:fs/promises` + `fast-xml-parser` into the renderer bundle and **silently break React init**. Shared helpers (`splitPascalCase`, `extractNameWords`, etc.) must be DUPLICATED in `matrix.ts`, not imported.

---

## Spreadsheet visual editing

`VisualManifestViewer.tsx` is the canonical visual surface for both viewing and authoring. Edit mode adds inline cell editors, category-level row creation, a compact setting-type menu, multi-row selection, and delete. The retired tile/form picker and per-setting modal must not be reintroduced.

### Structure and value safety

- `visual-viewer.ts` assigns stable source paths through nested `Microsoft.OSConfig/Group` arrays and `Microsoft.OSConfig/Test` wrappers. A Test row edits the inner resource properties while its logical name and desired schema remain bound to the wrapper.
- Mutations parse and dump with `LOSSLESS_MANIFEST_SCHEMA`; QWord integers above `Number.MAX_SAFE_INTEGER` remain exact.
- Cell coercion follows existing values and resource metadata (`Registry.valueType`, CSP `type`) instead of turning every edit into a string.
- Test schema constraints render as stacked technical rows in **Expected value** cells. Constraints are enforced only when the governed inner `value` is edited, so existing shipped mismatches remain viewable and unrelated edits are not retroactively blocked.
- Unknown top-level, wrapper, leaf, property, and schema fields survive edits. Visual row deletion removes the logical Test wrapper or exact Group child rather than rebuilding the resource tree.
- Add-row templates cover the ten concrete writable types; Group/Test construction remains available in Code because those structures are not safely representable as one blank flat row.

### Rationale prompt baseline

`apps/desktop/src/pages/ManifestEditor/index.tsx`'s `handleSaveClick` reads the "before" snapshot from `savedContent` (the on-disk baseline, only refreshed on load + successful save), **not** `formatCache.current.yaml`. Spreadsheet edits update the cached YAML buffer, which would make `before === editedContent` and skip the rationale prompt. Using `savedContent` ensures accumulated visual edits trigger one rationale modal on Save.

---

## Diff page canonicalization

`packages/core/src/diff/matrix.ts`'s `canonicalize()` treats these as equivalent:

| Input variants | Canonical form |
|---|---|
| `true`, `1`, `'1'`, `'true'`, `'True'` | `__TRUE__` |
| `false`, `0`, `'0'`, `'false'`, `'False'` | `__FALSE__` |
| `null`, `undefined`, `''`, `[]`, `[null]`, `['']`, `[{}]` | `__EMPTY__` |
| `'24'`, `24` | `24` (number) |
| `'HKLM:\System'`, `'hklm:\\System'`, `'HKLM:\\System\\'`, `'HKLM:\System\\\\'` | `'HKLM:\System'` (path-normalized) |
| Arrays | members canonicalized recursively, empty members filtered |
| Objects | keys sorted, empty values stripped, recurse |

Path canonicalization (collapse repeated backslashes + strip trailing + uppercase hive prefix) catches Windows Firewall Private/Public/Domain logging-name paths and Network Access Remotely Accessible Registry Paths/Subpaths reporting as "changed" when only backslash count differed.

---

## Code signing

**None — release artifacts are unsigned by design.** This repository holds no
code-signing credentials in CI (no Azure Trusted Signing, no `.pfx`/`CSC_*`, no
signing gate). On Windows, SmartScreen warns until a binary builds reputation;
on macOS, Gatekeeper requires `xattr -cr`. The trust path is building from
source; an optional **local** self-sign helper for a contributor's own build is
`apps/desktop/scripts/generate-dev-cert.ps1` (it never runs in CI and signs only
on the machine that trusts the throwaway cert). Do not re-introduce CI signing
or signing secrets in this repo.

---

## Don't (hard rules)

- Re-introduce the `Microsoft.OSConfig` PowerShell module.
- Re-bundle the `oscfg` binary into installers.
- Invoke `oscfg` directly from a handler — go through `packages/core/src/oscfg/`.
- Re-add `/api/drift` or make `/api/scenarios` functional.
- Commit `oscfg` binaries, manifest snapshots, or anything from `~/.configforge/` or `.probe/`.
- Treat "Unsupported resource type" as a hard failure — it's a warning.
- Treat `CLI_REQUIRED` envelope as a generic error — it should route through `CliRequiredModal`.
- Touch or close the user's existing browser/Edge tabs during validation. Use only isolated Playwright/Electron contexts created by your work, and close only those contexts when done.
- Regenerate `package-lock.json` on Windows without `--include=optional` — npm bug #4828 will drop the Linux rollup binary and break CI.
- Import Node-only modules (`crypto`, `fs`, `path`) into `packages/core/src/` files that aren't gated behind a Node-only entry point — they break the renderer Vite bundle.
- Bypass `safeCfs()` / `hasCfsNamespace()` for author-omitted namespaces
  (`health`, `deploy`, `deployRecovery`, `revert`, `auditResults`, `system`) —
  direct access crashes when that namespace is absent.
- Translate technical artifacts: manifest YAML / source text, OSConfig CLI output, `packages/core` errors, CIS rule titles / IDs, baseline filenames, audit-pack PDF contents, schema validation stock messages, or Monaco editor chrome.
- Hand-edit FR / DE / ES catalogs for routine string additions — update English, run `scripts/translate-locales.mjs`, then `node scripts/review-locales.mjs`.
- Use `toLocaleString()` for user-visible renderer dates / numbers — use `apps/desktop/src/lib/format.ts` hooks.
- Remove or bypass the i18n boot kill-switch in `apps/desktop/src/main.tsx`.

---

## Maintainer

Community-maintained by [@ABMFST](https://github.com/ABMFST), the current
repository maintainer and release authority. Maintainer changes must be
reflected in `.github/CODEOWNERS` and this section. Issues and discussion use
GitHub Issues. Security vulnerabilities follow [`SECURITY.md`](./SECURITY.md).
