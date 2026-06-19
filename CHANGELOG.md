# Changelog

## [0.3.71] - 2026-06-19

### Security
- **Bumped `undici` to 7.28.0** (Dependabot #14 medium, #15 high) via a targeted override (`undici@>=7.0.0 <7.28.0` → `^7.28.0`), resolving both advisories. `undici` is a build/test-only dependency (electron-builder, `@electron/get`, jsdom) and is **not bundled** into the shipped app; node-gyp's non-vulnerable `undici` 6.25.0 is left untouched. `npm audit`: 0 vulnerabilities.

### Changed
- Bumped `dompurify` (dev dependency) 3.4.9 → 3.4.11 (Dependabot).

### Docs
- Regenerated all 9 README screenshots and refreshed the Release-history table for the current UI (My Baselines / Microsoft Baselines / Export Readiness / Benchmark Mapping nav, "setting" terminology, 4-color Windows logo + penguin, OSConfig Gen 2).

## [0.3.70] - 2026-06-18

### Fixed
- **Benchmark Mapping: the "Back to My Baselines" button now shows a back arrow**, matching the other back buttons across the app (added the `ArrowLeftRegular` icon to the link in `CisCatalog.tsx`).

## [0.3.69] - 2026-06-18

### Changed
- **UI polish across My Baselines, Microsoft Baselines, and the Baseline Editor.**
  - Replaced the Windows emoji and the FluentUI desktop icon with a 4-color Microsoft Windows logo on baseline cards, Microsoft Baselines filters/cards, the setting picker, and the editor header; Linux now uses the penguin consistently.
  - Moved the **Microsoft Baselines** nav item directly under **My Baselines** and renamed the baseline-card action **"View" to "Open"**.
  - Removed the redundant **"Source: oscfg"** label from cards and the editor header.
  - Swapped the editor format strip so the Editor/Visual Builder toggle is on the left and the YAML/JSON/MOF tabs are on the right; renamed the Benchmark Mapping **"CIS data folder" to "Benchmark data folder"**; and fixed the License-note spacing.
- **Deprecated the duplicate toolbar "Docs" button** in the Baseline Editor (use Export → Docs); removed the now-dead docs-preview modal and hook.

### Fixed
- **Audit-pack PDF section headings now left-align** (Compliance, Device Audit, Version History, Rationale Log, Top non-compliant resources) instead of inheriting the previous element's right-anchored position.

### Localization
- Re-translated the changed FR/DE/ES keys via Azure Translator and hand-corrected the high-visibility **"Open"** button to the proper imperative form (Ouvrir / Öffnen / Abrir).

## [0.3.68] - 2026-06-10

### Changed
- **Removed all code-signing from CI; release builds are now unsigned by design (OSS migration).** Ahead of the open-source repo move, the Release workflow no longer signs Windows installers: dropped the Azure Trusted Signing step, the legacy `.pfx`/`CSC_*` path, the signing gate, and the `allow_unsigned` dispatch input (plus all `WIN_CSC_*`, `AZURE_*`, and `TRUSTED_SIGNING_*` secret/variable references). `release.yml`/`release-mac.yml` still build the full installer matrix (NSIS/zip/AppImage/deb/rpm/tar.gz/.dmg) with SBOM + SHA256SUMS and publish to a draft release — just **unsigned**. **Verification workflow:** before installing, download artifacts only from the GitHub release, verify each file against `SHA256SUMS`, and review attached provenance/SBOM artifacts; for high-assurance environments, build from source at the tagged commit and compare resulting hashes where reproducible. The trust path is building from source; an optional **local** self-sign helper (`apps/desktop/scripts/generate-dev-cert.ps1`) is retained but never runs in CI.
- **Moved the `npm audit --omit=dev --audit-level=high` supply-chain gate into `pr-check.yml`** so it runs on every PR (previously only at release). The release pipeline keeps its copy as a pre-ship gate.

### Docs
- Removed `apps/desktop/SIGNING.md` and scrubbed signing references across `CI.md`, `PACKAGING.md`, `UPDATING.md`, the desktop + root `README.md`, `docs/src/operations/ci.md`, `docs/src/contributing/agents-md.md`, `AGENTS.md`, and `PLATFORM.md`, replacing them with an honest "builds are unsigned — build from source, or self-sign locally" note. The auto-updater already no-ops on unsigned Windows installs (its comment was updated accordingly).

### Notes
- App code unchanged except comments; the main-process logger's secret-redaction patterns (incl. `WIN_CSC_*`) are intentionally retained as defense-in-depth.

## [0.3.67] - 2026-06-10

### Fixed
- **MOF export now produces a package the Azure Machine Configuration cmdlets can build.** `exportToMof` stamped `ModuleName = "OSConfig"` / `ModuleVersion = "1.0.0"`, but the OSConfig DSC resource ships in the **`Microsoft.OSConfig`** PSGallery module, and `New-GuestConfigurationPackage` requires the MOF's `ModuleVersion` to match an *installed* version exactly. The result: packaging a ConfigForge-exported MOF failed with *"Failed to find a module with the name 'OSConfig' and the version '1.0.0'."* The export now emits `ModuleName = "Microsoft.OSConfig"` and **omits `ModuleVersion`**, so the packaging cmdlet binds to whatever `Microsoft.OSConfig` (1.2.0 or later) is installed. Verified end-to-end: Export → MOF → `New-GuestConfigurationPackage -Type AuditAndSet` now produces a valid `.zip` with no manual edits (against GuestConfiguration 4.11.0 + Microsoft.OSConfig 1.3.11). The DSC resource class (`instance of OSConfig`) and the configuration footer are unchanged.
  - **If you exported MOFs before 0.3.67, re-export them before packaging.** Manual fallback: update `ModuleName` to `Microsoft.OSConfig` and remove the `ModuleVersion` line in the existing MOF, then rerun `New-GuestConfigurationPackage`.
  - Documented the one-time prerequisites (`Install-Module GuestConfiguration` + `Install-Module Microsoft.OSConfig`) in the manifest-editor export guide and added 4 regression tests (`import-export/index.test.ts`).

### Tests
- Full vitest suite passing; `npm run desktop:build` clean; `npm run lint` 0 errors; MOF→package validated end-to-end via the Azure Machine Configuration cmdlets.

## [0.3.66] - 2026-06-10

### Changed
- **Shortened the desktop app package description** shown in the Windows executable / installer metadata: "ConfigForge — Electron desktop app. Cross-platform (Windows + Linux) with Fluent-inspired desktop polish." → "ConfigForge — OSConfig Baseline Editing tool". The source is the `description` field in `apps/desktop/package.json`, which electron-builder embeds in the built artifact. No functional change.

### Fixed
- **Manifests list card stat labels no longer look cramped.**
  - The 4-up Resources / Compliant / Issues / Could not read grid used wide letter-spacing (`tracking-wider`) plus large side padding (`px-3`), leaving only ~70px for text, so the three-word "Could not read" label wrapped to three tight lines and crowded the tile edges.
  - Tightened the label tracking and trimmed the stat-box horizontal padding so the label wraps cleanly to two lines — tile size and the other three stats are unchanged.

## [0.3.65] - 2026-06-10

### Fixed
- **Diff "Select manifest" dropdown could freeze until app restart (definitive fix).** Rapidly navigating between pages that mount and dispose Monaco editors (Manifests, the manifest editor, CIS Mapping, Diff) could leave an orphaned `position: fixed` Monaco overflow widget parented on `document.body`. The invisible overlay sat over the Pairwise "Select manifest" `<select>`, swallowed clicks, and froze the dropdown until restart. v0.3.53 mitigated the symptom (removed a stuck-loading guard, added an IPC timeout); this is the root-cause fix — Monaco's overflow widgets are now hosted in a node ConfigForge owns via `overflowWidgetsDomNode`: created with `document.createElement`, appended to `<body>` for the editor's lifetime, and **removed on unmount**, so no orphan can survive a dispose/navigation race.
- Covered by a strengthened Playwright e2e (`e2e/diff-dropdown-no-orphan.spec.ts`): it churns editors, then switches the Pairwise side to "from manifest" mode and asserts the dropdown has no overlay, accepts a real pointer click, and actually changes value when a manifest is selected.

### Notes
- The overflow-widget host is deliberately a non-React `document.createElement` node rather than JSX. A React-rendered node carries `__reactFiber$…` expando properties that point into the cyclic Fiber tree, and Monaco deep-clones the editor options (which include this node); cloning a React-owned node recurses through the entire Fiber graph and crashes the renderer with "Maximum call stack size exceeded" on a later editor mount.

### Tests
- Full vitest suite **1254 passing, 0 failing**; full Playwright e2e **61 passing** (1 known-flaky `conflict-detection` retry); `npm run desktop:build` clean; `npm run lint` 0 errors.

## [0.3.64] - 2026-06-09

### Fixed
- **Manifests list card now surfaces the "Could not read" bucket.**
  - Each per-manifest card showed only Resources / Compliant / Issues and silently dropped indeterminate/error resources, so the card totals disagreed with the manifest detail view — e.g. a 265-resource manifest showing 66 Compliant + 192 Issues with 7 unreadable resources invisible (66 + 192 = 258 ≠ 265).
  - Added the amber **Could not read** stat (indeterminate + error, mirroring `DeployResultPanel`) so Compliant + Issues + Could not read add up to the audited total. Never-audited resources are not counted as unreadable.
  - Covered by new unit tests (`Manifests/index.test.tsx`) and a Playwright e2e (`e2e/manifest-card-could-not-read.spec.ts`).
- **Welcome splash no longer hard-codes a version.** "ConfigForge v0.2.0 works in two modes…" → "ConfigForge works in two modes…" across en/fr/de/es.

## [0.3.63] - 2026-06-08

### Changed
- **UI label "OSConfig vNext" → "OSConfig Gen 2".** Renamed the product/version label across the sidebar footer, Home page description, and Settings (docs-link label + section description) in all four locales (en/fr/de/es), kept identical as a product label (localized `vSuivant`/`vWeiter`/`vSiguiente` variants folded into "Gen 2").
  - Left unchanged: the MS Learn URL `…concept-osc-vnext-redux` in `Settings.tsx` (real external link) and the internal i18n key name.

## [0.3.62] - 2026-06-08

### Changed
- **Rebrand: "ConfigForge Spark" → "ConfigForge".** Dropped the "Spark" suffix across the entire codebase, build configuration, and documentation (112 files).
  - **App identity (clean rebrand):** `appId` `community.configforge.spark` → `community.configforge`; `executableName` / npm package `name` `configforge-spark` → `configforge`; `productName` / `shortcutName` "ConfigForge Spark" → "ConfigForge". The Windows install path and `%APPDATA%` data folder move from `configforge-spark` to `configforge`, so preview users' local settings do not carry over (acceptable pre-GA).
  - **Installer artifacts:** `ConfigForgeSpark-Setup-${version}` → `ConfigForge-Setup-${version}`.
  - **Repo URLs:** `github.com/ABMFST/ConfigForgeSpark` → `github.com/ABMFST/ConfigForge` (repo already renamed; old URLs auto-redirect). Local git remote updated to match.
  - **Author flavor (mac):** "ConfigForge Spark Author" → "ConfigForge Author"; `appId` `community.configforge.spark.author` → `community.configforge.author`. Ported on `mac-author-build` separately.
  - **Preserved:** the unrelated `SparkleRegular` FluentUI icon in `ai-analysis-panel.tsx` (false-positive match on "spark").

### Tests
- No behavioral change. Full vitest suite **1251 passing, 0 failing**; `npm run desktop:build` clean; `npm run lint` 0 errors.

### Follow-ups
- The Azure Trusted Signing service principal documented as `ConfigForgeSparkSigner` is now written as `ConfigForgeSigner`; rename the actual Azure SP to match (the doc is aspirational until then — signing itself is driven by secrets, not the SP display name).

## [0.3.61] - 2026-05-28

### Added
- **Localization QA polish (Phase 7).** Two parallel audits over the v0.3.60 catalogs: `Intl`-based date/number/relative-time formatting, and overflow/length risk analysis for non-English locales.
  - **`apps/desktop/src/lib/format.ts` (new)** exposes three hooks — `useDateFormatter(opts?)`, `useNumberFormatter(opts?)`, `useRelativeTimeFormatter(opts?)` — each backed by the active `i18n.language` so dates and numbers re-render with the rest of the UI when the user changes language. Tests in `lib/format.test.tsx`.
  - **15 formatter fixes** across 14 files (Home, ManifestHistory, UpdateBanner, ai-analysis-panel, CisDiffTab, ManifestNew, manifest-editor, recent-rationale-sidebar): 2 date/time, 2 relative-time, 11 number. Out-of-scope formatters left alone: job IDs, file dates in audit-pack exports, log/telemetry timestamps, test fixtures, and anything under `packages/core`.
  - **`apps/desktop/src/locales/VISUAL-QA.md` (new)** flags 30 length-overflow risks (23 from `REVIEW.md` + 7 from a proactive grep for `whitespace-nowrap`, fixed widths on translatable text, etc.). 0 hard breakages required a CSS change; the worst remaining risk is a `de` compliance tooltip with `whitespace-nowrap` — flagged for Amir to visually verify in dev. All risks include render-location pointers so spot-checking is one search away.

### Tests
- `apps/desktop/src/lib/format.test.tsx` (new) and updates to Home, ManifestHistory, and UpdateBanner test suites to exercise the new formatter hooks across `en`/`fr`/`de`/`es`. Full suite: **1245 → 1251 passing, 0 failing**.

### Notes
- Plan reservations: original v0.3.59 was reserved for QA polish; we shipped extraction waves 1-5 in v0.3.55-v0.3.59, machine translation in v0.3.60, and QA polish here in v0.3.61. The original v0.3.58 MT-review release becomes an Amir-personal follow-up (see `REVIEW.md` for the workflow).
- Wave 6 carve-outs unchanged: CIS rule data, audit-pack export contents, OSConfig/`packages/core` output, manifest YAML/source all remain English by design.

## [0.3.60] - 2026-05-28

### Added
- **Localization rollout Wave 6 (machine translation and review tooling).** Added first-pass FR/DE/ES catalogs for all 13 namespaces plus the tooling needed to rerun and review translation updates.
  - Added `scripts/translate-locales.mjs` with provider adapters for `--provider=azure`, `--provider=deepl`, `--provider=passthrough`, and `--provider=manual`, preserving existing target-locale values and `{{interpolation}}` placeholders while keeping glossary terms literal.
  - Added `scripts/review-locales.mjs`, `scripts/locales-glossary.json` (13 protected terms), `scripts/translate-locales.test.mjs`, and `scripts/review-locales.test.mjs`; `npm test` now includes `scripts/**/*.test.mjs`.
  - Generated `apps/desktop/src/locales/REVIEW.md` with the reviewer workflow, coverage table, placeholder checks, length-risk analysis, glossary checks, and plural-form completeness.
  - Populated FR/DE/ES catalogs to 827 / 827 keys each. Previously-present target-locale keys: 20 per locale; newly populated keys in this wave: 807 per locale.

### Changed
- Bumped root and desktop package versions from `0.3.59` to `0.3.60`.
- Updated localization integration tests to assert real shipped translations for FR/DE/ES instead of English fallback behavior. Full-suite expected count increases from 1239 to 1245 passing tests (0 failing).
- Added root convenience scripts: `npm run locales:translate -- --provider=<azure|deepl|manual|passthrough>` and `npm run locales:review`.

### Validation
- `node scripts/review-locales.mjs --strict`: placeholder integrity clean, glossary compliance clean, plural-form completeness clean; 23 length warnings remain for v0.3.61 visual QA.
- `npm test -- --reporter=dot`: 1245 passing tests, 0 failing.
- `npm run build --workspace @configforge/desktop`: succeeded. Locale catalog growth is approximately +130.9 KiB raw / +35.7 KiB gzip; current main renderer chunk is 1,025.64 KiB / 291.21 KiB gzip.
- `npx eslint scripts/translate-locales.mjs scripts/review-locales.mjs` has no root config to load; rerun with the existing desktop config succeeded with 0 errors and 1 existing-style complexity warning in the report analyzer.

### Notes
- **Honest disclosure:** this autopilot run had no Azure Translator or DeepL API keys, so the FR/DE/ES strings were produced directly by the autopilot LLM and curated heuristically rather than by the `translate-locales.mjs` paid-provider adapters. These machine-assisted translations are **draft quality only** and must be reviewed/corrected by native speakers (or qualified product linguists) before any production/customer-facing release; do not treat them as final professional translations until that sign-off is complete. The adapter script is ready for future reruns when `AZURE_TRANSLATOR_KEY` / `AZURE_TRANSLATOR_REGION` or `DEEPL_API_KEY` is available.
- **Critical note for Amir:** machine-assisted translations are first-pass product text. Per the `review-amir` follow-up, review at least the high-traffic surfaces (sidebar, common buttons, settings, home, manifest editor toolbar) before any external/customer-facing release. The review workflow is documented in `apps/desktop/src/locales/REVIEW.md`.

## [0.3.59] - 2026-05-28

### Added
- **Localization rollout Wave 5 (final extraction wave).** Long-tail pages and remaining reusable components now route app-authored UI strings through `react-i18next`, closing English source-catalog extraction for the desktop app.
  - Migrated pages: `ManifestNew/index.tsx`, `Library/index.tsx`, `ManifestCompliance.tsx`, `Compliance.tsx`, `CisCatalog.tsx`, `ManifestAuditPack.tsx`, and `NotFound.tsx`.
  - Migrated leftover string-bearing components: `conflict-detector.tsx` and `recent-rationale-sidebar.tsx` (2 components). Audited numeric/no-op/caller-supplied long-tail components and left them unchanged.
  - Populated / extended English namespaces: `manifests` 185 keys (124 Wave 5 additions, including `manifests.new.*` and `manifests.library.*`), `compliance` 63 keys, `cis-catalog` 62 keys, `audit-pack` 21 keys, `common` 65 keys (37 Wave 5 additions), and `dialogs` 14 keys (7 Wave 5 additions). No separate `library` namespace was carved out.
  - Reuse counts in Wave 5 touched code: `common:` 0, `manifests:` 0, `manifest-editor:` 0, `diff:` 0. Library copy stayed under `manifests.library.*`; component copy stayed under `common.components.*`.
  - Added 3 Wave 5 i18n integration tests covering Library language switching, CIS benchmark data staying verbatim across language switches, and audit-pack PDF preview identity staying English. Expected full-suite count increases from 1236 to 1239 passing tests (0 failing).

### Notes
- **English extraction is complete across all 13 namespaces** (`common`, `sidebar`, `settings`, `home`, `manifests`, `manifest-editor`, `diff`, `history`, `compliance`, `cis-catalog`, `audit-pack`, `welcome`, `dialogs`); every namespace now has a populated EN catalog and is ready for machine translation in v0.3.60.
- Carve-out compliance reaffirmed: CIS rule titles / IDs / benchmark data, audit-pack exported PDF and Markdown contents, OSConfig CLI output and `packages/core` errors, and manifest YAML/source text remain English by design so support and SI handoffs remain greppable.
- **Version renumbering:** Wave 5 takes v0.3.59, machine translation + review shifts to v0.3.60, and QA polish shifts to v0.3.61.

## [0.3.58] - 2026-05-28

### Added
- **Localization rollout Wave 4 (manifest editor surface).** The manifest editor route now routes app-authored user-visible chrome through `react-i18next` using the `manifest-editor` namespace.
  - Migrated 11 files under `pages/ManifestEditor/`: `index.tsx`, `helpers.tsx`, 6 files under `components/` (`ComplianceTable`, `DeployResultPanel`, `DocsModal`, `ManifestContent`, `ManifestHeader`, `ResourceEditDialog`), and 3 string-bearing state hooks (`useDeployFlow`, `useDocsModal`, `useManifestEditorState`).
  - Migrated the conceptually-related rationale view at `pages/ManifestRationale.tsx` into the same namespace.
  - Populated `apps/desktop/src/locales/en/manifest-editor.json` with 128 English keys. Reused shared namespaces rather than duplicating copy: `common:` 3 times, `manifests:` 7 times, `diff:` 0 times.
  - Added 2 manifest-editor i18n integration tests, raising the expected full-suite count from 1234 to 1236 passing tests (0 failing).

### Notes
- **Monaco carve-out remains intentional:** Monaco editor chrome (find/replace, suggestions, completion menus, breadcrumbs) remains English regardless of app locale in v1. Future work may add Monaco locale packs; this wave did not touch Monaco configuration or language bundles.
- **Version renumbering:** the original plan reserved v0.3.58 for machine translation review. Wave 4 now takes v0.3.58; Wave 5 takes v0.3.59, MT review moves to v0.3.60, and QA polish moves to v0.3.61. The MT release plan is unchanged in substance.
- Carve-outs reaffirmed: manifest YAML/source text, OSConfig CLI/core output, schema-validator stock messages, manifest data field names, telemetry/localStorage keys, brand names, keyboard shortcuts, Monaco chrome, and date/number formatting remain out of localization.

## [0.3.57] - 2026-05-28

### Added
- **Localization rollout Wave 3 (high-traffic pages).** Home/Dashboard, Manifest History, the Manifests list/browse surface (`pages/Manifests/index.tsx`), and the Diff surface (`pages/Diff/index.tsx`, `Diff/components/CisDiffTab.tsx`, `components/diff-viewer.tsx`, and `components/ai-analysis-panel.tsx`) now route user-visible strings through `react-i18next`.
  - Resolved the scope ambiguity by treating the page-split `pages/Manifests/index.tsx` as the manifest list surface and `pages/Diff/index.tsx` plus its CIS/AI/diff-viewer helpers as the diff surface; embedded history compare strings live under `history.diff.*`.
  - Populated English namespaces: `home` (57 keys), `manifests` (61 keys), `history` (35 keys), and `diff` (128 keys). Reused existing `common:` keys 6 times (`buttons.refresh`, `buttons.dismiss`, `buttons.cancel`) instead of duplicating shared button copy.
  - FR/DE/ES remain English-fallback only for these new Wave 3 keys; machine translation and review are still deferred to Wave 6.

### Tests
- Added i18n language-switch integration coverage for Home, Manifests, Manifest History, and Diff. Full suite increased from 1230 to 1234 passing tests (0 failing).

### Notes
- Carve-outs remain unchanged: manifest YAML/source text, OSConfig CLI/core errors, CIS rule titles/IDs, baseline filenames, audit-pack export artifacts, brand names, keyboard shortcuts, telemetry/localStorage/version strings, date/number formatting, and Monaco editor chrome stay out of localization.

## [0.3.56] - 2026-05-28

### Added
- **Localization rollout Wave 2 (Settings page).** Settings page strings now route through `react-i18next` while preserving English fallback behavior.
  - Migrated active Settings sections: `ThemeSection`, `HistoryRetentionSection`, System Health / OSConfig CLI controls, elevation controls, and About / reset first-run controls.
  - Skipped `LanguageSection` because Phase 0 already completed it, and skipped the commented-out Drift Control block because it is not rendered in v1.
  - Added 48 English keys to `apps/desktop/src/locales/en/settings.json`; FR/DE/ES `settings.json` remain unchanged for Wave 6 machine translation.

### Tests
- Added `apps/desktop/src/pages/Settings.test.tsx`, rendering Settings in English, switching to French with `i18n.changeLanguage('fr')`, and asserting the Language section heading updates to `Langue`.
- Full suite increased from the Wave 1 baseline of 1229 passing tests to 1230 passing tests (0 failing).

### Notes
- Carve-outs remain unchanged: brand names, keyboard shortcuts, localStorage keys, telemetry event names, About version/build details, Monaco editor chrome, and `packages/core` forwarded errors stay out of localization.

## [0.3.55] - 2026-05-28

### Added
- **Localization rollout Wave 1 (shell components).** Shell UI strings now route through `react-i18next` while preserving English fallback behavior.
  - Migrated string-bearing shell components: `Sidebar`, `Layout`, `Breadcrumb`, `WelcomeDialog`, `UpdateBanner`, `CliRequiredModal`, and `HealthIndicator`.
  - Audited shell components with no direct user-visible literals to extract: `TitleBar` (no-op stub), `DangerButton` (caller-provided label), `ExternalLink` (caller-provided label/aria), `TintedSpinner` (caller-provided label), and `AuditProgressCounter` (numeric counter only).
  - Populated Wave 1 English namespaces: `common`, `sidebar`, `dialogs`, and `welcome`.
  - Added the shell proof string `sidebar.nav.home` in FR/DE/ES (`Accueil`, `Startseite`, `Inicio`) so the Sidebar integration test proves runtime language switching end-to-end before the Wave 6 machine-translation pass.

### Tests
- `apps/desktop/src/components/Sidebar.test.tsx` now verifies `i18n.changeLanguage('fr')` updates the rendered nav label from `Dashboard` to `Accueil`.
- Full suite increased from the Phase 0 baseline of 1228 passing tests to 1229 passing tests (0 failing).

### Notes
- Carve-outs remain unchanged: manifest YAML, OSConfig CLI output, CIS rule text, baseline filenames, audit-pack export filenames, packages/core error strings, telemetry, Monaco editor chrome, keyboard shortcuts, and deferred date/number formatting stay out of localization.

## [0.3.54] - 2026-05-28

### Added
- **Localization plumbing (Phase 0 of 5).** ConfigForge can now load translation catalogs for English, French, German, and Spanish, with a Language picker in **Settings → Language** that lets users override the auto-detected OS locale. Phase 0 ships the infrastructure only — the Language section itself is fully translated in all four languages, but the rest of the UI is still English. Subsequent waves (v0.3.55–0.3.57) will fill in the strings page-by-page; FR/DE/ES catalogs will receive their full content in v0.3.58 after machine translation + review.
  - New `apps/desktop/src/lib/locale.ts` mirrors the `useThemePreference` shape exactly: `system | en | fr | de | es` enum, `localStorage` key `configforge-locale`, `useLocalePreference()` hook with `[pref, setPref]`. `system` resolves via `navigator.language` (`fr-CA → fr`, `de-AT → de`, `es-MX → es`, anything else → `en`).
  - New `apps/desktop/src/locales/index.ts` bootstraps `i18next` + `react-i18next` with 13 namespaces (`common`, `sidebar`, `settings`, `home`, `manifests`, `manifest-editor`, `diff`, `history`, `compliance`, `cis-catalog`, `audit-pack`, `welcome`, `dialogs`). Catalogs are eager-globbed at build time — no async fetch, no flash-of-untranslated-content. English is the fallback for any missing key in any locale.
  - **Kill-switch wired:** `initI18n()` is called from `main.tsx` inside a `.catch()`. If i18next fails to initialize for any reason, the app still boots and components display raw keys instead of localized text. Reverting to English-only is one `localStorage.removeItem('configforge-locale')` away.
  - **Carve-outs documented:** technical content (manifest YAML, OSConfig CLI output, CIS rule titles, baseline filenames, audit-pack PDF exports, `packages/core` error messages, telemetry) always stays in English regardless of UI language so artifacts remain greppable and bug-filable. Monaco editor chrome (find/replace, suggestions) also stays English in v1.

### Tests
- `apps/desktop/src/lib/locale.test.ts` — 10 cases covering `resolveLocale` for concrete + system preferences, navigator subtag stripping, unsupported-locale fallback, malformed-input safety, storage round-trip, and `initializeLocale` precedence rules.
- `apps/desktop/src/locales/index.test.ts` — 6 cases covering namespace load, populated key lookup, missing-key returns key, language switching across all four locales, English fallback for partially translated namespaces, and `{{interpolation}}` pipeline.
- `vitest.setup.ts` now boots i18next in English before each suite so the existing 1217 tests pass unchanged.

## [0.3.53] - 2026-05-26

### Fixed
- **Diff page "Select manifest" dropdown stability.** Clicking the Pairwise Before/After manifest picker sometimes did nothing — no popup, no error — and the failure persisted across page navigation until the app was restarted. Three independent defensive fixes:
  - **Removed `disabled={loadingManifests}`** from both Pairwise selects (`Diff/index.tsx`). If the `cfs.manifests.list({})` IPC ever stalled, `loadingManifests` stayed `true` forever, leaving the `<select>` permanently uninteractive even after navigating away and back. Loading is now communicated only via the placeholder option text.
  - **10s timeout on the manifest list IPC.** New `apps/desktop/src/lib/with-timeout.ts` helper wraps the call; a stuck handler now surfaces a recoverable banner error instead of hanging silently.
  - **Monaco editor hygiene** (`manifest-editor.tsx`): the capture-phase `pointerdown` listener attached in `handleEditorMount` is now removed on `editor.onDidDispose` instead of leaking on every unmount, and `fixedOverflowWidgets: true` keeps the find/suggest/hover widgets inside the editor's own DOM so they cannot become body-level orphans that intercept clicks on other UI after the editor is disposed.

### Added
- New tests `apps/desktop/src/lib/with-timeout.test.ts` (5 cases) and `apps/desktop/src/pages/Diff/index.test.tsx` (2 cases) pinning the contract that the Pairwise selects stay interactive while the manifest IPC is pending.

## [0.3.52] - 2026-05-26

### Removed
- **Windows Secure Shell (SSH) baseline removed from the library.** The `ssh.osc.yaml` / `ssh.csv` manifest has been retired from the bundled catalog.

## [0.3.51] - 2026-05-26

### Fixed
- **CIS Diff per-row "CIS Rule" column now populated for Linux.** v0.3.50 wired the new `linuxFuzzyMatch` into the compliance counter path but the per-resource display column went through the legacy `lookupCisRule` which still showed "No CIS rule" for most Linux resources. When `lookupCisRule` returns null but the benchmark matcher found a hit, the row now falls back to displaying the matched rule.
- **Installer artifact filename version.** `apps/desktop/package.json` was stale at 0.3.36, so installer filenames embedded the wrong version. Now synced with the root release version.

## [0.3.50] - 2026-05-26

### Fixed
- **CIS Diff Linux matcher overhaul.** The Azure Policy and XCCDF fuzzy matchers were missing most Linux rules (7.36% unique catalog coverage on the bundled SFF Linux Baseline, with several wrong matches — e.g. `/etc/cron.d` mis-matched to `/etc/cron.hourly`, and all `DCCP/RDS/SCTP/TIPC` resources collided on the GDM rule). New Linux-aware matcher (`linuxFuzzyMatch` in `packages/core/src/cis/xccdf-parser.ts`) gated on `platform === 'linux'`:
  - Walks nested `properties.resources[*]` so `Linux/KernelModule.properties.name = dccp` reaches the matcher.
  - Linux-specific stopwords (`configured/disabled/enabled/available/etc/file/line/system/...`); polarity (`disable` vs `enable` vs `configure`) detected from raw text **before** stopword removal so it isn't lost.
  - Light stemming (`users` → `user`, `requests` → `request`) and hyphenated-token handling (`usb-storage` keeps the whole token AND splits to `usb` + `storage`).
  - Path normalization with boundary-aware overlap — `/etc/cron.d` no longer prefix-matches `/etc/cron.daily`.
  - Token confidence weights: nested KernelModule/User names + path basenames = high; resource name = medium; ancestor path segments = low.
  - Best-vs-runner-up margin gate (≥ 0.15) unless the winner has an exact path or high-confidence token match.
  - Windows XCCDF + Windows Azure Policy untouched. Member-Server 2022 + 2025 still match the v0.3.46 baseline (75.10%–77.51% unique catalog coverage).
- **Audit results.** Linux SFF Baseline (47 resources) vs Linux Azure Policy CIS (299 rules): 39/47 = **82.98% resource hit**, 38/299 = **12.71% unique catalog coverage** (81% of the theoretical 15.7% ceiling). All four user-cited cases (USB Storage, DCCP, GID 0, default umask) now match.

### Added
- New tests `packages/core/src/cis/linux-fuzzy.test.ts` (29 cases covering kernel modules, paths, polarity, stemming, margin gate, Windows non-regression).
- Audit scripts `scripts/audit-linux-fuzzy.mjs` and `scripts/audit-windows-xccdf.mjs` for coverage diagnostics.

## [0.3.48] - 2026-05-26

### Changed
- **CIS Mapping subtitle points users to Diff > CIS.** The CIS Mapping page now mentions that a CIS Diff tab is also available on the Diff page after users add benchmark data.

## [0.3.47] - 2026-05-26

### Improved
- **History and Compare usability improvements.** The History panel now shows real change summaries via an optional `changeSummary` on `RegisterManifestRequest` (IPC-validated, max 200 chars), and Compare results auto-scroll into view from `CisDiffTab.tsx` / `Diff/index.tsx` after a run.

## [0.3.46] - 2026-05-23

### Fixed
- **CIS fuzzy matcher tightened.** Reduced over-matches while keeping benchmark coverage close (78% → 75.9% match rate), sanitized CIS-licensed titles from fixtures/comments, and added `scripts/smoke-azure-policy-fuzzy.mjs` for dev smoke checks.

## [0.3.45] - 2026-05-22

### Improved
- **Visual Builder expands `Microsoft.OSConfig/Group` resources inline.** Each Group is now rendered as a parent header card with its nested resources visible underneath as their own indented cards, each with its own Edit/Remove buttons. The Linux Security Baseline (~50 Group resources, each containing 2-3 nested File/FileLine/KernelModule resources) is now fully editable through the visual builder — no more YAML escape hatch. The Group parent card shows a "Group · N" badge so users see at a glance how many nested resources it contains.

## [0.3.44] - 2026-05-22

### Fixed
- **Visual Builder Edit no longer bricks the app** (grey backsplash regression from v0.3.42). Cause: `yamlFallbackPanel` closed over `editHeader`, which was declared further down in the function body. When the early-return branch called `yamlFallbackPanel(...)` before reaching the `const editHeader = ...` line, JavaScript's temporal dead zone threw `ReferenceError` — React caught it and rendered nothing inside the modal. Moved the `editHeader` declaration above the panel so the closure resolves correctly. Affects every Edit click, not just Group/unknown types.
## [0.3.43] - 2026-05-22

### Added
- **Azure Trusted Signing wired into `release.yml`**. New `Sign Windows installers with Azure Trusted Signing` step uses the official `azure/trusted-signing-action@v0.5.1` with the `ConfigForge` certificate profile. Activates only when 3 secrets (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) and 2 variables (`TRUSTED_SIGNING_ENDPOINT`, `TRUSTED_SIGNING_ACCOUNT_NAME`) are configured in GitHub repo settings. Coexists with the existing `.pfx` path (`WIN_CSC_LINK_BASE64` / `WIN_CSC_KEY_PASSWORD`). Signing-gate warning updated to accept either path. See `apps/desktop/SIGNING.md` for the full setup walkthrough (service-principal creation + secret values).

### Improved
- **CIS Azure Policy matcher now handles CSP-keyed resources**. Previously the Azure Policy benchmark fuzzy matcher only used the resource `name`; CSP resources (where the name is a noisy concatenation like `LocalPoliciesSecurityOptions_NetworkAccess_AllowAnonymousSIDOrNameTranslation`) frequently fell below the 0.6 word-overlap threshold even when the CIS rule title shared 7-8 strong tokens. Fix: strip the CSP category prefix and union CSP path-component words into the matching set, same as the XCCDF matcher. **Result on WS2025 Member Server vs Azure Policy CIS Baseline v1.0.0:** resources matched went from ~163/318 to **274/318** (86% of resources now show a CIS rule in the editor drawer). Compliance % bumped from 51.5% to **53.3%**; the gap from 73.9% remains real (Azure Policy CIS Baseline is a WS2019-era registry-keyed subset that doesn't model many of WS2025's CSP-based settings).

## [0.3.42] - 2026-05-22

### Added
- **README screenshots refreshed** with current v0.3.41 UX: new captures for **CIS Diff**, **CIS Mapping**, **Visual Builder**, and an updated Compare-manifests shot (WS2019 -> WS2025: 137/84/14 stats panel visible).
- **Visual Builder Edit now handles `Microsoft.OSConfig/Test` wrappers** by unwrapping to the inner Registry/CSP resource for the form, then re-wrapping on save with the original `properties.schema` preserved. WS2022/2025 baselines (~300 Test-wrapped resources each) are now fully editable inline.
- **YAML fallback editor in Visual Builder Edit** for `Microsoft.OSConfig/Group` and any other resource type without a per-field form. Pre-populates with the full resource as YAML, validates parse + required fields (`name`, `type`) on submit.

### Changed
- **Library page** "microsoft/osconfig" link now points at the top-level repo (https://github.com/microsoft/osconfig) instead of the CLI docs subdirectory.
- **Diff canonicalization** now treats path-like strings as equivalent under common Windows-path variations: doubled backslashes (`Foo\\Bar` == `Foo\Bar`), trailing backslashes (`HKLM:\System\` == `HKLM:\System`), and hive-prefix case (`hklm:\System` == `HKLM:\System`). Catches Windows Firewall Private/Public/Domain logging-name paths and Network Access Remotely Accessible Registry Paths/Subpaths reporting as "changed" when only backslash count differed between baselines.

### Capture pipeline
- Rewrote `scripts/capture-screenshots.mjs` to use `playwright._electron.launch()` directly. No more `npm run desktop:dev` dance \u2014 just `npm run desktop:build` then run the script. Launches the bundled Electron app, navigates routes via hash, and captures real cfs-backed UI (CIS Diff with real compliance numbers, Diff with real resource counts).
## [0.3.41] - 2026-05-22

### Changed
- **Visual Builder Edit is now form-based** (matches Add Resource UX). Clicking Edit on a resource card opens the same per-type form the Add panel uses (Registry Path / Value Name / Expected Value (compliance) / Enforcement Value / etc.) pre-populated with the resource's current values. New top-level "Resource Name" field allows rename in the same dialog. Unknown / unsupported resource types show a friendly "no form available" message.
- **Edit submit merges into the original resource** instead of rebuilding it. Preserves any properties the form doesn't know about (custom `valueType`, security descriptors, nested arrays in Group, etc.). Coerces values back to their original type so e.g. `"Administrators"` stays a string instead of being parsed as an int.

### Fixed
- **CIS Diff Source column**: `Azure Policy` badge no longer breaks onto two lines when the app is narrow. Added `whitespace-nowrap` to the badge and cell so the label always renders as one piece.
## [0.3.40] - 2026-05-22

### Changed
- **Cross-manifest conflict list is now fixed-height + scrollable** (max-height 400px), matching the visual builder's current-resources panel. Long conflict lists no longer push the rest of the page below the fold. Header now shows a count badge so you can see total conflicts before scrolling.
## [0.3.39] - 2026-05-22

### Added
- **Visual Builder: edit existing resources.** Each resource card now has an **Edit** button (next to Remove) that opens a YAML editor dialog. Edits the full resource (name, type, properties, compliance) in one shot, with parse validation and unique-name enforcement.

### Fixed
- **Visual Builder: rationale prompt now fires after visual-builder-only edits.** Previously the rationale baseline (efore) was read from a format-cache ref that the visual-builder Add/Remove handlers were overwriting — so on Save the diff against the baseline was empty and the prompt skipped. Switched to the on-disk `savedContent` baseline, which is only refreshed on load and successful save. Adds + edits + removes all bundle into a single rationale prompt on Save.
## [0.3.38] - 2026-05-22

### Changed
- **CIS Diff tab**: Status column is now manually sortable (click the column header to cycle: natural order -> unmapped first -> mapped first -> natural). The auto-sort introduced in v0.3.37 has been removed; the table now starts in its natural order and the user decides when to sort.
## [0.3.37] - 2026-05-22

### Fixed
- **CIS Diff tab**: Unmapped status indicator changed from light-grey to red filled X (much easier to see at a glance), and mapped to green filled checkmark for consistency. Includes accessible ria-labels.
- **CIS Diff tab**: Resource table now sorts unmapped rows first (more actionable), then mapped, alphabetically within each group.
## [0.3.3] - Stable-width audit counter + CIS Catalog: file checklist & true recheck

### Fixed

- **Audit counter layout jitter** — Rendering `${completed}/${total}` raw inside the Deploy button caused the button (and the surrounding `flex flex-wrap` action cluster) to reflow each time `completed` crossed a digit boundary (1→2, 9→10, 99→100, …). At certain viewport widths the whole row would wrap to a second line, then snap back, then wrap again on the next tick. Replaced with a new `<AuditProgressCounter>` component using `font-variant-numeric: tabular-nums` + figure-space left-padding + `min-width: Nch`. The counter span is now a fixed width for the entire audit. Applied in both Manifests list and ManifestHeader.
- **CIS Catalog "Re-check" cache bug** — `cfs:cis:recheck` only invalidated the status cache; `loadCisGlobalMappings` kept its own module-scope cache that returned the still-null result. Dropping a file and clicking Re-check appeared to do nothing without an app restart. `_resetCisStateForRecheck` now clears all CIS data caches.

### Changed

- **CIS Catalog page** — Shows a per-file checklist with green check / red REQUIRED indicators so users can see at a glance which expected JSONs are present and which are missing. Setup card copy now accurately describes the OSConfig CIS pipeline sidecar files (`cis-mappings.json`, `cis-ws<YEAR>-rules.json`, etc) instead of a generic and incorrect array shape.

### Maintainer notes

- New `CIS_EXPECTED_FILES` constant in `packages/core/src/cis/data.ts` so the renderer and handler share one source of truth for expected filenames.
- `getCisStatus` now scans the data dir and returns a presence-map. Cheap (≤6 stat calls) — runs once per page load + once per Re-check.
- `AuditProgressCounter` is unit-tested for padding, clamping, and CSS plumbing (5 new tests).
- 1172/1172 unit tests pass.

---

## [0.3.2] - CIS Catalog page: show resolved path + Open folder

### Headline

Drive-by polish on the CIS Catalog page. The instructions used to point users at `public/_baselines/cis/_data/` — the source-tree path — which is **not** where the packaged app reads from. The page now shows the **actual resolved on-disk directory** for the current install, with a one-click **Open folder** button (Explorer / Finder) and an in-app **Re-check catalog** action that doesn't require an app restart.

### Changed

- **CIS Catalog page** — shows the resolved runtime path (e.g. `%LOCALAPPDATA%\Programs\configforge\resources\public-assets\_baselines\cis\_data\` on Windows installs, or `<repo>/public/_baselines/cis/_data/` in dev), with **Copy** + **Open folder** + **Re-check catalog** buttons. Open-folder creates the directory if it's missing (typical for fresh installs since the CIS data is gitignored).
- `CisStatus` now carries a `dataDir` field. `getCisStatus` returns the resolved path so the renderer doesn't have to duplicate the path-strategy logic.
- New IPC: `cfs:cis:reveal-data-dir` (creates the directory if missing, opens with `shell.openPath`, invalidates the status cache) and `cfs:cis:recheck` (force-refresh).

### Maintainer notes

- `packages/core/src/cis/data.ts` now exports `getCisDataDir()` so handlers/UI can resolve the path without re-implementing the public-asset-root logic.
- All 1167 unit tests pass.

---

## [0.3.1] - Phase 3 — settings store, snapshot rotation, deploy recovery, breadcrumbs

### Headline

Completes the v0.3.x audit-tracked feature plan. Adds a userData-side **settings store** (foundation for user preferences the main process needs to read), rotates **pre-deploy snapshots** so revert is no longer one-level-deep, surfaces a **deploy-recovery banner** when a previous enforce was killed mid-write, and renders **breadcrumbs** on nested manifest pages.

### Added — Reliability

- **Pre-deploy snapshot rotation (#2)** — `runDeploy` now writes both the canonical `<ns>.pre-deploy.json` pointer (backward-compatible — `revert.ts` keeps working unchanged) *and* a timestamped `<ns>.pre-deploy-<ISO>.json` backup. Retention is configurable (default 5, env override `CFS_PRE_DEPLOY_SNAPSHOT_RETENTION`). Old single-snapshot users continue to revert exactly the same way — they just now keep a deeper trail.
- **Mid-deploy interruption sentinel + dashboard banner (#4)** — Before `applyManifest` in enforce mode, deploy writes a `<ns>.deploy-in-progress` sentinel under the snapshots dir; cleared on success or explicit failure. On app start, the renderer probes `cfs.deployRecovery.listInterrupted()` and shows a persistent dashboard banner *"A deploy of '{name}' may have been interrupted. Your device may be in a partially-applied state."* with Audit / Revert CTAs and a "I've handled it" dismiss action.

### Added — Settings & UX

- **userData settings store (#23)** — New `<userData>/settings.json` with atomic-write + 1-second read cache. Schema v1: `historyRetention` (5-1000, default 20), `preDeploySnapshotRetention` (1-50, default 5), `auditPackPiiWarningDismissed`. Env vars `CONFIGFORGE_HISTORY_MAX_COUNT` (legacy) and `CFS_PRE_DEPLOY_SNAPSHOT_RETENTION` continue to win as power-user overrides. Wired through new `cfs:settings:get/:set` IPC.
- **History retention number input in Settings (#23)** — Settings page exposes the retention value as a numeric input (5-1000) with a Save button. Save calls `cfs.settings.set({historyRetention})` and the history-prune sweep picks it up on the next save.
- **Breadcrumbs on nested manifest pages (#12)** — `Breadcrumb` component (FluentUI `ChevronRightRegular` separator, `react-router-dom` `<Link>` parents) added to Manifest Editor, Manifest History, and Manifest Audit Pack. Example: `Manifests > ws2025-member > History`.

### Fixed

- `packages/core/src/history/index.ts` retention sweep now lazy-imports the settings store only when the env-var override is *unset*, preserving the legacy `0`/`-1` "disable pruning" semantics that the test suite encodes.

### Maintainer notes

- The dual-write snapshot strategy keeps `revert.ts` unchanged — the canonical `<ns>.pre-deploy.json` pointer is still the "latest" the existing UI restores to. Future work can surface the timestamped trail in a "revert to which snapshot?" picker.
- Lazy `await import('../handlers/settings')` inside the prune callback avoids a circular dep (history → handlers/settings → handlers → history).
- Sentinel write/clear is gated behind `mode === 'enforce'` — audit-only deploys do not write sentinels because there is no device mutation to recover from.
- All 1167 unit tests + 59 e2e tests pass.

---

## [0.3.0] - Private-preview readiness features (Phases 1 + 2)

### Headline

First feature wave of the v0.3.0 series. **17 audit-tracked features**, all real defects-or-omissions our 3-track audit surfaced — no speculative work. Phase 3 (#2 snapshot rotation, #4 deploy-recovery banner, #23 settings store, #12 breadcrumbs) is queued for v0.3.1 so this release ships cleanly without on-disk migrations.

### Added — Security (CF-SEC-019 / -020 / -021)

- **Main-process confirmation gate for enforce mode (CF-SEC-019, #1)** — `cfs:deploy:run` now shows a native `dialog.showMessageBox` before `runDeploy` whenever `mode === 'enforce'`. The renderer's `window.confirm()` can be bypassed by a compromised renderer dispatching the IPC directly from devtools; this native gate cannot.
- **Runtime-secret log redaction patterns (CF-SEC-020, #3)** — `apps/desktop/electron/log.ts` now redacts `Authorization: Bearer …`, `AZURE_CLIENT_SECRET/CLIENT_ID/TENANT_ID`, Azure SAS / OAuth URL params (`?sig=…&token=…&access_token=…`), and `password=`, `secret=`, `api_key=` patterns in addition to the existing CI build secrets. Customer Azure / Bearer / SAS leaks via fetch error stacks no longer reach disk in cleartext.
- **CLI version-mismatch banner (CF-SEC-021, #5)** — `HealthStatus` gains `versionMismatch` + `expectedVersion` fields; the renderer's footer pill turns amber and surfaces *"oscfg X — expected Y. ConfigForge was validated against Y; the installed CLI may produce unexpected errors during deploy or audit — upgrade if you hit issues."*
- **Namespace-collision warning on register (#20)** — `registerManifest` now checks `getRegistration(namespace)` before saving; if a different `displayName` already maps to the same sanitized namespace, surfaces a warning in the response. Renderer can pass `force: true` to skip when the user explicitly confirmed.
- **Audit-pack hostname PII warning (#24)** — Before generating any audit-pack ZIP, a one-shot dialog asks the user to confirm they're OK with the hostname being embedded. Stored in `localStorage('cfs.auditpack.pii-warning.dismissedAt')` — one warning per machine.

### Added — Reliability

- **`uncaughtException` + `unhandledRejection` handlers in main process (#22)** — Silent main-process crashes during preview no longer die without a trace; both catchall handlers wire to `electron-log`.
- **Stale rationale lock sweep on startup (#21)** — `apps/desktop/electron/main.ts` sweeps `~/.configforge/rationale/*.jsonl.lock` files older than 5 min on `app.whenReady`. Prevents the "could not acquire rationale append lock after 100 retries" error when a previous process was killed mid-save.

### Added — UX

- **Dashboard first-run "Get started" card (#7)** — For any first-run user with 0 manifests and the welcome dismissed, surfaces a persistent card pointing to **Browse Library** and **Register your own**. Dismissable; localStorage so it stays gone.
- **Compare Manifests quick action on Dashboard (#15)** — Fourth action button → `/diff`.
- **Format-tab unsaved-changes notice (#14)** — `MessageBar intent="info"` above the format tabs when the user has unsaved edits in YAML/JSON, so the buffer preservation across tab switches is visible.
- **Revert button disabled when no deploy history (#18)** — Both the editor header Revert and the Manifests list Revert respect `manifest.Deployed`. `title` tooltip explains why on hover.
- **History/Revert disambiguation (#17)** — History button renamed "Restore" → "Restore snapshot" with a tooltip explaining it replaces the YAML; Editor Revert tooltip explains it undoes a deploy on the device.
- **Compliance Status empty state has actionable guidance (#8a)** — *"No compliance data yet. Run Audit or Enforce to check this baseline against the device."*
- **Diff page 1-manifest banner (#8b)** — When exactly 1 manifest is registered, surfaces an info banner explaining the user needs a second or can paste YAML.
- **Manifests page empty state adds Library CTA (#8c)** — Secondary *"Or browse the baseline library"* button next to Register New.
- **Theme toggle in Settings (#9)** — Light / System / Dark segmented control. "System" follows OS via `matchMedia`. Persisted via `useThemePreference()` hook (already-existing infrastructure in `lib/platform.ts`).
- **Settings copy: scrub "on PATH" + show resolved binary path (#10)** — `Settings.tsx` and `CliRequiredModal.tsx` no longer claim OSConfig has to be on the system PATH (we look in env → PATH → bundled → installed → MSIX). Settings now shows the actual resolved binary path under the OSConfig Module row.
- **CIS Catalog moved to its own sidebar page (#11)** — New `/cis` route + sidebar entry + `CisCatalogPage` with catalog-loaded status indicator and setup instructions. Editor stays at its current two drawer tabs; CIS integration is now opt-in and easy to prune (one route + one sidebar line + one page).
- **Resource picker search box (#13)** — `<input type="search">` above the type grid in `ResourcePicker`. Case-insensitive on type+label+description.
- **URL import error classification (#16)** — Raw `HTTP 404` / `fetch failed` messages now mapped to friendly actionable copy by status code (404, 401/403, 5xx, abort/timeout, private-IP, scheme, too-large).

### Test plan

- 1167/1167 vitest passing (added `getRegistration` to the `oscfg` mock for `manifests.test.ts`).
- 59 Playwright e2e passing (smoke + workflows updated for the new CIS Catalog sidebar entry).
- 0 lint errors.

### Deferred to v0.3.1

- #12 Breadcrumbs for nested pages
- #2 Pre-deploy snapshot rotation (needs on-disk migration)
- #4 Mid-deploy interruption recovery banner (depends on #23)
- #23 Shared userData settings store + history retention

### Skipped (per user direction)

- #6 Windows code signing (no cert available)
- #19 Crash reporter + opt-in telemetry (deferred for a later release)

---

## [0.2.21] - Private-preview audit fixes (security, reliability, UX)

### Headline

A 3-track audit (safety / reliability / UX) flagged a stack of real, doubly-verified bugs that would have shipped to a private-preview customer cohort modifying real Windows baselines. This release fixes all of them. No new features — every change is a documented defect repair.

### Fixed — Security (CF-SEC-016 / -017 / -018)

- **SSRF blocked on `cfs:manifests:fetch-uri`** — `fetchManifestFromUri` now rejects localhost, loopback (127/8), link-local (169.254/16 incl. Azure/AWS IMDS), private (10/8, 172.16/12, 192.168/16), 0.0.0.0, IPv6 ULA (fc00::/7), and IPv6 link-local (fe80::/10) destinations before issuing the fetch. Previously a compromised renderer could direct the privileged main process to fetch cloud-instance metadata or internal-network admin panels and exfiltrate the response as "manifest content."
- **`path` field removed from `cfs:manifests:register`** — The legacy Next.js-era `path` parameter was an arbitrary host-file-read primitive (read `id_rsa`, AWS creds, etc.). Validator now hard-rejects payloads with a `path` key, and the core handler does the same as defence-in-depth. Renderer never used this field; file imports go through `importChannel`.
- **IPC validator for `cfs:manifests:list`** — The list channel was the lone mutating-or-privileged channel without an explicit input validator. Added `validateListManifestsRequest` to match the rest of the IPC surface.

### Fixed — Reliability

- **History snapshots now atomic (temp + rename)** — `saveSnapshot` and its `.meta` sidecar used direct `writeFile`, leaving truncated snapshots on disk after a disk-full or process kill. Switched to the same atomic write pattern the registry and audit-results store already use. Without this, a later "Restore snapshot" could re-apply a corrupt YAML to the customer's machine.
- **`deleteManifest` now also deletes the manifest's history directory** — Previously, deleting and re-registering under the same namespace surfaced ghost snapshots from the prior registration on the History page; clicking "Restore snapshot" silently overwrote new content with old, unrelated YAML. Added `deleteHistoryForManifest` and wired it into `deleteManifest` as a best-effort cleanup.
- **`useCliPresence` no longer crashes on the mac-author flavor** — On flavors that intentionally omit the `health` IPC namespace (mac author-only build), the unguarded `cfs.health.check()` threw a TypeError, pinning the CLI presence pill to permanent amber and breaking `CliRequiredModal`. Routed both `check` and `recheck` through `safeCfs('health')` with a graceful no-op for missing-namespace flavors.
- **`ManifestHistory.tsx` restore now uses a live Electron IPC client** — `safeRestore` was being called with `defaultBrowserClient()`, a Next.js-era helper whose four `fetch('/api/...')` calls don't exist in the packaged Electron app. The entire Restore-snapshot flow was 100% non-functional. Added `electronRestoreClient` which delegates to `cfs.history.list({name, id})`, `cfs.manifests.status`, `cfs.history.save`, and `cfs.manifests.register`.
- **Format-tab race-guard** — Flipping fast between YAML/JSON/MOF could land stale MOF content in the YAML buffer; a subsequent save would commit MOF as the manifest's YAML, corrupting registration. Added a `latestFormatRequestRef` so a slow in-flight fetch only writes back if the user is still on that tab.
- **Diff page no longer swallows errors** — Two `catch {}` blocks (analyzer + manifest-list IPC) surfaced silent empty states. Both now route to a dismissible page-level `MessageBar`.

### Fixed — UX

- **LAPS / SSH `Could not read` rows now show a computed verdict when the CLI doesn't emit one** — When the OSConfig CLI returns a Test resource without a `compliance` field but a parseable schema is present, the tool now evaluates the schema locally against the reported value and renders a verdict with `(computed locally — CLI did not return a verdict)` appended to the reason. Recognizes `const`, `oneOf [const, type:null]`, `enum`, `minimum/maximum`, and `pattern` schemas. Closes the LAPS `PasswordComplexity` / `PasswordLength` mystery.
- **Settings: "OSConfig Module" no longer shows "voscfg X.Y" double-prefix** — `health.version` already contains `oscfg X.Y`; the row wrapper was prepending another `v`.
- **DeployResultPanel: per-resource Reason column added** — The audit result table had Resource/Type/Status only; admins had to scroll past it down to `ComplianceTable` to see why a row was non-compliant. The data was already there (`r.reason`).
- **Revert confirm copy is accurate** — Both the editor and the Manifests-list "Revert" buttons used contradictory descriptions ("manifest will be unregistered" vs "settings restored"). Both now describe both possible outcomes (snapshot replay vs unregistration depending on whether a pre-deploy snapshot exists).
- **WelcomeDialog: deploy-mode card hidden on flavors without the health IPC** — Previously the mac-author build invited users to install OSConfig locally on a platform where deploy doesn't work. The card is now gated on `hasCfsNamespace('health')`.
- **Audit on a 0-resource manifest now emits a 400 with an accurate message** — Previously hit a generic "not readable" 404 that implied the YAML was corrupt.
- **Diff insights panel copy** — "AI-Assisted Analysis · Deterministic" was the contradictory pair from v0.2.20; renamed to "Intelligent Diff Insights · Heuristic, locally-computed summary" (already in v0.2.20, called out here for completeness).
- **SSH library manifest scrubbed of internal authoring comments** — A customer reading the YAML shouldn't see `# Source: ssh.csv (12 rules, regenerated PR20)`.
- **Monaco editor: Find widget X button + Escape now both close it reliably** — A parent (FluentProvider/bottom drawer/Resource Explorer) was intercepting the keydown and click events before Monaco's find controller saw them. Bound Escape explicitly and added a capture-phase pointerdown delegate on the editor host that catches `.codicon-widget-close` clicks and dispatches `closeFindWidget` directly against the editor instance.
- **Rationale entry timestamps + author readable** — Timestamps were `text-[10px] text-slate-500` on a `bg-slate-950/60` drawer (~2.5:1 contrast). Bumped to `text-[11px] text-blue-300 tabular-nums` (timestamp) and `text-slate-200` (author), with the · separator distinguishing.

### Notes

- Author name detection chain documented in `packages/core/src/history/author.ts`: `CONFIGFORGE_AUTHOR` env → `git config user.name/.email` → `os.userInfo().username` → `unknown`. No system scraping beyond what `git` itself reads.
- 1167/1167 vitest passing (existing failing tests updated for the new `path`-rejection and `deleteHistoryForManifest` mock). 58 Playwright e2e passing. 0 lint errors. Core builds clean.
- **Deferred for follow-up release(s)**: Windows installer signing (requires actual code-signing certificate), pre-deploy snapshot rotation (current single-snapshot is one revert level deep), main-process enforce-mode confirmation dialog, log-redaction patterns for Azure SAS / Authorization Bearer / `api_key=` shapes, mid-deploy interruption recovery prompt on app restart. All four are tracked from the safety/reliability audit reports.

---

## [0.2.20] - Empty-value equivalence in conflict detection + AI/deterministic copy fix

### Headline

`""`, `[]`, `null`, and absent are all the same security posture for an empty User Rights / policy value. The conflict detector was JSON-stringifying them straight, so `""` (`'""'`) and `[]` (`'[]'`) classified as different and produced spurious conflict cards for rules every baseline agreed are empty. Also fixed a contradictory copy line that called the analysis "AI-Assisted" and "Deterministic" in the same breath.

### Fixed

- **Empty-value equivalence in `detectConflicts`** — Replaced raw `JSON.stringify(v ?? null)` comparison with a `normalizeForCompare()` helper that maps `undefined`, `null`, `""`, `[]`, and `{}` all to the same empty sentinel before bucketing. The "UserRightsModifyObjectLabel" conflict card across WS2022-MS / WS2025-WG / WS2025-MS — and similar empty-equivalence false positives — no longer surface.
- **String-array values compare order-independently** — User Rights are a *set* of principals; two manifests that list the same SIDs in different order describe identical permissions. Now sorted before serializing so they compare equal.
- **Diff insights panel copy: "AI-Assisted Analysis · Deterministic analysis of configuration changes"** — The "AI" / "deterministic" pair was self-contradictory. Replaced with "Intelligent Diff Insights · Heuristic, locally-computed summary of configuration changes" — accurate (heuristic + local), honest (no LLM involved), and no false AI buzzword.

### Notes

- 3 new analyzer unit tests in `analyzer.test.ts` cover the empty-equivalence (`""` ↔ `[]` ↔ `null`), partial-empty disagreement (one manifest has real value, others empty → real conflict), and order-independent SID arrays.
- Verified against the official Microsoft WS2022-MS / WS2025-MS / WS2025-WG baselines: 0 empty-equivalent spurious conflicts (was producing false positives previously). Real conflict count: 15 (unchanged).
- 1167/1167 vitest passing. 58 Playwright e2e tests passing.

---

## [0.2.19] - Matrix-diff: differs wins over partial + CI e2e flake fix

### Headline

A rule that's set to *different values* across baselines is a **drift** — not a "partial coverage" issue, even when one of the baselines is missing the rule entirely. The matrix-diff classification was checking `partial` before `differs` and consequently hiding real value disagreements under a "presence asymmetry" label. Also fixed a CI-only e2e flake from missing WelcomeDialog dismissal.

### Fixed

- **Matrix-diff status: `differs` now takes precedence over `partial`** — Previously `WS2019=1, WS2022=missing, WS2025=0` was classified as `partial` (because one baseline was missing the rule), even though the present baselines had a real value drift. Now classifies as `differs` whenever ≥2 present baselines disagree on value, regardless of whether other baselines are missing the rule. `partial` is now reserved for its correct semantic: pure presence asymmetry where all *present* baselines agree (a rule added in a newer OS version, etc).
- **Conflict-detection e2e tests no longer hang in CI** — The new `conflict-detection.spec.ts` was missing the `cfs.welcome.dismissedAt` localStorage dismissal that every other e2e spec sets in `beforeAll`. On a clean CI Electron profile the first-run WelcomeDialog mounted and intercepted every sidebar click, causing `locator.click: Timeout 30000ms` failures on tests that worked locally because dev boxes already had the modal dismissed.

### Notes

- 4 new matrix unit tests pin the new precedence (`packages/core/src/diff/matrix.test.ts`):
  - 3-way row with 2 present baselines disagreeing → `differs` (was `partial`)
  - 3-way row with all present baselines agreeing → `partial` (unchanged)
  - Pairwise rule only in A → `partial`
  - 3-way with mixed present-disagreement and missing → `differs`
- 1164/1164 vitest passing (1160 + 4 new). 58 Playwright e2e tests passing. 0 lint errors.

---

## [0.2.18] - Cross-OS-version conflict detection + Dashboard rename

### Headline

Pass-2 normalized-name bridge for cross-encoding conflict detection (WS2019 spaced display names ↔ WS2022/WS2025 CamelCase rule IDs), real Playwright coverage of the official Microsoft baseline trios across 2019/2022/2025, and the Dashboard CTA renamed to match the sidebar's "Validation" terminology.

### Added

- **Pass-2 normalize-name bridge in `detectConflicts`** — mirrors `analyzeDiff`'s two-pass match contract. Pass 1 still buckets by schema-canonical identity (Test-unwrapped). Pass 2 now buckets *remaining* resources by normalized rule name (lowercase + strip non-alphanumeric) so a resource whose canonical key didn't match anything in Pass 1 still gets a chance to bridge a cross-encoding gap. Concretely, the WS2025 baselines wrap most rules in `Microsoft.OSConfig/Test` over `Microsoft.Windows/CSP`, whereas WS2022 baselines use bare `Microsoft.Windows/CSP` with the same rule names — different canonical keys, same normalized name, now correctly matched. 13–19 real role-stable cross-version conflicts surface across the MS baselines.
- **Four new analyzer unit tests** pinning the Pass-2 behavior:
  - Spaced vs CamelCase rule names with different values → conflict
  - Spaced vs CamelCase rule names with same value → alignment, no conflict
  - All four naming styles (hyphen, underscore, period, CamelCase) normalize identically
  - Canonical-key Pass-1 takes precedence over Pass-2
- **End-to-end Playwright coverage** of cross-OS-version conflict detection — registers the official Microsoft Member Server baselines for all three OS versions and asserts known WS2022→WS2025 deltas (FirewallDomainProfileInboundConnection, MessageTextUserLogonTitle) surface as conflict cards in the live Validation page UI.

### Changed

- **Dashboard CTA card and quick-action button renamed `Compliance` → `Validation`** to match the v0.2.15 sidebar rename. The route `/compliance` is unchanged so deep links still work.

### Notes

- The honest data on cross-OS-version drift across the shipped Microsoft baselines:
  - **WS2019 ↔ WS2022**: 0 conflicts. WS2019 still uses spaced Windows Audit Policy display names ("Audit MPSSVC Rule-Level Policy Change"); WS2022 already moved to CamelCase rule IDs. Only ~24/265 rules normalize-match and all 24 agree on values.
  - **WS2022 ↔ WS2025**: 13–19 conflicts via Pass-2. Same naming convention; 239/257 rules normalize-match; a real handful disagree (firewall profile inbound defaults, account lockout policy, etc).
  - **WS2019 ↔ WS2025**: 0 directly-bridgeable conflicts. Same name-catalog drift as 2019↔2022. The 25 rules that DO bridge all agree on value. The remaining 240 WS2019 rules don't exist in WS2025 at all — Microsoft restructured the catalog. Algorithmically unrecoverable without a curated alias map.
- 1160/1160 vitest passing (1156 + 4 new). 58 Playwright e2e tests passing. 0 lint errors.

---

## [0.2.17] - Cross-manifest conflict detection: read source YAML, not reported state

### Headline

v0.2.16 fixed the conflict-detection algorithm. v0.2.17 fixes what it was reading. The detector had been pulling YAML from `cfs.manifests.status()`, which returns the **CLI-reported live state** — for any manifest that was registered but not yet deployed, that's an empty stub with no resources. So the algorithm could be perfect and still see "nothing to compare." This release routes the detector to the registered source YAML instead.

### Fixed

- **Conflict detector reads source YAML, not reported state** — Switched `ConflictDetector` from `cfs.manifests.status()` (which returns reconstructed YAML of the agent-reported live system state — empty for registered-but-undeployed manifests) to a new dedicated `cfs.manifests.getSource()` IPC backed by `getRegistrationSource()`. This is the "what the user actually wrote" payload that matrix-diff and the editor already use.

### Added

- **New IPC channel `cfs:manifests:source`** — returns the registered manifest's source YAML, or `{data: null}` for an unregistered namespace. Distinct from `manifests/status` (live state) and `manifests/get` (metadata).
- **End-to-end Playwright coverage of conflict detection** (`apps/desktop/e2e/conflict-detection.spec.ts`) — 4 tests that drive the real built Electron app, register manifests via live IPC, navigate to the Validation page, and assert the actual rendered conflict cards:
  - Same registry value+name, different values → conflict card shows both manifest names + both values
  - Bare Registry vs `Microsoft.OSConfig/Test`-wrapped Registry for same setting → conflict still surfaces
  - Same setting + same value → no conflict card
  - **Three real Microsoft WS2025 role baselines** (Member Server / Domain Controller / Workgroup Member, ~300 rules each) — asserts that the known DC-only `*S-1-5-9` Enterprise Domain Controllers SID in `AllowLocalLogOn` surfaces, and the MS=1 / DC=2 / WG=1 `SAMRPCPasswordChangePolicy` drift surfaces.

### Notes

- Running `detectConflicts` against the 3 shipped WS2025 baselines surfaces **13 genuine role-specific deltas** including AllowCustomSSPAPIntoLSASS, EnabledNTPClient (WG-only since DCs use AD time), SAMRPCPasswordChangePolicy, ServerSPNTargetNameValidationLevel, and several User Rights differences. This is real, useful signal for security admins composing multi-role deployments.
- 1156/1156 vitest passing. **57 Playwright e2e tests passing** (53 prior + 4 new conflict-detection). 0 lint errors.
- The `data-testid="conflict-list" / conflict-card / conflict-none` attributes added to `ConflictDetector` are stable test hooks; they have no production effect.

---

## [0.2.16] - Cross-manifest conflict detection actually works

### Headline

The Validation page's "Cross-Manifest Conflicts" check was missing real conflicts and (worse) reporting false ones. Two baselines that visibly disagreed on the same setting in the Diff page would show up as "no conflicts" on the Validation page. Root cause: the conflict scanner hand-rolled its own resource-identity and value-extraction logic instead of using the canonical helpers that matrix-diff already had. Now it uses them.

### Fixed

- **Conflict detection misses Test-wrapped resources** — A bare `Microsoft.Windows/Registry` resource in one baseline and a `Microsoft.OSConfig/Test`-wrapping-Registry resource in another, both targeting the same registry value but with different values, were treated as two unrelated settings. Now unwrapped via the canonical `resourceKey()` so they collide and the value difference is reported.
- **Conflict detection conflates different `valueName` under same `keyPath`** — Two manifests that wrote *different* registry value names under the same key were bucketed together; their distinct values then looked like a conflict. The identity key is now `keyPath\\valueName`, so they're correctly treated as independent settings.
- **Conflict detection ignores `compliance.equals`** — Report-only manifests (`compliance.equals: SuccessAndFailure` etc.) had no `properties.value`, so the old scanner dropped them silently. The detector now uses `extractEnforcementValue()`, which prefers `compliance.equals` (matching matrix-diff's contract), so audit-only drift across baselines is finally surfaced.
- **Conflict detection misses AuditPolicy / UserRightsAssignment / AccountPolicy canonical identifiers** — The old scanner only knew `keyPath`/`path`/`name`. Now uses the canonical `subcategory` (AuditPolicy), `policy` (UserRights/AccountPolicy), and `ruleId` (BaselineRule placeholder) identifiers via `resourceKey()`.
- **Conflict detection misses typed registry shapes** — `{ dword: 1 }` vs `{ dword: 0 }` looked like complex object differences instead of `1 → 0`. Now unwrapped to the inner scalar to match matrix-diff.
- **Cosmetic naming drift was unmatched** — `AuditLogon` vs `Audit Logon` (same setting, different naming style) used to bucket separately. Now collide via normalized-name fallback in `resourceKey()`.

### Changed

- `extractEnforcementValue()` hoisted from a nested closure inside `analyzeDiff` to module scope so `detectConflicts` (and any future consumer) can reuse it.

### Notes

- 6 new tests in `packages/core/src/ai/analyzer.test.ts` cover the specific failure modes above (Test-wrap unwrap, same-keyPath-different-valueName, compliance.equals-only, typed registry values, same-setting-same-value not flagged).
- 1156/1156 vitest passing (1150 + 6 new). 53 Playwright e2e tests passing. 0 lint errors.

---

## [0.2.15] - Validation page fixes + URL import flow + compliance table density

### Headline

Round of fixes on the Validation page (formerly "Compliance" in the sidebar) and the per-manifest Compliance Status table, plus a real URL-import-with-edit flow. The Compliance sidebar link is now called **Validation** to match what the page actually does — actual deployment compliance status still lives on the per-manifest page.

### Changed

- **Sidebar: "Compliance" → "Validation"** — matches what the page does (manifest validation + export readiness). The route `/compliance` is unchanged so any deep links still work.
- **Compliance Status table is denser** — Reason and Type columns now truncate with a hover tooltip instead of wrapping to multiple lines, which was blowing rows up to ~200px tall and forcing admins to scroll past 2–3 rows per screen. Row padding tightened (`py-3` → `py-2`), Resource column proportions retuned so the Reason column gets visible width. Most pages now show 12–15 rows per screen instead of 4–5.

### Fixed

- **ConflictDetector re-fired N IPC calls on every parent render** — `manifestNames` was a fresh `manifests.map(...)` literal on each render, so the child's `useEffect([manifestNames])` ran every time. Now memoized in the parent and additionally locked to a value-stable key (sorted CSV) inside the child for defense-in-depth.
- **Export errors were swallowed silently** — the Export buttons used `try { await … } catch { /* ignore */ }`, so permission-denied / disk-full / bad-path errors never surfaced. Now distinguishes a user-cancel envelope (`{ok:false,error:'cancelled'}` from the file picker) from real failures, and renders failures inline next to the button.
- **MOF export was hard-disabled for any manifest containing a `Microsoft.Windows/CSP` resource** — the backend MOF generator handles CSP just fine; the UI safeguard was stale. Removed.
- **`$schema` flagged amber when missing** — `$schema` is optional on OSConfig manifests; surfacing it as a warning created false signal that conflicted with v0.2.12's intentional decision to stop showing schema warnings in the editor. Now neutral.
- **`unnamed` manifests dropped silently** — backend regressions that produce nameless records used to disappear with no trace. Now logs a `console.warn` before filtering so the bug is observable.
- **"Export Ready" overview count over-reported** — a manifest with 0 issues *and* 0 resources counted as Ready while every per-format button was disabled. Now requires at least one resource.

### Added

- **Import from URL with edit before register** — new "Fetch & Edit" button in the New-manifest URL flow. Pulls the manifest from the URL (via a new `cfs.manifests.fetchUri` IPC backed by an extracted `fetchManifestFromUri()` core helper), loads the content into the editor, and switches to content mode. The user reviews/edits, then clicks Register to commit. The previous flow (paste URL → click Register → backend fetches and registers in one step) is unchanged for users who don't need to edit first.

### Notes

- New IPC channel `cfs:manifests:fetch-uri`. Same 10 MB cap, 30s timeout, http/https-only scheme guard as the existing register-via-uri path (the new helper is the extracted helper that path now uses).
- 1150/1150 vitest passing (Sidebar test updated for the rename). 0 lint errors. Core builds clean.

---

## [0.2.14] - Editor: bigger working canvas for IT admins

### Headline

The Monaco editor was locked to a fixed `h-[500px]` regardless of monitor size, so admins editing 200-rule baselines were paging through a tiny window on 1440p displays while the rest of the page was empty. Switched the editor wrapper to a viewport-relative height that grows with the screen, with a sensible floor for laptops.

### Changed

- **Editor canvas grows with the viewport** — Manifest viewer/edit page and "New manifest" YAML/JSON tabs now size the editor as `h-[calc(100vh-340px)]` (and `min-h-[520px]` so small laptops still get a usable height). On a 1440p display this roughly doubles the visible code area; on 1080p it gains ~200px. The Resource Explorer left rail and the bottom drawer track the new height automatically.

### Notes

- Two-file change: `pages/ManifestEditor/components/ManifestContent.tsx` and `pages/ManifestNew/index.tsx`.
- 1150/1150 vitest passing. 0 lint errors.

---

## [0.2.13] - Editor: less-invasive bottom drawer + readable empty rationale

### Headline

Polish pass on the v0.2.11 bottom drawer based on live feedback: the drawer is now noticeably smaller when expanded, the left Resource Explorer is a bit narrower, and the "No rationale captured yet for this resource." empty-state text is finally readable.

### Changed

- **Editor drawer is less invasive** — Expanded drawer height reduced from 280px to 120px (~57% smaller). Rationale entries are short and most users only need to glance at the latest one or two — anything longer routes to the full `View all →` page. Reclaims ~160px of vertical space for the editor.
- **Resource Explorer is a touch narrower** — Left sidebar width reduced from `w-48` (192px) to `w-40` (160px), ~17% smaller, freeing horizontal room for the editor.
- **Empty-state rationale text is readable** — The "No rationale captured yet for this resource." placeholder used `text-slate-500` on `bg-slate-950/60`, which rendered almost invisible. Bumped to `text-slate-300` to match the entry-body color and pass contrast checks.

### Notes

- Three-line change across `editor-bottom-drawer.tsx`, `manifest-editor.tsx`, and `recent-rationale-sidebar.tsx`.
- 1150/1150 vitest passing. 0 lint errors.

---

## [0.2.12] - Editor: suppress false-positive JSON schema warnings

### Headline

Fixes a v0.2.11 (and earlier) bug where editing a manifest in JSON view produced spurious yellow squiggles on perfectly valid documents. The bundled `osc-manifest-schema.json` is intentionally narrow — it only enumerates 5 resource types (`AccountPolicy`, `AuditPolicy`, `CSP`, `Registry`, `UserRightsAssignment`) and uses `additionalProperties: false` in several places. Real library manifests routinely use other Microsoft OSConfig types (`Microsoft.OSConfig/Test`, `Microsoft.Windows/SecurityPolicy`, etc.) which fail the narrow schema's `oneOf` constraints, producing schema-validation warnings on documents that are otherwise valid OSConfig YAML/JSON.

### Fixed

- **Editor: stop emitting schema-validation diagnostics for JSON** — Set `schemaValidation: 'ignore'` in the Monaco JSON diagnostics options. The schema is still attached for IntelliSense / property-name autocomplete, but its narrow type catalog no longer produces noisy yellow squiggles on valid manifests. Monaco's built-in JSON syntax errors (unclosed strings, parse errors, trailing commas, comments) are unaffected — those still surface in the editor as before. Real manifest-shape validation continues to happen in our own `validateContent()` (platform check, registered-types check, shape detection).

### Notes

- One-line change in `apps/desktop/src/components/manifest-editor.tsx` (`updateMonacoSchema`).
- 1150/1150 vitest passing. 0 lint errors.
- Long-term: replace the bundled schema with one generated from the canonical OSConfig type registry so `schemaValidation` can be re-enabled. Out of scope for this hotfix.

---

## [0.2.11] - Editor layout: bottom drawer for CIS + Rationale

### Headline

Reclaims horizontal real estate in the manifest editor. The CIS cross-reference and Recent rationale panels previously rendered as a permanent right-side sidebar (~240–288px wide), which combined with the new Resource Explorer left sidebar (~224px) left the YAML editor crammed into a narrow middle column — especially painful on 1440×900 laptop screens with 257-resource baselines. v0.2.11 moves both reference panels into a **tabbed bottom drawer** modelled after the VS Code Problems/Terminal panel: collapsed by default (32px tab bar), opt-in expansion per tab, full editor width otherwise.

### Changed

- **Manifest editor: bottom drawer for CIS + Recent rationale** — New `EditorBottomDrawer` component (`apps/desktop/src/components/editor-bottom-drawer.tsx`) renders a tab bar across the bottom of the editor area. Each tab can be clicked to expand (280px content panel); clicking the active tab again collapses. Tabs:
  - **CIS reference** — Shows when `showCisCrossref` is on. Badge displays the rule severity (Critical/High/Medium/Low) or "none" when no rule matches. Hosts the existing `CisCrossrefSidebar` body.
  - **Recent rationale** — Shows when a `manifestId` is present. Hosts `RecentRationaleSidebar` in a new `mode="drawer"` rendering that skips the now-redundant in-panel collapse header.
- **Resource Explorer sidebar: width reduced** — Left sidebar shrunk from `w-56` (224px) to `w-48` (192px). Resource names still truncate to 1 line as before.
- **Monaco fills available space via flex** — Editor now uses `height="100%"` inside a `flex-1 min-h-0` wrapper instead of the old `calc(parent_height - bottom_panels)`. The bottom drawer expands/collapses without manual height math; Monaco's `automaticLayout` handles the resize.

### Notes

- No public API change. The `<ConfigEditor height>` prop is still honored and defaults to `100%`.
- `RecentRationaleSidebar` gains `mode?: 'sidebar' | 'drawer'`. Existing sidebar callers are unaffected (default is `sidebar`).
- 1150/1150 vitest passing. 0 lint errors.

---

## [0.2.10] - Diff viewer: readable text (GitHub-style)

### Headline

Hotfix for v0.2.9. The status-tinted text introduced in v0.2.9 (light emerald/red/amber text on tinted-dark backgrounds) tested clean in a dark-only synthetic harness but produced unreadable warm-tan-on-pale-yellow in the live "all-rows-changed" case (e.g. WS2019 vs WS2025 normalized compare, version history). v0.2.10 switches to a GitHub-style palette: **plain black text on opaque light tints** (emerald-200 / red-200 / amber-100). Same regression test, much higher contrast.

### Fixed

- **Diff viewer + Version History: black text on light status backgrounds** — `apps/desktop/src/components/diff-viewer.tsx` (used by both pairwise Diff and ManifestHistory) now renders meaningful cells as `text-black` on `bg-emerald-200` / `bg-red-200` / `bg-amber-100`. Ghost cells (the empty side of an added/removed row) stay on muted dark fill with muted text. Line numbers on the light side use `text-slate-700` for readability. Measured contrast (Playwright):
  - added-right (black on emerald-200): **16.37:1**
  - removed-left (black on red-200): **14.52:1**
  - changed-left/right (black on amber-100): **18.86:1** ← the cell that was unreadable in v0.2.9
  - same rows (slate-200 on slate-900): 14.48:1
  - ghosts (slate-400 on slate-800/60 blend): 6.22:1
  All cells now pass WCAG AAA (7:1).

### Notes

- No core or schema changes. Single-file fix plus updated assertions in `apps/desktop/e2e/diff-contrast.spec.ts`.
- 1150/1150 vitest passing. 0 lint errors. Playwright contrast spec passing.

---

## [0.2.9] - Deploy risk-ack + UX polish + MS legal alignment

### Headline

Defense-in-depth update following the v0.2.8 audit. Adds a second risk-acknowledgement prompt before enforce so a stray Enter keystroke can't push a machine into a broken policy state, improves diff readability with status-tinted text (WCAG AAA contrast), and aligns the repo's MIT license / SECURITY.md / CONTRIBUTING.md with the Microsoft Azure-org template.

### Added

- **Deploy: second risk-acknowledgement confirm for enforce mode** — After the existing "Deploy manifest X in enforce mode?" prompt, users now see an explicit warning that enforce will apply OS-level security policy, may break login/networking/RDP/installed software, that recovery may require local admin access, and that they're proceeding "at your own risk — this action may break your machine." Audit mode is unchanged (still one click, read-only). 3 new unit tests; 14/14 `useDeployFlow` tests pass.

### Fixed

- **Diff viewer: high-contrast status-tinted text** — Replaced uniform slate-300 (mid-grey on tinted backgrounds) with status-specific colors: emerald-200 for added lines, red-200 for removed, amber-200 for changed. Measured live via Playwright with WCAG 2.1 relative-luminance: every meaningful cell now lands between 10.05:1 and 12.02:1 (AAA is 7:1). Pinned by a new regression test (`apps/desktop/e2e/diff-contrast.spec.ts`).
- **OSConfig install link → CLI docs** — `OSCONFIG_INSTALL_URL` now points at `github.com/microsoft/osconfig/tree/main/docs/cli` (direct CLI install docs) instead of the repo root. Updated in `CliRequiredModal.tsx`, `Library/index.tsx`, `oscfg/binary.ts` error message, and the `v020-byo-cli.spec.ts` e2e test constant that was missed in the v0.2.8 cherry-pick.

### Changed

- **Every TypeScript file carries an MIT license header** — Added the standard two-line `// Copyright (c) Microsoft Corporation. All rights reserved. // Licensed under the MIT License.` header to all 234 tracked `.ts/.tsx/.cts/.mts` files. The script that does this (`scripts/add-license-header.mjs`) is idempotent and safe to re-run.
- **LICENSE / SECURITY.md / CONTRIBUTING.md aligned with Azure-org template** — LICENSE copyright holder is now "Amir Bredy" (was generic "ConfigForge contributors"). SECURITY.md is wrapped in the canonical `BEGIN/END MICROSOFT SECURITY.MD V1.0.0 BLOCK` markers that Microsoft repo policy bots key off. CONTRIBUTING.md's Code of Conduct paragraph now uses the standard Microsoft Open Source CoC wording with the `opencode@microsoft.com` contact.

### Tests

- Full suite: 1,147 → 1,150 passing, 0 lint errors
- New: 3 deploy-flow risk-ack tests, 1 Playwright contrast regression test

---

## [0.2.8] - Matrix diff cross-type merge + edge case hardening

### Headline

Ported the pairwise diff analyzer's cross-type identity improvements to the matrix (N-way) diff builder. Before this fix, comparing WS2019 vs WS2025 in the Matrix tab produced 559 rows with Audit settings split across separate rows (one with WS2019 only, one with WS2025 only). Now it produces 534 rows with all 43 Audit settings correctly merged into single rows showing both baselines.

### Fixed

- **Matrix: schema-canonical identity in `makeRowKey()`** — AuditPolicy resources now key by `subcategory`, UserRightsAssignment / AccountPolicy by `policy`, CSP by `path`, and BaselineRule placeholders by `ruleId`. Previously these fell through to unstable display names, causing duplicates when the same baseline used slightly different naming conventions.

- **Matrix: post-build cross-type merge pass** — After structural keying, rows that share the same normalized display name but come from different resource types (e.g. Microsoft.Windows/AuditPolicy in WS2019 vs Microsoft.Windows/CSP in WS2025) are merged into a single row when their baseline cells are disjoint. This mirrors the pairwise analyzer's Pass-2 cross-type matching.

- **Matrix: type-pair safety guard** — Only types in the known Windows security equivalence class (AuditPolicy, CSP, UserRightsAssignment, AccountPolicy, Registry) are eligible for cross-type merge. Prevents false merges between unrelated types like FileLine + Registry that happen to share a normalized display name.

- **Matrix: name normalization in `makeRowKey()` fallback** — The name-fallback path now uses the same lowercase+strip-non-alphanumeric algorithm as the analyzer, with a `name:` prefix to avoid collisions with schema-canonical keys.

### Tests

- 13 new matrix regression tests (29 total): schema-canonical identity for AuditPolicy/UserRights/AccountPolicy, cross-type merge (2-way and 3-way), type-pair guard blocking ineligible merges, BaselineRule ruleId dedup, name normalization, same-type different-keyPath merge
- Full suite: 1,134 → 1,147 passing, 0 lint errors
- E2E verified in live Electron app with real WS2019 + WS2025 baselines: 534 rows, 43 audit rows all showing both baselines

---

## [0.2.6] - Diff cross-type quiet mode + workflow upload cleanup

### Headline

v0.2.5's two-pass matching correctly paired up the same logical rule across WS2019 / WS2025 type shifts (Microsoft.Windows/AuditPolicy ↔ Microsoft.OSConfig/Test wrapping Microsoft.Windows/CSP, etc.), eliminating phantom add+remove. But for every matched cross-type pair it then reported every structural-field difference between the two encodings as a "changed" entry — even when both encodings represent the SAME setting at the SAME value. Result: a clean WS2019 vs WS2025 diff was reporting 711 total changes (202 enforcement-value rows of pure structural noise on top of the unavoidable 269 added + 240 removed).

This release quiets cross-type matches down to their actual meaning.

### Fixed

- **Diff: cross-type matched pairs now report only the meaningful enforcement value change** (or no change at all when the values agree). New `extractEnforcementValue()` walks the same priority chain matrix-diff already uses (compliance.equals → properties.value → properties.data → properties.desired → properties.Value), recursing into `Microsoft.OSConfig/Test` wrappers. When two cross-type matched resources extract the same value → zero changes reported. When they differ → exactly one clean `field: "value", from: X, to: Y` row instead of 8+ noise rows for `subcategory`, `value`, `name`, `resource.properties.path`, `resource.properties.type`, `resource.properties.value`, `resource.type`, `schema.enum`, etc.

  Same-type matched pairs are unchanged — they still get the full structural flatten-diff, because same-type pairs have a consistent field set and every field-level difference is meaningful.

  Verified end-to-end on real bundled WS2019 vs WS2025 workgroup-member baselines: total change count 711 → 510 (the unavoidable 269 added + 240 removed remain — see the v0.2.5 known limitation about cross-baseline-version renames with completely different naming conventions); meaningful enforcement-value changes 202 → **1** (the one rule that genuinely drifted).

- **CI: stop uploading `release/win-unpacked/configforge.exe`** (~216 MB) as a release asset. The v0.2.4 `find -maxdepth 3` upload glob was picking up the unpacked-but-not-yet-installed Electron runtime that sits inside the NSIS installer source dir. Added `-not -path '*/*-unpacked/*'` to the publish find and the equivalent `Where-Object { $_.FullName -notmatch ... -unpacked ... }` guard to the Windows `Get-FileHash` SHA256SUMS step. Also tightened the Windows checksum's `-Include` from `*.yml,*.yaml` to the same `latest*.yml + installer + blockmap` allowlist the publish step uses, so the checksum file lists ALL and ONLY what's actually uploaded. Previously the SHA256SUMS-windows.txt carried 20+ stale entries (`builder-debug.yml`, `app-update.yml`, every bundled `*.osc.yaml` baseline) that an auditor would fail to verify.

### Tests

- 3 new analyzer regression tests (cross-type quiet match, cross-type with value drift, cross-type compliance.equals priority)
- 1 negative-control test that same-type matches still do full flatten-diff
- Full suite: 1,131 → 1,134 passing, 0 lint errors
- Module-level repro on bundled WS2019 vs WS2025 manifests: 202 enforcement-value noise rows → 1 real one
- Playwright CDP smoke + Diff route E2E green

---

## [0.2.5] - Diff cross-type matching (2-pass) + CDP regression

### Headline

Closes the WS2019 vs WS2025 phantom-add+remove bug for real. v0.2.4 added name normalization but only as a fallback when no structural identity existed — between WS2019 (`Microsoft.Windows/AuditPolicy` + `UserRightsAssignment` + `AccountPolicy`) and WS2025 (`Microsoft.OSConfig/Test` wrapping `Microsoft.Windows/Registry` + `Microsoft.Windows/CSP`), every rule had a structural identity in BOTH baselines (different ones), so the name-normalization fallback never fired. Result: 25 phantom rename pairs in the real diff.

### Fixed

- **Diff: rules now match across resource-type changes between baseline versions.** Two-pass matching algorithm:
  - **Pass 1** (unchanged): structural identity within a type — Registry by `keyPath\valueName`, AuditPolicy by `subcategory`, UserRights/AccountPolicy by `policy`, CSP/path-shaped by `path`, BaselineRule by `ruleId`.
  - **Pass 2** (new): for resources still unmatched after Pass 1, look them up by normalized display name (lowercase + strip non-alphanumeric) **across types**. This catches the WS2019→WS2025 case where the same logical rule is encoded as `AuditPolicy` in one baseline and `CSP-wrapped-in-Test` in the other — same name, different type+identity-field shape.

  First-wins disambiguation in Pass 2: if two unmatched after-resources normalize to the same name, only the first claims the slot (the second stays genuinely unmatched). Pass 1 always wins over Pass 2 (structural identity beats name normalization).

  Verified end-to-end via Playwright CDP: registers the real bundled WS2019 + WS2025 workgroup-member baselines via the IPC bridge, navigates to Diff, selects both, clicks Compare, scrolls to the analysis section, and asserts zero rules appear in BOTH the Added and Removed lists by normalized name. **Real-baseline phantom-pair count: 25 → 0.**

### Known limitation

Rules with completely different naming conventions between baselines (e.g. WS2019 GPO display name `Application: Control Event Log behavior when the log file reaches its maximum size` vs WS2025 CSP-path name `EventLogServiceControlEventLogBehavior`) will still appear as add+remove. These describe the same setting conceptually but the names share only a few tokens; matching them automatically would require a Microsoft-internal GPO-to-CSP translation table the project doesn't ship. The matrix-diff (N-way) view handles this case correctly because it keys by `keyPath\valueName` regardless of name.

### Tests

- Analyzer suite: 78 → 81 passing (3 new cross-type tests: cross-type bridge via normalized name; Pass-2 first-wins disambiguation; Pass-1 always wins over Pass-2)
- Full suite: 1,128 → 1,132 passing, 0 lint errors
- New CDP spec drives the real WS2019 + WS2025 baselines through the live UI and asserts the analysis section shows zero phantom rename pairs

---

## [0.2.4] - Diff name-normalization + schema-canonical identity

### Headline

Closes the remaining diff phantom-add+remove bug. The v0.2.3 semantic-identity fix only covered Registry resources (matched by `keyPath + valueName`); two CIS-style baselines that target the same `AuditPolicy.subcategory` or `UserRightsAssignment.policy` but use different naming conventions still showed phantom duplicates because the fallback went to a literal display-name comparison.

Reported scenario: diffing **Windows Server 2019 Member Server vs Windows Server 2025 Workgroup Member**. Many rules had the same underlying identity (e.g. `AuditPolicy.subcategory: AuditLogon`) but one baseline used the concatenated style `AuditLogon` while the other used the spaced style `Audit Logon`. Both forms refer to the same setting; the diff was reporting them as one added + one removed.

### User-visible changes

#### Fixed

- **Diff: same rule under different naming conventions now matches.** Two improvements stacked:
  1. **Schema-canonical identity for non-Registry types.** Added matching by `AuditPolicy.subcategory` (the enum-constrained CIS-canonical identifier: `AuditLogon`, `AuditAccountLogon`, etc.), `UserRightsAssignment.policy` (the SID-privilege name: `SeAssignPrimaryTokenPrivilege`, etc.), and `AccountPolicy.policy` (e.g. `MinimumPasswordLength`). These fields are schema enums — they're the stable identifier across baseline versions; the display name is cosmetic.
  2. **Name normalization as the fallback.** When no schema-canonical identifier exists, the display name is now normalized (lowercase + strip non-alphanumeric) before matching, so `AuditLogon`, `Audit Logon`, `Audit-Logon`, and `audit_logon` all collide as the same rule. Includes a negative-control regression: `AuditLogon` and `AuditLogonEvents` still report correctly as add+remove (they're genuinely different).

### Maintainer-facing changes

- `packages/core/src/ai/analyzer.ts` — new `normalizeNameForIdentity()` helper; `resourceKey()` priority chain extended from 5 cases to 8 (Test wrapper → Registry → AuditPolicy → UserRights/AccountPolicy → CSP/path → BaselineRule ruleId → normalized-name → type).
- 6 new regression tests in `analyzer.test.ts` (AuditPolicy spacing, UserRightsAssignment human-readable rename, AccountPolicy spacing, generic-type normalization, substring negative control, same-name-different-type negative control). Analyzer suite: 72 → 78.

### Test counts

- Full suite: 1,122 → 1,128 passing
- 0 lint errors

---

## [0.2.3] - Azure Policy structural rewrite + diff semantic identity

### Headline

Two correctness fixes that close the gap between what ConfigForge generates and what the real platforms downstream actually accept. The diff analyzer no longer flags renamed rules as duplicate add+remove. The Azure Policy export now matches the structure of a real Microsoft-shipped Guest Configuration baseline — the previous output was structurally incomplete and couldn't deploy any settings.

### User-visible changes

#### Fixed

- **Diff: same rule across baseline versions no longer appears as both Added and Removed.** Diffing a Windows 2019 baseline against a Windows 2025 baseline put the same registry rule in BOTH the Before (removed) and After (added) columns when the rule had been cosmetically renamed between versions (`EnsureAuditUserAccountManagement-WS2019` → `EnsureAuditUserAccountManagement`). Root cause: the analyzer matched resources by display name; now it matches by semantic identity (type + keyPath + valueName, mirroring the matrix-diff contract). Renames surface as a single field-level change with from/to values. Matrix diff already worked correctly; this brings the pairwise analyzer up to the same standard. Also handles Test-wrapper boundary changes (a rule wrapped in `Microsoft.OSConfig/Test` in one baseline and unwrapped in the other) and `Microsoft.OSConfig/BaselineRule` placeholders (matches across catalog refreshes by stable `ruleId`).

- **Azure Policy export: now generates a structurally complete policy that can actually deploy settings.** The previous export emitted a stub that Azure could ingest but had no way to actually configure anything. Compared against a real Microsoft-shipped GC baseline (the LAPS custom policy), 13 required fields were missing. The rewrite produces a 25 KB structurally-complete policy from the manifest's resources:
  - `metadata.requiredProviders`, `contentType`, `contentUri`/`contentHash` placeholders, `configurationParameter` map
  - One ARM parameter per manifest setting, with the manifest's current value as `defaultValue`
  - `IncludeArcMachines` toggle (defaults to `false`, matches MSFT baseline convention)
  - `parameterHash` existence-condition for drift detection — without this, ARM parameter changes silently never propagate
  - Dual deployment resources (Azure VM + Arc) gated by `condition` on the `type` parameter
  - `configurationParameter` as the array `{name, value}` shape inside the deployment template
  - `versions[]` array
  - Assignment name uses `uniqueString()` so multiple policy assignments coexist

  Mapping convention: ARM parameter name = sanitized resource name; MOF parameter name = `<resource.name>;Value` (matches what `exportToMof` writes). Test wrappers unwrap to the inner registry/CSP resource for keyPath/valueName extraction. `compliance.equals` wins over `properties.value` when both are present.

  Workflow: generate MOF via Export → MOF, zip the package, upload to Azure Storage, then replace the `REPLACE_WITH_*` placeholders in the policy JSON with the storage URI and SHA256 hash.

#### Maintainer-facing changes

- `packages/core/src/ai/analyzer.ts` — new `resourceKey()` walks identity in priority order (Test-wrapper inner-resource recursion → Registry keyPath+valueName → CSP path → BaselineRule ruleId → name → type). New `displayName()` helper surfaces the human-readable name in the added/removed/changed lists. `flattenResourceForDiff()` now includes `name` so renames surface as a `field: "name"` change. `changedResources` entries carry a parallel `changeResourceRefs[]` array so the risk-level loop can call `isCriticalSetting()` on the actual matched resource (the previous `beforeMap.get(change.name)` broke once the map key diverged from the display name).

- `packages/core/src/import-export/index.ts` — `exportToAzurePolicy(name, resources, options)` rewritten end-to-end against the real LAPS baseline shape. New private helpers: `extractPolicySettingParams`, `buildConfigurationParameterMap`, `buildParameterHashExpression`, `buildDeploymentParameters`, `buildDeploymentResource`.

- `packages/core/src/handlers/export.ts` — `exportManifest` now passes `manifestResources` through to `exportToAzurePolicy` so per-setting parameters can be generated.

- 12 new structural-shape tests for `exportToAzurePolicy` (import-export.test.ts 5 → 17) + 5 new semantic-identity regression tests for the analyzer (analyzer.test.ts 67 → 72) + 1 CDP smoke test for the Diff page.

- Workflow fixes from v0.2.2 carried forward: signing gate eased to `continue-on-error: true` + `::warning::` instead of hard fail; installer-upload glob uses `find -maxdepth 3` so electron-builder's version-subdir output is picked up.

### Test counts

- Full suite: 1,101 → 1,122 passing
- Lint: 0 errors

---

## [0.2.2] - Azure Policy import shapes + matrix-diff correctness

### Headline

ConfigForge v0.2.2 makes the import surface accept the JSON shapes you actually have, fixes a silent-wrong-answer bug in the matrix builder, and tightens the Azure Policy export so it can't generate fake-compliance policies.

User-visible: drop in an Azure Policy Guest Configuration baseline JSON (Ubuntu CIS, Linux baseline, Windows GC catalogs) and it imports cleanly with the rule identity preserved; drop in a wrapped manifest with an embedded YAML `source` field and the YAML gets parsed; drop in an Azure Policy Definition wrapper or a rule-metadata reference file and get a clear actionable error instead of generic "unrecognized JSON shape."

### User-visible changes

#### Added

- **Import: Azure Policy Guest Configuration baseline catalogs (`settingsReference[]` shape).** Files like `Ubuntu2204Json.json`, `Azure_Security_Baseline_for_Linux_v_1.0.0.json`, and `settings.json` now import cleanly. Each entry maps to a `Microsoft.OSConfig/BaselineRule` placeholder that carries the rule identity (ruleId, displayName, severity, schema type, defaultValue). The OSConfig agent on the target machine is the only thing that knows the actual implementation per ruleId, so these placeholders are not directly deployable — the imported manifest opens with a leading banner comment explaining what to do next.
- **Import: embedded YAML manifests in a `source` field.** Files like `Microsoft-Defender-Antivirus.json` (top-level `source: "<yaml>"` with `resources: []`) used to silently import as a 0-resource manifest. Now the YAML inside `source` is parsed correctly.
- **Import: friendly errors for known-but-unsupported shapes.** Dropping an Azure Policy Definition wrapper (`{properties.policyRule}`) now gives an error naming the Guest Configuration package it assigns. Dropping a rule-metadata reference file (`{id, version, rules[]}`) explains that it pairs with a baseline by ruleId and points at the right file to import.
- **Export to Azure Policy: Arc-enabled server targeting.** Generated policies now also target `Microsoft.HybridCompute/machines`, so Arc-managed on-prem/multi-cloud/Azure Local servers receive the same policy. Matches real Microsoft-published GC baseline policies.
- **Export to Azure Policy: auto-detect OS family from manifest resources.** Type prefixes (`Microsoft.Windows/*` vs `Microsoft.OSConfig/FileLine`/`Sshd`/`Package`/`Firewall`/`TimeZone`/`Hostname` and friends, plus `Microsoft.Linux/*`) pick Windows vs Linux automatically. The `ExportRequest` shape gains an optional `osType` override for callers that want to force a target.
- **Export to Azure Policy: carries source-of-truth metadata forward.** Imported baselines round-trip their original name/version/baselineId into the policy's `metadata` block, parsed from both top-level manifest fields and the placeholder-baseline banner comment.

#### Fixed

- **Matrix diff: now compares `compliance.equals`, not just `properties`.** Two manifests targeting the same registry path with different desired compliance values (`equals: 10` vs `equals: 20`) used to report `status: identical` because the matrix builder only inspected `properties` and fell back to whole-properties comparison when no inline `properties.value` was set. CSV-imported and `compliance:`-block manifests (the canonical authoring path since v0.2.1) were silently affected by this. Same root cause as the `analyzeDiff` fix earlier in v0.2.1; now patched in the matrix builder too. New `compliance.contains` / `matches` / `regex` operators are also handled as distinct comparison ops.
- **Export to Azure Policy: refuses to silently ship a fake-compliance policy.** Any manifest containing imported `Microsoft.OSConfig/BaselineRule` placeholders (rule identity without implementation) used to export as a policy that the OSConfig agent would skip every resource for, with Azure happily reporting every VM as Compliant. Now the export fails loudly with an error naming the affected placeholders and the next step ("map each placeholder to a concrete resource type before exporting"). False-compliance is worse than no compliance.
- **Export to Azure Policy: drop image publisher allowlist.** The hardcoded `['MicrosoftWindowsServer', 'MicrosoftWindowsDesktop']` / `['Canonical', 'RedHat', 'SUSE']` lists silently excluded corporate gold images, custom VHDs, and smaller-publisher marketplace images. Real Microsoft-published GC baseline policies use `osDisk.osType` only, which works for every VM. Now we do too.

### Maintainer-facing changes

#### Added

- `packages/core/src/handlers/import.ts` — new shape-detector helper (`detectJsonImportShape`) replaces the chain of `if (Array.isArray(...))` checks. Each recognised JSON shape gets its own dispatch case so future shapes are easier to add without regressing the existing ones.
- `packages/core/src/handlers/export.ts` — three new helpers used only by the `azurepolicy` format: `inferOsTypeFromResources`, `findPlaceholderBaselineResources`, `extractManifestMetadata`. Other formats (yaml/json/mof/excel) are untouched.
- `packages/core/src/import-export/index.ts` — `ParsedSDSetting` interface gains optional `ruleId` / `schemaType` / `severity` / `originalSettingName` fields for the settingsReference path; `ParsedSecurityDefinition` gains an `origin` discriminator so downstream code can branch on which shape produced the settings.

#### Tests

- 5 new regression tests in `matrix.test.ts` for the compliance-comparison fix (matrix file 11 → 16 tests).
- 4 new safety-guard tests in `downloads.test.ts` for the azurepolicy export (placeholder rejection, mixed-OS rejection, osType override).
- All existing tests preserved unchanged. Total suite: **1,101 passing**, 0 lint errors.

---

## [0.2.1] - Page-split refactor + security audit closure

### Headline

The largest **maintainer-facing** release since the Electron migration. ConfigForge v0.2.1 lands the Phase A→E renderer-page split (1,585-line `ManifestEditor.tsx` down to 451 lines plus four other oversized pages factored into directory/hook/components form), closes all 15 findings from the post-OSS security audit (CF-SEC-001 through 015), introduces a typed main-process logger, hardens the release pipeline (CycloneDX SBOM, `npm audit` gate, `npx --no-install` tooling pin, tilde-pinned electron + electron-builder), wires up Prettier, and fixes a CSV-import schema-validation bug that flagged every imported Registry row in the editor.

No user-visible feature regressions. The CSV-import fix is the only user-facing behaviour change — imported manifests now pass schema validation immediately instead of showing red error markers on every imported resource.

### User-visible changes

#### Fixed

- **CSV / TSV / XLSX import** now emits `Microsoft.Windows/Registry` resources with all three schema-required properties (`keyPath`, `valueName`, `valueType`). Previously the import omitted `valueType` (and the JSON security-definition import also omitted `valueName`), so the manifest editor's inline validator flagged every imported row as invalid the moment you opened the file. `valueType` is now inferred from `expectedValue` — integer-shaped values (numbers, `"0"`, `"-7"`, `"  42  "`) get `Dword`, everything else gets `String`.

### Maintainer-facing changes

#### Added (page-split refactor — Phase A→E)

Five oversized renderer pages refactored into directory/hook/components form. The new shape:

```
apps/desktop/src/pages/<Page>/
├─ index.tsx         # JSX composition + page-level state
├─ helpers.tsx       # pure render helpers (optional)
├─ state/
│  ├─ use<X>.ts      # custom hooks
│  └─ use<X>.test.ts # regression-prone hook tests
└─ components/
   └─ <Sub>.tsx      # React.memo'd visual sub-components
```

Line-count savings (electron-migration):

| Page | Before | After | Change |
| --- | ---: | ---: | ---: |
| `ManifestEditor/index.tsx` | 1,585 | 451 | −72% |
| `Manifests/index.tsx` | 894 | 772 | −14% |
| `ManifestNew/index.tsx` | 865 | 632 | −27% |
| `Library/index.tsx` | 816 | 802 | −2% (small filter hook, JSX-heavy page) |
| `Diff/index.tsx` | 773 | 717 | −7% |
| **Aggregate (5 pages)** | **4,933** | **3,374** | **−32%** |

Hooks extracted (with regression tests that lock in race-guards, timer cleanup, ghost-selection, and format sync — historically the highest-bug-density areas):

| Page | Hook | Tests | Regression locked |
| --- | --- | ---: | --- |
| ManifestEditor | `useManifestEditorState` | 13 | `fetchToken` race-guard |
| ManifestEditor | `useDeployFlow` | 11 | `deployJobIdRef` cancel-on-unmount |
| ManifestEditor | `useDocsModal` | 7 | `docsCopiedTimerRef` cleanup |
| Manifests | `useManifestList` | 6 | `listTokenRef` race-guard |
| Manifests | `useFlashMessage` | 5 | timer Set unmount cleanup |
| Manifests | `useBulkSelection` | 6 | `removeFromSelection` ghost-selection fix |
| ManifestNew | `useNewManifestForm` | 14 | yaml↔json↔visual sync, platform-switch incompat warning |
| Library | `useLibraryFilters` | 6 | filter composition |
| Diff | `useDiffMatrix` | 9 | `matrixLoadTokenRef` race-guard + 10-cap UX |

#### Added (security audit closure — CF-SEC-001 through 015)

- **CF-SEC-001** — Block file:// navigation outside the bundled UI in `navigation-guard.ts`.
- **CF-SEC-002** — Typed IPC payload validators (`ipc-validators.ts`) on every channel registered in `ipc-handlers.ts`.
- **CF-SEC-003** — Import payload size cap (`MAX_IMPORT_BYTES = 10 MB`) with a descriptive 413 error.
- **CF-SEC-005 / 006** — Markdown HTML escape (`packages/core/src/markdown/escape.ts`) wired into the audit-pack markdown emitter and the doc-generator output.
- **CF-SEC-007** — AI-content circular-guard now uses a **spoof-resistant per-process content-hash registry** in addition to the inline `<!-- ai-generated:rev=N -->` marker. Attacker stripping the marker before re-feeding content to the system is still detected via the registry (NFC-normalised 64-bit FNV-1a hash — browser-safe, no Node-`crypto` dependency, doesn't break the renderer Vite bundle). Registry is process-local with FIFO eviction at 4,096 entries.
- **CF-SEC-008** — `SIGNING.md` + `scripts/generate-dev-cert.ps1` clarify that the default `configforge-dev` password is a non-secret throwaway for local dev only; runtime banner warns at cert-generation time. Production signs via `WIN_CSC_LINK_BASE64` GitHub secret.
- **CF-SEC-009** — mdbook-mermaid release checksum pinned in `.github/workflows/docs.yml`.
- **CF-SEC-010** — Release-signing gate: final-release tags (`vX.Y.Z`, `electron-vX.Y.Z`) refuse to ship unsigned. Per-platform SHA256SUMS published with each release.
- **CF-SEC-011** — Release tooling pinned via `npx --no-install electron-builder` so a missing/wrong-version binary fails loudly instead of silently fetching from the network.
- **CF-SEC-012** — CycloneDX SBOM generated per platform (`sbom-windows-latest.cdx.json`, `sbom-ubuntu-latest.cdx.json`) and uploaded to release artifacts alongside SHA256SUMS. `@cyclonedx/cyclonedx-npm` exact-pinned at the root.
- **CF-SEC-013** — Postinstall script audited.
- **CF-SEC-014** — `npm audit --omit=dev --audit-level=high` gate in the release workflow; `electron` + `electron-builder` repinned with tilde (`~`) instead of caret (`^`) so minor-version updates are intentional. Locally validated: 0 prod-dep vulnerabilities at the high/critical level.
- **CF-SEC-015** — `safeCfs(key)` + `hasCfsNamespace(key)` helpers added to `apps/desktop/src/lib/cfs.ts` for flavor-conditional renderer code. The macOS author build omits `deploy` / `elevation` / `health` / `auditResults` preload namespaces; renderer code that may run on either flavor should now use the new helpers instead of bare `cfs.X` (which throws on mac).

#### Added (developer experience)

- **Typed main-process logger** at `apps/desktop/electron/log.ts`. Provides `log` (active logger), `setLogger()` (test injection), `resetLogger()` (revert to default), `scoped(name)` (returns a Logger prefixing every message with `[name]`), and `redact(message)` (best-effort secret-key=value scrubbing). Wraps `electron-log` (lazy-required so the vitest environment falls back to console). First migration: `apps/desktop/electron/elevate.ts` (6 prior `console.*` calls). Remaining ~30 console.* sites in main + core migrate incrementally.
- **Prettier** added as an exact-pinned devDep with `.prettierrc.json` + `.prettierignore`. `npm run format` + `npm run format:check` scripts available. `eslint-config-prettier` wired into the desktop ESLint chain so style rules eslint owns defer to prettier. **No mass-format run shipped** — incremental adoption on touched files only, to keep the diff signal high.
- **ESLint complexity caps** as `warn`-level on the desktop project (`max-lines: 600`, `max-lines-per-function: 150`, `complexity: 15`). Surfaces oversized files in PR review without failing CI.

#### Added (tests)

- **Net +211 tests** (882 → 1,093 on electron-migration; 882 → 1,028 on mac-author-build). The bulk is the Phase E hook tests (75 total across 9 files) plus 19 new security tests (CF-SEC-007 spoof-resistance, CF-SEC-015 capability helpers) and 9 logger tests.

#### Changed

- **`circular-guard.ts`** now uses a hand-rolled 64-bit FNV-1a hash instead of Node's `crypto.createHash`. The previous draft broke the renderer Vite build (`createHash` is undefined in browser-externalised `crypto`). The FNV-1a hash is browser-safe, has no dependency footprint, and is more than strong enough for the spoof-resistance threat model (~1e-12 birthday collision at 4k entries; the marker check remains the primary signal).
- **`import.ts` registry shape**: CSV/TSV/XLSX imports now set `valueType` from a new `inferRegistryValueType()` helper. JSON security-definition imports now set `valueName: s.name` (was missing) + the same inferred `valueType`.
- **README, AGENTS.md, CONTRIBUTING.md, MERGE-INSTRUCTIONS.md, module-map.md** rewritten to reflect the current state. The previous docs referenced the Next.js era (deleted in Phase 10), pre-page-split file paths, the no-logger convention (no longer true), and stale test counts.

#### Branch parity

Every commit on `electron-migration` was ported to `mac-author-build` via `git cherry-pick` to keep the two flavors in lock-step. Two notable manual merges during this cycle:

- `elevate.ts` Phase E port took the electron-migration version wholesale (its new `buildLinuxElevationArgv` helper is a strict superset of the inline RDP detection on mac).
- `package.json` Phase E port hand-merged: kept mac's `version: 0.1.0` + `postinstall: node scripts/chmod-oscfg.js` (required for the bundled oscfg binary on the mac/linux dev-drop path), added the Prettier devDeps + `format` / `format:check` scripts.

---

## [0.2.0] - Bring-your-own-CLI + OSS readiness

### Headline

The biggest change since the Electron migration. ConfigForge v0.2.0 **no longer bundles the OSConfig CLI**. Users install OSConfig separately. Editor / library / diff / compare / audit-pack PDF features keep working without it; Deploy / Audit / Revert require it and now degrade gracefully when missing instead of failing on a raw spawn error.

The repo also gained all the legal / docs scaffolding needed for transfer to an official Microsoft open-source GitHub organization.

### User-visible changes

#### Added

- **First-run Welcome dialog** with two cards on first launch: "Author baselines anywhere" (any OS, no CLI) and "Author + deploy on this machine" (Win/Linux + OSConfig). Dismissal persists per profile in `localStorage`. A "Reset first-run experience" button on the Settings page restores it for testing.
- **CLI-required install dialog** opens when you click Deploy / Audit / Revert / Bulk Deploy while the CLI is missing, instead of a generic error. The dialog has an Install link (opens https://github.com/microsoft/osconfig in your default browser) and a Recheck button that auto-dismisses the dialog once OSConfig is installed, so you can install and retry without restarting the app.
- **Footer health pill** rewritten. New states:
  - 🟢 OSConfig CLI v…
  - 🟠 Editor mode, CLI not installed (clickable; opens install dialog)
  - 🔴 Cannot reach IPC
  - ⚪ Verifying…
- **Editor-mode hero card** on the dashboard when OSConfig is missing, pointing users at /library + the install affordance. Dismissable per session.
- **Settings page** now has a dedicated OSConfig CLI section: status, version, binary path, source, plus Install / Recheck buttons.
- **`INSTALL.md`** at the repo root with platform-by-platform install steps and resolver behavior.

#### Changed

- The error message you'd previously see if `oscfg` was unreachable no longer mentions `resources/oscfg/<platform>/`. New message: "OSConfig CLI not found … Install OSConfig, see INSTALL.md."
- **Binary resolver now probes well-known install locations** in addition to PATH. On Windows that includes the WindowsApps App Execution Alias (`%LOCALAPPDATA%\Microsoft\WindowsApps\oscfg.exe`), the winget user-scope Links shim, and the common Program Files layouts. On Linux that includes `/usr/bin`, `/usr/local/bin`, `/opt/osconfig`, and `~/.local/bin`. The fix means `winget install Microsoft.OSConfig` is detected immediately, even when the parent shell's PATH has not been refreshed since the install (which is the common case for already-running Electron processes).
- **Windows MSIX fallback** via `Get-AppxPackage Microsoft.OSConfig` catches installs where the App Execution Alias is disabled in Windows Settings or PATH is otherwise stale. ~700ms one-time cost, cached behind the existing 60s health-cache singleton.
- The `OscfgBinaryInfo.source` discriminator now includes two new states: `'installed'` (matched a well-known install path) and `'msix'` (resolved via Get-AppxPackage).
- README rewritten: dropped the "drop the binary into resources/oscfg/..." Quick Start. Added the BYO-CLI callout + reference to INSTALL.md.

#### Removed

- **The bundled `oscfg` CLI binary** is no longer shipped with the installer. v0.1.x users moving to v0.2.0 need to install OSConfig manually; see `INSTALL.md`. The first launch detects the missing CLI and walks you through it.
- `resources/oscfg/win32-x64/oscfg.exe`, `oscfg_event.dll`, and `resources/oscfg/linux-x64/oscfg` are no longer in the repo. The `resources/oscfg/` directory remains as a dev-only convenience drop for contributors who want to bring their own binary without installing system-wide. **Never shipped to users.**
- `scripts/chmod-oscfg.js` postinstall script (no binary to chmod) on `electron-migration`. The mac-author-build branch retains it for the bundled oscfg path used during dev there.
- `electron-builder.yml` `extraResources` entry for `oscfg-resources/`.

### Maintainer-facing changes

#### Added (handlers + IPC contract)

- **`HandlerError.code` field** for machine-readable failure discriminators. The first defined code is `CLI_REQUIRED` (status 412). The IPC envelope forwards `code` so the renderer can branch on it from a regular `try/catch`.
- **`cliRequiredError(detail?)` factory** in `packages/core/src/handlers/errors.ts`, single source of truth for the CLI-missing throw, with consistent status (412) and code (`CLI_REQUIRED`).
- **`isCliMissingMessage()` detector** in the same file. Substring match against both the v0.2.0 phrasing ("OSConfig CLI not found") and the legacy "oscfg binary not found" wording for rollback resilience.
- **`recheckHealth()` handler** in `packages/core/src/handlers/health.ts`. Clears the 60s in-process cache and reprobes. Wires the "I've installed it, recheck" UX.
- **`cfs:health:recheck` IPC channel** + `cfs.health.recheck()` preload export.
- **`useCliPresence()` renderer hook** at `apps/desktop/src/hooks/useCliPresence.ts`. Exposes `{ installed, version, loading, error, health, recheck }`. 60s background poll picks up out-of-band installs.
- **Preflight gate in `runDeploy`**: refuses with `cliRequiredError()` before `withDeployLock` runs. Audit + enforce both gated.
- **Preflight gate in `revertManifest`**: same shape; maps `applyManifest` / `deleteNamespace` CLI-missing failures.
- **`scripts/verify-no-cli-binary.sh`** belt-and-suspenders release guard. Wired into `release.yml` after the publish step. Fails the build if any `oscfg*` file shows up under `apps/desktop/release/`.
- **`<CliRequiredModal />`** shared FluentUI v9 Dialog component, invoked by Manifests / ManifestEditor / Layout / WelcomeDialog.
- **`<WelcomeDialog />`** + `hasDismissedWelcome()` / `markWelcomeDismissed()` helpers.
- **`HealthIndicator.onInstallClick`** prop seam, Layout wires it to open the CliRequiredModal.

#### Changed

- AGENTS.md rewritten. The previous version was stale from the Next.js era. Now documents the Electron monorepo layout, the v0.2.0 BYO-CLI contract, and the CLI choke point. CONTRIBUTING.md captures the test-gate protocol established this cycle.

#### Removed

- `Microsoft.OSConfig` PowerShell module remnants (already gone since the Electron migration; doc references purged).

#### Tests

- **+50 new tests** (832 → 882, all green). New coverage:
  - `errors.test.ts` (14 tests): HandlerError.code + cliRequiredError factory + isCliMissingMessage detector (v0.2.0 + legacy phrasings).
  - `health.test.ts` (4 tests): recheckHealth cache-busting + flip scenarios.
  - `useCliPresence.test.tsx` (7 tests): probe states, recheck flip, interval registration, unmount cleanup.
  - `CliRequiredModal.test.tsx` (6 tests): renders correctly, Install routes through shell.openExternal, recheck auto-dismisses on flip, "Still not detected" warning on stale recheck.
  - `WelcomeDialog.test.tsx` (8 tests): first-mount-shows, dismissed-state-suppresses, CTA flows, persistence helpers.
  - `HealthIndicator.test.tsx` (8 tests): full state matrix + clickable button mode + negative-assertion against banned legacy strings.
  - `deploy.test.ts` (+4 tests): preflight gates audit + enforce on `resolveOscfgBinary` failure; default mock returns healthy binary so all 35 existing deploy tests stay green.

### Legal / OSS readiness

- **`LICENSE`** added at repo root, MIT, 2025-2026 ConfigForge contributors. `apps/desktop/package.json` declared MIT since v0.1.0 but no actual LICENSE file existed; v0.2.0 closes that gap.
- **`NOTICE`** added. Documents Microsoft trademark policy, the OSConfig integration ("we integrate, we don't bundle"), and the project's current state ("Microsoft community open-source project, not yet officially supported").
- **`THIRDPARTYNOTICES.md`** added. Hand-curated top 20 runtime dependencies with license + upstream URL.
- **`SECURITY.md`** added, uses the standard Microsoft repository template; vuln reporting goes through https://aka.ms/SECURITY.md.
- **`CONTRIBUTING.md`** added. Pre-PR bar, commit conventions, the test-gate protocol, the bundled-binary ban, and a CLA placeholder that activates on transfer to a Microsoft OSS GitHub organization.

### Upgrade notes

If you used v0.1.x:

1. Install OSConfig separately. See `INSTALL.md`.
2. Launch ConfigForge v0.2.0. The first-run Welcome dialog appears. Pick the mode that fits your usage.
3. Your `~/.configforge/` manifests, history, rationale, and audit-results from v0.1.x are preserved — the storage location is unchanged.
4. Scripts that ran `npm postinstall` expecting `chmod-oscfg.js` to exist will see it gone on `electron-migration`. The postinstall step is now a no-op there.

---

## Pre-0.2.0

Earlier versions tracked changes per-release in commit messages and the GitHub Releases page. See `git log --oneline` for v0.1.x history.
