# Testing expectations

Minimum bar before opening a PR:

1. `node scripts/verify-public-package-assets.mjs` and
   `node --test scripts/verify-public-package-assets.node-test.mjs` pass.
2. Run the smallest focused Vitest selection that covers the change.
3. `npm test` (= `vitest run`) passes clean. Test counts change as
   features land; use the command's current summary rather than
   copying an old count. Historical PRs may cite exact counts in their
   own validation notes, but this page should not copy those numbers.
4. `npm run lint` passes clean (0 errors; `warn`-level `max-lines` /
   `complexity` is tracked-but-not-blocking).
5. `npm run desktop:build` passes clean. **This step catches Node-only
   imports leaking into the renderer Vite bundle** - `vitest` alone
   misses them because Vitest runs in Node and accepts `crypto` / `fs`
   / `path` happily.
6. `npm audit --omit=dev --audit-level=high` returns 0 high or
   critical production vulnerabilities (CF-SEC-014).
7. If you changed anything under `packages/core/src/oscfg/` or the
   elevation / health code, exercise an actual `oscfg` operation in an
   elevated shell on Windows (smoke-testing notes below).
8. If you added a registered type, add it to
   `packages/core/src/oscfg/registered-types.ts` and make sure the
   type-allowlist tests still pass.

## What we test

- **Pure functions** - schema validators, matrix builders, compliance scorers, provenance helpers, the `inferRegistryValueType()` import helper, the FNV-1a hash in `circular-guard.ts`. Hermetic, fast, exhaustive.
- **CLI wrapper** - `runner.ts` is mocked via spawn injection; we assert the *contract* (preamble scrubbing, exit-code routing, stdin-EOF management, concurrency cap) rather than spawning a real binary.
- **Handler functions** (`packages/core/src/handlers/`) - happy path + every error branch. Each `<area>.test.ts` covers the IPC contract.
- **Lighthouse-page hooks** (`apps/desktop/src/pages/<Page>/state/use<X>.test.ts`) - every regression-prone hook from the Phase A→E refactor. Race-guards (`fetchToken`, `deployJobIdRef`, `listTokenRef`, `matrixLoadTokenRef`), timer cleanup (`docsCopiedTimerRef`, flash-message timer Set), selection invariants (`removeFromSelection` ghost-selection fix), and format-sync round-trips are all under test. **Adding a new hook in a `pages/<Page>/state/` directory? Add the corresponding `.test.ts` file in the same commit.**
- **History/snapshot store** - round-trip + dedupe + retention + per-namespace mutex.
- **Author resolution** (`history/author.ts`) - env → git → OS user → unknown, plus the never-throws contract.
- **Security-audit invariants** - `circular-guard.test.ts` covers CF-SEC-007 spoof-resistance (launder-attempt detection, NFC normalisation); `cfs.test.ts` covers CF-SEC-015 flavor capability checks (`safeCfs` returns undefined on missing namespaces); `log.test.ts` covers the secret-redaction patterns.

## CI gates

The `PR check` workflow runs automatically on pull requests and pushes
to both `main` and `mac-author-build`; `workflow_dispatch` remains
available for manual re-runs. It has three jobs:

| Job | What it runs |
| --- | --- |
| `Lint` | Public packaging guard, Node `--test` packaging guard, `npm run lint`. |
| `Vitest (core + desktop projects)` | `npm audit --omit=dev --audit-level=high`, `npm run core:build`, `npm test`, Linux `npm run desktop:build`, and desktop artifact smoke checks. |
| `Playwright Electron smoke` | Windows Electron smoke through `npx playwright test --config apps/desktop/playwright.config.ts`. |

## What we *don't* test (in CI)

- The actual `oscfg` binary. CI doesn't have it. End-to-end CLI tests run during local Windows smoke (see [Smoke testing](../operations/smoke-testing.md)).
- The Linux CLI side with a live `oscfg` install. CI verifies Linux builds, but not live deploy/audit operations.
- The AI analyzer's *content quality*. We test that `provenance` is populated and `citationCoverage` is honest; we don't grade the prose.
- Visual regression. Playwright traces are available but a pixel-diff workflow is out of scope.

## Vitest layout

Each test file sits next to the source it tests (`foo.ts` ↔ `foo.test.ts`). Vitest discovers them automatically.

Run a single file:

```bash
npx vitest run path/to/file.test.ts
```

Run all hook tests for a page:

```bash
npx vitest run apps/desktop/src/pages/Manifests/state/
```

Run a single test by name:

```bash
npx vitest run -t "listTokenRef" apps/desktop/src/pages/Manifests/
```

For tests that mock OS-level APIs (`child_process`, `fs`, `os.userInfo`), use `vi.mock` factories at the top of the file and reset them in `beforeEach`. The `history/author.test.ts` file is a good template. For tests that mock `node:fs/promises` and call into modules that use `rename`, ensure `rename` is in the mock factory - leaving it out produces a noisy stderr stream that's easy to ignore but indicates the mock is incomplete.

## Test data

- Manifest fixtures live next to the test that uses them as inline string literals when small, or under a `__fixtures__` folder when large.
- CIS data files are **not bundled** in the repo (license restrictions). The CIS test suites mock the data layer (`vi.mock`) with synthetic fixtures so they pass on a fresh clone without any CIS files on disk.
- **CIS fuzzy matching smoke** - `scripts/smoke-azure-policy-fuzzy.mjs` replays the Azure Policy exact-word matcher against synthetic rule titles. Run `npm run core:build` first because the script imports from `packages/core/dist`.

## Performance bounds

A handful of tests assert performance. Don't loosen these without justification:

| Test | Bound |
| --- | --- |
| Matrix diff: 5 baselines × 350 settings | < 300ms |
| Compliance report: 350-rule manifest | < 1s |
| Audit-pack PDF: 350-rule + 50 history | < 3s |
| `cfs-blob://` export fuzz spec | < 15s slow-probe threshold in CI (300s total timeout) - bumped in `aa7552f` to absorb Windows runner variance |

## Branch-parity note

When you add a test on `main`, the cherry-pick port to `mac-author-build` usually applies cleanly. Two gotchas:

- Tests that import from `apps/desktop/src/pages/Manifests/index.tsx` should use the hook directly (`apps/desktop/src/pages/Manifests/state/useManifestList.ts`) when possible - page-level tests that import the full page may pull in flavor-specific code paths that diverge between branches.
- Mocking `window.cfs` in a renderer test should set up a partial preload shape; on mac, expect `health`, `deploy`, `deployRecovery`, `revert`, `auditResults`, and `system` to be absent. See `apps/desktop/src/lib/cfs.test.ts` for the pattern.

## See also

- [Coding conventions](./conventions.md)
- [Smoke testing on Windows](../operations/smoke-testing.md)
- [Architecture → Module map](../architecture/module-map.md)
