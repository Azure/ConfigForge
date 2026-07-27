# ConfigForge — CI/CD

> Four GitHub Actions workflows ship in the current state:
> [`pr-check.yml`](../../.github/workflows/pr-check.yml),
> [`release.yml`](../../.github/workflows/release.yml),
> [`release-mac.yml`](../../.github/workflows/release-mac.yml), and
> [`docs.yml`](../../.github/workflows/docs.yml).
> This doc explains what they do, what triggers them, and how to cut a
> release. Release artifacts are unsigned by design (no code signing in CI).

## Trigger scope

| Workflow | Triggers ON |
|---|---|
| `pr-check.yml` | PRs into and pushes to `main` or `mac-author-build`; manual dispatch remains available for explicit re-runs. |
| `release.yml` | Clean tag push matching `v*.*.*` with no suffix; manual dispatch with version input. Builds Windows + Linux Full edition artifacts. |
| `release-mac.yml` | Manual dispatch of the protected `main` workflow definition with an existing `mac-vX.Y.Z-author.N` tag; checks the tagged tree with the protected public-asset guard, then attaches five unsigned macOS Author assets to its existing draft release. |
| `docs.yml` | Pushes to `main` touching `docs/**`, `.github/workflows/docs.yml`, or `README.md`; PRs touching `docs/**` or `.github/workflows/docs.yml`; manual dispatch. Deploys the mdBook site to `gh-pages` only on push to `main`. |

The legacy `.github/workflows/ci.yml` (tested the now-deleted Next.js tree) was removed in the Phase 10 cutover commit.

## `pr-check.yml` — fast PR feedback

**Jobs (parallel):**

| Job | Runner | Time budget | What it runs |
|---|---|---|---|
| `lint` | ubuntu-latest | <8 min | Dependency-free public-asset guard + guard tests, then `npm run lint` (ESLint over `apps/desktop`; 0 errors expected, `warn`-level `max-lines` is tracked-but-not-blocking) |
| `test` | ubuntu-latest | <12 min | `npm ci`, `npm audit --omit=dev --audit-level=high`, `npm run core:build`, `npm test`, `npm run desktop:build`, and smoke-checks the built renderer/main/preload files. |
| `e2e` | windows-latest | <20 min | Playwright Electron smoke spec |

**Caching:**
- `setup-node@v4` with `cache: npm` — npm cache + lockfile.
- `actions/cache@v4` for Electron prebuilt binaries (~120 MB) + electron-builder cache + Playwright browsers (~150 MB).
- Cache key includes `apps/desktop/package.json` hash for Electron and `package-lock.json` hash for Playwright, so cache invalidates automatically on dep updates.

**Concurrency:** new pushes to the same PR cancel in-progress runs.

**On failure:** the `e2e` job uploads `test-results/` and `playwright-report/` as workflow artifacts with 7-day retention.

## `release.yml` — tagged release pipeline

**Triggers:**
- Clean tag push matching `v*.*.*` with no suffix.
- Manual via Actions tab → "Release" → "Run workflow" with version input.

**Jobs (parallel matrix):**

| OS | Produces | Time budget |
|---|---|---|
| windows-latest | NSIS `.exe`, portable `.zip` | <30 min |
| ubuntu-latest | AppImage, `.deb`, `.rpm`, `.tar.gz` | <30 min |

Both jobs publish artifacts to a GitHub Release as a **draft** so a human reviews before publishing.

### Hardened release pipeline

The release workflow steps now include, in order:

1. **`node scripts/verify-public-package-assets.mjs`** — rejects CIS benchmark files, unsafe CIS `extraResources` filters, and non-public package-lock registry hosts before installation or packaging.
2. **`npm ci`** — strict-from-lockfile install.
3. **`npm audit --omit=dev --audit-level=high`** *(CF-SEC-014 gate)* — fails the release if any production dependency has a HIGH or CRITICAL advisory. Moderate/low advisories pass through so legitimate releases aren't blocked by transient downstream noise. (Also runs on every PR via `pr-check.yml`.)
4. Generate icons + build core + build renderer + build main.
5. **`npx --no-install electron-builder --<platform> --publish never`** *(CF-SEC-011 pin)* — refuses to silently install a different version of electron-builder if the lockfile is stale or the locally-installed binary is missing. Combined with `npm ci` above, this constrains the release toolchain to exactly the versions in `package-lock.json`. Artifacts are produced **unsigned**.
6. **Generate CycloneDX SBOM** *(CF-SEC-012)* — runs `npx --no-install @cyclonedx/cyclonedx-npm --omit dev --output-format JSON --output-file apps/desktop/release/sbom-<os>.cdx.json`. Smoke check: bails if the output doesn't contain a `"components"` array.
7. **Generate per-platform SHA256SUMS** — `SHA256SUMS-windows.txt` or `SHA256SUMS-linux.txt`.
8. **Publish to GitHub Release** — uploads installers + `SHA256SUMS-*.txt` + `sbom-*.cdx.json` as a draft release via `gh release upload --clobber`.
9. **Stash artifacts as workflow outputs** — belt-and-suspenders for retries (7-day retention).

