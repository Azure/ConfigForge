# Manifest editor

> The editor itself does **not** require the OSConfig CLI.
> Authoring, validation, history, CIS cross-reference, rationale, and
> Audit Pack export all work without it. In the Full edition, **Deploy**,
> **Audit**, and **Revert** are CLI-gated and route missing-CLI failures
> through `CliRequiredModal`; the footer health pill surfaces CLI state.
> The macOS Author edition omits deploy, audit, revert, health, elevation,
> and audit-results surfaces entirely.

The manifest editor is the primary authoring surface. It accepts raw
YAML or editable Visual spreadsheet changes, validates as you type,
and persists to `~/.configforge/manifests/<ns>.source.yaml` on save.

## Open

- New baseline: **My Baselines → Register New** in the side nav.
- Existing baseline: **My Baselines → click any namespace** in the list,
  then **Edit**.

## What it does

- Live syntax checking in Code mode and structural validation in
  Visual mode. Code and Visual edits round-trip through canonical YAML
  when the source can be parsed.
- Resource-type pickers populated from
  [`registered-types.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/oscfg/registered-types.ts).
  Aspirational types (in baselines but not yet supported by the target
  CLI) show with a warning chip.
- A CIS rule cross-reference drawer. When CIS data is available
  locally (see [Benchmark Mapping](./cis-compliance.md) for how to enable),
  the drawer shows the matching rule's ID, severity, and GPO path
  next to the resource at the cursor. Matches are resolved from
  Azure Policy JSON or XCCDF+OVAL data (not only the legacy
  `cis-mappings.json` file). v0.3.46 tightened fuzzy matching from
  substring matching to exact-word-set matching with a higher threshold,
  which reduces over-matching; property-mapping fallback still appears
  with lower confidence.
  The drawer is **hidden entirely** when CIS data is not present
  (the `useCisAvailable()` hook short-circuits the render).
- The "Why?" rationale modal. See [Rationale](./rationale.md).

## YAML editor

- Two-space indentation. Tabs are rejected by the parser.
- The editor uses Monaco with a YAML language service for inline error
  squiggles (missing `name:`, missing `type:`, malformed
  `properties:`).
- Save is `Ctrl+S` (or `Cmd+S` on macOS). Save runs the same
  validation pass that the `cfs:manifests:register` IPC handler runs
  on the main process side.

## Code and Visual modes

The editor provides **Code** and **Visual** modes. Code mode can view
YAML, JSON, or MOF; MOF is read-only. Visual mode is an editable
spreadsheet for supported baseline settings, with inline cell editing,
Add settings, row selection, delete, and keyboard navigation. Tab
saves and moves right. Enter saves and moves down. Shift+Enter remains
a newline for structured values.

> **v0.2.1 import fix:** CSV / TSV / XLSX / JSON security-definition
> imports now emit `Microsoft.Windows/Registry` resources with all
> three schema-required properties (`keyPath`, `valueName`,
> `valueType`). Before v0.2.1 the import omitted `valueType` (and the
> JSON path also dropped `valueName`), so the schema validator flagged
> every imported row as invalid the moment the editor opened it. The
> importer now infers `valueType` from `expectedValue` via
> `inferRegistryValueType()`: DWORD-range integers → `REG_DWORD`, larger
> exact integers → `REG_QWORD`, and other values → `REG_SZ`.

## Resource wrappers

Two resource types are _wrappers_ that nest other resources:

| Wrapper                    | Behaviour                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `Microsoft.OSConfig/Group` | A logical group; nested resources are validated recursively.                       |
| `Microsoft.OSConfig/Test`  | An assertion. Wraps a single resource and adds an `expression`/`compliance` field. |

The platform validator (`packages/core/src/platform.ts`) walks both
wrappers recursively, so a Linux resource hidden inside a
Windows-only Group is still caught.

## Save flow

```text
edit → validate → persist source.yaml + .json → optional snapshot →
  show success banner with any soft warnings
```

> **Tip:** The save flow does **not** call `oscfg apply`. To deploy,
> you need to explicitly hit **Deploy** (admin/root required on the
> host platform; the CLI must be installed). If OSConfig is missing,
> Deploy opens the install dialog instead of failing. See
> [Authoring vs deploying](../quick-start/authoring-vs-deploying.md).

## Export formats

The current renderer **Export** menu writes the manifest in these
formats:

| Format | Extension   | Use                                                                                                           |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| YAML   | `.osc.yaml` | Native OSConfig manifest - the canonical source.                                                              |
| JSON   | `.json`     | The manifest as JSON.                                                                                         |
| MOF    | `.mof`      | DSC Managed Object Format for the Azure Machine Configuration toolchain (see below). Read-only in the editor. |
| CSV    | `.csv`      | Flat per-resource rows for spreadsheets / bulk review.                                                        |

Use the separate **Docs** button to download generated Markdown
documentation. Azure Policy export exists in the core handler but is
not exposed by the current Manifest Editor UI.

### Machine Configuration package route

To reach Azure Policy / Machine Configuration through a package, export
**MOF (`.mof`)**, then hand the `.mof` to the
[`GuestConfiguration`](https://learn.microsoft.com/azure/governance/machine-configuration/how-to-create-package)
PowerShell module (Azure Machine Configuration) to turn it into a
package and a policy definition.

**Prerequisites (one-time, on the packaging machine - PowerShell 7,
run as Administrator):** the exported MOF declares the OSConfig DSC
resource, so `New-GuestConfigurationPackage` needs both modules
installed to bundle it into the package:

```powershell
Install-Module GuestConfiguration -Scope AllUsers -Force
# The exported MOF carries a portable 0.0.0 placeholder. Resolve it to
# the newest module installed on the packaging machine before packaging.
Install-Module Microsoft.OSConfig -Scope AllUsers -Repository PSGallery -Force
```

Then build and publish:

```powershell
$InstalledOSConfig = Get-Module -ListAvailable Microsoft.OSConfig |
  Sort-Object Version -Descending |
  Select-Object -First 1
$ResolvedMof = '.\MySecurityBaseline.resolved.mof'
(Get-Content '.\MySecurityBaseline.mof' -Raw).Replace(
  'ModuleVersion = "0.0.0";',
  "ModuleVersion = `"$($InstalledOSConfig.Version)`";"
) | Set-Content $ResolvedMof -Encoding utf8

# MOF to Machine Configuration package (.zip)
New-GuestConfigurationPackage `
  -Name MySecurityBaseline `
  -Configuration $ResolvedMof `
  -Type Audit `
  -Path .\package

# Upload the returned ZIP to Azure Storage with Set-AzStorageBlobContent,
# then pass its read-only URI to the policy generator.
New-GuestConfigurationPolicy `
  -PolicyId <new-guid> `
  -ContentUri <package-uri> `
  -DisplayName 'My Security Baseline' `
  -Path .\policy `
  -Platform Windows `
  -PolicyVersion 1.0.0 `
  -Mode Audit
```

Then assign the generated definition in Azure Policy. Use this route
when you want to own the packaging and publishing step - custom
storage, your own GUIDs/versioning, or package signing.

See [Deploy through Azure Machine Configuration](./machine-configuration.md)
for the complete package, Storage, Azure Policy, assignment, verification, and
troubleshooting workflow.

> The exported MOF uses `ModuleVersion = "0.0.0"` as a portable placeholder.
> Resolve it to the packaging machine's installed version as shown above;
> Machine Configuration runtime requires the exact bundled version. If the module isn't installed,
> `New-GuestConfigurationPackage` fails with _"Failed to find a module
> with the name 'Microsoft.OSConfig'."_
>
> Microsoft.OSConfig 1.3.11 can audit these packages, but its PowerShell
> resource has an upstream `Set()` serialization defect. The example therefore
> defaults to Audit. Use `AuditAndSet` plus an Apply mode only with a newer
> module that contains the fix.

## What changes don't trigger a save

- Re-typing the exact same content as the last save → de-duplicated by
  the snapshot store (no new history entry).
- Comments-only changes → still trigger a save (the comment is part of
  the source YAML and is preserved on export).

## Errors you'll see

| Error                                            | Meaning                                                                        | Fix                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources is required`                          | Top-level YAML doesn't have a `resources:` array.                              | Wrap your resources under `resources:`.                                                                                                                                         |
| `invalid Group/Test wrapper`                     | A `Microsoft.OSConfig/Group` or `Microsoft.OSConfig/Test` has no nested array. | Add `resources:` (Group) or `resource:` (Test) inside.                                                                                                                          |
| `Unsupported resource type`                      | The target CLI doesn't know this type, it's not in the registered whitelist.   | Soft warning only; the rest of the manifest still applies.                                                                                                                      |
| `mixed-platform manifest`                        | Your YAML has both Windows and Linux resource types.                           | Split it. `'mixed'` is rejected at deploy time.                                                                                                                                 |
| `CLI not installed` (on Deploy / Audit / Revert) | OSConfig isn't on this machine.                                                | The dialog's **Install** button opens the [OSConfig CLI docs](https://github.com/microsoft/osconfig/tree/main/docs/cli); **Recheck** auto-dismisses once the resolver finds it. |

## Breadcrumbs

Breadcrumb navigation appears on the Editor, History, and Audit Pack
pages. The breadcrumb trail shows the current manifest namespace and the
active sub-page so you can jump back without the side nav.

## Stable-width audit counter

The audit counter badge in the manifest header now uses a
fixed-width layout. Previous versions caused layout jitter when the
count changed during a deploy because the badge width shifted with
the digit count. The counter is now stable regardless of the
displayed number.

## See also

- [Reference → Manifest schema](../reference/manifest-schema.md)
- [Reference → Registered types](../reference/registered-types.md)
- [User Guide → History & snapshots](./history-snapshots.md)
