# Benchmark Mapping with CIS data

> ⚠️ **Important:** ConfigForge **does not bundle CIS Benchmark
> data**. The Center for Internet Security licenses CIS Benchmarks
> under terms incompatible with redistributing derived YAML / JSON /
> XCCDF artifacts in a public open-source repository. This page
> describes local/offline features that are **disabled by default**
> for data-dependent surfaces until you, the user, supply your own
> legally licensed copy of the data files locally.
>
> The editor cross-reference drawer and Diff page **CIS Diff** tab are
> hidden until supported CIS data is present. The **Benchmark Mapping**
> sidebar page remains visible so users can see the resolved data
> folder and setup guidance. No OSConfig CLI is required.

## What this feature does (when enabled)

Two related but distinct features sit on top of CIS Benchmark data:

1. **Cross-reference** - for each resource in your manifest, show the
   matching CIS rule (ID, severity, GPO path) inline in the editor
   drawer.
2. **CIS Diff coverage scoring** - score your manifest against a full
   CIS baseline on the **Diff → CIS Diff** tab: *"Your custom WS2025
   baseline covers X% of the CIS WS2025 baseline you supplied."*

When CIS data is **not** present (the default for a fresh clone), the
editor cross-reference drawer and the Diff page's CIS tab are hidden.
The rest of the authoring experience (editor, history, rationale, Audit Pack,
pairwise diff, and matrix diff) works exactly the same. Full-edition device
operations are also unaffected.

## Ingestion paths

ConfigForge supports three ways to supply CIS data. You only need
**one** of these paths. The app resolves the correct location at
runtime and shows the active path on the Benchmark Mapping page. In a dev
checkout the folder is `public/_baselines/cis/_data`; in packaged builds
it resolves under the app's public assets as `_baselines/cis/_data`.

### 1. Azure Policy CIS baseline JSON (primary, recommended)

This is the simplest and recommended path for most users.

1. Open the Azure portal.
2. Navigate to **Azure Policy > Machine Configuration > CIS**.
3. Download the CIS baseline JSON for your target OS.
4. Drop the downloaded JSON file into `_baselines/cis/_data` (or the
   exact folder shown on the Benchmark Mapping page in the app).
5. Click **Re-check catalog** on the Benchmark Mapping page.

The app parses the Azure Policy structure automatically. No manual
conversion is needed.

### 2. XCCDF + OVAL XML (alternative)

If you have a CIS Workbench subscription, you can use the raw
XCCDF and OVAL files directly.