**Code signing: none.** Release artifacts are **unsigned** by design — this project holds no code-signing credentials in CI. On Windows, SmartScreen will warn until a binary builds reputation; on macOS, Gatekeeper requires `xattr -cr` (see `PACKAGING.md`). The trust path is building from source; an optional local self-sign helper for your own build is `apps/desktop/scripts/generate-dev-cert.ps1`.

**Concurrency:** releases are serialized per tag (no `cancel-in-progress`) so a re-push of the same tag waits for the original to finish.

## Cutting a release

1. **Pick a version** following semver. Set and validate it once in the shell;
   the empty default makes copying these commands fail safely:
   ```bash
   VERSION=''
   [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
     echo 'Set VERSION to X.Y.Z before continuing.'
     exit 1
   }
   ```
2. **Bump the version in the workspace package.jsons:**
   ```bash
   npm version "$VERSION" --no-git-tag-version
   npm version "$VERSION" --no-git-tag-version -w @configforge/desktop
   npm version "$VERSION" --no-git-tag-version -w @configforge/core
   ```
   Verify: `grep -r '"version"' package.json apps/desktop/package.json packages/core/package.json`.
3. **Commit and push:**
   ```bash
   git add -A
   git commit -m "chore: bump version to $VERSION"
   git push
   ```
4. **Tag and push the tag:**
   ```bash
   git tag "v$VERSION"
   git push origin "v$VERSION"
   ```
   Clean `v*.*.*` tags are the canonical Win/Linux release trigger.
5. **Watch the workflow** in the Actions tab. Both Full-edition build jobs should complete within the 30 min budget.
6. **Smoke-test** the draft release per [`PACKAGING.md`'s post-build checklist](./PACKAGING.md#post-build-smoke-checklist). Verify the SBOM file is present in the artifact list and that `SHA256SUMS-*.txt` matches the installer hashes.
7. **Edit the release notes** (the CHANGELOG entry for the version is a good starting point).
8. **Click Publish.**

## Cutting a hotfix without retagging

Actions tab → "Release" → "Run workflow" with the version input. Same artifacts get re-uploaded to the existing release. Use sparingly — a tag bump is cleaner.

## Required secrets summary

| Secret | Required for | What |
|---|---|---|
| `GITHUB_TOKEN` | Release uploads, SBOM upload, SHA256SUMS upload | Auto-provisioned by GitHub Actions |

No code-signing secrets — release artifacts are **unsigned** by design (no Windows or Linux signing).

## Cost notes

GitHub-hosted runners pricing (private repos, 2026 rates):

- ubuntu-latest: 1× minute multiplier
- windows-latest: 2× minute multiplier
- macos-latest: 10× minute multiplier (used only by manual `release-mac.yml` for the Author edition)

Per PR check (worst case, no cache):
- lint:  3 min ubuntu  →  3 ubuntu-min
- test:  6 min ubuntu  →  6 ubuntu-min (includes vitest + desktop:build verification)
- e2e:  10 min windows → 20 ubuntu-min
- **Total: ~29 ubuntu-equivalent min/PR**

Per release (includes audit gate + SBOM generation):
- Win build: 22 min × 2 multiplier  →  44 ubuntu-min
- Linux build: 20 min  →  20 ubuntu-min
- **Total: ~64 ubuntu-min/release**

## Future work

- **`format:check` CI gate** — Prettier is installed (v0.2.1) but not gated in CI. Adding `npm run format:check` to `pr-check.yml` is a one-line follow-up once the codebase is consistently formatted.
- **Coverage reporting** — vitest can output lcov; would add a Codecov / Coveralls step after lint passes. Skipped to keep the PR check matrix minimal.
- **Visual regression** — Playwright traces could feed a pixel-diff workflow. Visual parity is human-checked during PR review for now.
