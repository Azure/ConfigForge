# Changelog

A concise release history for ConfigForge. Newer entries use the
shipped semver tag; older entries summarize the foundational work by theme.

## v0.3.87 — 2026-07-21

- **Removed the local Server 2025 `ImpersonateClient` manifest override.** The three bundled baselines are restored to their source representation while the separate oscfg 1.3.9-or-newer status handling remains.

## v0.3.86 — 2026-07-21

- **Fixed the Server 2025 `ImpersonateClient` CSP rule** to use the current upstream string-backed UserRights representation and explicit SID schema.
- **Made oscfg 1.3.9 a minimum version.** Newer CLI releases are accepted; the footer shows concise installed/admin-required states and keeps the exact version in its tooltip.

## v0.3.85 — 2026-07-20

- **Fixed My Baselines sticky-header layering.** Scrolled baseline rows no longer appear in the gap above the column header or paint through it.

## v0.3.84 — 2026-07-20

- **Simplified exports to YAML, JSON, MOF, and CSV.** Azure Policy definition JSON is no longer offered in Baseline Detail or Export Readiness.
- **Cleared the remaining high-severity development dependency advisories** by updating `concurrently` to 9.2.4, `shell-quote` to 1.9.0, and each active `brace-expansion` major line to its patched release. This release contains no runtime feature changes.

## v0.3.83 — 2026-07-20

- **Patched development dependency advisories** by updating `tar` to 7.5.20 and `axios` to 1.18.1. This release contains no runtime feature changes.

## v0.3.82 — 2026-07-20

- **Refined Baseline Detail document identity and view-only feedback.** The title uses a document icon, and clicking a Visual table cell while viewing explains that editing requires Edit mode.
- **Improved Visual authoring reach.** Add setting actions now appear above and below each table.
- **Added Matrix baseline search** so large baseline lists can be filtered before selection.
- **Patched `js-yaml` to 4.3.0** across direct and transitive dependencies to resolve a high-severity CPU-consumption advisory.

## v0.3.81 — 2026-07-19

- **Corrected responsive Baseline Detail actions.** Every footer action keeps its icon and label. Wide windows use one row; scaled and narrow Electron windows use balanced compact rows instead of icon-only controls, clipping, or horizontal scrolling.

## v0.3.80 — 2026-07-19

- **Fixed official OSConfig CSV imports.** LAPS, Defender Antivirus, and Windows Server baseline files now retain typed Registry/CSP resources, role-specific values, and Test compliance criteria; report-only CSVs receive a clear reconstruction error.
- **Made the Baseline Detail footer responsive without hiding actions.** Controls compact to icons as space tightens instead of clipping or scrolling horizontally.
- **Fixed Save → Skip navigation.** A consumed compliance deep link no longer reopens the report after saving an edited baseline.

## v0.3.79 — 2026-07-19

- **Added compliance report search, filtering, and status sorting.** Search covers setting names, types, and reasons; status filters isolate Compliant, Non-compliant, or Could not read entries; and the Status header cycles ascending, descending, and original ordering.

## v0.3.78 — 2026-07-19

- **Corrected Create New Baseline, read-only editor, and compliance visuals.** The custom baseline selector now uses ConfigForge's four-color Windows SVG and renders a single Linux penguin. The inline Monaco read-only warning again receives its explicit detached-host colors and opaque background. Baseline Detail now restores the last persisted audit across navigation/restarts and presents it in one large centered dialog instead of a bottom section plus side drawer.

## v0.3.77 — 2026-07-17

- **Completed the Loop design pass.** Register New Baseline now offers file, URL, Excel, Microsoft template, and custom-authoring methods before opening the shared editor; My Baselines shows Date Modified; each baseline remembers Code/Visual mode; edited baselines use Save/Discard/Cancel close protection; and real `.xlsx` workbooks import without a new runtime dependency.

## v0.3.76 — 2026-07-17

- **Cognitive Walkthrough polish.** Two selected baselines open Pairwise Diff; Code and Visual share visible read-only guidance and Undo; compliance opens in a drawer while remaining in-page; final-cell Enter appends a spreadsheet row; platform/status presentation is corrected; OSConfig recheck skips missing-path probes; stacked onboarding dialogs and redundant step prefixes are removed.

## v0.3.75 — 2026-07-17

- **Fixed My Baselines search.** Search now matches baseline namespace and display name only, so shared hidden setting names and `Microsoft.Windows/*` resource types cannot make short prefixes appear unresponsive.

## v0.3.74 — 2026-07-16

