# Reporting `oscfg` issues

`oscfg` is in active preview. ConfigForge currently targets
`oscfg 1.3.9-preview11` and can encounter CLI defects.

Report the problem through
[ConfigForge GitHub Issues](https://github.com/Azure/ConfigForge/issues).
Maintainers will determine whether the failure is in ConfigForge integration
or the upstream CLI and route it appropriately.

## Issue checklist

1. **Title** - short, imperative, mention the verb that failed.
   *"`oscfg get resource` opens log file in protected dir on every
   read"*.
2. **Repro** - minimal manifest, exact CLI invocation, expected vs
   actual.
3. **Version** - the result of `oscfg --version`. ConfigForge
   currently targets `oscfg 1.3.9-preview11`; if you see something
   different, mention it.
4. **OS + admin status** - `Windows 11 Build 22631` (admin) /
   `Ubuntu 22.04` (root).
5. **Logs** - the protected log dir is the upstream bug; copy
   `%programdata%\OSConfig\logs\` (Windows) into the bug.
6. **ConfigForge wrapper output** - open Settings → System Health
   and copy the resolved binary path + source (`installed` / `path`
   / `env` / `msix`) and admin status so the bug filer knows exactly
   which install layout reproduced the issue.

## Translated errors we already handle

If the CLI returns one of the codes below, ConfigForge rewrites the
message to something user-actionable. Don't file it as a CLI bug
unless the *underlying* code is the issue:

| CLI error | Our hint |
| --- | --- |
| `Policy CSP 0x82F00009` | "Policy not applicable on this SKU." |
| `LSA 0xD0000022` | "LSA security policy is locked - run from elevated PowerShell." |
| `Unsupported resource type` | Soft warning at register time; rest of manifest still applies. |

## Linux side

The Linux side of the CLI is currently **unverified end-to-end** by
ConfigForge CI (no Linux runner with `oscfg` installed). If
you have a Linux environment, smoke-test the flow and capture
evidence under `.probe/` (gitignored). Include `Linux` in the GitHub issue
title or labels.

## See also

- [Architecture → `oscfg` CLI contract](../architecture/oscfg-cli.md)
- [Smoke testing on Windows](./smoke-testing.md)
