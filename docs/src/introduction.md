# Introduction

> ⚠️ **Microsoft community-maintained project.** ConfigForge is **not** an
> officially supported Microsoft product and is **not intended for production
> use**. Use it for experimentation, learning, and community contributions at
> your own risk.

## What is ConfigForge?

**ConfigForge is a security-baseline authoring tool for the OSConfig ecosystem.** It gives Windows and Linux security engineers a fast, visual way to write, validate, deploy, audit, version, and export the YAML manifests that the [`oscfg`](https://github.com/microsoft/osconfig/tree/main/docs/cli) command-line tool consumes - without hand-editing files in a text editor or memorizing the schema.

The app is an **Electron 42 + React 18 + FluentUI v9 + Vite desktop
application** with two editions:

- **Full edition** (`main` branch) - Windows + Linux with deploy, elevation, health probe, and audit-results storage.
- **Author edition** (`mac-author-build` branch) - ARM64 Apple Silicon macOS
  authoring with editor, Microsoft Baselines, Diff, validation, Benchmark
  Mapping, history, rationale, and Audit Pack export. Device-operation
  namespaces (`health`, `deploy`, `deployRecovery`, `revert`, `auditResults`,
  and elevation methods under `system`) are intentionally omitted. Authors
  deploy later from the Full edition on Windows or Linux.

The current Windows/Linux tagged source is `v0.3.97`, and its matching GitHub
release is a draft and unpublished. The current macOS Author tagged source is
`mac-v0.3.97-author.1`, and its matching GitHub release is also a draft and
unpublished. The package versions are `0.3.97` for the Full edition and
`0.3.97-author.1` for the macOS Author edition.

If you've ever maintained a security baseline by editing GPO templates, exporting Defender for Endpoint settings to a spreadsheet, or copy-pasting between half a dozen runbooks - this app is for you.

## What problem does it solve?

Authoring a security baseline today is **slow, brittle, and lonely**:

- The source of truth lives in PDFs, spreadsheets, GPO Templates, or
  internal wikis - not in a single artifact a tool can validate.
- Comparing two baselines (your draft vs. CIS, your draft vs. last
  quarter's, two regional variants of the same standard) means hours
  of manual diffing in Excel.
- When auditors ask "why did this value change?" the answer lives in
  someone's email or in a Slack thread that scrolled away.
- Exporting to the half-dozen formats different teams want (Intune,
  Azure Policy, Excel, Markdown) is a copy-paste exercise that
  drifts the moment any of them is edited.
- Every baseline author hits the same wall: the tooling assumes you
  already know the answer, instead of helping you find it.

## What does ConfigForge do?

The sidebar exposes **Dashboard**, **My Baselines**, **Microsoft Baselines**,
**Export Readiness**, **Diff**, **Benchmark Mapping**, and **Settings**.

The app is built around six core workflows, each of which closes one
of the gaps above.

### 1. Author and validate manifests in a structured editor

A Monaco-based YAML editor with live schema validation, type-aware
hints for every OSConfig resource type, and a side panel that surfaces
the currently-selected resource's CIS rule cross-reference (when CIS
data is available locally).

→ See [User Guide → Manifest editor](./user-guide/manifest-editor.md).

### 2. Compare baselines and explain the deltas

Pairwise diff for two manifests, plus an N-way **master-matrix** that
puts up to 10 baselines side-by-side as columns and shows which ones
agree and which ones differ on every setting. generated narrative
explanations describe *why* each delta matters in plain English. Excel
export with conditional formatting for the auditor's offline review.

→ See [User Guide → Matrix diff](./user-guide/matrix-diff.md).

### 3. Capture change rationale as you author

Every value change in the editor prompts a one-line "Why?" capture.
Author identity is resolved automatically (git config → OS user). Every
snapshot in the version history carries the author and the rationale,
so the audit trail is built as a side-effect of normal authoring - not
as a separate after-the-fact exercise.

→ See [User Guide → Rationale](./user-guide/rationale.md).

### 4. Generate the auditor's deliverable in one click

A PDF audit-pack assembles the manifest, the version history (with
authors and rationale), and the compliance scorecard against any
user-supplied CIS benchmark into a single document ready to attach to a
compliance review.

→ See [User Guide → Audit pack](./user-guide/audit-pack.md).

### 5. Benchmark Mapping and status tracking

The Benchmark Mapping page shows which benchmark data files are detected on
disk, with per-file status indicators. Users add Azure Policy JSON or
XCCDF/OVAL files to the resolved data directory; the page provides Re-check
and Open folder actions. Benchmark data powers the editor cross-reference and
the Diff page's CIS tab for full-baseline coverage scoring.

### 6. CIS Diff - bulk coverage analysis

The Diff page includes a CIS Diff tab that annotates the N-way matrix with CIS rule coverage. Each matrix row shows whether the setting maps to a CIS benchmark rule, its severity, and match status. Powered by a bulk-lookup IPC that avoids per-row round trips.

## Who is this for?

| Audience | Start here |
| --- | --- |
| **Microsoft Baseline Author / Consultant** writing or maintaining a custom security baseline | [Quick Start → Install & run](./quick-start/install-run.md) |
| **Security or compliance auditor** reviewing someone else's baseline | [User Guide → Benchmark Mapping](./user-guide/cis-compliance.md), [Diff](./user-guide/matrix-diff.md), and [Audit pack](./user-guide/audit-pack.md) |
| **Integrator / SI / VAR** deploying baselines to customer environments | [Quick Start → Authoring vs. deploying](./quick-start/authoring-vs-deploying.md) |
| **Engineer extending the codebase** | [Architecture → System overview](./architecture/system-overview.md) and [Contributing](./contributing/agents-md.md) |
| **AI agent (Copilot, Claude, Cursor)** | [`AGENTS.md`](https://github.com/Azure/ConfigForge/blob/main/AGENTS.md) at the repo root |

## How it fits in the OSConfig ecosystem

ConfigForge is a **front-end** for the upstream `oscfg` CLI. The
app does not replace the CLI, the OSConfig agent, or the schemas - it
shells out to `oscfg` for every actual deploy / audit / get operation.

```text
┌──────────────────────────────────────┐
│  ConfigForge UI (this app)     │  ← author, validate, diff, audit-pack
└──────────────────────────────────────┘
                  │
                  ▼  spawns
┌──────────────────────────────────────┐
│  oscfg CLI (Microsoft, preview)      │  ← apply, get, namespace operations
└──────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────┐
│  OSConfig agent + native OS APIs     │  ← actually applies the configuration
└──────────────────────────────────────┘
```

The current upstream CLI version targeted is **`oscfg 1.3.9-preview11`**.

## Supported platforms

| Platform | Edition | Status |
| --- | --- | --- |
| **Windows 11 / Windows Server 2016-2025** | Full | Author, validate, deploy, audit, diff, export. Deploy/audit require an elevated shell with `oscfg` installed. |
| **Linux (Ubuntu 22.04+)** | Full | Build is verified in CI; live deploy/audit requires a host with `oscfg` installed. |
| **macOS on Apple Silicon (M1 or later)** | Author | ARM64-only authoring, validation, Microsoft Baselines, Diff, Benchmark Mapping, history, rationale, and Audit Pack export. Device operations are intentionally absent. Intel Macs and universal binaries are not supported. |

> ConfigForge normalizes authoring differences across platforms;
> deploy and audit remain platform-gated by the local `oscfg` CLI.

## Repository

Source lives at
[github.com/Azure/ConfigForge](https://github.com/Azure/ConfigForge). Active
development happens on **`main`** (Windows/Linux full build) and
**`mac-author-build`** (macOS Author). Shared changes land on `main` first and
are ported through focused commits; the flavor branches are not cross-merged.

> **Tip:** This documentation is generated from the `docs/` folder of the repository at every push to `main`. To suggest an edit, click the pencil icon at the top of any page - it links straight to the source markdown on GitHub.

## Maintainer

Maintained by the community. Use
[GitHub Issues](https://github.com/Azure/ConfigForge/issues) for bug reports
and feature discussions.
