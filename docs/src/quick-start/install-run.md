# Install & run

ConfigForge is an Electron 42 + React 18 + FluentUI v9 + Vite desktop app. The
**Full** edition runs on Windows and Linux and includes authoring plus
CLI-gated device deploy/audit/revert. The **Author** edition is an ARM64-only
Apple Silicon macOS build. It includes authoring, Microsoft Baselines, Diff,
Benchmark Mapping, history, rationale, and Audit Pack export while omitting
device operations. The native `oscfg` CLI is **not bundled** and is **not
required** for authoring in either edition.

The current Windows/Linux tagged source is `v0.3.96`, and its matching GitHub
release is a draft and unpublished. The current macOS Author tagged source is
`mac-v0.3.96-author.1`, and its matching GitHub release is also a draft and
unpublished. Public downloads remain unavailable until a maintainer publishes
the releases. The package versions are `0.3.96` for the Full edition and
`0.3.96-author.1` for the macOS Author edition.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| **Node.js 22 LTS** | The repo pins Node 22 via `.nvmrc`. Run `nvm use` (or upgrade your Node) so `node --version` reports `v22`. |
| **`oscfg` CLI binary** *(optional)* | Only needed for Deploy / Audit / Revert in the Full edition. Install separately from the [OSConfig CLI docs](https://github.com/microsoft/osconfig/tree/main/docs/cli). |
| **Admin / root** *(optional)* | Required on Windows for *every* CLI operation (preview-CLI bug - see [Operations → Filing upstream bugs](../operations/upstream-bugs.md)). On Linux, only `oscfg apply` needs `sudo`. |

## Get the code

```bash
git clone https://github.com/Azure/ConfigForge.git
cd ConfigForge
```

> **Note:** `main` is the active Windows/Linux Full-edition line. On an Apple
> Silicon Mac (M1 or later), users can build the
> `mac-v0.3.96-author.1` tagged source while the matching release remains
> unpublished. Intel Macs and universal binaries are not supported.
> macOS release builds are unsigned by design. Clear quarantine after
> copying the app into Applications:
>
> ```bash
> xattr -cr "/Applications/ConfigForge Author.app"
> ```

## Install dependencies

```bash
npm ci
```

Use `npm ci` (not `npm install`) for a clean, lockfile-faithful
install. The `postinstall` script runs `scripts/chmod-oscfg.js`,
which marks any developer-supplied `oscfg` binary under
`resources/oscfg/linux-x64/` executable (no-op on Windows and when
no binary is present - most users don't drop one in).

## Run

```bash
npm run desktop:dev
```

This runs Vite (renderer) + Electron in parallel with hot-reload and
opens the ConfigForge window. There is **no browser URL** -
the UI lives entirely in the Electron window. `npm run dev` is not a
script; the Next.js host was retired in Phase 10.

> **Warning:** On Windows, **launch from an elevated PowerShell** if
> you plan to exercise Deploy or Audit. The preview `oscfg` CLI opens
> its log file in a protected directory on every invocation,
> including read-only audits, so a non-admin run fails at the first
> CLI call. Editor-mode flows (author, diff, import/export,
> audit-pack PDF) work fine without elevation.

## Verify

In the running app:

1. Look at the footer health pill. It should read either
   🟢 **OSConfig CLI v…** (CLI installed) or
   🟠 **Editor mode, CLI not installed** (default first-run state).
   Both are valid; only the second blocks Deploy.
2. Open **Settings → System Health** for the resolved CLI path,
   source (`env` / `installed` / `path` / `msix` / `bundled`), and
   admin status. Click **Recheck** if you just installed the CLI.
3. Open **My Baselines → Register New** and paste the
   [first-manifest example](./first-manifest.md). It should register
   with zero errors.

If the System Health panel says `binary not found`, install the CLI from
the [OSConfig CLI docs](https://github.com/microsoft/osconfig/tree/main/docs/cli),
or set `$env:OSCFG_BIN` / `$OSCFG_BIN` to point at a local copy and
click **Recheck**.

## Build a desktop installer

```bash
npm run desktop:build         # core + renderer + electron main
npm run desktop:dist          # full installer (Win or Linux per host)
```

See [`apps/desktop/PACKAGING.md`](../../../apps/desktop/PACKAGING.md)
for the cross-platform build matrix and unsigned-build trust guidance.

## Updating

The repo is plain `git pull`-able:

```bash
git pull
npm ci
npm run desktop:dev
```

No database, no migration step. Runtime state lives in
`~/.configforge/` (manifests, history, rationale, audit-results); it
is backwards-compatible across releases. Core authoring and analysis work
offline. Supported update checks and user-requested public URL imports use the
network as described in [`PRIVACY.md`](../../../PRIVACY.md).
