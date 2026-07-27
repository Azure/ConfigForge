# `cfs.history.*`, `cfs.revert.*`, `cfs.importChannel.*`, `cfs.exportChannel.*`

> **Phase 10 transport note.** These surfaces were `/api/history`,
> `/api/revert`, `/api/import`, and `/api/export` in the Next.js era.
> The pure handlers in
> `packages/core/src/handlers/{history,history-write,revert,import,export}.ts`
> now back the IPC channels below. Multipart `formData()` upload is gone
> — Electron has direct disk access, so import is split into
> `cfs:import:openAndParse` (file picker → read → parse) and
> `cfs:import:fromContent` (renderer-supplied content). Contract shapes
> preserved.

## `cfs.history.list({ name, id? })` — channel `cfs:history:list`

List snapshot summaries (no payload) when `id` is omitted; fetch one
snapshot's full payload + sidecar when `id` is supplied. Newest first.

```ts
// Without id — list summaries
const { data } = await cfs.history.list({ name: 'ws2025-baseline' });
// data: Array<{
//   id: string;                  // <ISO-8601-with-dashes>.<8-hex>
//   manifestName: string;
//   timestamp: string;
//   message?: string;            // auto-register uses changeSummary when provided
//   author?: string;             // only when sidecar carries it
//   authorEmail?: string;
//   rationale?: string;
//   size: number;
// }>

// With id — full payload
const { data } = await cfs.history.list({
  name: 'ws2025-baseline',
  id: '2026-03-01T14-22-00.000Z.a3f8b1c4',
});
// data: same shape + content: string (the YAML body)
```

The snapshot `id` format is
`<ISO-8601-with-dashes>.<8-hex-random-suffix>` (the 8-hex from
`randomBytes(4)` disambiguates writes within the same millisecond).
On disk: `.osc.yaml` appended.

Errors:

| Status | When |
| --- | --- |
| 400 | Missing `name`, malformed namespace, path-traversal-blocked id. |
| 404 | Snapshot `id` not found (only when `id` is supplied). |

## `cfs.history.save({ name, content, message? })` — channel `cfs:history:save`

Create a snapshot manually (the editor save flow does this
automatically; this channel is for tooling).

```ts
type SaveSnapshotRequest = { name: string; content: string; message?: string };
```

> **Note:** This channel takes only `{ name, content, message? }`. It
> does **not** accept `author` / `authorEmail` / `rationale` — those are
> only recorded by the auto-snapshot path inside
> [`cfs.manifests.register`](./manifests.md), which calls the structured
> `createSnapshot()` form internally and resolves the author server-side.

If content is byte-identical to the immediate predecessor snapshot,
dedup returns the existing entry (metadata preserved).

## `cfs.history.delete({ name, id })` — channel `cfs:history:delete`

Delete a snapshot. Idempotent — deleting a non-existent id returns
`{ message: "Snapshot '<id>' deleted" }`, not 404. Validates against
path-traversal.

## `cfs.revert.apply({ name })` — channel `cfs:revert:apply`

Roll the manifest back to the pre-deploy state.

```ts
type RevertResult = {
  message: string;
  data: {
    Reverted: true;
    Method: 'reapply-manifest' | 'delete-namespace';
    preDeployTimestamp?: string;
  };
};
```

The handler reads `<userDataDir>/snapshots/<ns>.pre-deploy.json`
(written by the last successful deploy). If a usable `manifestYaml`
exists, the snapshot is **re-validated** (H6 — schema, mixed-platform
rejection, host-platform match) before being re-applied via
`oscfg apply` (`Method: 'reapply-manifest'`). Otherwise the namespace
is deleted via `oscfg delete namespace` (`Method: 'delete-namespace'`).

> **Note:** `cfs.revert.apply` does **not** accept a snapshot id — it
> always reverts to the snapshot the deploy channel stamped. To
> reapply a specific historical snapshot, fetch it via
> `cfs.history.list({ name, id })` and re-register the content through
> `cfs.manifests.register({ name, content })`.

### Preflight gate — CLI required

Like `runDeploy`, the revert handler maps CLI-missing failures to
`cliRequiredError(...)` (status 412, code `CLI_REQUIRED`) via
`isCliMissingMessage(result.error)` so the renderer's
`<CliRequiredModal />` opens instead of a toast.

## `cfs.importChannel.openAndParse()` — channel `cfs:import:openAndParse`

Open the native OS file picker, read the file, parse. Returns the same
shape as `fromContent` (or an `IpcErrorEnvelope` on user-cancel).

## `cfs.importChannel.fromContent({ filename, content? | bytes? })` — channel `cfs:import:fromContent`

