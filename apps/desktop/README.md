# @configforge/desktop

ConfigForge — the Electron 42 + React 18 + FluentUI v9 + Vite desktop app.

Two parallel flavors:
- **`main` branch**: Windows + Linux full build with deploy / elevation / health / audit-results wired through the preload bridge.
- **`mac-author-build` branch**: macOS author-only flavor. Preload omits
  `health`, `deploy`, `deployRecovery`, `revert`, `auditResults`, and `system`;
  renderer code uses `safeCfs()` / `hasCfsNamespace()` from `src/lib/cfs.ts`
  for flavor-conditional paths.

This workspace replaced the legacy Next.js web app in the Phase 10 cutover (Sept 2025).

## Run in development

```bash
# From the repo root
npm ci
npm run desktop:dev           # full main flavor (deploy, elevation, etc.)

# macOS author flavor (only on mac-author-build branch):
npm run dev:author -w @configforge/desktop
```

`desktop:dev` starts Vite at `http://localhost:5173` and Electron pointing at it. Edit `src/**` and the renderer hot-reloads. Edit `electron/**` and you'll need to restart (Ctrl+C, re-run).

## Build a packaged installer

```bash
# From the repo root, main (Win/Linux) flavor:
npm run desktop:dist:win      # NSIS .exe + portable zip
npm run desktop:dist:linux    # AppImage, .deb, .rpm, .tar.gz on Linux hosts; tar.gz from Windows

# macOS author flavor (only on mac-author-build):
npm run dist:mac:author -w @configforge/desktop
```

Output lands in `apps/desktop/release/<version>/`. See [`PACKAGING.md`](./PACKAGING.md) for the full cross-platform build matrix, unsigned-build notes, and post-build smoke checklist.

## Architecture

```
apps/desktop/
├─ electron/
│  ├─ main.ts                # BrowserWindow + IPC + protocol handlers
│  ├─ preload.ts             # contextBridge surface (window.cfs.*) — flavor-specific
│  ├─ log.ts                 # Typed main-process logger (electron-log-backed, redacts secrets)
│  ├─ elevate.ts             # Process elevation (UAC on Windows, pkexec on Linux)
│  ├─ ipc-handlers.ts        # IPC channel registrations; thin wrappers around packages/core/handlers
│  ├─ ipc-validators.ts      # Typed payload validators per channel (CF-SEC-002)
│  ├─ navigation-guard.ts    # File:// navigation blocker (CF-SEC-001)
│  └─ protocol-handler.ts    # cfs-blob:// custom protocol for in-process artifact streaming
├─ src/
│  ├─ main.tsx               # React entry
│  ├─ App.tsx                # Router + Layout + Suspense boundary
│  ├─ pages/                 # Lighthouse pages in directory/hook/components form (Phase A→E)
│  │  ├─ ManifestEditor/
│  │  │  ├─ index.tsx        # Composition (~451 lines, down from 1,585)
│  │  │  ├─ helpers.tsx      # Pure render helpers
│  │  │  ├─ state/           # useManifestEditorState, useDeployFlow + tests
│  │  │  └─ components/      # AddSettingsPane, ManifestContent, VisualManifestViewer, DeployResultPanel, ComplianceTable, ManifestDetailFooter, ManifestHeader
│  │  ├─ Manifests/          # useManifestList, useFlashMessage, useBulkSelection + tests
│  │  ├─ ManifestNew/        # useNewManifestForm + tests
│  │  ├─ Library/            # useLibraryFilters + tests
│  │  └─ Diff/               # useDiffMatrix + tests (includes race-guard regression)
│  ├─ components/            # Shared sub-components (HealthIndicator, WelcomeDialog, CliRequiredModal, etc.)
│  ├─ hooks/                 # Shared hooks (useCliPresence, useDebounce, etc.)
│  ├─ lib/
│  │  ├─ cfs.ts              # Renderer IPC bridge + safeCfs() / hasCfsNamespace() helpers (CF-SEC-015)
│  │  ├─ flavor.ts           # HAS_DEPLOY / HAS_HEALTH / HAS_AUDIT compile-time flavor switches (mac branch)
│  │  └─ use-navigation-guard.ts  # Unsaved-changes guard (v0.1.15)
│  ├─ data/
│  │  └─ osc-manifest-schema.json # JSON Schema for editor validation
│  └─ design/                # Design system: tokens.ts, foundation.css, PLATFORM.md
├─ scripts/
│  ├─ build-electron.mjs     # esbuild config for main + preload
│  ├─ generate-icons.mjs     # Icon pipeline (svg → png → ico/icns)
│  └─ generate-dev-cert.ps1  # Self-signed Windows code-signing cert generator (dev only!)
├─ e2e/                      # Playwright Electron smoke specs
├─ index.html                # Vite HTML shell + CSP meta
├─ vite.config.ts
├─ tsconfig.json             # Renderer (ESM + Bundler resolution)
├─ tsconfig.electron.json    # Main process (CommonJS)
├─ electron-builder.yml      # Distribution config (Win + Linux)
├─ electron-builder.author.yml  # macOS author flavor (mac-author-build branch only)
├─ .eslintrc.cjs             # ESLint config (eslint-config-prettier wired)
├─ DESIGN.md                 # Fluent v2 design system contract
├─ PACKAGING.md              # Build / smoke checklist (artifacts are unsigned)
├─ CI.md                     # GitHub Actions workflows
└─ UPDATING.md               # Dependency update procedure (electron, electron-builder, etc.)
```

