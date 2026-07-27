# ConfigForge Author 0.3.94-author.1 - macOS

> **Release state: draft and unpublished.** `mac-v0.3.94-author.1` is the
> current macOS Author tagged source. Its matching GitHub release must remain
> a draft until a maintainer completes validation and approves publication.
> The expected asset names are listed below; this document does not assert
> that the assets have already been uploaded.

This release improves public-source readiness, refreshes shared
documentation screenshots with synthetic benchmark content, and updates one
dev-only dependency. It remains an author-only Apple Silicon build. It does
not add device deployment, device audit, enforcement, revert, elevation,
OSConfig CLI health, or audit-results storage.

## Security update

- Update dev-only `brace-expansion` 5.x from 5.0.7 to 5.0.8 for
  [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
  and CVE-2026-14257.
- Use the exact public npm registry URL, SHA-512 integrity value, and Node.js
  engine metadata reviewed in PR
  [#86](https://github.com/Azure/ConfigForge/pull/86).
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
- Use runtime-only synthetic **Industry Benchmark** content in Benchmark
  Mapping and CIS Diff examples.
- Commit no CIS benchmark data, generated benchmark catalog, or screenshot
  tooling.

The screenshots are shared documentation assets. They do not change the
macOS Author capability set.

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
Playwright validation. Publication requires successful CI and verification of
the five expected assets.

## Expected draft release assets

The macOS release workflow uses exactly these expected asset names:

1. `ConfigForge-Author-0.3.94-author.1-mac-arm64.dmg`
2. `ConfigForge-Author-0.3.94-author.1-mac-arm64.dmg.blockmap`
3. `latest-mac.yml`
4. `sbom-macos-author.cdx.json`
5. `SHA256SUMS-macos-author.txt`

## Contributors

PRs #86, #90, #92, #93, and #94 were contributed by
[@ABMFST](https://github.com/ABMFST) with Copilot collaboration.

## Reporting issues

File issues in [Azure/ConfigForge](https://github.com/Azure/ConfigForge/issues)
with the `mac-author` label.