- **Fixed overlapping Visual table columns.** Large CIS baselines now use proportional fit-first columns with opaque alternating rows and controlled wrapping. Horizontal scrolling remains available on narrow windows without sticky cells painting over other values.
- **Clearer table vocabulary.** Registry path, Value name, Value type, Expected value, and Applied value replace raw property keys.

## v0.3.73 — 2026-07-16

- **Visual editing is now a spreadsheet.** The old tile/form builder is gone. Baseline Detail and Register New Baseline share grouped tables with inline cell editing, direct row addition, selection, and deletion while preserving Test/Group structure, typed values, unknown fields, and exact QWord integers.
- **Editor actions stay anchored.** Edit changes to Save in the persistent bottom footer; Cancel remains in the header.
- **Opened baseline tabs show their platform.** Windows and Linux marks now appear beside persisted tab names.
- **Benchmark Mapping recognizes complete SCAP bundles.** Valid CPE OVAL, CPE dictionary, and OCIL sidecars tied to a detected XCCDF no longer appear under Unrecognized files.

## v0.3.72 — 2026-06-19

- **Security: completed the `undici` dependency update.** A follow-up to v0.3.71 that also patches a deeper, build-time-only copy of `undici` used by the native-module build tooling. `npm audit` now reports zero vulnerabilities. As with v0.3.71, these are build/test dependencies only — none of them ship inside the installed app.

## v0.3.71 — 2026-06-19

- **Security: patched the `undici` and `dompurify` build dependencies.** Updated `undici` to 7.28.0 and `dompurify` to 3.4.11 to clear reported advisories. Both are development/build-time dependencies and are not bundled into the installed app.

## v0.3.70 — 2026-06-18

- **Benchmark Mapping: the "Back to My Baselines" button now has a back arrow**, matching the other back buttons throughout the app.

## v0.3.69 — 2026-06-18

- **Refreshed navigation and vocabulary.** The left rail now reads **Dashboard, My Baselines, Microsoft Baselines, Export Readiness, Diff, Benchmark Mapping, Settings** (formerly Manifests / Library / Validation / CIS Mapping), with Microsoft Baselines sitting directly under My Baselines. A baseline's items are now called **settings** rather than resources throughout the app, and the baseline-card action is **Open** (was "View").
- **Microsoft Windows logo.** A four-color Windows logo replaces the previous window emoji / icon on baseline cards, the Microsoft Baselines catalog, the setting picker, and the editor header; Linux uses the penguin consistently.
- **Editor and Benchmark Mapping polish.** The editor's format strip now puts the Editor / Visual Builder toggle on the left and the YAML / JSON / MOF tabs on the right; Benchmark Mapping's folder field is labeled **Benchmark data folder**; the redundant "Source" line and a duplicate "Docs" button were removed; and the Audit Pack PDF section headings are left-aligned.
- **Localization refresh.** The French / German / Spanish catalogs were re-translated for the new terminology via Azure Translator (still pending native-speaker review).

## v0.3.68 — 2026-06-10

- **Release builds are now unsigned.** Ahead of the open-source migration, all code signing was removed from CI. The Windows/Linux/macOS installers are still built and published as drafts (with SBOM + SHA256SUMS) — just unsigned. Build from source for trust, or self-sign your own local build. Windows SmartScreen / macOS Gatekeeper will warn on unsigned builds.
- **Continuous dependency audit.** The production-dependency security audit (`npm audit`, high/critical) now runs on every pull request, not only at release.

## v0.3.67 — 2026-06-10

- **Fixed: exporting a baseline to MOF now produces a package the Azure Machine Configuration cmdlets accept.** Previously the exported MOF referenced the wrong module identity, so `New-GuestConfigurationPackage` failed to build a package. The MOF now targets the `Microsoft.OSConfig` module (any version 1.2.0 or later), so the **Export → MOF → package → Azure Policy** flow works end-to-end. See the manifest editor guide for the one-time `Install-Module` prerequisites.

## v0.3.66 — 2026-06-10

- **Cleaner app description.** The installer and executable now describe the app simply as "ConfigForge — OSConfig Baseline Editing tool".
- **Tidier manifest card stats.** The "Could not read" label on each manifest card now wraps cleanly instead of squeezing into three cramped lines.

## v0.3.65 — 2026-06-10

- **Fixed: the Diff "Select manifest" dropdown could stop responding until restart.** After rapid navigation between pages that open the YAML editor, an invisible leftover editor pop-up could settle over the dropdown and swallow clicks. The editor's pop-up widgets are now cleaned up reliably when you leave a page, so the dropdown stays responsive. (Completes the v0.3.53 mitigation with a root-cause fix.)

