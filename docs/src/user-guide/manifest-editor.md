# Manifest editor

Use the baseline editor to review settings, make changes, and export your
work. A **manifest** is the YAML/JSON document behind a baseline.
Authoring works in both editions without the OSConfig CLI, administrator
access, or Azure. The macOS Author edition omits device Deploy, Audit, Revert,
health, elevation, and audit-results controls entirely.

New here? Complete [Your first baseline](../quick-start/first-manifest.md)
before exploring packaging or device controls.

## Open

- New baseline: **My Baselines → Create new baseline**, choose a starting
  point, then **Create baseline** to review before registering.
- Existing baseline: **My Baselines → open a baseline** in the list,
  then **Edit**.

## What it does

- Live syntax checking in Code mode and structural validation in
  Visual mode. Code and Visual edits round-trip through canonical YAML
  when the source can be parsed.
- Resource-type pickers populated from
  [`registered-types.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/oscfg/registered-types.ts).
  Types unknown to the targeted CLI show a warning; this does not prevent
  drafting but needs investigation before device use.
- A CIS rule cross-reference drawer. When CIS data is available
  locally (see [Benchmark Mapping](./cis-compliance.md) for how to enable),
  the drawer shows the matching rule's ID, severity, and GPO path
  next to the resource at the cursor. Matches are resolved from
  Azure Policy JSON or XCCDF+OVAL data (not only the legacy
  `cis-mappings.json` file). Fuzzy matches and lower-confidence fallbacks
  need human review. A match is not proof that values or device state comply.
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

Each baseline remembers its Code or Visual view. Nested Test/Group settings
retain their source structure, values retain their types, and large QWord
integers retain precision. Import supported YAML/JSON or CSV/TSV/XLSX settings
through **Create new baseline**, then review the converted content before
saving. An arbitrary report spreadsheet is not necessarily an importable
baseline.

## Resource wrappers

Two resource types are _wrappers_ that nest other resources:

| Wrapper                    | Behaviour                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `Microsoft.OSConfig/Group` | A logical group; nested resources are validated recursively.                       |
| `Microsoft.OSConfig/Test`  | An assertion around a single nested resource, with its test expression/schema. |

The platform validator (`packages/core/src/platform.ts`) walks both
wrappers recursively, so a Linux resource hidden inside a
Windows-only Group is still caught.

## Save flow

```text
edit → validate → persist source.yaml + .json → optional snapshot →
  show success banner with any soft warnings
```

> **Tip:** The save flow does **not** call `oscfg apply`. In the Full edition,
> you must explicitly choose **Deploy** (admin/root required on the
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

For Azure Policy evaluation, export **MOF (`.mof`)** and follow the
[complete Machine Configuration workflow](./machine-configuration.md).
Packaging, testing, Storage upload, and policy assignment happen outside the
editor.

On the **packaging machine**, `New-GuestConfigurationPackage` requires the
**Microsoft.OSConfig PowerShell module 1.4.10 or later**, alongside the separate
**GuestConfiguration** toolkit and **PowerShell 7** runtime. Version 1.4.10
refers to the module, not PowerShell. The install command is
`Install-Module -Name Microsoft.OSConfig -MinimumVersion 1.4.10`.

The exported `ModuleVersion = "0.0.0"` is a portable placeholder. The
[version-resolution step](./machine-configuration.md#2-resolve-the-microsoftosconfig-module-version)
selects an installed version at or above 1.4.10 and fails if none is available
before replacing the placeholder. The MOF must bind to that exact bundled
version. Keep the resulting ZIP immutable after policy generation because the
policy contains its hash.

Start with **Audit** and validate the exact baseline/module combination.
The minimum version is not a blanket assurance that upstream issues are
resolved. Do not apply historical 1.4.3 package patches to 1.4.10+.

For a review document instead of a deployable package, use
[Audit Pack](./audit-pack.md). It needs none of these packaging tools.

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
| `Unsupported resource type`                      | The type is not in the targeted CLI's registered list. | A soft warning permits authoring, not guaranteed deployment. Review provider support before device use. |
| `mixed-platform manifest`                        | Your YAML has both Windows and Linux resource types.                           | Split it. `'mixed'` is rejected at deploy time.                                                                                                                                 |
| `CLI not installed` (on Deploy / Audit / Revert) | OSConfig isn't on this machine.                                                | The dialog's **Install** button opens the [OSConfig CLI docs](https://github.com/microsoft/osconfig/tree/main/docs/cli); **Recheck** auto-dismisses once the resolver finds it. |

## Breadcrumbs

Breadcrumb navigation appears on the Editor, History, and Audit Pack
pages. The breadcrumb trail shows the current manifest namespace and the
active sub-page so you can jump back without the side nav.

## Stable-width audit counter

In the Full edition, the audit counter badge in the manifest header uses a
fixed-width layout. Previous versions caused layout jitter when the
count changed during a deploy because the badge width shifted with
the digit count. The counter is now stable regardless of the
displayed number.

## See also

- [Reference → Manifest schema](../reference/manifest-schema.md)
- [Reference → Registered types](../reference/registered-types.md)
- [User Guide → History & snapshots](./history-snapshots.md)
