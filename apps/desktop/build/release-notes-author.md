# ConfigForge Author 0.3.95-author.1 - macOS

> **Release state: draft and unpublished.** `mac-v0.3.95-author.1` is the
> current macOS Author tagged source. Its matching GitHub release remains an
> unpublished draft until a maintainer completes validation and approves
> publication. The expected asset names are listed below; this document does
> not assert that the assets have already been uploaded or that the release
> has been published.

This release fixes unreliable My Baselines status tooltips and ports
documentation-accuracy corrections. It remains an author-only Apple Silicon
build. It does not add device deployment, device audit, enforcement, revert,
elevation, OSConfig CLI health, or audit-results storage.

## Fixed: reliable My Baselines status tooltips

- Replace unreliable native HTML `title` hover tooltips with FluentUI
  `Tooltip` on the baseline name, platform, validation, compliance/Not
  Audited, and modified-date cells in the My Baselines table.
- Preserve multiline validation details through a stable
  `aria-describedby` target instead of relying on OS-rendered native tooltips.
- Keep the mac compliance cell intentionally non-clickable — it stays a
  non-interactive `<span>` with the existing gray "not audited" styling, now
  wrapped only in `Tooltip`. No button, click handler, or route navigation
  was added.
- Preserve the accessible ARIA shape: no extra table tab stops are
  introduced by the tooltip triggers.
- See PR [#101](https://github.com/Azure/ConfigForge/pull/101), which ports
  the reviewed main PR [#100](https://github.com/Azure/ConfigForge/pull/100)
  fix to the mac-specific table layout.

## Documentation accuracy

- Port the applicable documentation-accuracy corrections from main PR
  [#97](https://github.com/Azure/ConfigForge/pull/97) via PR
  [#99](https://github.com/Azure/ConfigForge/pull/99), including corrected
  IPC surface, symbol/path references, and third-party notice licensing.
- Keep the macOS Author version stream and release references unaffected by
  the documentation port; no package, version, or workflow files changed in
  PR #99.

## Included authoring capabilities

- YAML, JSON, and Visual editing with validation
- Microsoft Baselines and local, URL, CSV, JSON, YAML, and XLSX import
- Pairwise, CIS, and Matrix Diff
- User-supplied Benchmark Mapping data
- History and rationale capture
- Audit Pack PDF and Markdown export

Audit Pack generation is an authoring and export feature. It does not perform
a device audit.

## Author-only boundary

The macOS preload intentionally omits:

- `health`, `deploy`, `deployRecovery`, and `revert`
- `auditResults`
- `system` elevation methods

No `oscfg` binary or device-operation surface is included.

## Architecture

The release targets Apple Silicon ARM64 Macs (M1 or later). It is not an x64
or universal build and does not support Intel Macs. Builds are unsigned and
not notarized.

## Validation policy

Release preparation uses these dependency-free local checks:

- Parse and compare package and lockfile JSON.
- Verify the public-package guard and its Node.js tests.
- Check documentation references, forbidden files, public registry URLs, and
  exact screenshot scope.
- Run Git whitespace and diff-scope checks.

GitHub CI is authoritative for npm-backed lint, Vitest, build, audit, and
Playwright validation. Publication requires successful CI, a completed
packaging build, and verification of the five expected assets before the
draft release is published.

## Expected draft release assets

The macOS release workflow uses exactly these expected asset names for
`mac-v0.3.95-author.1`:

1. `ConfigForge-Author-0.3.95-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.95-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`

## Contributors

PRs #99 and #101 were contributed by
[@ABMFST](https://github.com/ABMFST) with Copilot collaboration.

## Reporting issues

File issues in [Azure/ConfigForge](https://github.com/Azure/ConfigForge/issues)
with the `mac-author` label.
