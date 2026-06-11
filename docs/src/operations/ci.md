# CI and release operations

ConfigForge uses GitHub Actions from `.github/workflows/`. The product is an Electron desktop app, not a web service, so CI builds the Electron renderer/main bundles and installer artifacts rather than server routes.

## Workflows

| Workflow | File | Trigger | Output |
| --- | --- | --- | --- |
| **PR check** | `pr-check.yml` | Pull requests to `main`, pushes to `main`, or manual `workflow_dispatch` | Lint, Vitest, Linux desktop build verification, and Windows Playwright Electron smoke |
| **Release** | `release.yml` | Clean tag push `vX.Y.Z` on `main`; manual dispatch for rebuilds | Windows + Linux installers, per-platform SHA256SUMS, SBOMs, draft GitHub Release upload |
| **Release (macOS author)** | `release-mac.yml` | Manual `workflow_dispatch` from `mac-author-build` with an existing author release tag | Unsigned macOS Author `.dmg`, SHA256SUMS, SBOM, upload to the existing draft release |
| **Docs** | `docs.yml` | Docs changes on `main` / PRs touching docs | mdBook build, markdownlint, `gh-pages` deploy on push to `main` |

The Win/Linux Release workflow intentionally ignores hyphen-suffix tags (`!v*-*`). macOS Author releases use separate author tags such as `v0.3.48-author.1` and must be dispatched manually from `mac-author-build`.

## What `pr-check.yml` runs

Three jobs run in parallel:

1. **Lint** (`ubuntu-latest`) - `npm ci`, then `npm run lint`.
2. **Vitest + build** (`ubuntu-latest`) - `npm ci`, `npm run core:build`, `npm test`, `npm run desktop:build`, then smoke-checks the built renderer/main files.
3. **Playwright Electron smoke** (`windows-latest`) - installs, builds the desktop app, generates icons, then runs `npx playwright test --config apps/desktop/playwright.config.ts`.

Current scale: roughly **1,178 Vitest tests on `main`** and **1,114 on `mac-author-build`**. Playwright smoke tests are separate from the Vitest count.

Caching covers npm, Electron binaries, electron-builder, and Playwright browser downloads. Concurrency cancels stale PR runs on the same branch.

## What `release.yml` runs

The Release workflow builds **Full edition** artifacts from `main` on Windows and Linux. A clean `vX.Y.Z` tag push is the normal release path.

Each platform job:

1. Installs with `npm ci`.
2. Runs `npm audit --omit=dev --audit-level=high`.
3. Generates icons.
4. Builds `@configforge/core` and the desktop renderer/main bundles.
5. Builds platform installers with locked `electron-builder` (`npx --no-install`).
6. Generates a CycloneDX SBOM.
7. Generates `SHA256SUMS-windows.txt` or `SHA256SUMS-linux.txt`.
8. Uploads installers, checksums, and SBOMs to a draft GitHub Release.
9. Stashes the same artifacts on the workflow run for short-term recovery.

Release artifacts are **unsigned** by design — there is no code signing in CI. On Windows, SmartScreen warns until a binary builds reputation; on macOS, Gatekeeper requires `xattr -cr`. The trust path is building from source; optional local self-signing is described in `apps/desktop/scripts/generate-dev-cert.ps1`.

## What `release-mac.yml` runs

The macOS Author workflow is opt-in because macOS runners are expensive and the Author edition has a different product identity/build config.

Run it from the Actions tab or CLI against `mac-author-build`:

```bash
gh workflow run "Release (macOS author)" --ref mac-author-build -f release_tag=v0.3.48-author.1
```

The target draft release must already exist. The workflow builds with `electron-builder.author.yml`, generates `SHA256SUMS-macos-author.txt` and `sbom-macos-author.cdx.json`, then uploads the `.dmg` assets to that draft release.

## Linux runner notes

- Uses `ubuntu-latest`.
- The `oscfg` CLI is not bundled or installed in CI. End-to-end CLI operations are covered by local smoke testing.
- Keep optional Rollup Linux binaries in `package-lock.json`; regenerating the lockfile on Windows without optional dependencies can break Vitest startup on Linux.

## Windows runner notes

- Uses `windows-latest`.
- The CI smoke launches Electron, not a browser-hosted service.
- CLI deploy/audit smokes still require an elevated local Windows shell with `oscfg` installed.

## Docs workflow

`docs.yml` builds the mdBook under `docs/`, runs markdownlint, and deploys to `gh-pages` on pushes to `main`. GitHub Pages must be configured to serve from the `gh-pages` branch.

## CI minute budget

PR checks run three parallel jobs. Batch related commits before pushing, especially when porting between `main` and `mac-author-build`, so one logical change burns one CI run.

## See also

- [`apps/desktop/CI.md`](https://github.com/ABMFST/ConfigForge/blob/main/apps/desktop/CI.md)
- [Smoke testing on Windows](./smoke-testing.md)
- [Filing upstream bugs](./upstream-bugs.md)
- [Troubleshooting](./troubleshooting.md)
