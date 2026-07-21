# ConfigForge

> ⚠️ **Disclaimer:**  This tool is provided as-is without Microsoft support. This is an experimental project to help customers accelerate their use of security baselines while helping IT architects validate desired configurations., ConfigForge is **not** an officially supported Microsoft product. **Not intended for production use** — for experimentation, learning, and community contributions only. **Use at your own risk.**

**Cross-platform OSConfig security baseline authoring desktop app.** Electron 42 + React 18 + FluentUI v9 + Vite. Windows + Linux full builds come from `main`; the `mac-author-build` branch is author-only. Every flavor can author, validate, compare, and export baselines. Deploy and Audit are available only in the Windows/Linux builds through the native [`oscfg`](https://github.com/microsoft/osconfig/tree/main/docs/cli) CLI.

> The `oscfg` binary is **not** bundled. The macOS author flavor never checks for or uses the CLI and contains no device-operation UI. Editor, Microsoft Baselines, Diff, Benchmark Mapping, and Audit Pack features remain available.

## What it looks like

Left rail order is **Dashboard, My Baselines, Microsoft Baselines, Export Readiness, Diff, Benchmark Mapping, Settings**.

### Microsoft Baselines: start from a curated catalog

Browse pre-built security baselines (Windows Server 2016/2019/2022/2025, member, DC, workgroup; Microsoft Defender; LAPS; Secured Core; Linux Security Baseline) and click **Use as Template** to fork one into your own baseline.

![Microsoft Baselines: pre-built security baselines you can fork into your own baseline](./docs/images/screenshots/library.png)

### Dashboard: authoring status + quick actions

See registered-baseline counts and quick actions without a CLI or administrator check. New Baseline, Browse Microsoft Baselines, and Compare Baselines jump straight into authoring and comparison.

![Dashboard: registered-baseline count and authoring quick actions](./docs/images/screenshots/home.png)

### Baseline editor: author and export

YAML / JSON / Visual triple-format editor with live validation, version history, CIS cross-reference drawer, and a one-click **Audit Pack** button that produces an auditor-ready PDF with the baseline header, compliance score, version history, rationale, and heuristic AI provenance labels.

![Baseline editor: YAML/JSON/Visual tabs, history, and Audit Pack button](./docs/images/screenshots/manifest-detail.png)

### Visual spreadsheet: edit settings in place

Switch to **Visual** mode and click **Edit** to work directly in the grouped setting tables. Click a cell to change it, add a blank row in any category, add a known Windows/Linux setting type from the compact menu, or select rows for deletion. Test wrappers and Group children stay bound to their original YAML structure, typed values remain typed, and QWord integers retain full precision. All visual edits batch into the editor buffer; one Save produces one rationale prompt covering every change.

![Visual spreadsheet with inline setting editing](./docs/images/screenshots/visual-builder.png)

### Audit pack: the auditor deliverable

One click on **Audit Pack** opens a download surface with PDF + Markdown buttons, an inline PDF preview, and a sidebar showing exactly what's in the pack (baseline header, compliance report, version history, rationale log, AI provenance labels) with availability check-marks.

![Audit pack download page: PDF + Markdown buttons, inline preview, what's-included sidebar](./docs/images/screenshots/audit-pack.png)

### Register a new baseline: type, paste, or import

Drag-drop a `.osc.yaml` / `.json` / `.csv` file, paste from a URL, or start from a starter template. Pick Windows or Linux as the target platform and the editor adjusts validation accordingly. Imported CSV/spreadsheet rows are converted into schema-valid Registry settings.

![Register new baseline: import/paste/build with platform-aware validation](./docs/images/screenshots/new-manifest.png)

### Compare baselines: Pairwise, CIS, Matrix

The Diff page has three tabs: **Pairwise**, **CIS**, and **Matrix**. Pairwise shows YAML side-by-side with diff stats, then a Setting Changes panel grouped by status with before/after values. Matrix collapses cross-baseline rules via hive normalization and word-set overlap so registry-keyed and CSP-keyed views of the same setting collide cleanly.

![Compare baselines: pairwise diff with diff stats, AI insights, and Setting Changes panel](./docs/images/screenshots/diff.png)

### Benchmark Mapping: bring-your-own benchmark data

Drop CIS Azure Policy JSON or XCCDF+OVAL XML files onto the **Benchmark Mapping** page (no benchmarks are bundled — CIS licensing). The page auto-detects platform and shows per-file status indicators with Re-check / Open folder actions. CIS data powers the inline cross-reference drawer, compliance scoring, and the bulk CIS Diff tab.

![Benchmark Mapping page: per-file detection status with Re-check + Open folder actions](./docs/images/screenshots/cis-mapping.png)

### CIS Diff: bulk compliance scoring

The Diff page includes a **CIS Diff** tab that scores any baseline against any user-supplied CIS benchmark. It includes a compliance metric, filterable setting table, source badges, and a "Missing from CIS" filter.

![CIS Diff tab: compliance hero metric and sortable setting coverage table](./docs/images/screenshots/cis-diff.png)

## Quick start: run from source

```powershell
# Requires Node 22 LTS (see .nvmrc): `nvm use` if you have nvm.
git clone https://github.com/Azure/ConfigForge.git
cd ConfigForge
git checkout main                 # Windows + Linux full build (default)
# OR
git checkout mac-author-build     # macOS author-only flavor (parallel branch)
npm ci
npm run desktop:dev               # opens the Electron window
```

`desktop:dev` runs Vite (renderer) + Electron in parallel with hot-reload.

### Windows/Linux only: optional OSConfig CLI

The macOS author flavor never checks for or uses the OSConfig CLI. On Windows or Linux, install OSConfig separately to enable Deploy, Audit, and Revert:

- **Windows/Linux:** see [`INSTALL.md`](./INSTALL.md) for platform-by-platform steps.
- **Upstream:** https://github.com/microsoft/osconfig
- **Current target:** `oscfg 1.3.9-preview11`

The CLI status pill and Recheck control exist only in the Windows/Linux full flavor.

## Building installers

```powershell
# Windows: NSIS .exe + portable zip (~113 MB / ~149 MB)
npm run desktop:dist:win

# Linux: portable tar.gz from any host (~140 MB)
npm run desktop:dist:linux

# macOS: unsigned author-only .dmg
npm run dist:mac:author -w @configforge/desktop
```

Full Linux installer matrix (AppImage + deb + rpm) needs a Linux build host. `release.yml` uses `ubuntu-latest` for that. See [`apps/desktop/PACKAGING.md`](./apps/desktop/PACKAGING.md) for the full build matrix and the post-build smoke checklist.

> **Builds are unsigned.** This project holds no code-signing credentials, so installers are unsigned by design — Windows SmartScreen and macOS Gatekeeper will warn. The trust path is building from source (above); you can optionally self-sign your own local build via [`apps/desktop/scripts/generate-dev-cert.ps1`](./apps/desktop/scripts/generate-dev-cert.ps1).

## Repo layout

| Path | What |
|---|---|
| `apps/desktop/**` | The Electron app: renderer (React + FluentUI v9 + Vite), main process, preload bridge, electron-builder config |
| `apps/desktop/src/pages/<Page>/` | Each lighthouse page lives in its own directory with `index.tsx` (composition), `state/` (custom hooks + their tests), `components/` (memoised sub-components), and optional `helpers.tsx`. Pattern landed during the Phase A-E renderer-page split |
| `packages/core/**` | Platform-neutral core: manifests, history, audit-pack, oscfg wrapper, AI provenance labeling (`circular-guard`, `provenance`; local heuristic, advisory). Imported as `@configforge/core` from the desktop app |
| `resources/oscfg/**` | **Dev-only convenience drop** for contributors who bring their own `oscfg` binary. Never shipped to users; the installer carries no Microsoft-owned binaries |
| `public/_baselines/**` | Curated baseline manifests (Windows Server, Defender, LAPS, Secured Core, OpenSSH, etc.), bundled into installers |
| `docs/**` | mdbook documentation site (separate from the app) |
| `scripts/**` | Release, screenshot, localization, and contributor helper scripts |
| `.github/workflows/**` | `pr-check.yml` (lint + vitest + Playwright Electron smoke), `release.yml` (tag-driven installer builds with SBOM + npm-audit gate + pinned electron-builder), `docs.yml` (mdbook site) |

## Documentation

- **[`apps/desktop/DESIGN.md`](./apps/desktop/DESIGN.md)**: the Fluent v2 design system contract (principles, signature experiences, tokens, reviewer checklist).
- **[`apps/desktop/PACKAGING.md`](./apps/desktop/PACKAGING.md)**: installer build workflow, cross-platform matrix, smoke checklists, troubleshooting. Builds are unsigned (optional local self-sign helper included).
- **[`apps/desktop/CI.md`](./apps/desktop/CI.md)**: GitHub Actions workflows (PR check + release pipeline), supply-chain hardening (`npm audit` gate, CycloneDX SBOM, `npx --no-install` tooling pin), trigger scope, release-cutting walkthrough.
- **[`apps/desktop/src/design/PLATFORM.md`](./apps/desktop/src/design/PLATFORM.md)**: platform-specific UX rules (Windows Mica + custom titlebar, Linux native frame, etc.).
- **[`CHANGELOG.md`](./CHANGELOG.md)**: per-release notes. The current macOS author line is `v0.3.74-author.1`.
- **[Public docs site](https://abmfst.github.io/ConfigForge/)**: Quick Start, User Guide (matrix diff, CIS compliance, rationale capture, audit-pack PDF, AI provenance, history snapshots), Architecture, API Reference, Operations.

## Contributing

- Read [`AGENTS.md`](./AGENTS.md), the canonical guide for AI agents, also a useful summary for humans.
- Pre-PR bar:
  ```powershell
  npm ci
  npm run lint           # 0 errors; `warn`-level max-lines flags are tracked-but-not-blocking
  npm test               # vitest full suite
  npm run desktop:build  # core + renderer + electron main; must succeed cleanly
  ```
  Smoke-test on Windows from elevated PowerShell if you touched `apps/desktop/electron/**` or `packages/core/src/oscfg/**`.
- To regenerate the screenshots above: build the desktop app once (`npm run desktop:build`), then run `node scripts/capture-screenshots.mjs`. The script launches the bundled Electron app via `playwright._electron`, navigates each page, and writes PNGs to `docs/images/screenshots/`. Requires Playwright (`npm install --save-dev playwright` + `npx playwright install chromium` once).
- Active branches: **`main`** (Win + Linux full build) and **`mac-author-build`** (macOS author flavor). Non-flavor-specific work lands on `main` first and is ported to `mac-author-build` via `git cherry-pick`. Per-branch CI: `main` runs PR check on push; `mac-author-build` is `workflow_dispatch`-only (manual `gh workflow run "PR check" --ref mac-author-build`).
- Optional: `npm run format` (Prettier) and `npm run format:check`. Prettier was added in v0.2.1 with no mass-format run. Adopt incrementally on files you touch.

## Release history (high-level)

| Version | Highlights |
|---|---|
| **0.3.84-author.1** (current) | macOS author flavor with exports limited to YAML, JSON, MOF, and CSV plus all high-severity development dependency advisories cleared |
| **0.3.82-author.1** | macOS author flavor with clearer Baseline Detail identity and view-only feedback, top/bottom Add setting actions, Matrix baseline search, and the `js-yaml` 4.3.0 security patch |
| **0.3.81-author.1** | macOS author flavor with first-class OSConfig CSV imports, fully labeled responsive Baseline Detail actions, author-only Recent Activity, spreadsheet editing, and full FR/DE/ES coverage |
| **0.3.76-author.1** | macOS author flavor with author-only Recent Activity for registration/edit history, predictable namespace/display-name search in My Baselines, responsive Visual tables, spreadsheet editing shared by Baseline Detail and Register New Baseline, and full FR/DE/ES coverage |
| **0.3.62 – 0.3.68** | Rebrand **ConfigForge Spark → ConfigForge**; vocabulary refresh (**Manifests → My Baselines**, **Library → Microsoft Baselines**, **Validation → Export Readiness**, **CIS Mapping → Benchmark Mapping**, *resource* → *setting*, **OSConfig vNext → Gen 2**); unsigned OSS release pipeline with `SHA256SUMS` + SBOM verification; MOF export targets the `Microsoft.OSConfig` module; Monaco overflow-widget dropdown root-cause fix; "Could not read" compliance bucket on baseline cards |
| **0.3.54 – 0.3.61** | Localization rollout (FR / DE / ES) — five extraction waves, machine-translation + review tooling, `Intl` date/number/relative-time formatters, and length/overflow visual QA |
| **0.3.45 – 0.3.53** | Benchmark (CIS) Mapping subtitle + Diff › CIS tab; real History change summaries + auto-scroll Compare; CIS fuzzy-matching tightening; Group resources expand inline in Visual Builder; Diff "Select baseline" dropdown stability (Monaco overflow fix) |
| **0.3.27 – 0.3.36** | CIS matcher quality pass (CSP UserRights, alias table, XCCDF fuzzy fallback, 36/36 mappable UserRights match WS2025 CIS); 100x cis.status() perf fix; 3-second warmup deferral eliminates manifest-open regression; ResourceChangesPanel and Resource-level diff stats; AI summary numbers consistent across panels |
| **0.3.14 – 0.3.26** | CIS Mapping page (Azure Policy JSON + XCCDF/OVAL XML auto-detect), CIS cross-reference drawer in the manifest editor, CIS Diff tab on the Diff page, settings store with history retention, deploy recovery banner, breadcrumb navigation |
| **0.2.1** | Phase A-E renderer-page split; 15/15 security audit findings closed; typed main-process logger with secret redaction; Prettier config; CSV-import schema fix |
| **0.2.0** | Bring-your-own-CLI: removed bundled `oscfg` binary, added Welcome dialog + CliRequiredModal, well-known-paths binary resolver, MSIX fallback. Legal scaffolding (LICENSE / NOTICE / SECURITY / THIRDPARTYNOTICES) for OSS readiness |
| **0.1.x** | Initial Electron migration in 10 phases (Next.js to Electron + React Router + FluentUI v9 + Vite). See git log on `main` for per-phase commits |

## Maintainer

Community-maintained. Use [GitHub Issues](https://github.com/Azure/ConfigForge/issues) for bug reports and feature discussion.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Security

To report a security vulnerability, please follow the instructions in [SECURITY.md](./SECURITY.md). **Do not** file security issues as public GitHub issues. ConfigForge does not collect telemetry; see [PRIVACY.md](./PRIVACY.md).

## License

Licensed under the [MIT License](./LICENSE.TXT). Third-party components are described in [NOTICE](./NOTICE) and [THIRDPARTYNOTICES.md](./THIRDPARTYNOTICES.md).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
