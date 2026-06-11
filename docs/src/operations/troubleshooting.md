# Troubleshooting

A grab-bag of error messages and fixes. Listed in roughly the
order new users encounter them.

## "`oscfg` binary not found"

Symptom: footer pill stays amber (🟠 **Editor mode, CLI not
installed**) even after install. Settings → System Health reports
`oscfg.path: null` and Deploy / Audit / Revert open the
`<CliRequiredModal />` install dialog.

Causes & fixes:

1. No `OSCFG_BIN`, no `oscfg` on `$PATH`, no install in a well-known
   location. Follow [INSTALL.md](../../../INSTALL.md) for the
   platform-specific install path (Windows: `winget install
   Microsoft.OSConfig`; Linux: the latest release tarball into
   `/usr/local/bin/`). Click **Recheck** in Settings → System Health
   after installing.
2. CLI installed but PATH is stale. Restart any open PowerShell
   sessions, or set `$env:OSCFG_BIN` to point at the binary
   directly. The Windows resolver also has a Get-AppxPackage
   fallback for `Microsoft.OSConfig` MSIX installs, so winget
   installs usually resolve even with a stale PATH.
3. (Contributors only) Dropped a dev binary into
   `resources/oscfg/linux-x64/oscfg` but it's not executable. Run
   `npm ci` to fire `scripts/chmod-oscfg.js`, or
   `chmod +x resources/oscfg/linux-x64/oscfg` manually. The
   `resources/oscfg/` drop is a dev-only convenience and is never
   shipped to users.

## "Manifest mixes Windows and Linux resource types"

Symptom: Deploy is rejected with `platform: 'mixed'`.

Cause: the manifest contains both `Microsoft.Windows/*` and
Linux-typed resources.

Fix: split the manifest. Author them separately, register
separately, and deploy on the appropriate hosts. The recursive
validator inspects `Microsoft.OSConfig/Group` and
`Microsoft.OSConfig/Test` wrappers, so a Windows resource hidden
inside a "neutral" Group still triggers the rule.

## "Unsupported resource type" warning

Symptom: Register succeeds, but the result has a `warnings[]` entry
mentioning `"Unsupported resource type: <type>"`.

Cause: the type appears in the manifest but isn't in the registered
whitelist for the targeted `oscfg` build. The whitelist lives at
[`packages/core/src/oscfg/registered-types.ts`](https://github.com/ABMFST/ConfigForge/blob/main/packages/core/src/oscfg/registered-types.ts)
keyed by `OSCFG_CLI_VERSION`.

Fix: this is intentional graceful degradation - the rest of the
manifest still applies. When upstream adds a new type, re-probe with
`scripts/probe-types.ps1` and add it to the whitelist + bump
`OSCFG_CLI_VERSION`. See
[Contributing → Adding a new oscfg type](../contributing/adding-oscfg-types.md).

## "Deploy fails - admin required"

Symptom: footer pill flips to 🔴, or the translated error reads
*"oscfg requires Administrator privileges on Windows (the CLI opens
a log file in a protected directory on startup). Restart ConfigForge
from an elevated PowerShell / command prompt and try again."*

Cause: not admin / root.

Fix: relaunch ConfigForge from an elevated PowerShell on
Windows; use `sudo` or equivalent on Linux. The translated message
comes from `packages/core/src/oscfg/runner.ts → translateKnownErrors`
which also recognizes the LSA `0xD0000022` access-denied code on
`Microsoft.Windows/UserRightsAssignment`.

## CSP error `0x82F00009`

Cause: the Policy CSP layer rejects the read on devices not managed
by an MDM authority for this setting, or the SKU does not support it.

Fix: `runner.translateKnownErrors` already rewrites this into a
user-actionable hint. For `UserRights` paths specifically, it
recommends `Microsoft.Windows/UserRightsAssignment` (which reads the
same data via LSA directly and works on standalone machines). For
other settings, try a dedicated provider (`Microsoft.Windows/Registry`,
`Microsoft.Windows/AccountPolicy`, `Microsoft.Windows/AuditPolicy`).

## "Manifest registers but fast list misses it"

Symptom: the Manifests list doesn't show the namespace immediately
after registration.

Cause: an in-flight list cache served stale data.

Fix: this should self-heal - the fast-path list enrichment in
`cfs:manifests:list` uses a generation token (`listTokenRef`) that
invalidates on register/delete and on rapid Refresh clicks. If you
see it persist, file a bug.

## "Deploy succeeded but the change doesn't show up"

Cause: Group Policy refresh hasn't happened yet (Windows GPO
settings can take up to 90 minutes by default).

Fix: `gpupdate /force` or wait. The audit (`mode=audit`) reads the
*registry* directly, so it will reflect the change immediately even
if the live policy hasn't refreshed.

## "Snapshot history is too long"

Cause: the default retention is 50 entries.

Fix: bump `CONFIGFORGE_HISTORY_MAX_COUNT` to a larger number, or
manually prune `~/.configforge/history/<ns>/`. Set it to `-1` or
`0` to disable pruning entirely.

## "Audit-pack PDF takes longer than 3s"

Cause: very large manifest (>500 rules) or very long history
(>200 entries).

Fix: trim the history (`CONFIGFORGE_HISTORY_MAX_COUNT`), or use the
Markdown export for a leaner output. The PDF builder is already
streaming; it doesn't buffer the whole document.

## "AI suggestion's Apply button is disabled"

Cause: `citationCoverage < 0.5` or `sources.length === 0`.

Fix: this is intentional. Ask the analyzer for grounding; if it
genuinely can't cite anything, treat the suggestion as advisory.

## "CIS drawer or CIS Diff shows no matches"

Symptom: the CIS cross-reference drawer or **Diff → CIS Diff** table shows no matched rules.

Cause: CIS data files are not detected, or the current manifest does not overlap the supplied benchmark. The app resolves the CIS data directory at runtime and scans for Azure Policy JSON and XCCDF files.

Fix: open the **CIS Mapping** page from the sidebar. It shows detected files and the resolved data directory path for the current install. Drop Azure Policy JSON or XCCDF files into that directory and click **Re-check**. Re-check clears the backend and renderer availability caches, so newly added data should appear without restarting.

## "Deploy was interrupted - recovery banner"

Symptom: the Dashboard shows a persistent banner saying a deploy of a namespace may have been interrupted.

Cause: the app writes a `<ns>.deploy-in-progress` sentinel before `applyManifest` in enforce mode. If the process was killed or crashed mid-deploy, the sentinel remains on disk and the recovery banner appears on the next app launch.

Fix: click **Audit** to verify the current device state, then **Revert** if needed to roll back to the pre-deploy snapshot. Click "I've handled it" to dismiss the banner and clear the sentinel.

## See also

- [Smoke testing on Windows](./smoke-testing.md)
- [Filing upstream bugs](./upstream-bugs.md)
