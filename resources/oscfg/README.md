# `oscfg` resource directory

ConfigForge **does not bundle** the OSConfig CLI. On Windows and Linux,
ConfigForge runs in two modes:

1. **Editor mode** — no CLI required. Author, diff, compare, and export
   baselines. Works on any OS.
2. **Editor + deploy mode** — Windows/Linux only, requires the user to
   install the [`oscfg`](https://github.com/microsoft/osconfig/tree/main/docs/cli)
   CLI separately. Once installed, deploy/audit/apply/revert actions become
   available.

See `INSTALL.md` at the repo root for CLI install steps.

## Why the directory still exists

`packages/core/src/oscfg/binary.ts` resolves the CLI in this order:

1. `process.env.OSCFG_BIN` — if set, use it verbatim (debug/override).
2. `oscfg` from `PATH` — primary lookup once installed.
3. `resources/oscfg/<platform>-x64/oscfg[.exe]` — **dev-only convenience drop**
   for contributors who want to bring their own binary while iterating
   without installing system-wide.

The directory is committed empty (`.gitkeep`) so the drop path keeps working
during local development. **Nothing in this directory is shipped to users**;
`electron-builder.yml` no longer copies its contents into the installer.