## v0.3.64 — 2026-06-09

- **Fixed: the Manifests list card now shows a "Could not read" stat.** Indeterminate / unreadable resources (provider not supported, transport error, or unsupported path) were left out of the card, so Compliant + Issues didn't add up to the resource total the way they do in the manifest detail view. The card now shows the amber **Could not read** bucket alongside Resources / Compliant / Issues.
- **Fixed: the welcome screen no longer shows a stale version number** ("ConfigForge v0.2.0 works in two modes…" → "ConfigForge works in two modes…").

## v0.3.63 — 2026-06-08

- **UI label "OSConfig vNext" → "OSConfig Gen 2".** Renamed the product/version label shown in the sidebar footer, the Home page description, and the Settings docs-link + section description, across all four languages.

## v0.3.62 — 2026-06-08

- **Rebrand: "ConfigForge Spark" → "ConfigForge".** Dropped the "Spark" suffix across the app, build configuration, and documentation — new application id, executable name, installer artifact names, and macOS bundle identity. No functional change; existing manifests, history, and settings are unaffected.

## v0.3.54 through v0.3.61 - Full-UI localization (English / Français / Deutsch / Español)

Full user-interface localization via `react-i18next`: the app auto-detects the OS locale, with a **Settings → Language** override (`System / English / Français / Deutsch / Español`). 13 translation namespaces cover the sidebar, settings, editor, diff, history, compliance, audit-pack, and dialogs, and `Intl`-based formatters localize dates and numbers. English is the source language; French / German / Spanish catalogs are machine-translated and pending native-speaker review. Technical content — manifest YAML, OSConfig CLI output, CIS rule titles, baseline filenames, and audit-pack PDF exports — intentionally stays English so artifacts remain greppable and bug-filable.

## v0.3.53 — 2026-05-26

- **Fixed: the Diff "Select manifest" dropdown could become unresponsive.** Removed a stuck-loading guard on the Pairwise selects, added a 10-second timeout on the manifest-list IPC (a recoverable banner now replaces the silent hang), and tightened Monaco editor widget cleanup so a disposed editor can no longer intercept clicks elsewhere in the UI.

## v0.3.52 — 2026-05-26

- **Removed Windows Secure Shell (SSH) baseline from the library.** The bundled `ssh.osc.yaml` manifest has been retired.

## v0.3.51 — 2026-05-26

- **CIS Diff per-row "CIS Rule" column now displays Linux matches.** v0.3.50 wired the new Linux matcher into the compliance counter, but the per-resource display still used the legacy lookup. Rows now show the matched rule when the benchmark matcher succeeds.
- **Installer filenames now carry the correct version.** `apps/desktop/package.json` was stale at 0.3.36, causing all prior installer artifacts to embed the wrong version.

## v0.3.50 — 2026-05-26

- **Linux CIS Diff matcher rewrite.** New Linux-aware fuzzy matcher (`linuxFuzzyMatch`) replaces the PascalCase token matcher when matching Linux resources against Linux Azure Policy or Linux XCCDF benchmarks. Handles nested `Linux/KernelModule` children, path-boundary-aware overlap (`/etc/cron.d` ≠ `/etc/cron.hourly`), Linux-specific stopwords, polarity guard (`disable` vs `enable`), light stemming (`users` → `user`), and best-vs-runner-up margin. Coverage on the bundled SFF Linux Baseline jumped from **7.36% → 12.71% unique catalog coverage** (81% of the theoretical 15.7% ceiling for 47 resources against a 299-rule catalog), with **39/47 = 82.98%** of baseline resources finding a CIS match. Windows matchers untouched — Member-Server 2022/2025 still at 75.10%–77.51% unique coverage.

## v0.3.48 — 2026-05-26

- CIS Mapping page subtitle now mentions that a CIS tab is available in Diff for full-baseline coverage scoring.

## v0.3.47 — 2026-05-26

- History panel records the actual diff summary instead of a generic "Manifest registered" label.
- Compare buttons in CIS Diff and manifest-vs-manifest comparisons auto-scroll to results.

## v0.3.46 — 2026-05-26

- CIS fuzzy matching now uses exact-word overlap with a higher threshold to reduce over-matching in CIS Diff.
- CIS-licensed rule titles were removed from test fixtures and comments.
- Added `scripts/smoke-azure-policy-fuzzy.mjs` for targeted Azure Policy fuzzy-matcher smoke checks.

## v0.3.45 — 2026-05-22