1. Download the XCCDF and OVAL XML files from
   [CIS Workbench](https://workbench.cisecurity.org/).
2. Drop the files as-is into `_baselines/cis/_data` (or the exact
   folder shown on the Benchmark Mapping page).
3. Click **Re-check catalog** on the Benchmark Mapping page.

The app reads XCCDF structure and OVAL definitions to build the
mapping table at startup.

### 3. Legacy OSConfig pipeline JSON (advanced)

This is the internal `cis-mappings.json` format used by earlier
versions of ConfigForge and the OSConfig
[`mc/CIS`](https://github.com/microsoft/osconfig/tree/main/mc/CIS)
scripts. It remains supported for backward compatibility.

1. Generate the mapping artifacts using the upstream OSConfig
   PowerShell scripts from a CIS XCCDF + OVAL pair you supply.
2. Place the resulting JSON files in `_baselines/cis/_data` (or the
   exact folder shown on the Benchmark Mapping page).
3. Click **Re-check catalog** on the Benchmark Mapping page.

The expected JSON shapes are documented in the
[`packages/core/src/cis/data.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/cis/data.ts)
type definitions (`CisGlobalMappings`, `CisRuleCatalog`, etc.).

> **Tip:** You do not need to remember exact file paths. The
> Benchmark Mapping page in the app displays the resolved data directory for
> your installation. Place files there and click **Re-check catalog**.

## Cross-reference (Benchmark Mapping + editor drawer)

The **Benchmark Mapping** sidebar page detects the files in `_baselines/cis/_data`,
shows their source format, and explains the resolved folder. When data is
available, the manifest editor drawer cross-references each resource and shows:

| Field | Source |
| --- | --- |
| **CIS rule ID** | Resolved from whichever ingestion path is active |
| **Rule name** | The per-OS CIS catalog |
| **Severity** | The CIS catalog |
| **GPO path** | The CIS catalog (where applicable) |
| **Confidence** | High for exact matches; lower for property-mapping fallback |
| **Source** | Badge showing Azure Policy, XCCDF, or JSON |

**Strict match** is the default. If `myResource.name` matches a CIS
rule's `name` exactly, the match is high-confidence.

**Property-mapping fallback** (lower confidence): when strict match
fails, the engine checks whether the resource is a recognized type:

- `Microsoft.Windows/AccountPolicy` - match `properties.name` against
  the `osconfigProperty` field, then search the rule catalog for a
  matching friendly name.
- `Microsoft.Windows/UserRightsAssignment` - match `properties.name`
  (e.g. `SeSecurityPrivilege`) against the `userRights.*.privilege`
  field.
- `Microsoft.Windows/AuditPolicy` - match `properties.subcategory`
  GUID against the audit subcategory mapping.

The drawer marks property-mapping matches with a verification pill so
the author knows to review them.

> **Note:** A high-confidence match means the names/identity agree. It
> does **not** assert the *values* agree. That is what CIS Diff coverage
> is for.

## CIS Diff coverage report

On the **Diff** page, open the **CIS Diff** tab, choose a manifest and
optionally a benchmark, then click **Compare against CIS**. You will see:

```text
covered CIS rules        35
missing CIS rules         12
manifest resources matched 42 / 50
coverage                  74.5%
```

The main score is computed strictly:

- `covered CIS rules` - unique CIS benchmark rules with at least one
  matching manifest resource.
- `missing CIS rules` - benchmark rules with no matching manifest resource.
- `manifest resources matched` - secondary diagnostic; multiple resources
  can map to the same CIS rule.
- `coverage = covered CIS rules / total benchmark rules * 100`.

> **Tip:** `coverage == 100` means every supplied CIS rule has at least
> one matching resource. It does *not* mean your manifest is identical
> to the CIS baseline; extra hardening remains allowed.

### When CIS data is not available

If CIS data is missing, the CIS Diff tab is hidden and the Benchmark Mapping
page renders a friendly empty state explaining the license restriction
and pointing at the data folder. No broken dropdown, no crash.

## Per-rule breakdown

Below the summary, the CIS Diff tab lists mapped resources with source
badges and can switch to a Missing-from-CIS view that lists missing benchmark rules. The status column is sortable.

## Audit-pack export

Audit Pack export supports both PDF and Markdown. Both formats include
manifest metadata and can include compliance, device-audit, history,
rationale, and citations when those inputs are available. Open
**Manifest > Audit Pack** and choose **Download PDF** or **Download
Markdown**, or trigger the audit-pack IPC channel with `format: 'pdf'`
or `format: 'markdown'`.

Today AI provenance is not persisted per manifest, so the
citations/provenance section is omitted in normal UI-generated audit
packs. Both formats omit the CIS section gracefully when CIS data isn't
available. See [Audit-pack](./audit-pack.md).

## Performance (when data is present)

- Strict-match cross-reference: single `Map` lookup per resource.
- Property-mapping fallback: walks the global mapping table once,
  then uses exact-word-set fuzzy matching with a raised threshold over
  the per-OS rule catalog.
- The IPC handler caches per `(manifest, baseline)`.

## How the gating works under the hood

| Surface | Gating signal |
| --- | --- |
| Editor CIS drawer | `useCisAvailable()` hook, calls `cfs.cis.status()` once per page lifetime |
| Diff page **CIS Diff** tab | Same hook; tab appears only when `true` |
| Audit-pack PDF "CIS coverage" section | Server-side: skipped when `loadCisGlobalMappings()` returns `null` |
| `cfs.cis.lookup()` | Returns `{ name, match: null }` when data absent |
| `cfs.cis.bulkLookup()` | Returns benchmark coverage data for the Diff page's CIS Diff tab; errors clearly when a selected benchmark file is unavailable |

## See also

- [API Reference > Compliance](../api-reference/compliance.md)
- [User Guide > Audit-pack](./audit-pack.md)
- [User Guide > AI analysis with provenance](./ai-provenance.md)
