# ConfigForge Author 0.3.94-author.1 - macOS

> **Release state: draft and unpublished.**
> `mac-v0.3.94-author.1` is the current macOS Author tagged source. The
> matching GitHub release remains a draft until a maintainer approves
> publication. Current GitHub checks and release metadata are the authority
> for build and asset status.

This release improves public-source readiness, refreshes shared documentation
screenshots with synthetic benchmark content, and updates one dev-only
dependency. It remains author-only: device deployment, device audit,
enforcement, revert, elevation, OSConfig CLI health, and audit-results storage
are not included.

## Security update

- Update dev-only `brace-expansion` 5.x from 5.0.7 to 5.0.8 for
  [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
  and CVE-2026-14257.
- Preserve the exact public npm registry URL and integrity metadata reviewed
  in PR [#86](https://github.com/Azure/ConfigForge/pull/86).
- Keep every other macOS dependency and version stream unchanged. The updated
  package is used by build and test tooling and is not bundled in the app.

## Public-source readiness

- Align licensing, privacy, security reporting, best-effort support,
  contribution templates, repository ownership, and release guidance through
  PRs [#90](https://github.com/Azure/ConfigForge/pull/90),
  [#92](https://github.com/Azure/ConfigForge/pull/92), and
  [#93](https://github.com/Azure/ConfigForge/pull/93).
- Run a dependency-free public-package guard before packaging. The guard
  rejects licensed CIS assets, unsafe CIS builder filters, and non-public npm
  registry URLs.
- Keep maintainer, branch, and release guidance in existing documentation.
  This release does not add a standalone governance file.

## Synthetic documentation screenshots

- Port the exact nine reviewed screenshot PNGs from PR
  [#94](https://github.com/Azure/ConfigForge/pull/94).
- Use synthetic **Industry Benchmark** content in Benchmark Mapping and CIS
  Diff examples.
- Commit no CIS benchmark data, generated benchmark catalog, or screenshot
  tooling.

The screenshots are shared documentation assets. They do not change the
macOS Author capability set.

## Authoring parity

- **Complete New Baseline setup:** create a blank Windows or Linux baseline,
  use a starter template, choose a Microsoft Baseline in place, load from a
  public URL, or import a local `.osc.yaml`, `.json`, `.csv`, or binary
  `.xlsx` file.
- **Localized My Baselines catalog:** search and filter localized catalog
  content, see Date Modified in the local calendar, and keep multiple
  baselines open in persistent tabs.
- **Selection-aware Diff:** exactly two selected baselines open preselected in
  Pairwise; three through ten open preselected in Matrix.
- **Safer workspaces:** unsaved changes prompt before a tab closes or
  navigation leaves the editor.
- **Persistent views:** each baseline remembers Code or Visual view, and
  read-only Code view explains how to enter editing.
- **Current Benchmark Mapping setup:** shared headings and localized guidance
  replace the legacy setup copy.

## Nested multi-value navigation

PR #76 adds these behaviors on `main`, and PR #77 carries them to the current
macOS author line:

- Enter commits the current nested value and moves down.
- Enter on the final nested value appends and focuses a new value.
- Tab commits and moves to the cell on the right.
- Empty arrays create a focusable value when navigation reaches them.
- Invalid drafts retain focus and do not mutate the manifest.
- Shift+Enter remains a newline for structured nested values.

Dependency-free local validation covers package and lockfile JSON, the
public-package guard and its Node.js tests, documentation references,
forbidden files, public registry URLs, and Git whitespace checks. GitHub CI is
the authority for npm-backed lint, Vitest, build, audit, Playwright, and
release-asset status.

## Included authoring capabilities

- YAML, JSON, and Visual editing with live validation
- Typed, lossless Test and Group editing with exact QWord values
- Microsoft Baselines and local/URL/spreadsheet import
- Pairwise, CIS, and Matrix Diff
- User-supplied Benchmark Mapping data
- History and rationale capture
- Audit Pack PDF and Markdown export

Audit Pack generation is an authoring/export feature. It does not run a device
audit.

## Author-only boundary

The macOS preload intentionally omits:

- `health`, `deploy`, `deployRecovery`, and `revert`
- `auditResults`
- `system` elevation methods

No `oscfg` binary or device-operation surface is included.

## Architecture: Apple Silicon ARM64 only

This DMG contains an ARM64 Electron and Node.js binary for Apple Silicon Macs
(M1 or later). It is not an x64 or universal build and does not support Intel
Macs.

## First launch for unsigned builds

The app is unsigned and not notarized. After copying **ConfigForge Author.app**
to `/Applications`, clear the browser-added quarantine attribute once:

```bash
xattr -cr "/Applications/ConfigForge Author.app"
```

If that command reports a permission error, use:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/ConfigForge Author.app"
```

## Draft release asset contract

The release workflow is configured to upload exactly:

1. `ConfigForge-Author-0.3.94-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.94-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`

Use the draft GitHub release and current workflow checks to confirm actual
upload and verification status.

## Contributors

PRs #86, #90, #92, #93, and #94 were contributed by
[@ABMFST](https://github.com/ABMFST) with Copilot collaboration.

## Reporting issues

File issues in [Azure/ConfigForge](https://github.com/Azure/ConfigForge/issues)
with the `mac-author` label.
