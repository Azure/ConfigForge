# Installing ConfigForge and the OSConfig CLI

Start by installing the desktop app. **Stop after the first-baseline
walkthrough if you only want to author or review baselines.** The CLI and
Machine Configuration packaging tools are optional, separate workflows.

> ConfigForge is experimental, community-maintained, and not an officially
> supported Microsoft product. It is not intended for production use.

ConfigForge has two editions:

- **Full edition** — Windows + Linux from the `main` branch. Authoring works without the CLI; Deploy, Audit, and Revert require `oscfg`.
- **Author edition** — macOS from the `mac-author-build` branch. Authoring,
  validation, Microsoft Baselines, Diff, Benchmark Mapping, history, rationale,
  and Audit Pack export are available. Device Deploy, Audit, and Revert are
  intentionally omitted.

The current Windows/Linux Full-edition release is `v0.3.103`. The current
macOS Author release is `mac-v0.3.101-author.1`. Both are published as
prereleases. The Full-edition package version on `main` is `0.3.103`; the
macOS Author package version is `0.3.101-author.1`.

ConfigForge does **not** bundle the OSConfig CLI. To use the Full edition's Deploy, Audit, or Revert features against a real Windows or Linux machine, install `oscfg` separately from its upstream source.

The editor, Microsoft Baselines, Diff, import/export, and Audit Pack features
work without `oscfg`. This is Editor mode, and it is the default on first
launch. In the Full edition, the Welcome dialog and footer health pill surface
CLI state so you can switch to device operations after installing the CLI.

## Install the desktop app

