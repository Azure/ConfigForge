# `cfs.manifests.*` - manifest CRUD

> **Phase 10 transport note.** Was `/api/manifests/*` in Phase 1–9. The
> same pure handlers in `packages/core/src/handlers/manifests.ts` now
> back the IPC channels below. Request/response **shapes preserved** -
> only the transport changed (HTTP → IPC). Renderer code calls
> `window.cfs.manifests.*` via `apps/desktop/electron/preload.ts`.

Authoring goes here. Deployment is separate
([`cfs.deploy.*`](./deploy-health.md)). Registration is schema-only and
never spawns the CLI - see
[Architecture → Registration semantics](../architecture/registration-semantics.md).

## Complete IPC surface

This table is the current renderer preload surface from
`apps/desktop/electron/preload.ts`. The macOS author build omits the
flavor-conditional namespaces called out in `apps/desktop/src/lib/flavor.ts`.
Legacy scenario and drift methods still exist only as compatibility stubs and
always return a not-supported `501` envelope.

| Namespace | Method or event | IPC channel | Purpose |
| --- | --- | --- | --- |
| `cfs.activity` | `recent()` | `cfs:activity:recent` | Read the recent activity feed. |
| `cfs.auditPack` | `get(req)` | `cfs:audit-pack:get` | Build an audit-pack artifact in memory. |
| `cfs.auditPack` | `save(req)` | `cfs:audit-pack:save` | Save an audit-pack artifact through a native dialog. |
| `cfs.auditResults` | `get(id)` | `cfs:audit-results:get` | Read the last cached device-audit result. |
| `cfs.baselineCsv` | `fetch(req)` | `cfs:baseline-csv:fetch` | Fetch and parse a baseline CSV source. |
| `cfs.cis` | `status()` | `cfs:cis:status` | Report CIS catalog availability and diagnostics. |
| `cfs.cis` | `lookup(req)` | `cfs:cis:lookup` | Look up one resource against CIS data. |
| `cfs.cis` | `revealDataDir()` | `cfs:cis:reveal-data-dir` | Open the runtime CIS data directory. |
| `cfs.cis` | `recheck()` | `cfs:cis:recheck` | Clear CIS caches and re-read data. |
| `cfs.cis` | `warmup()` | `cfs:cis:warmup` | Pre-parse discovered CIS catalogs. |
| `cfs.cis` | `bulkLookup(namespace, benchmarkFilename?)` | `cfs:cis:bulk-lookup` | Score one manifest against a CIS benchmark. |
| `cfs.compliance` | `report(req)` | `cfs:compliance:report` | Build a CIS compliance report. |
| `cfs.deploy` | `run(req, onProgress?)` | `cfs:deploy:run` and `cfs:deploy:progress` | Run deploy or audit with progress events. |
| `cfs.deploy` | `cancel(jobId)` | `cfs:deploy:cancel` | Request cancellation for a running deploy job. |
| `cfs.deployRecovery` | `listInterrupted()` | `cfs:deploy:list-interrupted` | List orphaned deploy sentinels. |
| `cfs.deployRecovery` | `dismiss(namespace)` | `cfs:deploy:dismiss-interrupted` | Dismiss an interrupted-deploy sentinel. |
| `cfs.diff` | `matrix(names)` | `cfs:diff:matrix` | Build the N-way manifest matrix. |
| `cfs.diff` | `matrixXlsxSave(names)` | `cfs:diff:matrix-xlsx:save` | Save the matrix as an XLSX workbook. |
| `cfs.docs` | `get(name)` | `cfs:docs:get` | Read generated docs for a manifest. |
| `cfs.docs` | `generate(req)` | `cfs:docs:generate` | Generate docs from manifest content. |
| `cfs.drift` | `list()` | `cfs:drift:list` | Retired compatibility stub; always returns 501 not supported. |
| `cfs.exportChannel` | `get(req)` | `cfs:export:get` | Return an export artifact. |
| `cfs.exportChannel` | `save(req)` | `cfs:export:save` | Save an export artifact through a native dialog. |
| `cfs.health` | `check()` | `cfs:health:check` | Probe OSConfig CLI health from cache. |
| `cfs.health` | `recheck()` | `cfs:health:recheck` | Clear health cache and reprobe. |
| `cfs.history` | `list(req)` | `cfs:history:list` | List snapshots or read one snapshot. |
| `cfs.history` | `save(req)` | `cfs:history:save` | Save a manual history snapshot. |
| `cfs.history` | `delete(req)` | `cfs:history:delete` | Delete a history snapshot. |
| `cfs.importChannel` | `openAndParse()` | `cfs:import:openAndParse` | Open a file picker, read the file, and parse it. |
| `cfs.importChannel` | `fromContent(req)` | `cfs:import:fromContent` | Parse renderer-supplied text or bytes. |
| `cfs.library` | `list()` | `cfs:library:list` | List bundled baseline library entries. |
| `cfs.library` | `get(req)` | `cfs:library:get` | Read one library entry. |
| `cfs.manifests` | `list(opts?)` | `cfs:manifests:list` | List registered and optionally live manifests. |
| `cfs.manifests` | `get(name, opts?)` | `cfs:manifests:get` | Read one manifest summary. |
| `cfs.manifests` | `getSource(name)` | `cfs:manifests:source` | Read registered source YAML. |
| `cfs.manifests` | `fetchUri(uri)` | `cfs:manifests:fetch-uri` | Fetch remote manifest text without registration. |
| `cfs.manifests` | `register(req)` | `cfs:manifests:register` | Register source YAML and metadata. |
| `cfs.manifests` | `restore(req)` | `cfs:manifests:restore` | Restore a just-deleted registration from recovery data. |
| `cfs.manifests` | `delete(name, options?)` | `cfs:manifests:delete` | Delete a registration and return recovery metadata. |
| `cfs.manifests` | `status(name)` | `cfs:manifests:status` | Probe deployed state for one manifest. |
| `cfs.platform` | `info()` | `cfs:platform:info` | Read host platform and theme snapshot. |
| `cfs.platform` | `onThemeChanged(cb)` | `cfs:platform:theme-changed` | Subscribe to OS theme changes. |
| `cfs.rationale` | `list(id)` | `cfs:rationale:list` | Read rationale entries for a manifest. |
| `cfs.rationale` | `append(req)` | `cfs:rationale:append` | Append a rationale entry. |
| `cfs.revert` | `apply(req)` | `cfs:revert:apply` | Revert a deployed namespace. |
| `cfs.scenarios` | `list()` | `cfs:scenarios:list` | Retired compatibility stub; always returns 501 not supported. |
| `cfs.settings` | `get()` | `cfs:settings:get` | Read user settings. |
| `cfs.settings` | `set(patch)` | `cfs:settings:set` | Merge and persist user settings. |
| `cfs.shell` | `openExternal(url)` | `cfs:shell:open-external` | Open an HTTP or HTTPS URL in the default browser. |
| `cfs.system` | `isElevated()` | `cfs:system:is-elevated` | Check current process elevation. |
| `cfs.system` | `elevate()` | `cfs:system:elevate` | Relaunch with OS elevation when supported. |
| `cfs.systemConfig` | `summary()` | `cfs:system-config:summary` | Summarize host system configuration. |
| `cfs.systemConfig` | `forManifest(name)` | `cfs:system-config:get` | Read host configuration for one manifest. |
| `cfs.update` | `getStatus()` | `cfs:update:get-status` | Read the current auto-update status. |
| `cfs.update` | `onStatus(cb)` | `cfs:update:status` | Subscribe to auto-update status events. |
| `cfs.update` | `check()` | `cfs:update:check` | Manually check for updates. |
| `cfs.update` | `download()` | `cfs:update:download` | Start update download. |
| `cfs.update` | `quitAndInstall()` | `cfs:update:quit-and-install` | Quit and install a downloaded update. |

