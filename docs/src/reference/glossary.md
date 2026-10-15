# Glossary

A handful of terms that appear repeatedly. If a term is missing,
file a doc bug - adding it is a one-line PR.

## Aspirational type *(historical)*

Earlier docs used "aspirational" for resource types that appeared in
upstream baselines but weren't yet registered in the targeted
`oscfg` preview build (notably `Microsoft.Windows/AccountPolicy`,
`AuditPolicy`, `UserRightsAssignment` before preview11). Those types
landed in `oscfg 1.3.9-preview11` and are now fully supported. The
soft-warning path still exists for any *future* type that lands in
baselines before the CLI catches up - it just isn't called
"aspirational" anywhere in the code today.

## Audit-pack

A PDF or Markdown review report per baseline, built from available saved
metadata, comparison results, device results, history, and rationale.
Exporting it does **not** run a device Audit. Missing data is omitted; live
analysis provenance is not currently persisted, so its citations are absent
from normal UI-generated reports. See
[User Guide → Audit-pack](../user-guide/audit-pack.md).

## Audit

A local device check through the `oscfg` CLI in the Full edition. Distinct
from authoring validation, benchmark coverage, and Audit Pack export. Inspect
the result timestamp and unread/indeterminate settings before using it as
evidence.

## Baseline