1. Open the [ConfigForge releases](https://github.com/Azure/ConfigForge/releases)
   page. Choose **Full v0.3.103** for Windows/Linux x64 or
   **Author mac-v0.3.101-author.1** for Apple Silicon macOS. Expand **Assets**
   and download the appropriate installer/archive and published checksum
   manifest. Source-code archives are for contributors, not app installers.
2. Compare the download's SHA-256 with its entry in the release checksum
   manifest. For example, in PowerShell, replace the filename below with your
   downloaded asset:

   ```powershell
   Get-FileHash -LiteralPath '.\downloaded-installer.exe' -Algorithm SHA256
   ```

   On Linux use `sha256sum <downloaded-asset>`; on macOS use
   `shasum -a 256 <downloaded-asset>`. Stop if the checksum differs.
3. Follow your organization's software policy before installing an unsigned
   app. Windows users can run the installer or extract the portable archive.
   Linux users should choose the package format for their distribution, or
   extract the portable archive. For macOS, see [Author edition](#macos-author-edition).
4. Open ConfigForge without elevation for authoring. If the Welcome dialog
   appears, choose **Author baselines anywhere**, then follow
   [Your first baseline](./docs/src/quick-start/first-manifest.md).

**Unsigned-download warning:** these artifacts have no code-signing identity;
macOS builds are also not notarized. A checksum confirms integrity relative to
the published file, not that the app is safe. Do not disable operating-system
security protections globally. If Windows SmartScreen blocks the installer,
review its source and checksum and obtain approval before using any per-file
override. On managed devices, ask your administrator rather than bypassing
policy. Building from reviewed source is an alternative, not a safety guarantee.

## Optional local device operations

The following CLI setup is only for the Full edition's **Deploy**, device
**Audit**, and **Revert**. Test on a disposable machine that matches the
baseline's target OS. Registration alone does not apply a baseline.

For **creating Azure Machine Configuration packages**, use the separate
[packaging guide](./docs/src/user-guide/machine-configuration.md): it requires
PowerShell 7, the GuestConfiguration toolkit, and the **Microsoft.OSConfig
PowerShell module 1.4.10 or later** on the packaging machine.
`Install-Module -Name Microsoft.OSConfig -MinimumVersion 1.4.10` installs that
module; `winget install Microsoft.OSConfig` below installs the **CLI**, not
the PowerShell packaging prerequisite.

---

## Upstream source

- **Repository**: https://github.com/microsoft/osconfig
- **CLI docs**: https://github.com/microsoft/osconfig/tree/main/docs/cli
- **Targeted version**: `oscfg 1.3.9-preview11`

Older or newer `oscfg` releases may work but are not tested. The health probe
in ConfigForge (footer pill + Settings) reports the resolved CLI version
once installed.

---

## Windows

OSConfig on Windows ships as an MSIX package via the Windows Package
Manager (winget). The recommended install path is:

```powershell
winget install Microsoft.OSConfig
```

This puts the CLI on the App Execution Alias list, so `oscfg` is
typically available from any new PowerShell session. **Restart any
already-running PowerShell sessions** so they pick up the alias.
ConfigForge also probes the following locations directly, so
the CLI is detected even when PATH has not been refreshed:

- `%LOCALAPPDATA%\Microsoft\WindowsApps\oscfg.exe` (App Execution Alias)
- `%LOCALAPPDATA%\Microsoft\WinGet\Links\oscfg.exe` (winget user-scope shim)
- `%LOCALAPPDATA%\Programs\OSConfig\oscfg.exe`
- `%ProgramFiles%\OSConfig\oscfg.exe`
- `%ProgramFiles%\Microsoft\OSConfig\oscfg.exe`
- `%ProgramFiles(x86)%\OSConfig\oscfg.exe`
- `%ProgramFiles(x86)%\Microsoft\OSConfig\oscfg.exe`
- Microsoft.OSConfig MSIX install location (resolved via Get-AppxPackage
  as a last-resort fallback)

If you prefer to install from a release archive instead:

1. Download the latest Windows x64 release from
   https://github.com/microsoft/osconfig/releases.
2. Extract `oscfg.exe` and `oscfg_event.dll` somewhere on disk.
   `C:\Program Files\OSConfig\` is a reasonable default and ConfigForge
      will find it without further PATH changes.
3. (Optional) Add that directory to your user or system `PATH` so other
   tools can also invoke `oscfg`.
4. **Run ConfigForge from an elevated PowerShell.** The preview CLI
   opens its log file in a protected directory on startup, even for
   read-only audits, so it currently requires Administrator privileges
   for every operation. Restart from an elevated shell if the in-app
   health pill says "admin required."

Verify the install:

```powershell
oscfg --version
```

In ConfigForge, click the amber "Editor mode, CLI not installed" pill
in the footer (or the Recheck button on Settings → System Health) to flip
the app into Deploy-capable mode without restarting.

---

## Linux (Ubuntu 22.04+, RHEL 9+)

1. Download the latest Linux x64 release from
   https://github.com/microsoft/osconfig/releases.
2. Extract and place the `oscfg` binary in any of these locations
   (ConfigForge probes them automatically):

   - `/usr/local/bin/oscfg` (recommended)
   - `/usr/bin/oscfg`
   - `/opt/osconfig/bin/oscfg`
   - `/opt/osconfig/oscfg`
   - `$HOME/.local/bin/oscfg` (user-scope)

   Example:

   ```bash
   sudo install -m 0755 oscfg /usr/local/bin/oscfg
   ```

3. Verify:

   ```bash
   oscfg --version
   ```

4. ConfigForge will auto-detect the binary on next launch (or
   click Recheck in the app).

Deploy/Revert require root or equivalent privileges. Audit permissions depend
on the resource being read; protected settings may also require elevation.
An unread setting is not evidence of compliance. This is separate from
Machine Configuration package testing, which requires a privileged session.

---

## macOS Author edition

The macOS Author edition is available only for Apple Silicon Macs (M1 or
later). The release contains an ARM64-only binary. It is not an x64 or
universal build and does not support Intel Macs. Rosetta does not provide
ARM64-on-Intel compatibility.

The current macOS Author release is `mac-v0.3.101-author.1`, published as a
prerelease after its five assets pass validation. Users can download the
release or build the tagged source by following the instructions in the
[Azure/ConfigForge repository](https://github.com/Azure/ConfigForge).

The app is unsigned and not notarized. Verify its release checksum before
opening the DMG and copying **ConfigForge Author.app** to `/Applications`.
Gatekeeper may block it. Prefer your organization's approved per-app process
(for example, **System Settings → Privacy & Security → Open Anyway**, when
available and permitted).

Only if you have verified the download, accept the unsigned-app risk, and
your policy permits it, remove the quarantine attribute from this app alone:

```bash
xattr -rd com.apple.quarantine "/Applications/ConfigForge Author.app"
```

This removes a Gatekeeper quarantine check; it does not sign or notarize the
app. Do not clear all attributes, disable Gatekeeper globally, or escalate a
permission failure just to bypass policy. Ask your administrator if blocked.

The Author edition supports baseline authoring, validation, import, Diff,
Benchmark Mapping, history, rationale, and Audit Pack PDF/Markdown export. It
does not expose device Deploy, Audit, Enforce, Revert, elevation, device
health, or OSConfig CLI features. Use the Full edition on Windows or Linux for
device operations.

Repository documentation is maintained under
[`docs/src`](https://github.com/Azure/ConfigForge/tree/main/docs/src) and built
into an mdBook site by `.github/workflows/docs.yml`, which deploys it to the
`gh-pages` branch at <https://azure.github.io/ConfigForge/>.

---

## Custom locations (advanced)

If you don't want to add `oscfg` to `PATH`, set the `OSCFG_BIN` environment
variable before launching ConfigForge to point at the binary directly:

```bash
# Linux
export OSCFG_BIN=/opt/osconfig/oscfg

# Windows PowerShell
$env:OSCFG_BIN = "C:\Tools\osconfig\oscfg.exe"
```

The macOS Author edition does not load `oscfg`, so `OSCFG_BIN` has no effect
there.

The resolver order is:

1. `OSCFG_BIN` environment variable (explicit override)
2. `resources/oscfg/<platform>-x64/oscfg[.exe]` inside the app (dev-only
   convenience drop for contributors; never shipped to users)
3. Well-known install locations (see Windows / Linux sections above)
4. `oscfg` on `PATH` (via `where` on Windows, `which` on Linux)
5. (Windows only) Microsoft.OSConfig MSIX install location, resolved via
   `Get-AppxPackage`. This is the final fallback and handles the case
   where `winget install Microsoft.OSConfig` succeeded but the App
   Execution Alias is disabled or PATH was not refreshed yet.

---

## Verifying the integration

After install, open ConfigForge:

1. Footer pill should flip from 🟠 **Editor mode, CLI not installed** to
   🟢 **OSConfig CLI v…** within a minute, or immediately after clicking
   Recheck.
2. Settings → System Health → OSConfig Module should read
   "Installed (v1.3.9-preview11)" or similar.
3. Open a registered manifest and click **Deploy → Audit**, the install
   modal should NOT appear (it's only shown when the CLI is missing).

If the CLI doesn't show up after install:

- Confirm `which oscfg` (Linux) or `where oscfg` (Windows) returns a path.
- Set `OSCFG_BIN` explicitly as a fallback.
- Restart the app, the binary path is cached for 60 seconds per process.

---

## Uninstalling OSConfig

Uninstalling the CLI is supported, ConfigForge detects the loss on
its next 60-second poll and flips back to Editor mode automatically. You
won't lose any authored manifests, history, or rationale; that data lives
under `~/.configforge/` and is independent of the CLI install.