- Visual Builder expands `Microsoft.OSConfig/Group` resources inline so Linux baselines can be edited without the YAML fallback.

## v0.3.44 — 2026-05-22

- Visual Builder Edit dialog no longer hits a temporal-dead-zone `ReferenceError` when opening YAML fallback paths.

## v0.3.43 — 2026-05-22

- Azure Trusted Signing is wired into the Windows release workflow alongside the legacy `.pfx` signing path.
- CIS Azure Policy matching is CSP-aware, improving matches for CSP-keyed Windows resources.

## v0.3.42 — 2026-05-22

- Visual Builder Edit handles `Microsoft.OSConfig/Test` wrappers and preserves wrapper schema on save.
- Diff value canonicalization treats common Windows path variants as equivalent.
- README screenshots were refreshed for CIS Diff, CIS Mapping, Visual Builder, and Compare.

## v0.3.41 — 2026-05-22

- Visual Builder Edit now uses the same form-based UI as Add Resource and merges edits into the original resource.
- CIS Diff source badges no longer wrap onto multiple lines.

## v0.3.40 — 2026-05-22

- Cross-manifest conflict lists are fixed-height, scrollable, and show a total count badge.

## v0.3.39 — 2026-05-22

- Visual Builder can edit existing resources from resource cards.
- Rationale prompts now fire for visual-builder-only Add, Edit, and Remove changes.

## v0.3.38 — 2026-05-22

- CIS Diff Status column is user-sortable and no longer auto-sorts by default.

## v0.3.37 — 2026-05-22

- CIS Diff shows unmapped rows with a red filled X, mapped rows with a green check, and sorts unmapped rows first.

## v0.3.36 — 2026-05-22

- Matrix diff canonicalizes boolean, `0`/`1`, quoted numeric, and empty-array variants to reduce false-positive changes.

## v0.3.35 — 2026-05-22

- CIS Re-check invalidates the renderer availability cache so newly added CIS data appears without restarting the app.

## v0.3.34 — 2026-05-22

- Expanding Resource Changes sections no longer scrolls the Diff page back to the top.

## v0.3.33 — 2026-05-22

- Intelligent Diff Insights summary uses matrix-derived resource counts so it matches the Resource Changes panel.

## v0.3.32 — 2026-05-22

- Diff page cleanup added empty-value equivalence and improved History rationale display.

## v0.3.31 — 2026-05-22

- Diff page shows resource lists grouped by status instead of only aggregate counts.

## v0.3.30 — 2026-05-22

- Diff page stats use `buildMatrix` resource-level comparisons instead of raw YAML line counts.

## v0.3.29 — 2026-05-22

- `matrix.ts` keeps `splitPascalCase` local to avoid pulling Node-only CIS parser dependencies into the renderer bundle.

## v0.3.28 — 2026-05-22

- Baseline-to-baseline matrix diff uses CIS-matcher lessons for better cross-version row merging, including hive and CSP naming drift.

## v0.3.27 — 2026-05-22

- CIS XCCDF/OVAL warmup is deferred by 3 seconds so manifest open is not blocked by XML parsing.

## v0.3.4 through v0.3.14