## Security posture (locked in from Phase 0, never regress)

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- Renderer talks to main *only* through `window.cfs.*`
- `navigation-guard.ts` blocks `will-navigate` outside the bundled UI + file:// navigation (CF-SEC-001)
- `setWindowOpenHandler` opens external URLs in the user's default browser, not in-app
- CSP enforced via `<meta http-equiv="Content-Security-Policy">` in `index.html`
- Typed IPC payload validators on every channel (`ipc-validators.ts`, CF-SEC-002)
- Import payload size capped at 10 MB (CF-SEC-003)
- Markdown HTML escaping for any user-supplied or AI-generated text rendered as markdown (CF-SEC-005/006)

See the full security audit closure in [`CHANGELOG.md`](../../CHANGELOG.md) under v0.2.1.

## Testing

```bash
# From repo root:
npm test                          # vitest full suite
npm test -- apps/desktop/src      # narrow to desktop project
npm run desktop:e2e               # Playwright Electron smoke (windows-latest in CI)
```

Page-level test coverage uses the hook-first pattern landed in Phase A→E:

```bash
# Run all hook tests for a page:
npx vitest run apps/desktop/src/pages/Manifests/state/

# Run a single regression test (e.g. listTokenRef race-guard):
npx vitest run -t "listTokenRef" apps/desktop/src/pages/Manifests/
```

See [`../../AGENTS.md`](../../AGENTS.md) for the full page-split convention.

## Mac flavor notes

If you're working on `mac-author-build`:

- `npm run dev:author` / `npm run build:author` / `npm run dist:mac:author` are the entry points.
- Renderer code that needs `health`, `deploy`, `deployRecovery`, `revert`,
  `auditResults`, or `system` must use `safeCfs()` or gate on
  `hasCfsNamespace()`. Direct access crashes when the namespace is absent.
  Elevation methods are under `system`; there is no `elevation` namespace.
- The `chmod-oscfg.js` postinstall script is still in place because the mac dev-drop path uses the bundled binary; do not remove it on this branch.
- E2E specs that exercise deploy / elevation flows are excluded from the author build; the Playwright smoke spec gates on `HAS_DEPLOY`.
- Preview macOS Author builds are unsigned; after copying to Applications, clear quarantine with `xattr -cr "/Applications/ConfigForge Author.app"` if Gatekeeper blocks launch.

## Documentation

- [`DESIGN.md`](./DESIGN.md) — Fluent v2 design system contract: principles, signature experiences, tokens, reviewer checklist.
- [`PACKAGING.md`](./PACKAGING.md) — Installer build matrix, post-build smoke checklist, troubleshooting. Builds are unsigned (optional local self-sign: `scripts/generate-dev-cert.ps1`).
- [`CI.md`](./CI.md) — GitHub Actions workflows (`pr-check.yml` + `release.yml`), supply-chain hardening (npm audit gate, CycloneDX SBOM, `npx --no-install` pin), release-cutting walkthrough.
- [`UPDATING.md`](./UPDATING.md) — How to bump electron / electron-builder / FluentUI versions safely.
- [`src/design/PLATFORM.md`](./src/design/PLATFORM.md) — Platform-specific UX rules (Windows Mica + custom titlebar, Linux native frame).