Parse renderer-supplied text or binary content. Exactly one of
`content: string` or `bytes: Uint8Array` is required; the 10 MB cap
(`MAX_IMPORT_BYTES`) applies to either. Larger payloads return 413;
empty text content returns 400.

```ts
type ImportResult = {
  type: 'manifest' | 'security-definition' | 'baseline-spreadsheet';
  filename: string;
  data: Record<string, unknown>;
  yaml: string;                // canonical YAML for downstream tools
};
```

File-type detection (`detectFileType`):

| Extension | Recognised shape | Output `type` |
| --- | --- | --- |
| `.osc.yaml` / `.osc.yml` / `.yaml` / `.yml` | `parseOscYaml` | `'manifest'` |
| `.json` with non-empty `resources[]` | manifest-JSON | `'manifest'` |
| `.json` with a `source: "<yaml>"` field containing an embedded manifest | embedded-source unwrap → `parseOscYaml` | `'manifest'` |
| `.json` with `settingsReference[]` (Azure Policy Guest Configuration baseline catalog) | `parseSecurityDefinition` (origin: `settingsReference`) | `'security-definition'` |
| `.json` with `Settings[]` / `settings[]` / `desiredConfiguration[]` | `parseSecurityDefinition` (origin: `settings`) | `'security-definition'` |
| `.csv` / `.tsv` / `.xlsx` | `parseExcelBaseline` | `'baseline-spreadsheet'` |

Friendly errors (added v0.2.2) for known-but-unimportable JSON shapes — the importer detects them and surfaces an actionable message with the file's identifying metadata instead of the generic "Unrecognized JSON shape":

| Detected shape | What it is | Error message |
| --- | --- | --- |
| `{ properties.policyRule }` | Azure Policy Definition wrapper — references a Guest Configuration package by name but doesn't carry the settings. | Names the `policyRule.then.details.name` + `metadata.guestConfiguration.{name,version}` and tells the user to import the baseline JSON inside the GC package instead. |
| `{ id, version, rules[] }` with `ruleId` on each rule | Rule-metadata reference file (descriptions / remediation steps, pairs with a baseline by ruleId). | Names the rule count + the baseline id and tells the user to import the matching baseline JSON (with `settingsReference[]`) instead. |
| `{ resources: [] }` with no other content | Empty manifest with no `source` field. | Surfaces explicitly instead of silently importing as a 0-resource manifest. |

Every successful shape is normalized into canonical YAML in the `yaml` field so the editor sees one format.

### `settingsReference[]` mapping (Azure Policy GC baseline imports, v0.2.2)

The settingsReference shape carries only the rule **identity** (`ruleId`, `displayName`, `severity`, `schema.type`, `defaultValue`) — not the implementation (no registry path, no file path, no command line). The OSConfig agent on the target machine is the only thing that knows how to evaluate each rule by its ruleId.

The importer maps each entry to a `Microsoft.OSConfig/BaselineRule` placeholder resource (not a synthetic `Microsoft.Windows/Registry`). The placeholder is honest about being unimplemented:

- The editor's schema validator flags `Microsoft.OSConfig/BaselineRule` as an unknown type — exactly the signal needed: "map this to a concrete type before deployment."
- The oscfg CLI doesn't recognise the type, so audit/deploy fails loudly instead of silently faking compliance.
- The imported manifest opens with a leading banner comment explaining the constraint and what to do next.
- Matrix diff, search, library browse, and rename all still work — the manifest is editable, just not deployable as-is.

This is deliberate: synthetic Registry placeholders with `HKLM:\AzurePolicy\<name>` keyPaths would let users build a fake audit/deploy manifest that silently reports "compliant" by checking registry keys that don't exist. False compliance is worse than no compliance.

### v0.2.1 — Registry schema fix

CSV / TSV / XLSX and JSON security-definition imports now emit
`Microsoft.Windows/Registry` resources with **all three** schema-required
properties (`keyPath`, `valueName`, `valueType`). Previously the CSV
import omitted `valueType` (and the JSON path also omitted `valueName`),
so the editor's inline validator flagged every imported row as invalid.

`valueType` is inferred from `expectedValue` via
`inferRegistryValueType()` (exported from `import.ts`): integer-shaped
values — numbers (`42`) and integer-shaped strings (`"0"`, `"-7"`,
`"  42  "`) — get `Dword`; everything else gets `String`. Users can
override after import. New import sources should re-use the same helper.

## `cfs.exportChannel.get({ name, format?, effect?, osType? })` — channel `cfs:export:get`

Download the manifest. Defaults to `yaml`.

