# Diff: Pairwise + CIS + Matrix

> **v0.3.48:** Diff is a pure-renderer feature - no OSConfig CLI
> required. Pairwise and Matrix modes load source YAML from the
> manifest store and compute deltas in-process, so they work in
> Editor mode (amber footer pill) exactly as they do with the CLI
> installed. The CIS tab also runs locally against user-supplied CIS
> data.

ConfigForge's **Diff** page has three tabs:

- **Pairwise** - classic A vs B comparison from registered manifests or
  pasted/uploaded YAML. The Compare button auto-scrolls to the results
  once the diff renders.
- **CIS Diff** - industry-aligned coverage scoring against a selected
  CIS baseline. It appears when CIS data is loaded and its Compare
  button auto-scrolls to the score/results.
- **Matrix (N-way)** - pick 2-10 manifests, see a side-by-side table
  with each row a setting and each column a baseline.

The matrix mode is the one auditors and consultants asked for: the
research showed that pairwise compare doesn't scale past three
baselines.

## Open

- **Pairwise** - side nav, **Diff**, then the **Pairwise** tab. Pick
  registered manifests on the left/right or switch either side to
  **Paste / Upload**.
- **CIS Diff** - side nav, **Diff**, then the **CIS Diff** tab (visible
  when CIS data is loaded). Pick a manifest and optionally a benchmark.
- **Matrix** - side nav, **Diff**, then the **Matrix (N-way)** tab. Pick
  the manifests to include with checkboxes (up to 10).

## How rows are merged

The matrix builder lives in
[`packages/core/src/diff/matrix.ts`](https://github.com/Azure/ConfigForge/blob/main/packages/core/src/diff/matrix.ts).
It keys rows by a stable composite of
`(type, valueName | name | keyPath\\valueName)`, *not* the raw
`name:` field, because two baselines for "MaxAuthTries" may use
different display names ("MaxAuthTries-WS2022" vs "MaxAuthTries").
Keying on the resource identity instead of the display name correctly
merges the same setting across baselines.

> **v0.2.2 fix:** the matrix builder now compares `compliance.equals`
> (and `compliance.contains` / `matches` / `regex` for non-equality
> ops) in addition to `properties.value`. CSV-imported and
> `compliance:`-block manifests previously reported `status: identical`
> for two baselines that targeted the same registry path but disagreed
> on the desired value, because the value lived under
> `compliance.equals` (sibling of `properties`) and the matrix only
> inspected `properties.value`.
>
> **v0.2.3 fix (pairwise analyzer):** `analyzeDiff` now uses the same
> semantic-identity contract as matrix-diff
> (`type:keyPath\\valueName` for Registry; recursive unwrap for
> `Microsoft.OSConfig/Test`; `type:rule:ruleId` for imported
> `Microsoft.OSConfig/BaselineRule` placeholders) so the pairwise view
> no longer reports the same renamed rule as duplicate add+remove
> across baseline versions.
>
> **v0.2.4 fix (pairwise analyzer):** identity now also covers
> `Microsoft.Windows/AuditPolicy.subcategory`,
> `Microsoft.Windows/UserRightsAssignment.policy`, and
> `Microsoft.Windows/AccountPolicy.policy`: schema-canonical fields
> that are stable across CIS benchmark versions even when the display
> name drifts. Finally, a name-normalization fallback (lowercase +
> strip non-alphanumeric) catches generic-type rules that only differ
> in naming convention (`AuditLogon` / `Audit Logon` / `audit_logon`).
> The matrix builder is unaffected; its keying already covers these
> cases.

## Row status

Each row gets one of three statuses:

| Status | Meaning |
| --- | --- |
| `identical` | All baselines that have this setting agree on the value. |
| `differs` | At least two baselines have this setting and disagree. |
| `partial` | Setting is present in some baselines, missing in others. |

Each *cell* in turn carries `identical | differs | missing`. The
`fromTestWrapper` flag is set when the resource is wrapped in a
`Microsoft.OSConfig/Test` (so a value `equal:'no'` reads as a
compliance assertion, not a literal).

## 10-manifest cap

The Matrix tab is hard-capped at **10 selected manifests**
(`MATRIX_MAX_SELECTION` in
[`useDiffMatrix.ts`](https://github.com/Azure/ConfigForge/blob/main/apps/desktop/src/pages/Diff/state/useDiffMatrix.ts)).
Clicking an 11th checkbox surfaces an inline message:
*"Matrix compare is limited to 10 manifests. Deselect one before
adding another."* Instead of silently no-op'ing the click
(v0.1.14 fix).

## Excel export

Click **Export → Excel** on the Matrix tab to download an `.xlsx`
with conditional formatting:

- `identical` cells stay neutral.
- `differs` cells highlight red.
- `partial` cells highlight amber.
- Each baseline gets its own column; one summary sheet ranks settings
  by how many baselines disagree.

Internally this routes through `cfs.diff.matrixXlsxSave()` over IPC;
no web endpoints are involved.

## Rendering notes

- Matrix computation is pure once the input manifests are loaded.
- The matrix IPC channel accepts up to 10 manifests per request (matches
  the renderer cap).
- Rendering uses CSS grid; very wide tables become horizontally
  scrollable rather than wrapping.

## Race-guard on rapid clicks

`useDiffMatrix` carries a `matrixLoadTokenRef` so a slow fetch from a
previous selection can't overwrite the fresh result. This was a
v0.1.13 regression fix and is locked in by a hook test.

## CIS Diff tab

The CIS Diff tab appears on the Diff page when CIS data is loaded (see
[Benchmark Mapping](./cis-compliance.md)). It scores coverage as **unique CIS
rules covered / total benchmark rules**, not resources matched / total
manifest resources.

### How to use it

1. Open the **Diff** page from the side nav.
2. Select the **CIS Diff** tab.
3. Pick a manifest from the manifest picker dropdown.
4. Optionally pick a CIS benchmark; blank auto-picks by platform.
5. Click **Compare against CIS**. The page scrolls to the results when
   scoring completes.

### Summary bar

After comparison, a summary bar shows:

- **X of Y CIS rules covered** - how much of the selected benchmark is
  represented in the manifest.
- **Z%** - full-baseline coverage percentage.
- A secondary line showing how many manifest resources matched any CIS
  rule.

### Results table

Below the summary bar, a filterable table lists resources and missing
benchmark rules. Controls:

- **Filter buttons:** All resources, Covered in manifest, Missing from CIS.
- **Search box:** filters by resource/rule name, or by CIS rule title /
  section in the Missing view.
- **Status column sort:** cycles unmapped first, mapped first, and natural
  order.

Each row displays a **source badge** indicating where the CIS match
came from:

| Badge | Meaning |
| --- | --- |
| Azure Policy | Matched via Azure Policy CIS baseline JSON |
| XCCDF | Matched via XCCDF+OVAL XML data |
| JSON | Matched via legacy pipeline JSON (`cis-mappings.json`) |

## Edge cases

- **Same setting, different `name`** - merged via the composite key.
- **Same `name`, different setting** (rare, e.g. a registry value
  re-used as a CSP value) - kept as separate rows; the `type` column
  disambiguates.
- **A resource wrapped in `Microsoft.OSConfig/Test`** - the cell
  carries `fromTestWrapper: true`; the value displayed is the
  `expression` rather than a literal value.

## See also

- [API Reference → Diff matrix](../api-reference/diff.md)
- [User Guide → AI analysis with provenance](./ai-provenance.md)
- [User Guide → Benchmark Mapping](./cis-compliance.md)