Releases v0.3.4 through v0.3.14 continued hardening the CIS pipeline, added the CIS Diff tab to the Diff page (`cfs:cis:bulk-lookup` IPC), improved macOS author-build parity, and shipped incremental reliability and UX fixes. See [`CHANGELOG.md`](https://github.com/ABMFST/ConfigForge/blob/main/CHANGELOG.md) at the repo root for per-release detail.

## v0.3.3 - Stable-width audit counter + CIS Mapping file checklist

Audit counter layout jitter fixed with `AuditProgressCounter` (tabular-nums + fixed width). CIS Mapping page gained a per-file checklist with present/missing indicators. `cfs:cis:recheck` cache bug fixed (all CIS caches now cleared). 1172 unit tests.

## v0.3.2 - CIS Mapping: resolved path + Open folder

CIS Mapping page shows the resolved runtime data directory path with Copy, Open folder, and Re-check actions. New IPC endpoints: `cfs:cis:reveal-data-dir` and `cfs:cis:recheck`.

## v0.3.1 - Settings store + snapshot rotation + deploy recovery

userData settings store (`cfs:settings:get/:set`), pre-deploy snapshot rotation (dual write: latest + timestamped), mid-deploy interruption sentinel with dashboard recovery banner, breadcrumbs on nested manifest pages. 1167 unit + 59 e2e tests.

## v0.3.0 - Private-preview readiness (Phases 1 + 2)

17 audit-tracked features: main-process enforce confirmation gate (CF-SEC-019), runtime secret log redaction (CF-SEC-020), CLI version-mismatch banner (CF-SEC-021), namespace-collision warning on register (#20), audit-pack PII warning, uncaughtException handlers, stale rationale lock sweep, Dashboard first-run card, compare quick action, format-tab unsaved notice, revert-button disable, CIS Mapping sidebar page (#11), resource picker search, URL import error classification. 1167 unit + 59 e2e tests.

## v0.2.21 - Private-preview audit fixes

3-track safety/reliability/UX audit: SSRF blocked on fetch-uri (CF-SEC-016/017/018), `path` field removed from register, atomic history snapshots, deleteManifest cleans history directory, useCliPresence mac-flavor fix, format-tab race-guard, computed verdicts for LAPS/SSH rows, revert confirm copy accuracy, Monaco find-widget fix.

## v0.2.20 - Empty-value equivalence + AI copy fix

Empty-value equivalence (`""`, `[]`, `null`, absent) in conflict detection. String-array values compare order-independently. Diff insights panel copy fixed (removed contradictory "AI-Assisted" + "Deterministic" pair).

## v0.2.15 through v0.2.19 - Cross-manifest conflict detection

Cross-manifest conflict detection shipped across five releases: source-YAML reading (not live state), normalized-name bridging for cross-OS-version drift (WS2019/2022/2025), `differs` wins over `partial` classification, Playwright e2e coverage of official Microsoft baseline trios.

## v0.2.10 through v0.2.14 - Editor layout + readable diffs

Editor layout reworked: bottom drawer for CIS + Rationale, bigger working canvas, less-invasive drawer behavior, suppressed false-positive JSON schema warnings. Diff viewer switched to GitHub-style readable text rendering. Validation page fixes, URL import flow improvements, and compliance table density tuning.

## v0.2.9 - Deploy risk-ack + UX polish + MS legal alignment

Deploy risk-acknowledgment dialog, UX polish pass, and Microsoft legal alignment updates.

## v0.2.5 through v0.2.8 - Diff cross-type matching + edge case hardening

Diff gained two-pass cross-type matching so rules wrapped differently (bare CSP vs Test-wrapped CSP) compare correctly. Matrix-diff edge cases around cross-type merge, empty-value equivalence, and quiet-mode filtering hardened. See [`CHANGELOG.md`](https://github.com/ABMFST/ConfigForge/blob/main/CHANGELOG.md) at the repo root for per-release detail.

## v0.2.4 - Diff name-normalization + schema-canonical identity

- **Diff: same rule under different naming conventions now matches.** v0.2.3 covered Registry; v0.2.4 closes the remaining gaps: `AuditPolicy.subcategory`, `UserRightsAssignment.policy`, `AccountPolicy.policy` matched by their enum-constrained schema fields; display-name normalization fallback (lowercase + strip non-alphanumeric) so `AuditLogon` / `Audit Logon` / `Audit-Logon` / `audit_logon` all collapse to the same rule. Negative controls preserve genuine add/remove cases (`AuditLogon` vs `AuditLogonEvents`; same name, different type).

See [`CHANGELOG.md`](https://github.com/ABMFST/ConfigForge/blob/main/CHANGELOG.md) at the repo root for the full v0.2.2 / 0.2.3 / 0.2.4 detail.

## v0.2.3 - Azure Policy structural rewrite + diff semantic identity

- **Diff: rules renamed across baseline versions no longer appear as duplicate add+remove.** `analyzeDiff` was keying by display name; switched to semantic identity (`type:keyPath\\valueName` for Registry; mirrors matrix-diff). Test-wrapper boundary changes (wrapped vs unwrapped) and `Microsoft.OSConfig/BaselineRule` placeholders (matched by stable `ruleId`) also handled.
- **Azure Policy export: structurally complete.** Previous export was a stub Azure could ingest but couldn't deploy any settings. Compared against a real Microsoft-shipped GC baseline, 13 required fields were missing. Now produces a 25 KB LAPS-aligned policy from the manifest's resources: per-setting ARM parameters (one per resource, manifest's current value as default), `configurationParameter` map in metadata, parameter-hash existence-condition for drift detection, dual VM+Arc deployment-template resources, `IncludeArcMachines` toggle, `versions[]`, assignment name uses `uniqueString()`.

## v0.2.2 - Azure Policy import shapes + matrix-diff correctness

- **Import: Azure Policy Guest Configuration JSON shapes.** Drop in the catalogs Microsoft publishes (Ubuntu CIS, Linux Azure Security Baseline, Windows GC) - the `settingsReference[]` shape now imports as `Microsoft.OSConfig/BaselineRule` placeholders that preserve `ruleId`, `displayName`, `severity`, and the original setting name. Plus: embedded YAML in a top-level `source` field (e.g. `Microsoft-Defender-Antivirus.json`); friendly errors for Azure Policy Definition wrappers and rule-metadata reference files (each error names what the file actually is and what to import instead).
- **Matrix diff: now compares `compliance.equals`, not just `properties`.** Two manifests targeting the same registry path with different desired compliance values (CSV-imported style: `equals: 10` vs `equals: 20`) used to report `status: identical`. Same root cause as the v0.2.1 analyzer fix, but in the matrix-builder code path.
- **Azure Policy export safety:** drop image-publisher allowlist (silently excluded gold images / custom VHDs / smaller-publisher marketplace images), add Arc-server targeting, refuse to export placeholder-baseline manifests (would silently report Compliant for every VM), auto-detect Windows vs Linux from manifest resources.
- **CI workflow:** signing gate eased to `continue-on-error: true` + `::warning::` so canonical `vX.Y.Z` tags can ship unsigned binaries until a Microsoft-managed signing pipeline is in place. Installer upload glob uses `find -maxdepth 3` to pick up electron-builder's version-named output subdirectory.

## v0.2.1 - Page-split refactor + security audit closure (current dev line)

Largest maintainer-facing release since the Electron migration:

- **Phase A→E renderer-page split.** Five lighthouse pages refactored from monolithic `.tsx` files into `<Page>/{index.tsx,helpers.tsx,state/,components/}` directories with custom hooks + per-hook vitest coverage. `ManifestEditor` went from 1,585 to 451 lines (−72%); aggregate across all five pages: 4,933 → 3,374 (−32%). New hooks lock in regression coverage for race-guards (`fetchToken`, `deployJobIdRef`, `listTokenRef`, `matrixLoadTokenRef`), timer cleanup (`docsCopiedTimerRef`, flash-message Set), ghost-selection fix, and format sync.
- **CSV-import schema-validation fix** (user-visible): CSV/TSV/XLSX imports and JSON security-definition imports now emit `valueName` + an inferred `valueType` so the editor's schema validator stops flagging every imported row.
- **All 15 security audit findings closed** (CF-SEC-001 through CF-SEC-015): file:// navigation lockdown, typed IPC payload validators, import size cap, markdown HTML escape, AI-content spoof-resistant per-process hash registry (CF-SEC-007), production signing gate + SHA256SUMS, `npx --no-install` electron-builder pin, CycloneDX SBOM in the release pipeline, `npm audit --omit=dev --audit-level=high` release gate, electron + electron-builder tilde-pinned, `safeCfs(key)` / `hasCfsNamespace(key)` capability helpers for the mac-author flavor.
- **Typed main-process logger** at `apps/desktop/electron/log.ts` (electron-log-backed, redacts common secret-key patterns). First migration: `elevate.ts`. Remaining ~30 console.* sites migrate incrementally.
- **Prettier** added (config + scripts; not gated in CI).
- **Test count** 882 → 1,093 on `main` / → 1,028 on `mac-author-build`.

See [`CHANGELOG.md`](https://github.com/ABMFST/ConfigForge/blob/main/CHANGELOG.md) at the repo root for the full v0.2.1 detail.

## v0.2.0 - Bring-your-own-CLI + OSS readiness

The biggest change since the Electron migration:

- **OSConfig CLI is no longer bundled.** Users install OSConfig separately; the editor / library / diff / compare / audit-pack PDF features keep working without it, and Deploy / Audit / Revert degrade gracefully via a new typed `CLI_REQUIRED` IPC error envelope (status 412) instead of failing on a raw spawn error.
- **First-run Welcome dialog**, **CliRequiredModal**, **Editor-mode hero card**, footer health pill rewrite, dedicated OSConfig section on the Settings page.
- **Binary resolver** now probes well-known install locations on Windows (App Execution Alias, winget Links shim, Program Files) and Linux (`/usr/bin`, `/usr/local/bin`, `/opt/osconfig`, `~/.local/bin`), plus Windows MSIX fallback via `Get-AppxPackage`.
- Legal/OSS scaffolding: `LICENSE`, `NOTICE`, `THIRDPARTYNOTICES.md`, `SECURITY.md`, `CONTRIBUTING.md`. Test count 832 → 882.

See [`CHANGELOG.md`](https://github.com/ABMFST/ConfigForge/blob/main/CHANGELOG.md) at the repo root for the full v0.2.0 detail.

## Wire audit-pack rationale-log loader

The audit-pack PDF + Markdown's **Rationale log** section now
actually renders. Previously `tryLoadRationale` was a stub
returning `undefined` - even though the rationale data sat at
`~/.configforge/rationale/<ns>.jsonl` and was already reachable
via `GET /api/manifests/[id]/rationale`. The adapter now maps
the on-disk shape (`ts / author / resourceName / oldValue /
newValue / reason / skipped?`) onto the audit-pack render shape
and the renderers gained a `resourceName` annotation so an
auditor can see **which resource** each rationale entry is
about. Skipped entries (`skipped:true`) are kept with a
`(rationale skipped)` sentinel so the explicit no-rationale
events remain audit-visible.

The AI provenance / **Citations** section is still gated and
omitted - that needs a per-manifest provenance store, which
was intentionally not built. Documented as a known gap.

## Docs hardening + factual audit + identity scrub

Comprehensive audit of every doc page against actual source.
Every API page had at least one wrong request/response shape
(biggest: `/api/health` is flat, not nested; `/api/diff` doesn't
exist, only `/api/diff/matrix`; `/api/audit` doesn't exist, audit
is `/api/deploy?mode=audit`). Snapshot ID format corrected
(it's a `randomBytes(4)` collision tiebreaker, not a sha256
prefix). `OSCFG_BINARY` corrected to `OSCFG_BIN` everywhere.
Last `L1` Level reference and `cis-ws2025-ms` worked-example
baseline ID removed. Personal owner email + name scrubbed from
public-facing surfaces; replaced with "Community-maintained" and
GitHub Issues link. Changelog backfilled with the preceding entries.

## Gate CIS UX surfaces on data availability

Adds `GET /api/cis/status` and a `useCisAvailable()` React hook.
When CIS data is absent, the editor sidebar, the compliance
dropdown, and the audit-pack tip are **hidden** rather than
rendering empty results. The rest of the app - editor, deploy,
audit, history, rationale, audit-pack PDF, AI analyzer, diff
matrix - works exactly the same.

## Remove bundled CIS benchmark data

License-compliance cleanup. Removes every CIS-derived YAML/JSON
artifact from `public/_baselines/cis/` and the `cis-benchmark`
catalog entries from
[`src/data/baseline-catalog.ts`](https://github.com/ABMFST/ConfigForge/blob/main/src/data/baseline-catalog.ts).
The CIS Benchmarks ship under terms incompatible with redistributing
derived artifacts in a public repo; the user supplies their own
legally licensed copies into `public/_baselines/cis/_data/`. Loaders
return `null` on `ENOENT`; downstream features hide gracefully.

## Not-Microsoft / not-for-prod disclaimer

Adds the prominent "independent open-source project, not
officially supported by Microsoft, not intended for production
use" banner to `README.md` and the introduction page of this
docs site. Sets reader expectation up-front.

## Edge-case fixes from rubber-duck audit

A grab-bag of fixes from a careful re-read of the
codebase. Highlights:

- `DELETE /api/manifests` now also drops the per-manifest rationale
  log via `deleteRationale()` so a deleted namespace doesn't leave
  an orphaned `<ns>.jsonl` that would mix with a re-registered
  manifest of the same name.
- `GET /api/manifests/[id]/audit-pack` now emits an RFC 6266-compliant
  `Content-Disposition` header (ASCII fallback + `filename*=UTF-8''…`)
  so non-ASCII manifest names download with the right name across
  modern and legacy browsers.
- A handful of smaller fixes flushed during the audit (author
  coercion to `-` when both git config and OS user are unavailable,
  defensive author cell in the rationale CSV export, etc.).

## Full rationale log page

`/manifests/[id]/rationale` is now a real page (
[`src/app/manifests/[id]/rationale/page.tsx`](https://github.com/ABMFST/ConfigForge/blob/main/src/app/manifests/%5Bid%5D/rationale/page.tsx))
instead of a 404. Shows every rationale entry across all resources,
with a search filter, a skipped-vs-captured toggle, per-row stats,
and a CSV-injection-safe download button. The editor sidebar's
"View all →" link finally goes somewhere.

## CIS cross-reference sidebar on `/manifests/new`

The CIS rule sidebar that already lit up on `/manifests/[id]` is now
also wired into the new-manifest page, so the cross-reference is
visible while authoring (not just while editing an existing
namespace). Hidden when CIS data is not present locally.

## Clearer YAML parse errors

YAML parse failures in the editor and `POST /api/manifests` now
include the offending line/column when the parser surfaces them,
and a single de-duplicated issue text replaces the old "issue
appears twice" UI.

## Download changelog as Markdown

Adds a "Download as Markdown" button on the in-app changelog page
that streams the markdown source directly. Removes the redundant
in-page rendered changelog so this docs site is the single canonical
copy.

## Documentation site

This site. mdBook-built, deployed via GitHub Actions to `gh-pages` on
every push to `main`. Replaces the ad-hoc README-and-AGENTS.md
sprawl. README is slimmed; `AGENTS.md` stays unchanged at the repo
root for AI-agent tool discovery.

## Audit-pack PDF generator

`src/lib/audit-pack/` builds a single self-contained PDF per
manifest: header → compliance scorecard → version history with
author/rationale (works without) → AI provenance citations.
New endpoint `GET /api/manifests/[id]/audit-pack?format=pdf|markdown`.

## Inline rationale + change-author capture

`HistoryEntry` extended with optional `author`, `authorEmail`,
`rationale`. `src/lib/history/author.ts` resolves the change author
from `CONFIGFORGE_AUTHOR` → `git config user.{name,email}` → OS user
→ `'unknown'`. Per-manifest rationale log at
`~/.configforge/rationale/<ns>.jsonl`. Editor-side modal prompts
once per save with a 1-500 char "Why?" textarea.

## CIS cross-reference fuzzy fallback

When a strict-name match returns nothing, the editor sidebar falls
back to a fuzzy-match suggestion list (Levenshtein-bound) so the UX
gap closes. Strict matches stay marked
`high confidence`; fuzzy ones get `low confidence`.

## AI provenance + bibliography + circular-reference guard

Every AI response now carries a `provenance` field listing sources
(`CIS`, `NIST`, `MSDocs`, `GPO`, `manifest`, `user-input`) with
confidence scores. The `circular-guard` refuses to ground on content
tagged `<!-- ai-generated -->`. Apply buttons hidden when
`citationCoverage < 0.5` or `sources.length === 0`.

## Microsoft↔CIS cross-reference + compliance % report

`src/lib/cis/crossref.ts` plus `src/lib/cis/compliance.ts`. Given a
user manifest and a CIS baseline, score it: `{matched, mismatched,
missing, score}` plus per-rule breakdown. New
`/api/compliance/report` endpoint and `/manifests/[id]/compliance`
view. Markdown audit-pack export.

## Master-matrix N-way diff + AI delta explanation

`/api/diff/matrix` plus the `/diff/matrix` UI page. Pick 2-10
registered manifests; see a master-matrix table where each row is a
setting and each column is a baseline, with `identical` / `differs` /
`partial` colour-coding. AI-driven semantic explanations of *why*
values differ. Excel export with conditional formatting.

## CIS Windows benchmarks

CIS Windows Server 2016/2019/2022/2025 (Domain Controller and Member
Server roles) benchmarks ingested as compact JSON catalogs at
`public/_baselines/cis/`, plus rule-id mappings. Sets the foundation
for the compliance scoring and UI cross-reference that follow.

## Inputs, atomicity, perf

- Input hardening + recursion + numeric overflow guards
- Atomic registration writes (temp + rename) + per-namespace mutex
- Registry `valueType` fix: `REG_DWORD`/`REG_SZ`/... → `Dword`/`String`/...
- Regenerate `ssh.osc.yaml` - was using a non-existent resource type
- Status endpoint perf: cache + dedup + concurrency gate + stdin fix

## Reliability and security

- Compliance audit fidelity: null-tolerant Defender enums + indeterminate state
- Memoize `getSystemInfo` for the process lifetime
- Bounded worker queue + retries with backoff for transient CLI errors
- Translate Policy CSP `0x82F00009` + LSA `0xD0000022` to actionable hints
- Pre-deploy snapshot saves PRIOR yaml; `lastAuditedAt` on enforce
- `oscfg apply --content` falls back to temp file for large manifests
- CSRF guard on all state-mutating routes; binary cache source typo fix

## Foundation hardening

- Use `fs/promises` everywhere; remove sync I/O from history
- History security: refuse path traversal, restrict to user dir
- CI matrix on Linux + Windows; bump CI Node + Vitest versions
- ESLint cleanup; strict-mode TypeScript
- Snapshot dedupe + retention sweep (default 50, env-tunable)
- Restore safety: re-apply pre-restore snapshot before changes
- Analyzer correctness - fix `isCriticalSetting` heuristics
- Use server-side validation summary from source YAML in compliance
