# `oscfg` CLI contract

ConfigForge shells out to the upstream Microsoft OSConfig CLI for deploy and audit operations. The upstream CLI documentation lives at <https://github.com/microsoft/osconfig/tree/main/docs/cli>.

The current targeted upstream CLI version in code is `oscfg 1.3.9-preview11` (`packages/core/src/oscfg/registered-types.ts`).

## Bring-your-own CLI

ConfigForge installers do **not** bundle `oscfg`. Users install OSConfig separately. Editor, library, validation, diff, CIS mapping, and audit-pack generation can run without the CLI; deploy/audit/revert flows are CLI-gated.

When a CLI-gated handler can determine that the CLI is missing, it throws `cliRequiredError()` from `packages/core/src/handlers/errors.ts` with status `412` and code `CLI_REQUIRED`. The preload bridge preserves those fields on the thrown renderer `Error` so UI code can open `CliRequiredModal`.

## Discovery order

`packages/core/src/oscfg/binary.ts` resolves the binary in this order:

1. `OSCFG_BIN` environment override.
2. Active runtime path strategy resource directory, primarily for dev/test drops under `resources/oscfg/<platform>-x64/`. The installer does not ship this directory.
3. Legacy compiled-layout fallbacks under nearby `resources/oscfg/<platform>-x64/` paths.
4. Well-known installed locations:
   - Windows: WindowsApps alias, WinGet Links, per-user OSConfig install, Program Files OSConfig/Microsoft OSConfig locations, and x86 Program Files equivalents.
   - Linux: `/usr/local/bin/oscfg`, `/usr/bin/oscfg`, `/opt/osconfig/bin/oscfg`, `/opt/osconfig/oscfg`, and `$HOME/.local/bin/oscfg`.
5. `PATH` via `where` or `which`.
6. Windows MSIX fallback via `Get-AppxPackage Microsoft.OSConfig`.

`cfs.health.check()` reports the resolved binary path and source (`env`, `bundled`, `installed`, `path`, or `msix`). In current releases, `bundled` means a developer/test resource drop was found, not that the installer carried the CLI.

## Operational invariants

| Invariant | What it means |
| --- | --- |
| **Exit-code-driven** | `0` = success, non-zero = failure. We never parse free-form prose to decide if a CLI call worked. |
| **Verbatim capture** | `stdout` and `stderr` are returned uninterpreted to the caller. The wrapper neither colours, nor reformats, nor filters lines. |
| **Preamble scrubbing** | The preview CLI prints a multi-line telemetry banner before real payload. `runner.ts` strips it before returning, so downstream sees only the body. |
| **Single operational spawn path** | CLI verbs go through `runOscfg()` in `runner.ts`. Handlers and renderer code do not spawn `oscfg` directly. |
| **Bounded concurrency** | `MAX_CONCURRENT_SPAWNS = 4`. Beyond that, callers queue. Avoids the Windows Defender real-time scan + `oscfg_event.dll` load-contention cliff that produced 60s timeouts during bulk audits. |
| **Stdin closed** | Every spawn closes stdin immediately. Prevents the Windows-only "child waits for stdin EOF" hang we hit on the old spawn pipeline. |
| **Per-namespace mutex** | Two concurrent `apply` operations on the same namespace serialize, never interleave (`packages/core/src/oscfg/concurrency.ts`). |
| **CLI-missing preflight** | `runDeploy()` checks `resolveOscfgBinary()` before starting deploy/audit work. Revert translates CLI-missing results where detected. |

`binary.ts` uses `spawnSync` for discovery/version probes; `runner.ts` owns long-running operational verbs.

## Verbs wrapped by core

| Verb | Module | Notes |
| --- | --- | --- |
| `oscfg apply -f <file> -n <ns>` | `apply.ts` | File-based path; required for large manifests. |
| `oscfg apply --content "..." -n <ns>` | `apply.ts` | Inline path; falls back to a temp file when content > a tunable size. |
| `oscfg get namespace` | `get.ts` | Lists all CLI-known namespaces. |
| `oscfg get resource -n <ns>` | `get.ts` | Read-only audit. |
| `oscfg exec resource --mode <mode> ...` | `exec.ts` | Direct provider reads for audit fallback. |
| `oscfg delete ...` | `manage.ts` | Namespace/resource cleanup helpers. |

If you need a new verb, add it to `packages/core/src/oscfg/` as a
named export and re-use `runOscfg`. **Do not** shell out from a
handler, and **never** add a `child_process.spawn('oscfg', …)`
anywhere else in the tree.

## Unsupported-type handling

`oscfg` returns `Unsupported resource type` for types the installed
CLI doesn't know about. ConfigForge treats this as a **soft warning**
(the registration still succeeds and other resources still apply).
The set of types the targeted CLI version knows about lives in
[`packages/core/src/oscfg/registered-types.ts`](https://github.com/ABMFST/ConfigForge/blob/main/packages/core/src/oscfg/registered-types.ts)
keyed by version (`OSCFG_CLI_VERSION`). Types missing from that
whitelist trigger the soft-warning path at register time, only
when the manifest targets this host's platform, to avoid spamming
Windows-only-type false positives on a Linux machine.

When you bump the targeted CLI version, re-run
`scripts/probe-types.ps1` and update the whitelist (see
[Reference → Registered types](../reference/registered-types.md)).

> **Warning:** Treating "Unsupported resource type" as a hard
> failure is explicitly forbidden in
> [`AGENTS.md`](https://github.com/ABMFST/ConfigForge/blob/main/AGENTS.md).
> Don't regress this behaviour.

## Translated CLI errors

Some raw CLI errors are turned into actionable hints in
`runner.translateKnownErrors`:

| Raw CLI text | What we surface |
| --- | --- |
| `oscfg requires Administrator privileges` | "Run ConfigForge from an elevated PowerShell session." |
| `Policy CSP 0x82F00009` | "Policy not applicable on this SKU." |
| `LSA 0xD0000022` | "LSA security policy is locked; run from elevated PowerShell." |

The original CLI output is still preserved in the response so a
power user can see exactly what the binary said.

## Windows admin requirement

The preview CLI opens its log file in a protected directory on
**every** invocation, including `get resource` reads. So on Windows,
*every* Deploy / Audit operation requires elevation.
`getHealthStatus()` reports `adminBlocked: true` when the current
process can't reach the CLI log directory, and the in-app footer pill
and Settings panel surface this as "admin required." A future CLI
release is expected to make reads admin-free; until then, this page
applies.

## See also

- [Architecture → System overview](./system-overview.md)
- [Operations → Filing upstream bugs](../operations/upstream-bugs.md)
- [Reference → Registered types](../reference/registered-types.md)