## `cfs.manifests.list(opts?)` - channel `cfs:manifests:list`

List all manifests. Disk-only on the hot path: enriches each registered
namespace from `~/.configforge/manifests/<ns>.json` without spawning the
CLI. Pass `{ live: true }` to also union in CLI-visible namespaces; those
entries fall through to `oscfg get namespace`.

Two in-process caches (disk-only vs. live-union), 60s TTL, in-flight
dedup via a generation token. Any `register`/`delete` invalidates both.

```ts
type ListManifestsOptions = {
  live?: boolean;
  includeResources?: boolean; // default true
  lite?: boolean;             // explicit opt-in to drop Resources[]
  force?: boolean;            // bypass list caches for explicit refresh
};

type ManifestSummary = {
  Name: string;
  DisplayName: string;
  Source: 'oscfg' | 'library';
  RegistrationSource: 'user' | 'library' | 'import' | null;
  RegistrationSourceId: string | null;
  Deployed: boolean;
  LastAppliedAt: string | null;
  LastAuditedAt: string | null;
  Revision: string | null;
  Platform: string | null;
  ResourceCount: number;
  Validation: {
    hasSchema: boolean;
    hasEnforcementValues: boolean;
    hasComplianceCriteria: boolean;
    issues: string[];
  } | null;
  Compliance: {
    auditedAt: string;
    total: number;
    compliant: number;
    nonCompliant: number;
    indeterminate: number;
    errors: number;
  } | null;
  RegisteredAt: string | null;
  LastModifiedAt: string | null;
  Resources?: { name: string; type: string }[]; // omitted when lite=true
};

const { data } = await cfs.manifests.list();
// or
const { data } = await cfs.manifests.list({ live: true, lite: true });
```

