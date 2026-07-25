# ConfigForge Author 0.3.93-author.1 - macOS release draft

> **Status: planned, not released.** No `mac-v0.3.93-author.1` tag or GitHub
> release exists. PR [#75](https://github.com/Azure/ConfigForge/pull/75) is on
> `mac-author-build` at `3086ef0`. PR
> [#76](https://github.com/Azure/ConfigForge/pull/76) is on `main` at
> `278dad6`; PR [#77](https://github.com/Azure/ConfigForge/pull/77) ports that
> complete series to `mac-author-build` at `aec0775`. Package metadata remains
> at `0.3.92-author.1`. Create no tag or release until the exact
> `0.3.93-author.1` candidate passes final validation.

This planned release restores the macOS author flavor to the shared authoring
experience and completes nested multi-value keyboard editing. It remains
author-only: device deployment, audit, enforcement, revert, elevation,
OSConfig CLI health, and device audit-results storage are not included.

## Planned authoring parity

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

PR #77 reports 79 focused Manifest Editor tests, two isolated Playwright
scenarios, lint with zero errors, a successful desktop build, and a clean
production audit. The exact versioned candidate still requires the complete
release gate before tagging.

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

## Expected candidate assets

The draft release must contain exactly these five assets after the packaging
workflow succeeds:

1. `ConfigForge-Author-0.3.93-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.93-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`

Verify the DMG, blockmap, and update metadata against the SHA-256 manifest.

## Contributors

Historical implementation attribution for PRs #75 through #77: @ABMFST and
Copilot.

## Reporting issues

File issues in [Azure/ConfigForge](https://github.com/Azure/ConfigForge/issues)
with the `mac-author` label.
