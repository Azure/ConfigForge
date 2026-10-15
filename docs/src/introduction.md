# Introduction

## What is ConfigForge?

ConfigForge is a desktop app for creating, reviewing, and sharing OSConfig
security baselines. Start from a Microsoft template or your own settings,
compare changes, and export your work before deciding whether to test it on a
device.

> **Experimental and community-maintained.** ConfigForge is not an officially
> supported Microsoft product and is **not intended for production use**.
> It is provided as-is for learning and evaluation, at your own risk.

**Start here:** [Install the app](./quick-start/install-run.md) →
[Create your first baseline](./quick-start/first-manifest.md).
You do not need a CLI, administrator access, or an Azure subscription to
complete this authoring walkthrough.

On macOS, use the **Author edition**. It includes authoring and review
workflows, not device operations; evaluate devices later using the Full
edition on Windows/Linux or a separate Machine Configuration environment.

## What problem does it solve?

Keep desired settings in one editable baseline rather than reconciling
separate spreadsheets and handwritten change notes. ConfigForge helps you
compare drafts, record why values changed, and share a review report.
It does not certify a baseline or prove that a device is compliant.

### Three terms to know

- **Baseline:** your set of desired security settings.
- **Manifest:** the YAML or JSON document describing a baseline.
- **Register:** save a baseline in My Baselines. Registration does not deploy
  settings or create an Azure resource.

See the [glossary](./reference/glossary.md) when you need more terminology.

## What does ConfigForge do?

Choose the next task you need; the advanced sections are optional.

| Task | Start here | What to expect |
| --- | --- | --- |
| Create or edit a baseline | [Baseline editor](./user-guide/manifest-editor.md) | Code/Visual editing, validation, and YAML/JSON/MOF/CSV export |
| Compare drafts | [Diff](./user-guide/matrix-diff.md) | Pairwise comparison or a matrix of up to ten baselines |
| Review benchmark coverage | [Benchmark Mapping](./user-guide/cis-compliance.md) | Matches against your own licensed data; no CIS data is bundled |
| Explain changes | [Rationale](./user-guide/rationale.md) and [history](./user-guide/history-snapshots.md) | Saved change reasons and snapshots |
| Share review material | [Audit Pack](./user-guide/audit-pack.md) | PDF or Markdown from available saved data; not a new device audit |
| Check a local lab device | [Authoring vs deploying](./quick-start/authoring-vs-deploying.md) | Optional CLI-based Audit, Deploy, and Revert in the Full edition |
| Evaluate through Azure Policy | [Machine Configuration](./user-guide/machine-configuration.md) | Separate packaging, testing, hosting, and policy-assignment workflow |

The sidebar uses **Dashboard**, **My Baselines**, **Microsoft Baselines**,
**Export Readiness**, **Diff**, **Benchmark Mapping**, and **Settings**.
Export Readiness concerns baseline validation; it is not a device-compliance
result.

**Keep the results distinct:** benchmark coverage identifies matching rules,
not necessarily matching values. Device Audit checks a machine. Audit Pack
exports a report and only includes device results when saved results exist.
Review their timestamps, scope, and any unread or unavailable settings.

## Supported platforms

| Your computer | Edition | Start with |
| --- | --- | --- |
| Windows (x64) | **Full** | Authoring without extra tools; local device operations need `oscfg` and elevation |
| Linux (x64) | **Full** | Authoring; live device operations additionally need a compatible CLI/host and permissions |
| macOS on Apple Silicon (M1 or later) | **Author** | Authoring, Diff, Benchmark Mapping, history, rationale, and Audit Pack export; no device operations |

The current Windows/Linux release is
[v0.3.103](https://github.com/Azure/ConfigForge/releases/tag/v0.3.103).
The current macOS Author release is
[mac-v0.3.101-author.1](https://github.com/Azure/ConfigForge/releases/tag/mac-v0.3.101-author.1).
Both are prereleases and unsigned; macOS is not notarized. Intel Macs and
universal binaries are not supported. Read the
[download and installation guidance](./quick-start/install-run.md) first.

## Who is this for?

- **Baseline authors:** begin with [Your first baseline](./quick-start/first-manifest.md).
- **Reviewers:** compare drafts and inspect an [Audit Pack](./user-guide/audit-pack.md),
  keeping benchmark coverage separate from device evidence.
- **Lab operators:** read [Authoring vs deploying](./quick-start/authoring-vs-deploying.md)
  before using device operations.
- **Contributors:** the [system overview](./architecture/system-overview.md),
  [module map](./architecture/module-map.md), and [contribution guide](./contributing/agents-md.md)
  cover implementation details.

## How it fits in the OSConfig ecosystem

The app authors baselines. For optional local operations, the Full edition
calls the native `oscfg` CLI, which is installed separately. The targeted CLI
is `oscfg 1.3.9-preview11`; CLI compatibility is separate from package tooling.

For Azure Machine Configuration, export a MOF and move to a packaging machine
with **PowerShell 7**, **GuestConfiguration**, and the **Microsoft.OSConfig
PowerShell module 1.4.10 or later**. Version **1.4.10** refers to the module,
not the PowerShell runtime. Follow the
[packaging prerequisites](./user-guide/machine-configuration.md#prerequisites);
these tools are not required to author in ConfigForge.

## Repository

Source and documentation live at
[Azure/ConfigForge](https://github.com/Azure/ConfigForge). The active branches
are `main` for Windows/Linux Full and `mac-author-build` for macOS Author.
The documentation site's edit link opens the corresponding Markdown source.

## Maintainer

Community-maintained by [@ABMFST](https://github.com/ABMFST). Use
[GitHub Issues](https://github.com/Azure/ConfigForge/issues) for reproducible
bugs and feature discussions. Read the
[support boundaries](https://github.com/Azure/ConfigForge/blob/main/SUPPORT.md)
and report vulnerabilities privately through
[SECURITY.md](https://github.com/Azure/ConfigForge/blob/main/SECURITY.md).