```ts
type ExportFormat = 'yaml' | 'json' | 'mof' | 'excel' | 'azurepolicy';

type ExportRequest = {
  name: string;
  format?: ExportFormat;
  effect?: 'AuditIfNotExists' | 'DeployIfNotExists'; // azurepolicy only
  osType?: 'Windows' | 'Linux';                      // azurepolicy override
};

type ExportArtifact = {
  filename: string;
  contentType: string;
  body: string;
  cacheable: boolean;     // true for yaml/json/mof when source YAML is on disk
};
```

| Format | Content-Type | Notes |
| --- | --- | --- |
| `yaml` | `application/x-yaml` | Lossless source manifest (preserves comments). Falls back to `resourcesToYaml(namespace, liveResources)` when no on-disk source. |
| `json` | `application/json` | Canonical manifest JSON. Round-trips through `cfs.importChannel.*`. |
| `mof` | `text/plain` | DSC-compatible MOF text. |
| `excel` | `text/csv` | Flattened CSV. Matches the legacy PowerShell-edition CSV shape. |
| `azurepolicy` | `application/json` | Azure Policy Guest Configuration definition. See [Azure Policy export shape](#azurepolicy-export-shape-v023) below. `effect: 'AuditIfNotExists'` (default) or `'DeployIfNotExists'`. Optional `osType: 'Windows' \| 'Linux'` overrides auto-detection. |

### `azurepolicy` export shape (v0.2.3+)

The export was a structurally-incomplete stub through v0.2.2; v0.2.3 rewrote it to match a real Microsoft-shipped Guest Configuration policy. The emitted JSON now carries every field Azure Policy actually needs to deploy or audit settings:

- `metadata.requiredProviders: ["Microsoft.GuestConfiguration"]`
- `metadata.guestConfiguration.{ contentType, contentUri, contentHash, configurationParameter }` — `configurationParameter` here is an **object** mapping ARM-parameter name → MOF-parameter name (the OSConfig agent reads this to wire policy values into resource configs)
- One ARM parameter per manifest setting, with the manifest's current value as `defaultValue`
- `IncludeArcMachines` toggle (defaults to `"false"` — Azure-VM-only by default; operators opt in to Arc per assignment)
- `existenceCondition` with both `complianceStatus` AND `parameterHash` so ARM parameter changes propagate via reassignment (without this, parameter changes silently never apply)
- Dual deployment-template resources: one for `Microsoft.Compute/virtualMachines/.../guestConfigurationAssignments` and one for `Microsoft.HybridCompute/machines/.../guestConfigurationAssignments`, each gated by a `condition` on the `type` parameter
- `guestConfiguration.configurationParameter` inside the deployment template is an **array** of `{ name, value }` per setting (different shape than the metadata object map)
- `versions: ["<version>"]` array
- Assignment name uses `uniqueString()` so multiple policy assignments coexist

Mapping convention: ARM parameter name = sanitized resource name (alphanumeric + underscore); MOF parameter name = `<resource.name>;Value` (matches what `exportToMof` writes). Test wrappers unwrap to the inner resource for keyPath/valueName extraction. `compliance.equals` wins over `properties.value` when both are present.

Workflow: generate the MOF via `format: 'mof'`, zip it with the package metadata, upload to Azure Storage, then replace the `REPLACE_WITH_YOUR_MOF_PACKAGE_URI` / `REPLACE_WITH_SHA256_OF_PACKAGE_ZIP` placeholders in the policy JSON with the storage URI and SHA256 hash.

Safety guards in the export handler:

- Refuses to export when the manifest contains `Microsoft.OSConfig/BaselineRule` placeholders (the imported-baseline shape). Those carry no implementation — the OSConfig agent would skip every resource without flagging an error, and Azure would report every VM as Compliant. Error message names the affected placeholders.
- Rejects manifests that somehow mix Windows and Linux resources (a GC package is single-OS by definition).
- Auto-detects OS family from resource type prefixes (`Microsoft.Windows/*` → Windows; `Microsoft.OSConfig/FileLine|Sshd|Package|Firewall|...` and `Microsoft.Linux/*` → Linux). Default falls to Windows for ambiguous / empty manifests.

## `cfs.exportChannel.save(req)` — channel `cfs:export:save`

Same handler, but main pops a native save dialog and writes the bytes
to the chosen path. Returns `{ ok: true, path }` or `IpcErrorEnvelope`
on user-cancel.

## See also

- [User Guide → History & snapshots](../user-guide/history-snapshots.md)
- [User Guide → Rationale](../user-guide/rationale.md)
- [Architecture → Module map](../architecture/module-map.md)
- [API Reference → `cfs.manifests.*`](./manifests.md) — auto-snapshot on register
- [API Reference → `cfs.deploy.*`](./deploy-health.md) — pre-deploy snapshot stamping