A set of desired configuration settings. ConfigForge stores and edits it as
a [manifest](#manifest). A baseline is not a statement that a device currently
has those settings.

## BYO-CLI

"Bring-your-own-CLI." The v0.2.0 shift: the `oscfg` binary is **no
longer bundled** in ConfigForge installers. Users install
OSConfig separately (see
[`INSTALL.md`](https://github.com/Azure/ConfigForge/blob/main/INSTALL.md))
and the resolver in `packages/core/src/oscfg/binary.ts` finds it via
env override → dev drop → well-known install paths → `PATH` → MSIX.
Editor / library / diff / audit-pack-PDF features all work without
the CLI; **Deploy / Audit / Revert** are gated by the
[CLI_REQUIRED gate](#cli_required-gate). See the
[`oscfg` CLI contract](../architecture/oscfg-cli.md).

## CIS

Center for Internet Security - publishes the
[CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks).
ConfigForge **does not redistribute** CIS Benchmark content
(license restrictions). The cross-reference and compliance features
work when a user drops their own legally licensed catalog files into
the data directory shown on Benchmark Mapping. The app resolves that directory
for your installation. The UI hides the data-dependent CIS drawer and Diff
tab when those files are absent. The Benchmark
Mapping setup page remains visible. See
[User Guide → CIS compliance](../user-guide/cis-compliance.md).

## Benchmark Mapping

The sidebar page (route `/cis`) for benchmark-data ingestion and status. It shows which expected CIS data files are present on disk, the resolved data directory path, and provides Re-check / Open folder actions. It replaces the earlier "CIS Mapping" and "CIS Catalog" names. Users drop Azure Policy JSON or XCCDF files into the data directory shown on this page. See [User Guide - CIS compliance](../user-guide/cis-compliance.md).

## CIS Diff

A tab on the Diff page that compares one baseline with a supplied benchmark.
It shows covered/missing benchmark rules and matched settings; it is separate
from Matrix (N-way). Requires CIS data (see [Benchmark Mapping](#benchmark-mapping)).

## Azure Policy CIS JSON

A supported JSON settings catalog with a `settingsReference[]` array mapping
policy settings to benchmark rules. It is not an arbitrary Azure Policy
definition or assignment export. ConfigForge reads it alongside XCCDF data
from the Benchmark Mapping folder.

## Change summary

The short diff-derived label persisted with a history snapshot when a
manifest is registered from the editor save flow (v0.3.47). It is sent
as `RegisterManifestRequest.changeSummary` and shown in History instead
of the generic "Manifest registered" message.

## Citation coverage

A 0..1 number: the mean of per-source confidence for an analysis result
(a heuristic label, not a verified-evidence measure). Below 0.5 the analysis
result is labeled as low-confidence advisory content.

## Circular-guard

Labels generated output with an inline marker
(`<!-- ai-generated:rev=N -->`) plus a spoof-resistant per-process
content-hash registry (CF-SEC-007 - see
[FNV-1a hash registry](#fnv-1a-hash-registry-cf-sec-007) below) so
re-fed content is detectable. A detection helper
(`assertNotAiGenerated`) exists but is **not currently wired** into the
analyzer's ingestion path, so the marker is advisory (labeling, not
enforcement) today. Implemented in
[`packages/core/src/ai/circular-guard.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/ai/circular-guard.ts).

## CLI_REQUIRED gate

The typed v0.2.0 gate that fires when a Deploy / Audit / Revert
operation is requested but `oscfg` cannot be resolved on disk.
`runDeploy` / `revertManifest` throw `cliRequiredError()` from
`packages/core/src/handlers/errors.ts` - `HandlerError` with
`status: 412`, `code: 'CLI_REQUIRED'`. The IPC envelope forwards
both fields so the renderer can branch in a regular `try/catch` and
open `<CliRequiredModal />` instead of toasting a raw spawn error.

## Compliance score

For `cfs.compliance.report`, `round(matched / cisRules * 100)` with
strict name-match scoring against the selected local CIS baseline YAML.
`extras` (your-manifest-only rules) do **not** lower the score. The
Diff page's CIS Diff tab uses `cfs.cis.bulkLookup`, where compliance is
unique CIS benchmark rules covered / total benchmark rules, with XCCDF
and Azure Policy CIS matching.

These are baseline-comparison/coverage measures, not device audits or
certification. Matching a rule does not by itself prove its value agrees.

## Cross-platform manifest

A manifest with no platform-specific resource types - typically
just `Microsoft.OSConfig/*` types. Deployable on either Windows
or Linux. Distinct from `'mixed'` (which has both Windows-only
and Linux-only types and is **not** deployable).

## Dedupe

The history store collapses a snapshot to its prior identical
twin via `sha256(content)`. Two consecutive saves of the same
text produce one history entry, not two.

## Flavor

A build of ConfigForge with a different preload surface and
feature set, controlled by a git branch. Two flavors today:

- **`main`** - Windows + Linux full build. Includes
  Deploy / Audit / Revert / elevation / health / audit-results.
- **`mac-author-build`** - macOS author-only. The preload omits the
  `health`, `deploy`, `deployRecovery`, `revert`, `auditResults`, and
  `system` namespaces;
  any renderer code that may run on either flavor must use
  [`safeCfs` / `hasCfsNamespace`](#safecfs--hascfsnamespace) to
  read them. Elevation methods live under `system`; there is no
  `elevation` namespace. Diff and Audit Pack export remain available.

Cross-merge is forbidden - sync the two via `git cherry-pick`.

## FNV-1a hash registry (CF-SEC-007)

The spoof-resistance layer added to the generated-content
[circular-guard](#circular-guard). A per-process in-memory registry
of NFC-normalised 64-bit FNV-1a hashes of every chunk of content
ever tagged as generated. Pure JS hash - no Node `crypto`
import - so the module is safe to pull into the renderer Vite
bundle. FIFO eviction at 4,096 entries. Even if an attacker strips
the inline `<!-- ai-generated:rev=N -->` marker before re-feeding
content to the system, the hash check catches the spoof.

## Hard gate vs soft warning

A **hard gate** is a refused operation (status 400, 403, 412 - the
IPC envelope carries `ok: false`). A **soft warning** is a
successful operation (status 200) with a `warnings[]` field
populated - e.g. registering a Linux manifest on a Windows host
succeeds but the response includes a "Manifest targets linux, but
this host is windows" warning.

## Manifest

The YAML/JSON document describing a baseline's desired settings. Registering
the document saves it locally; it does not apply the settings. See
[Reference → Manifest schema](./manifest-schema.md).

## Master matrix

The N-way diff - pick 2-10 manifests, see a side-by-side table
where each row is a setting and each column is a baseline.
See [User Guide → Matrix diff](../user-guide/matrix-diff.md).

## Mixed-platform

A manifest that mixes Windows and Linux resource types in one
document. Always rejected at deploy. See
[Architecture → Mixed-platform classification](../architecture/mixed-platform.md).

## Namespace

The unique name a manifest registers under. Think `ws2025-baseline`
or `ssh-hardening`. The CLI calls this a "namespace"; ConfigForge
uses the same word.

## oscfg

The native upstream CLI used by the Full edition for local device operations.
Targeted version: `oscfg 1.3.9-preview11`. The binary is not bundled (see
[BYO-CLI](#byo-cli)). It is not the PowerShell resource module or the
GuestConfiguration packaging toolkit.

## Microsoft.OSConfig PowerShell module

Supplies the OSConfig DSC resource for Azure Machine Configuration packages.
**Version 1.4.10 or later is required on the packaging machine** when creating
a package from a ConfigForge-exported MOF. This is a module version, not a
PowerShell runtime version. The app itself does not need this module for
authoring or its CLI-based local operations.

## GuestConfiguration

The separate PowerShell toolkit providing `New-GuestConfigurationPackage`,
package testing, and policy generation. It runs in the required
**PowerShell 7** environment and bundles the exact Microsoft.OSConfig module
version referenced by the resolved MOF. See
[Machine Configuration packaging](../user-guide/machine-configuration.md).

## Phase A→E page split

The v0.2.1 refactor that split the five lighthouse renderer pages
(`ManifestEditor`, `Manifests`, `ManifestNew`, `Library`, `Diff`)
out of single oversized `*.tsx` files into directories with a
hooks-first, tests-before-visual-extraction shape:

```text
apps/desktop/src/pages/<Page>/
├─ index.tsx          # JSX composition + page-level state
├─ helpers.tsx        # pure render helpers (optional)
├─ state/             # custom hooks + their vitest tests
└─ components/        # React.memo'd visual sub-components
```

`ManifestEditor` went from 1,585 lines to 451 (−72%). Race-guards
(`fetchToken`, `deployJobIdRef`, `listTokenRef`, `matrixLoadTokenRef`)
and timer cleanup are locked in by hook-level regression tests.

## Preload bridge

The single file
([`apps/desktop/electron/preload.ts`](https://github.com/Azure/ConfigForge/blob/main/apps/desktop/electron/preload.ts))
that uses `contextBridge.exposeInMainWorld('cfs', { … })` to expose
the `window.cfs.*` API to the sandboxed renderer. **The only**
cross-layer surface - the renderer has no Node access, no direct
IPC, no `fetch` to main. The preload is also **flavor-specific** -
the macOS author preload omits the `health`, `deploy`,
`deployRecovery`, `revert`, `auditResults`, and `system` namespaces.
Elevation methods live under `cfs.system`; there is no `cfs.elevation`
namespace.

## Provenance

The bibliography attached to every analysis result - a list of sources
(`CIS`, `NIST`, `MSDocs`, `GPO`, `manifest`, `user-input`) with
confidence scores 0..1. See
[User Guide → Analysis provenance](../user-guide/analysis-provenance.md).

## Rationale

The free-text "why?" attached to a save. Recorded both on the
history snapshot's `.meta` sidecar and in the per-manifest
`~/.configforge/rationale/<ns>.jsonl` log.

## Registration

The act of writing a manifest's metadata + source YAML to
`~/.configforge/manifests/`. Distinct from **deployment**, which
calls `oscfg apply`. See
[Quick Start → Authoring vs deploying](../quick-start/authoring-vs-deploying.md).

## Resource

A single entry in the manifest's `resources:` array. Has a
`name`, a `type`, and a `properties` block.

## safeCfs / hasCfsNamespace

CF-SEC-015 helpers in
[`apps/desktop/src/lib/cfs.ts`](https://github.com/Azure/ConfigForge/blob/main/apps/desktop/src/lib/cfs.ts).
`hasCfsNamespace(key)` returns `true` when `window.cfs[key]` is
present on the current [flavor](#flavor); `safeCfs(key)` returns
either the namespace object or `undefined`. Required for any renderer code that touches `health`, `deploy`,
`deployRecovery`, `revert`, `auditResults`, or `system`. The macOS
author preload omits those namespaces, so a bare `cfs.deploy.run(...)`
crashes there. The plain `cfs` proxy still
throws when `window.cfs` itself is undefined (legacy semantics);
new flavor-conditional code should prefer `safeCfs`.

## Snapshot

A timestamped + content-addressed copy of a manifest's source
YAML, stored under `~/.configforge/history/<ns>/`. Created on
every save. Pruned by retention.

## Visual spreadsheet

The table-based resource editor shared by the manifest editor and new-baseline
flow. It supports inline cell edits, row addition, selection, and deletion.
It projects `Microsoft.OSConfig/Test` wrappers and
`Microsoft.OSConfig/Group` children into editable rows while preserving their
original YAML structure.

## Soft warning

See *[hard gate vs soft warning](#hard-gate-vs-soft-warning)*.

## See also

- [Architecture → System overview](../architecture/system-overview.md)
- [Reference → Manifest schema](./manifest-schema.md)
- [Reference → Registered types](./registered-types.md)
