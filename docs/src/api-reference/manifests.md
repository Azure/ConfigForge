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
};

type ManifestSummary = {
  Name: string;
  DisplayName: string;
  Source: 'oscfg' | 'library';
  Deployed: boolean;
  LastAppliedAt: string | null;
  LastAuditedAt: string | null;
  Platform: string | null;
  ResourceCount: number;
  Validation: {
    hasSchema: boolean;
    hasEnforcementValues: boolean;
    hasComplianceCriteria: boolean;
    issues: string[];
  } | null;
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

## `cfs.manifests.register(req)` - channel `cfs:manifests:register`

Register a new manifest. Schema validation only - never calls
`oscfg apply`. Best-effort auto-snapshot to `~/.configforge/history/<ns>/`
runs in the background (failures logged, not surfaced).

```ts
type RegisterManifestRequest = {
  name: string;                              // display name - sanitized to namespace
  content?: string;                          // YAML or JSON; exactly one of content/uri required
  uri?: string;                              // http/https URL (10 MB cap, 30 s timeout)
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