Field casing is intentionally `PascalCase` for back-compat with the
PowerShell-edition UI. `Source` is `"oscfg"` (locally-authored) or
`"library"` (catalog-sourced). `Resources` is `[]` for CLI-only
namespaces; the detail page fetches them via `cfs.manifests.get(name)`.

## `cfs.manifests.get(name, opts?)` - channel `cfs:manifests:get`

Single-manifest read (perf W2 / C5). Returns `{ data: null }` (does
**not** throw) for unknown namespaces.

```ts
const { data, warning } = await cfs.manifests.get('ws2025-baseline');
// data: ManifestSummary | null
// warning?: string - surfaces e.g. "Registered source YAML missing on disk"
```

## `cfs.manifests.getSource(name)` - channel `cfs:manifests:source`

Return the registered source YAML exactly as stored on disk, or
`{ data: null }` when the namespace is not registered. This is distinct
from `status`, which reads/reconstructs live state from `oscfg`.

```ts
const { data } = await cfs.manifests.getSource('ws2025-baseline');
// data: string | null
```

## `cfs.manifests.fetchUri(uri)` - channel `cfs:manifests:fetch-uri`

Fetch remote YAML for preview/edit without registering it. The same URL
validation and 10 MB / 30 s fetch limits used by `register({ uri })`
apply; the response is `{ content: string }`.

## `cfs.manifests.restore(req)` - channel `cfs:manifests:restore`

Restore a just-deleted registration from captured recovery data without
overwriting an existing namespace. The restore path validates the YAML
content and writes only the registration metadata and source YAML; it does
not reconstruct deployment pointers, history, rationale, or audit records.

```ts
type RestoreManifestRequest = {
  namespace: string;
  displayName: string;
  content: string;
  source: 'user' | 'library' | 'import';
  sourceId?: string;
};

type RestoreManifestResult = {
  message: string;
  data: {
    namespace: string;
    platform: 'windows' | 'linux' | 'mixed' | 'cross-platform' | 'unknown';
  };
};
```

Errors: `400` for invalid request, content, or schema; `409` when the
namespace is already registered.

## `cfs.manifests.register(req)` - channel `cfs:manifests:register`

Register a new manifest. Schema validation only - never calls
`oscfg apply`. Best-effort auto-snapshot to `~/.configforge/history/<ns>/`
runs in the background (failures logged, not surfaced).

