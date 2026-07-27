# `AGENTS.md` (canonical guide)

> **Note:** This page is a *summary* of the guide for human readers.
> The authoritative file is
> [`AGENTS.md`](https://github.com/Azure/ConfigForge/blob/main/AGENTS.md)
> at the repo root. AI agents (Copilot, Claude, Cursor, etc.) load
> that file directly - keep it primary; this page can drift slightly
> behind.

`AGENTS.md` is **the** rules-of-engagement for the repository. If
you're a human contributor reading this, you've already chosen the
slow path; you should still skim `AGENTS.md` once.

## Why we have it

The same conventions apply to humans and AI agents. `AGENTS.md` is
the comprehensive canonical guide that agents load before work. This
page is only a human-readable summary and should not be treated as
complete.

## What it covers

- The project in one paragraph, including the **Full** edition on
  `main` (Windows/Linux) and the **Author** edition on
  `mac-author-build` (macOS).
- Branch + remote setup, the parallel-worktree pattern, and the
  cherry-pick-only rule between flavor branches.
- How to run anything (`npm ci`, `npm run desktop:dev`, etc.) plus
  the npm bug [#4828](https://github.com/npm/cli/issues/4828)
  lockfile caveat on Windows.
- The directory map - what to touch, what not to touch, and which
  surfaces are retired (the Next.js `src/app/api/` and
  `src/lib/oscfg/` trees were deleted in Phase 10).
- The page-split convention (`pages/<Page>/index.tsx` +
  `state/use<X>.ts` + `components/`) used by the lighthouse pages.
- The bring-your-own-CLI (BYO-CLI) contract: `useCliPresence()`,
  `<CliRequiredModal />`, and the `CLI_REQUIRED` IPC envelope.
- The `oscfg` CLI contract that `runOscfg` guarantees.
- Registration semantics (schema-only validation; deploy/audit are
  the platform gates).
- Manifest schema for the current upstream CLI version (`oscfg
  1.3.9-preview11`).
- CIS data integration, CIS Diff behavior, renderer-safe matrix diff
  helpers, Linux fuzzy matching (v0.3.50+), and the v0.3.51 CIS Diff
  two-code-path fallback.
- Spreadsheet visual editing, including lossless typed values and Test
  wrapper / Group source-path handling.
- Unsigned release builds — no code signing in CI (artifacts are unsigned by design).
- Security-audit closure: CF-SEC-001 through CF-SEC-015 are all
  closed; don't regress any of them.
- The typed main-process logger
  (`apps/desktop/electron/log.ts` - use `scoped('module').info(...)`
  instead of `console.*`).
- Flavor-conditional capability helpers - `safeCfs(key)` and
  `hasCfsNamespace(key)` from `apps/desktop/src/lib/cfs.ts`
  (CF-SEC-015) for namespaces the macOS author flavor omits
  (`health`, `deploy`, `deployRecovery`, `revert`, `auditResults`,
  `system`). Elevation methods live under `system`; there is no
  `elevation` namespace.
- Filing upstream bugs (the *real* tracker in the Microsoft ADO
  `OS` project, not the public GitHub mirror with issues disabled).
- Testing + validation expectations and the CI minute budget
  guidance.
- Coding conventions.
- Things to never do.

## Things that bear repeating

The "things to never do" list deserves a second look:

- Do **not** reintroduce the `Microsoft.OSConfig` PowerShell module.
- Do **not** re-bundle the `oscfg` binary into installers (removed
  in v0.2.0 Phase A; users install it separately per `INSTALL.md`).
- Do **not** invoke `oscfg` directly from a handler - go through
  `packages/core/src/oscfg/`.
- Do **not** re-add `/api/drift` or make `/api/scenarios`
  functional.
- Do **not** commit `oscfg` binaries, manifest snapshots, or
  anything from `~/.configforge/` or `.probe/`.
- Do **not** treat "Unsupported resource type" as a hard failure -
  it's a warning; the rest of the manifest should still apply.
- Do **not** treat a `CLI_REQUIRED` envelope as a generic error -
  it should route through `<CliRequiredModal />`.
- Do **not** regenerate `package-lock.json` on Windows without
  `--include=optional` - npm bug #4828 will silently drop the
  Linux rollup binary and break CI on `ubuntu-latest`.
- Do **not** bypass `safeCfs()` for flavor-conditional namespaces
  (`health`, `deploy`, `deployRecovery`, `revert`, `auditResults`,
  `system`) - direct calls crash when the namespace is absent.
- Do **not** import Node-only modules (`crypto`, `fs`, `path`) into
  `packages/core/src/` files that aren't gated behind a Node-only
  entry point - they break the renderer Vite bundle.

## Where AI agents fit

When working as an AI agent, include this trailer on every commit:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## See also

- [Coding conventions](./conventions.md)
- [Testing expectations](./testing.md)
- [Adding a new oscfg type](./adding-oscfg-types.md)
