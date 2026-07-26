# ConfigForge Author 0.3.93-author.2 - macOS

> **Release state: draft and unpublished.** Annotated tag
> `mac-v0.3.93-author.2` and the current `mac-author-build` head resolve to
> `c4ce196574f1d3fdf878d4c5856f64539f6dec7a`. The matching GitHub release
> exists and contains five verified assets. Workflow run
> [#30186678580](https://github.com/Azure/ConfigForge/actions/runs/30186678580)
> completed successfully. The release must remain a draft unless a maintainer
> separately approves publication. PR
> [#83](https://github.com/Azure/ConfigForge/pull/83) ports the reviewed
> Windows Server 2025 baseline repairs to `mac-author-build`, and PR
> [#84](https://github.com/Azure/ConfigForge/pull/84) prepares the immutable
> author.2 tag and package metadata.

This release carries forward the authoring parity and nested multi-value
keyboard editing from author.1. It also repairs the standalone Windows Server
2025 baselines and the matching analysis identities. It remains author-only:
device deployment, audit, enforcement, revert, elevation, OSConfig CLI health,
and device audit-results storage are not included.

## Windows Server 2025 baseline repairs

- Replace failing array-valued Policy CSP settings with supported Registry,
  AccountPolicy, AuditPolicy, and UserRightsAssignment providers.
- Keep ten supported residual CSP settings in each standalone profile.
- Correct the Domain Controller, Member Server, and Workgroup Member resource
  counts to 321, 320, and 296.
- Remove Source links from the three corrected baselines because the local
  manifests now differ materially from their upstream files.
- Resolve Increase scheduling priority, password complexity, and guest account
  status in Benchmark Mapping without bundling licensed CIS data.
- Use `properties.name`, with legacy `properties.policy` fallback, to keep
  User Rights Assignment and Account Policy settings distinct in analysis and
  Matrix Diff.

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

The author.1 preparation tree passed 1,598 Vitest tests in 117 files, 79
focused Manifest Editor tests, both isolated Loop Playwright scenarios, lint
with zero errors, full and author-flavor desktop builds, locale review with
zero placeholder/glossary/plural issues, and a clean production audit. The
author.2 preparation passed PR check run
[#30186333208](https://github.com/Azure/ConfigForge/actions/runs/30186333208).
The tag-pinned macOS workflow also passed the install, production audit, build,
SBOM, checksum, and upload gates and verified all five release assets.

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

## Verified draft release assets

The draft release contains exactly these five assets:

1. `ConfigForge-Author-0.3.93-author.2-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.93-author.2-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`

Verify the DMG, blockmap, and update metadata against the SHA-256 manifest.

## Contributors

Historical implementation attribution for PRs #75 through #77, release
documentation/tooling in PRs #79 and #80, and author.2 repairs in PRs #83 and
#84: @ABMFST and Copilot.

## Reporting issues

File issues in [Azure/ConfigForge](https://github.com/Azure/ConfigForge/issues)
with the `mac-author` label.
