# Contributing to ConfigForge

Thanks for taking the time to look. ConfigForge is a community open-source project; pull requests, issue reports, and design feedback from anyone are welcome.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Quick links

- Security vulnerabilities: see [SECURITY.md](./SECURITY.md). **Do not file vulnerabilities as public issues.**
- AI agent guide: see [AGENTS.md](./AGENTS.md), canonical reference for both AI tooling and human contributors.

## Contributor License Agreement

This project welcomes contributions and suggestions. Most contributions require you to agree to a Microsoft [Contributor License Agreement (CLA)](https://cla.opensource.microsoft.com/) declaring that you have the right to, and actually do, grant us the rights to use your contribution. The CLA bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

Commits should still include a `Co-authored-by` trailer when AI tooling assisted (see Commit conventions below).

## Pre-PR bar

Every PR must pass these gates before review:

```powershell
npm ci                  # clean install; never use `npm install` for PRs
npm run lint            # ESLint over apps/desktop
npm test                # vitest, full suite
npm run desktop:build   # core + renderer + electron main
```

All four must exit zero. CI will surface regressions.

In addition:

- `npm audit --omit=dev --audit-level=high` should show zero high/critical CVEs. The release workflow enforces this as a hard gate (CF-SEC-014).
- The release workflow runs `scripts/verify-no-cli-binary.sh` against `apps/desktop/release/`. This will fail the build if any `oscfg*` binary is found in artifacts. ConfigForge v0.2.0+ does **not** bundle the OSConfig CLI.
- If you add an external runtime dependency, justify it in the PR description and update `THIRDPARTYNOTICES.md`.
- **Prettier** is available (`npm run format`, `npm run format:check`) but **not** gated in CI. Adopt it on files you touch; mass-format runs are discouraged.

## Commit conventions

Short imperative subject lines, optional scope, body with rationale for non-trivial changes. Examples:

```
fix(deploy): preserve cancelRequested when audit completes
refactor(oss): C1 - HealthIndicator rewrite + binary.ts cleanup (Phase C of v0.2.0)
docs: bring-your-own-CLI install guide
```

When AI tooling assisted (Copilot, Claude, Cursor, etc.), include the trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Test-gate protocol

Adopted 2026-05-17 during the v0.2.0 cycle; extended in v0.2.1 with the page-split test pattern. Every meaningful code change must pass:

**Per-change loop**

1. Build the affected workspace (`npm run core:build` for core; `npm run build -w @configforge/desktop` for renderer/electron).
2. Run targeted vitest on the changed files: `npx vitest run <changed-file>`.
3. Run lint on the affected workspace.

**Per-phase gate** (before any commit that closes a logical unit)

1. Full vitest passes on the active branch.
2. Full lint clean (0 errors; `warn`-level `max-lines`/`complexity` is tracked-but-not-blocking).
3. Both core + desktop builds clean. **The renderer build catches Node-only import leaks that vitest alone misses** (e.g. `import { createHash } from 'crypto'` in a core file pulled into the renderer bundle).
4. Banned-strings sweep returns no product-code matches for: `Drop the oscfg binary`, `place the binary in resources/oscfg` (legacy v0.1.x phrasings).
5. CDP smoke test against the dev runtime where the change is user-visible — use an isolated Electron context, never the user's browser.

PRs that touch IPC contracts or `packages/core/handlers/` should add or extend the contract tests in `packages/core/src/handlers/<area>.test.ts`. PRs that touch a lighthouse page (`ManifestEditor`, `Manifests`, `ManifestNew`, `Library`, `Diff`) should extend the corresponding hook tests in `apps/desktop/src/pages/<Page>/state/use<X>.test.ts` — the **hook-first, tests-before-visual-extraction** convention is non-negotiable for the regression-prone areas (race-guards, timer cleanup, ghost-selection, format sync).

## Code style

- TypeScript strict mode is on; avoid `any` unless commented with a reason.
- `async/await` over raw promises.
- **Main-process logging:** use `scoped('module').info/warn/error/debug` from `apps/desktop/electron/log.ts` (introduced v0.2.1). Migrate any `console.*` you touch in the main process — the wrapper redacts common secret-key patterns (`CSC_KEY_PASSWORD`, `GH_TOKEN`, etc.) before they hit disk.
- **Renderer logging:** still `console.*` for now (no renderer-side wrapper yet).
- React components: functional + hooks. FluentUI v9 for primitives; tailwind utility classes for layout. Match the existing component patterns.
- HTML in API responses must be escaped. Renderer treats error envelopes as plain text.
- **Browser-safe primitives in `@configforge/core`:** the core package is pulled into the renderer Vite bundle, so Node-only imports (`crypto`, `fs`, `path`) will break the renderer build. Use the FNV-1a pattern in `circular-guard.ts` for hashes, or add an explicit Node-only entry point if you genuinely need a Node-only helper.

## Things to never do

- Reintroduce the bundled `oscfg` binary or any `Microsoft.OSConfig` PowerShell module dependency.
- Shell out to `oscfg` from anywhere except `packages/core/src/oscfg/`. The wrapper is the single choke point.
- Commit secrets, `~/.configforge/` state, `.probe/` evidence, or any binary not authored by this project.
- Treat "Unsupported resource type" or "CLI_REQUIRED" as a hard failure that blocks the rest of a manifest, they are soft warnings / typed gates.
- Modify the user's existing browser/Edge tabs during validation. Use only isolated Playwright/Electron contexts created by your work, and close only those contexts when done.

## Pull request flow

1. Open a feature branch from `main` (Win/Linux full build) or `mac-author-build` (macOS author flavor). For cross-flavor changes, push to `main` first and cherry-pick to `mac-author-build` (the two are kept in lock-step but never auto-merged).
2. Run the test gates above.
3. Open a PR with a description that calls out:
   - What changed and why (link to issue if applicable)
   - Whether IPC contracts or registered resource types changed
   - Test coverage added or updated
   - Any user-visible UX impact
4. CI runs the same gates. **For `mac-author-build` PRs, CI is `workflow_dispatch` only** — trigger manually with `gh workflow run "PR check" --ref mac-author-build`. The PR is mergeable when CI is green and a maintainer has approved.

## Filing OSConfig CLI bugs

Bugs in the underlying `oscfg` CLI are not bugs in ConfigForge. File them upstream in the Microsoft ADO `OS` project (area path `OS\Core\ENS\Edge Security\ESCC\OSConfig`). The public mirror at https://github.com/microsoft/osconfig has issues disabled.

## Getting help

- GitHub Discussions (when enabled), design questions, "should I" questions, architecture chat.
- GitHub Issues, bugs and feature requests.
- For security vulnerabilities, see [SECURITY.md](./SECURITY.md), not Issues.
