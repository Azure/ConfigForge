# ConfigForge

**Create, compare, and share OSConfig security baselines—before changing a device.**
Start with a Microsoft baseline or your own settings, review them visually, and
export a baseline or review report. No CLI, administrator access, or Azure
subscription is needed for authoring.

> **Experimental, community-maintained, and provided as-is.** ConfigForge is
> not an officially supported Microsoft product and is **not intended for
> production use**. Use it for learning and evaluation at your own risk.
> [Support boundaries](./SUPPORT.md)

**[Download releases](https://github.com/Azure/ConfigForge/releases)** ·
**[Documentation](https://azure.github.io/ConfigForge/)** ·
**[First baseline walkthrough](./docs/src/quick-start/first-manifest.md)**

## Download the right edition

| Your computer | Download | What you can do |
| --- | --- | --- |
| Windows or Linux (x64) | **Full** — [v0.3.103](https://github.com/Azure/ConfigForge/releases/tag/v0.3.103) | Author, validate, compare, and export. Optional local Deploy, Audit, and Revert require the separately installed `oscfg` CLI. |
| macOS on Apple Silicon (M1 or later) | **Author** — [mac-v0.3.101-author.1](https://github.com/Azure/ConfigForge/releases/tag/mac-v0.3.101-author.1) | The same authoring and review workflows, including Audit Pack export; no device operations. ARM64 only—not Intel or universal. |

Both releases are **prereleases**. Full-edition package versions are `0.3.103`;
the macOS Author package version is `0.3.101-author.1`.

**Downloads are unsigned; macOS builds are also not notarized.** Download only
from this repository's release page, compare the asset's SHA-256 with the
published checksum, and follow your organization's software policy.
Checksums check file integrity, not publisher identity or safety. Do not
disable SmartScreen or Gatekeeper globally. See [installation and download
warnings](./INSTALL.md#install-the-desktop-app) before opening an installer.
Building from reviewed source is another option, not a safety guarantee.

## Create your first baseline

A **baseline** is a set of desired settings. A **manifest** is the YAML or JSON
document that describes those settings. **Register** means save a baseline to
your ConfigForge workspace—not apply it to a device.

1. Install and open the edition for your computer. If the Welcome dialog
   appears, choose **Author baselines anywhere**.
2. Open **Microsoft Baselines**, choose a baseline to explore, and select
   **Use as Template**.
3. Give your copy a unique name, review its settings in **Visual** or **Code**,
   and select **Register Baseline**.
4. Open it from **My Baselines** and choose **Export → YAML** to save a portable
   copy.

**Success:** your baseline appears in My Baselines and you have an exported
`.osc.yaml` file. You have not deployed or audited anything. A Full-edition
**Editor mode, CLI not installed** indicator is expected and does not block
this workflow.

For screenshots, alternative starting points, and a small YAML example, follow
[Your first baseline](./docs/src/quick-start/first-manifest.md).

![Microsoft Baselines: choose a template to create your own baseline](./docs/images/screenshots/library.png)

## Choose what to do next

| Your goal | Guide | Extra requirements |
| --- | --- | --- |
| Edit settings or import YAML, JSON, CSV, or XLSX | [Baseline editor](./docs/src/user-guide/manifest-editor.md) | None for authoring |
| Compare two baselines or a matrix of up to ten | [Diff](./docs/src/user-guide/matrix-diff.md) | None |
| Map settings to a benchmark | [Benchmark Mapping](./docs/src/user-guide/cis-compliance.md) | Your own legally licensed benchmark data; CIS data is not bundled |
| Record why settings changed | [Rationale](./docs/src/user-guide/rationale.md) and [history](./docs/src/user-guide/history-snapshots.md) | None |
| Export a PDF or Markdown review report | [Audit Pack](./docs/src/user-guide/audit-pack.md) | Uses available saved data; does not run a device Audit |
| Evaluate a local lab device | [Authoring vs deploying](./docs/src/quick-start/authoring-vs-deploying.md) | Full edition, matching Windows/Linux host, CLI, and appropriate privileges |
| Evaluate a baseline through Azure Policy | [Machine Configuration](./docs/src/user-guide/machine-configuration.md) | Separate packaging environment and Azure permissions |

**Benchmark coverage is not proof of device compliance.** A mapped setting
does not establish that its value is correct or that a device uses it. An
**Audit Pack** is an exported report; **Audit** checks a device through `oscfg`.
Missing or old device results must not be presented as a current audit.

## What it looks like

Screenshots illustrate the workflows; exact layout varies by release and
edition. Device controls shown in Full-edition screenshots are absent on macOS.

<details>
<summary>Explore the editor, comparison, and report screenshots</summary>

### Microsoft Baselines: start from a curated catalog

Browse Windows Server role baselines, Defender, LAPS, Secured Core, and the
Linux Security Baseline. **Use as Template** creates your own editable copy.

### Dashboard: system health + quick actions

Start a baseline, browse Microsoft Baselines, or compare existing work.
The Full edition also surfaces CLI and device health.

![Dashboard and quick actions](./docs/images/screenshots/home.png)

### My Baselines: localized catalog and persistent workspaces

Search and filter baselines, open persistent tabs, and compare selected items.
Unsaved-edit prompts help protect work when closing a tab or navigating away.

### Baseline editor: author and export an Audit Pack

Review Code or Visual views, edit settings, and export your work.

![Baseline editor in the Full edition](./docs/images/screenshots/manifest-detail.png)

### Visual spreadsheet: edit settings in place

Edit cells, add supported setting types, or remove selected rows. Nested
Test/Group structure, typed values, and exact QWord integers are preserved.

![Visual spreadsheet editing](./docs/images/screenshots/visual-builder.png)

### Audit pack: the auditor deliverable

Export PDF or Markdown from saved baseline, history, and available review data.
No device audit is performed when generating the report.

![Audit Pack download and preview](./docs/images/screenshots/audit-pack.png)

### Create a new baseline: choose from five starting points

Start a custom Windows/Linux baseline, choose a template, import a baseline
file, import a spreadsheet, or load a public URL.

![New baseline starting points](./docs/images/screenshots/new-manifest.png)

### Compare baselines: Pairwise, CIS, Matrix

Two selected baselines open Pairwise; three through ten open Matrix.
The CIS view requires user-supplied benchmark data.

![Pairwise comparison](./docs/images/screenshots/diff.png)

### Benchmark Mapping: bring-your-own benchmark data

Use the data folder shown in **Benchmark Mapping**, then re-check the catalog.
See the [data setup guide](./docs/src/user-guide/cis-compliance.md).

![Benchmark data detection](./docs/images/screenshots/cis-mapping.png)

### CIS Diff: bulk compliance scoring

The percentage measures unique benchmark rules covered by matching settings,
not device compliance or certification.

![CIS coverage table](./docs/images/screenshots/cis-diff.png)

</details>

## Optional: install the OSConfig CLI for Deploy / Audit

The native [`oscfg`](https://github.com/microsoft/osconfig/tree/main/docs/cli)
CLI is **not bundled**. It is separate from the PowerShell modules used for
Machine Configuration packaging. The targeted CLI is `oscfg 1.3.9-preview11`;
see [INSTALL.md](./INSTALL.md#optional-local-device-operations) for setup.

Start with Audit on a disposable, matching-platform device. Enforce changes
settings; Revert is not a substitute for a machine backup. On Windows, the
preview CLI requires elevation even for Audit. Authoring does not.

## Export to Azure Machine Configuration

This is an **advanced, optional workflow**, not a prerequisite for using the
app:

`ConfigForge baseline → MOF → resolved MOF → Machine Configuration ZIP → Azure Storage → generated policy JSON → policy definition → assignment`

On the **packaging machine**, `New-GuestConfigurationPackage` needs the
**Microsoft.OSConfig PowerShell module version 1.4.10 or later** to bundle the
OSConfig DSC resource. Install it with
`Install-Module -Name Microsoft.OSConfig -MinimumVersion 1.4.10`.
This is a **module version**, not a PowerShell runtime version. PowerShell 7
and the separate **GuestConfiguration** packaging toolkit are also required.

The [complete Machine Configuration guide](./docs/src/user-guide/machine-configuration.md)
checks for a qualifying installed module, binds the exported
`ModuleVersion = "0.0.0"` placeholder to that exact version, and creates an
Audit-first package. Keep each ZIP and its URI immutable after policy
generation: the policy contains the package hash. Test the baseline and
module combination; the minimum version is not a claim that every OSConfig
issue is resolved. [Module release](https://www.powershellgallery.com/packages/Microsoft.OSConfig/1.4.10)

## Quick start: run from source

Source builds are optional. Follow [Build from source](./docs/src/quick-start/install-run.md#build-from-source-optional)
for the separate Full and macOS Author commands and the supported Node
toolchain. You do not need Node.js to run a downloaded desktop build.

## Building installers

See [desktop packaging](./apps/desktop/PACKAGING.md) for platform-specific
commands, build-host requirements, and smoke checks. Full Linux installer
builds require Linux; macOS Author builds require Apple Silicon.

## Repo layout

The desktop app uses Electron, React, Fluent UI, and Vite. Its shared core
lives in `packages/core`; the documentation site lives in `docs`.
See the [system overview](./docs/src/architecture/system-overview.md) and
[module map](./docs/src/architecture/module-map.md) for developer details.

## Documentation

- [Documentation site](https://azure.github.io/ConfigForge/) and [source navigation](./docs/src/SUMMARY.md).
- [Troubleshooting](./docs/src/operations/troubleshooting.md), [support](./SUPPORT.md), and [privacy](./PRIVACY.md).
- Developer references: [design contract](./apps/desktop/DESIGN.md),
  [platform UX](./apps/desktop/src/design/PLATFORM.md), [packaging](./apps/desktop/PACKAGING.md),
  and [CI/release workflow](./apps/desktop/CI.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md)
for ownership, active-branch, review, release, and cherry-pick guidance.
Report reproducible bugs through [GitHub Issues](https://github.com/Azure/ConfigForge/issues);
include the edition, version, OS, and a minimal non-sensitive example.

## Release history (high-level)

See [CHANGELOG.md](./CHANGELOG.md) for detailed historical validation and
[the documentation changelog](./docs/src/changelog.md) for a shorter summary.
Past module-version validation records are not current packaging prerequisites.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Security

To report a security vulnerability, follow [SECURITY.md](./SECURITY.md).
**Do not** file security issues as public GitHub issues. ConfigForge does not
collect telemetry; see [PRIVACY.md](./PRIVACY.md).

## License

Licensed under the [MIT License](./LICENSE). Third-party components are described in [NOTICE](./NOTICE) and [THIRDPARTYNOTICES.md](./THIRDPARTYNOTICES.md).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
