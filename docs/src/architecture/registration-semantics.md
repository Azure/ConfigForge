# Registration semantics

ConfigForge separates **register** from **deploy/audit**:

- **Register** validates and stores OSConfig manifest YAML. It does not contact the OSConfig CLI and does not mutate the device.
- **Deploy/audit** are the CLI-backed operations. They shell out to the upstream Microsoft `oscfg` tool through `packages/core/src/oscfg/`.

## IPC channels and handlers

Channels are registered in `apps/desktop/electron/ipc-handlers.ts`. Mutating/privileged channels are guarded by validators in `apps/desktop/electron/ipc-validators.ts` before they call core handlers.

| Channel (`cfs:*`) | Core handler | Main gates | Side effect |
| --- | --- | --- | --- |
| `cfs:manifests:register` | `registerManifest` | IPC type/length checks; manifest schema errors are hard failures. | Writes `<ns>.source.yaml` and `<ns>.json`; creates a best-effort history snapshot. Never calls `oscfg apply`. |
| `cfs:manifests:list` | `listManifests` | Optional typed `{ live, includeResources, lite }` payload. | Reads registrations; when `live: true`, unions CLI-visible namespaces. |
| `cfs:manifests:status` | `getManifestStatus` | Name payload validation. | Returns registered/CLI-visible status; registered-but-never-deployed is a soft `deployed: false` state. |
| `cfs:manifests:delete` | `deleteManifest` | Name validation. | Best-effort CLI namespace deletion, then removes registration, rationale, audit-result cache, and history. |
| `cfs:deploy:run` (`mode: 'audit'`) | `runDeploy` | CLI present; registered source exists; platform must match host or be cross-platform; `mixed` is rejected. | Runs `oscfg get resource` and per-resource `oscfg exec resource` fallback; stamps `lastAuditedAt`; writes audit result best-effort. |
| `cfs:deploy:run` (`mode: 'enforce'`) | `runDeploy` | CLI present; admin/root pre-check; registered source exists; platform must match host or be cross-platform; `mixed` is rejected. | Writes pre-deploy snapshot, writes deploy-in-progress sentinel, runs `oscfg apply`, audits, stamps `lastAppliedAt`/`lastAuditedAt`. |
| `cfs:revert:apply` | `revertManifest` | Name validation; snapshot YAML is revalidated before apply; CLI-missing errors are translated to `CLI_REQUIRED` where detected. | Re-applies `<ns>.pre-deploy.json` YAML, or deletes the namespace if no usable snapshot exists. |

## Hard blocks at register time (status 400)

- Top-level YAML doesn't parse.
- Top-level isn't an object (e.g. it's a string or array).
- `resources:` is missing or isn't an array.
- A resource in `resources:` is missing `name` or `type`.
- A `Microsoft.OSConfig/Group` has no nested array.
- A `Microsoft.OSConfig/Test` has no `resource:` block.
- A nested structure exceeds the recursion or numeric guards.

## Soft warnings at register time

The manifest is **registered** (status 200) and the `warnings[]`
array on the response is populated. The UI surfaces these as yellow
chips next to the manifest name.

| Trigger | Behavior |
| --- | --- |
| Namespace collision after sanitization | Warns that the new display name maps to an existing namespace unless `force: true` is supplied. |
| Manifest mixes Windows and Linux resource types | Warns at register; deploy/audit reject until split into per-platform manifests. |
| Manifest platform differs from host platform | Warns at register; deploy/audit must run on a matching host. |
| Manifest targets this host but contains types outside the targeted CLI allowlist | Warns that deploy may fail until the installed/upstream CLI supports those types. |

## Deploy/audit gates

`runDeploy()` performs CLI and platform checks before it starts device work:

1. `resolveOscfgBinary()` must find the upstream OSConfig CLI. If not, `cliRequiredError()` returns status `412` and code `CLI_REQUIRED`.
2. The registered source YAML must be readable from the registration store.
3. `detectManifestPlatform()` must match the host platform or return `cross-platform`; `mixed` is rejected.
4. Enforce mode additionally checks admin/root before `oscfg apply`.

On Windows, the current upstream CLI still requires Administrator privileges for read operations too. Health status exposes `adminBlocked`, and CLI errors are translated into actionable messages where possible.

## Fast-path list enrichment

`cfs:manifests:list` (→ `listManifests`) unions:

1. `oscfg get namespace`: CLI-visible namespaces (only when called
   with `{ live: true }`).
2. `listRegistrations()`: disk state under `~/.configforge/manifests/`.

For every registered namespace the handler uses the cached
`resourceSummary` from the JSON, **zero CLI spawns** on the hot
list path. Only namespaces visible to the CLI but *not* registered
(deployed by something else, or before this refactor) fall through
to a CLI fetch.

The handler keeps two TTL-bucketed caches (disk-only vs. CLI-union),
a 60-second TTL, and in-flight dedup keyed by a `cacheGeneration`
counter so a concurrent register/delete invalidates the in-flight
promise rather than overwriting the cache with stale data.

## Atomic writes

Registration metadata writes are serialized per namespace in `packages/core/src/oscfg/registry.ts`. `saveRegistration()` writes temp sibling files and renames them into place, with JSON as the commit marker.

Version-history snapshots in `packages/core/src/history/index.ts` also use temp-file + rename writes for snapshot YAML and metadata sidecars.

Pre-deploy snapshots are written before enforce-mode `oscfg apply` so revert has the prior YAML if deploy mutates the device. They are serialized by the deploy lock, but the current latest-pointer write uses direct `writeFile()` in `handlers/deploy.ts`.

## See also

- [Mixed-platform classification](./mixed-platform.md)
- [`oscfg` CLI contract](./oscfg-cli.md)
- [API Reference → `manifests` channel](../api-reference/manifests.md)