```ts
type RegisterManifestRequest = {
  name: string;                              // display name - sanitized to namespace
  content?: string;                          // YAML or JSON; content or uri is required. Non-empty content wins over uri; an empty content string falls back to uri.
  uri?: string;                              // http/https URL (10 MB cap, 30 s timeout)
  // path is a rejected legacy field; use importChannel or content instead.
  source?: 'user' | 'library' | 'import';    // default 'user'
  sourceId?: string;
  rationale?: string;                        // persisted on snapshot .meta sidecar
  changeSummary?: string;                    // v0.3.47; max 200 chars at IPC boundary
  force?: boolean;                           // override namespace-collision guard
  author?: string;                           // test affordance - server resolves via resolveAuthor()
};

type RegisterManifestResult = {
  message: string;
  data: { namespace: string; platform: 'windows' | 'linux' | 'mixed' | 'cross-platform' | 'unknown' };
  warnings: string[];
};
```

`changeSummary` is the short diff-derived label shown in History instead
of the generic "Manifest registered" message. The renderer computes it
from the save diff; IPC validation caps it at 200 characters.

Hard 400 via `HandlerError` / IPC validation:

- Missing `name`, or `sanitizeNamespace(name)` empty.
- Both `content` and `uri` absent or empty (whitespace-only counts as empty).
- Legacy `path` is rejected by `validateRegisterManifestRequest()` and by the core handler; use `importChannel` or pass already-read YAML via `content`.
- Remote `uri` > 10 MB → `HandlerError(413)`.
- Unsupported URI scheme (only `http:` / `https:`).
- Content fails YAML/JSON parse or `validateManifestSchema`.

Soft warnings (registration succeeds, populated in `warnings[]`):

- Manifest targets a different platform than the host.
- Mixed Windows + Linux resource types.
- Resource types not in the host-platform registered-type whitelist.
- Namespace collision: a different display name already maps to the same sanitized namespace (#20). The renderer can pass `force: true` to override.

> Cross-platform authoring is supported. Deploy/audit are the gates
> that enforce platform match.
>
> On macOS, platform-mismatch warnings are suppressed in the UI because the macOS author build has no deploy capability.

## `cfs.manifests.delete(name)` - channel `cfs:manifests:delete`

Remove a registration. Best-effort CLI cleanup (`oscfg delete namespace`)
runs in parallel; failures don't block. Also cleans the per-manifest
rationale log and the cached audit-results JSON (v0.1.6).

```ts
type DeleteManifestResult = {
  message: string;
  data: {
    namespace: string;
    cliRemoved: boolean;        // false for registered-but-never-deployed - expected, not a failure
    cliError: string | null;
    rationaleLogRemoved: boolean;
    rationaleLogError: string | null;
    recovery: RegistrationRecoveryBackup | null;
  };
};
```

## `cfs.manifests.status(name)` - channel `cfs:manifests:status`

Per-manifest deployed-state probe (read-only). 5s cache + in-flight
dedup. Returns a soft stub when the manifest is registered but never
deployed, instead of an error.

```ts
// Deployed namespace
{
  data: '# Reported system configuration for: ws2025-baseline\n...',
  name: 'ws2025-baseline',
  resources: [/* live resources from oscfg get resource */],
  deployed: true,
}

// Registered but never deployed (soft stub, not an error)
{
  data: '# ws2025-baseline is registered but not yet deployed on this host.\n...',
  name: 'ws2025-baseline',
  resources: [],
  deployed: false,
  cliError: 'Namespace not found',
}
```

## Error shape

Handlers throw `HandlerError(status, message)` (see
`packages/core/src/handlers/errors.ts`). The IPC layer wraps to
`{ ok: false, status, error, code? }`; the preload `call<T>()` helper
re-throws as a regular `Error` with `.status` (and `.code`) attached.

## See also

- [Architecture - Registration semantics](../architecture/registration-semantics.md)
- [Architecture - Module map](../architecture/module-map.md)
- [API Reference - `cfs.deploy.*` + `cfs.health.*`](./deploy-health.md)
- [`AGENTS.md` - registration semantics](https://github.com/Azure/ConfigForge/blob/main/AGENTS.md#registration-semantics)
