# Coding conventions

The repository uses TypeScript strict mode, ESLint, Prettier (added v0.2.1), and Vitest. The conventions are short.

## TypeScript

- Strict mode is on. Avoid new `any` usage unless the boundary is
  genuinely dynamic and the reason is clear. The desktop ESLint config
  does not block `any`, so reviewers enforce this convention.
- Discriminated unions over enums when the values carry meaning
  (e.g. `'windows' | 'linux' | 'cross-platform' | 'mixed'`).
- Prefer `async/await` for multi-step async logic. Short `.then(...)`
  chains still exist in hooks and one-shot dynamic imports; keep them
  localized and readable.
- Re-export through `packages/core/src/<module>/index.ts` - consumers
  import from the index, not from internal files. (Tests are an
  exception; they import the file under test directly.)

## File layout

- One concern per file. Big files get split before they cross
  ~600 lines (the desktop ESLint config flags anything over 600 with
  a `warn`-level `max-lines` rule).
- Filenames are kebab-case (`registry-types.ts`, `circular-guard.ts`).
- Tests sit next to the source: `foo.ts` ↔ `foo.test.ts`.
- Lighthouse renderer pages live in **directories** with `index.tsx` + `state/` + `components/` + optional `helpers.tsx` when the page is large enough to need the split. See the [module map](../architecture/module-map.md) for the convention.

## Naming

- Functions: `camelCase`, verb-first.
- Types: `PascalCase`.
- Constants: `UPPER_SNAKE` only for true constants.
- Test files: `<file>.test.ts` (vitest discovery).
- React hooks: `use<X>` in `state/use<X>.ts`.

## Logging

- **Main process:** use the typed logger at `apps/desktop/electron/log.ts`. `scoped('module').info/warn/error/debug` instead of `console.*`. The wrapper redacts common secret-key patterns (`CSC_KEY_PASSWORD`, `GH_TOKEN`, Azure credentials, bearer tokens, etc.) before they hit disk.
- **Renderer:** `console.*` for now - no renderer-side wrapper yet.
- **Core / shared:** prefer letting the caller log; if a core module must log, use `console.*` (the package is shared between main + renderer so the main-process `log.ts` isn't importable here).
- Prefer `warn` for soft failures, `error` for hard ones, `info` for one-shot bookkeeping (deploy start/end, etc.), `debug` for verbose tracing.

## IPC envelopes / handler errors

- HTML in IPC responses is escaped - the UI renders warnings and errors as plain text.
- `warnings[]` is the right vehicle for soft issues. `error` plus a status-style code on the envelope is for hard failures.
- Typed `HandlerError.code` carries machine-readable failure discriminators (e.g. `CLI_REQUIRED`). The renderer branches on `code` from a regular `try/catch`.

## Formatting (Prettier - v0.2.1+)

- `npm run format` - write changes
- `npm run format:check` - verify without writing
- **Not gated in CI** (no `format:check` step in `pr-check.yml` yet). Adopt incrementally on files you touch; mass-format runs are discouraged because they buy nothing and bury the review signal.

## Dependencies

- No new dependencies without a line in the PR description explaining the need.
- Pin version ranges:
  - **`electron`, `electron-builder`**: tilde (`~x.y.z`) - minor-version updates should be intentional (CF-SEC-014).
  - **Security tooling** (`@cyclonedx/cyclonedx-npm`, `prettier`, `eslint-config-prettier`): exact (`x.y.z` via `--save-exact`).
  - **Other runtime + dev deps**: caret (`^x.y.z`) is the default.
- Production deps must pass `npm audit --omit=dev --audit-level=high` (enforced as a release-pipeline gate).

## Renderer-safe primitives in `@configforge/core`

The core package is pulled into the renderer Vite bundle. Node-only imports (`crypto`, `fs`, `path`) will break `npm run build:renderer`. If you need a hash in core, use the FNV-1a pattern from `circular-guard.ts`. If you genuinely need a Node-only helper, expose it from an explicit Node-only entry point (e.g. `packages/core/src/node-only/index.ts`) and don't import it from the shared barrel.

## Commits

Short imperative subject lines. Examples from `git log`:

- `fix(import): emit valueName + valueType on Registry resources so editor validation passes`
- `chore(security): close CF-SEC-008/011/012/014 supply-chain residuals`
- `refactor(ManifestNew): extract useNewManifestForm hook (Phase E.2)`

Trailers (only when an AI agent is the author):

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Copy guidelines

- **No em dashes in user-facing copy.** Use a regular dash (-) or rewrite the sentence. Em dashes render inconsistently across terminals and narrow UI panels.

## Import style in main process

- **Use static imports in the main process.** Lazy `await import(...)` breaks in the esbuild bundle that electron-builder produces. If you need conditional loading, gate with a runtime check around a statically imported module, not a dynamic import.

## See also

- [`AGENTS.md` (canonical guide)](./agents-md.md)
- [Testing expectations](./testing.md)
- [Architecture → Module map](../architecture/module-map.md)
