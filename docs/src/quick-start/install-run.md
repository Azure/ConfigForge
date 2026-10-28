# Install & run

Download the desktop app to start authoring. **You do not need Node.js, the
OSConfig CLI, PowerShell modules, administrator access, or an Azure subscription
to author baselines.** Installing software may still require approval on a
managed computer.

> ConfigForge is experimental, community-maintained, provided as-is, and not
> intended for production use. It is not an officially supported Microsoft
> product.

## Prerequisites

| Your computer | Edition and download | Capabilities |
| --- | --- | --- |
| Windows/Linux x64 | [Full v0.3.104](https://github.com/Azure/ConfigForge/releases/tag/v0.3.104) | Authoring and review; optional CLI-based local device operations |
| macOS, Apple Silicon (M1 or later) | [Author mac-v0.3.104-author.1](https://github.com/Azure/ConfigForge/releases/tag/mac-v0.3.104-author.1) | Authoring and review, including Audit Pack export; no device operations |

Both are prereleases. macOS is ARM64-only: Intel Macs and universal binaries
are not supported.

## Download and install

1. Open the release for your edition and expand **Assets**.
2. Download the installer or portable archive for your OS and the release's
   checksum manifest. Do not choose the source-code archive unless you plan
   to build the app.
3. Verify the asset's SHA-256 against the published checksum and follow the
   platform-specific [installation instructions](https://github.com/Azure/ConfigForge/blob/main/INSTALL.md#install-the-desktop-app).
4. Open ConfigForge normally. Authoring does not require elevation.

**Downloads are unsigned; macOS builds are not notarized.** Checksum matching
does not establish publisher identity or safety. Review warnings, use only
approved per-file exceptions, and do not disable SmartScreen or Gatekeeper
globally. On managed computers, ask your administrator if blocked.
The [installation guide](https://github.com/Azure/ConfigForge/blob/main/INSTALL.md)
explains the risks and platform-specific options.

## Verify

1. If the Welcome dialog appears, choose **Author baselines anywhere**.
2. Open **Microsoft Baselines** and confirm the catalog appears.
3. Follow [Your first baseline](./first-manifest.md) to register and export
   a copy.

In the Full edition, **Editor mode, CLI not installed** is a valid state—not
an installation failure. You can ignore it while authoring. macOS Author
intentionally omits CLI-health and device-operation controls.

## Optional tools

- **Local device Audit/Deploy/Revert:** Full edition, a matching Windows/Linux
  host, and the separately installed `oscfg` CLI. Windows CLI operations
  require elevation. See [Authoring vs deploying](./authoring-vs-deploying.md).
- **Azure Machine Configuration packaging:** PowerShell 7, GuestConfiguration,
  and the **Microsoft.OSConfig PowerShell module 1.4.10 or later** on the
  packaging machine. Version 1.4.10 is **not** the PowerShell runtime version.
  See the [complete packaging guide](../user-guide/machine-configuration.md).
- **Benchmark Mapping:** your own legally licensed benchmark data.
  See [data setup](../user-guide/cis-compliance.md).

## Updating

Read the [release notes](../changelog.md), back up your workspace at
`~/.configforge/`, and install the new release for the **same edition**.
Recheck the release checksum and unsigned-download guidance.
The workspace holds baselines, history, rationale, and available audit results.
See [privacy and local storage](https://github.com/Azure/ConfigForge/blob/main/PRIVACY.md).

## Build from source (optional)

For contributors or readers choosing to build reviewed source. These commands
are **not** needed for the downloaded app.

### Get the code

Use Node **22.12+ LTS** or **24 LTS** and Git. `.nvmrc` and `.node-version`
select the default Node 22 toolchain.

```powershell
git clone https://github.com/Azure/ConfigForge.git
cd ConfigForge
```

### Install dependencies

Choose the correct branch **before** restoring dependencies:

```powershell
# Windows or Linux Full edition
git checkout main
node --version
npm ci
```

For Apple Silicon macOS:

```bash
git checkout mac-author-build
node --version
npm ci
```

The version check must report Node 22.12+ or 24.x. Use `npm ci` for a
lockfile-faithful install. If dependencies were installed under an unsupported
Node release, switch to the supported toolchain, remove `node_modules`, and
run `npm ci` again.

### Run

Windows/Linux Full:

```powershell
npm run desktop:dev
```

Apple Silicon macOS Author:

```bash
npm run dev:author -w @configforge/desktop
```

These commands open Electron with hot reload; there is no browser URL.
Launch without elevation for authoring. For contributor setup and validation,
see [CONTRIBUTING.md](https://github.com/Azure/ConfigForge/blob/main/CONTRIBUTING.md).

## Build a desktop installer

See [desktop packaging](https://github.com/Azure/ConfigForge/blob/main/apps/desktop/PACKAGING.md)
for Windows/Linux and macOS Author commands, build-host requirements, and smoke
checks. A source build remains unsigned unless you arrange your own signing.
