# `cfs.deploy.*` and `cfs.health.*`

> **Phase 10 transport note.** Both surfaces were `/api/deploy` and
> `/api/health` in the Next.js era. The same pure handlers now back the
> IPC channels below. Contract shape preserved; only the transport
> changed.

Deploy is the only handler that touches the live OS. Health is the
read-only probe. Both are flavor-conditional in the renderer (omitted
on the macOS author build per CF-SEC-015 - use `safeCfs('deploy')` /
`safeCfs('health')` instead of bare `cfs.deploy` / `cfs.health` for
cross-flavor code).

## `cfs.deploy.run(req, onProgress?)` - channel `cfs:deploy:run`

Run `oscfg apply` (`mode: 'enforce'`) or read live device state
(`mode: 'audit'`). Both modes verify host platform = manifest platform
before invoking the CLI; mixed-platform manifests are always rejected.

```ts
type DeployRequest = {
  name: string;
  mode?: 'audit' | 'enforce';    // default 'enforce'
  platform?: string;             // informational; server re-validates
  scenarioName?: string;         // legacy; accepted-but-ignored
  jobId?: string;                // correlation id; required for cancel
};

type DeployProgressEvent = {
  phase: 'validate' | 'apply' | 'audit' | 'snapshot' | 'finalize';
  phaseIndex: number;
  phaseCount: number;
  message: string;
  resourcesCompleted?: number;   // audit phase only
  resourcesTotal?: number;
  cancellable: boolean;
  cancelRequested: boolean;
};
```

### Preflight gate - CLI required (v0.2.0)

`runDeploy` calls `resolveOscfgBinary()` **before** the deploy state
machine. If the CLI isn't installed it throws `cliRequiredError(...)` -
`HandlerError(412)` with `code: 'CLI_REQUIRED'`. The IPC envelope
preserves the code; the renderer's `useCliPresence()` +
`<CliRequiredModal />` branch on it. See
[`AGENTS.md` - bring-your-own-CLI contract](https://github.com/Azure/ConfigForge/blob/main/AGENTS.md#v020-bring-your-own-cli-contract).

### Cancellation contract

Pass `jobId` and call `cfs.deploy.cancel(jobId)` to abort. Honored at
safe boundaries only:

| Mode | When `cancel()` lands… |
| --- | --- |
| `audit` | Any safe boundary aborts with `cancelled: true`. |
| `enforce` (pre-apply) | Aborts; nothing applied. |
| `enforce` (post-apply) | `cancelRequested: true` recorded, deploy completes (commit + audit + snapshot) to keep device + on-disk consistent. Audit phase stops scheduling new spawns; partial results aggregated and `AuditIncomplete: true`. |

### Response shape (success)

```ts
type DeployResponse = {
  message: string;
  warning?: string;
  cancelRequested: boolean;
  cancelled: boolean;
  data: {
    Name: string;
    Deployed: boolean;
    DeployError?: string | null;
    Hostname: string;
    Timestamp: string;
    TotalResources: number;
    Compliant: number;
    NonCompliant: number;
    Indeterminate: number;
    Errors: number;
    Resources: { name: string; type: string; status: string; reason: string }[];
    DeployMethod: 'Manifest';
    DeployMode: 'audit' | 'enforce';
    AuditIncomplete: boolean;
    AuditRetries: number;
    FallbackUsed?: number;
  };
};
```

### Pre-deploy snapshots (v0.3.1+)

Before `applyManifest` in enforce mode, `runDeploy` writes a dual snapshot:

- **`<ns>.pre-deploy.json`** - the canonical latest pointer (backward-compatible with `revert.ts`).
- **`<ns>.pre-deploy-<ISO>.json`** - a timestamped backup. Retention is configurable (default 5, env override `CFS_PRE_DEPLOY_SNAPSHOT_RETENTION`).

Old single-snapshot users continue to revert exactly the same way; they now keep a deeper trail.

### Deploy sentinel (v0.3.1+)

Before `applyManifest` in enforce mode, deploy writes a `<ns>.deploy-in-progress` sentinel under the snapshots directory. The sentinel is cleared on success or explicit failure. On app restart, the renderer probes `cfs.deployRecovery.listInterrupted()` and shows a persistent dashboard banner with Audit / Revert CTAs when an orphaned sentinel is found.

Casing is `PascalCase` for back-compat. `AuditRetries` + `FallbackUsed`
surface the bounded-worker retry stats.

### Errors

| Status | When |
| --- | --- |
| 400 | Missing `name`, mixed-platform manifest, host platform != manifest platform, schema invalid. |
| 403 | Admin required on Windows (`adminBlocked`). |
| 404 | Manifest not registered, or no source YAML on disk. |
| 412 (`CLI_REQUIRED`) | CLI not installed - preflight gate. Open install modal. |
| 499 | Pre-apply cancellation. |

Post-apply failures surface via the envelope as `Deployed: false` +
`DeployError` + a `warning` rather than throwing.

## `cfs.deploy.cancel(jobId)` - channel `cfs:deploy:cancel`

```ts
const cancelled: boolean = await cfs.deploy.cancel(jobId);
// true -> controller found, abort signal sent; false -> already settled.
```

## `cfs.health.check()` - channel `cfs:health:check`

Liveness + binary discovery. No side effects. 60s in-process cache.

```ts
type HealthStatus = {
  status: 'healthy' | 'degraded' | 'error';
  installed: boolean;
  version: string;
  binaryPath: string;
  binarySource: string;            // 'env' | 'bundled' | 'installed' | 'msix' | 'path'
  platform: string;                // raw process.platform
  isAdmin: boolean;
  serverType: string;
  osVersion: string;
  requiresAdminForAllOps: boolean;
  adminBlocked: boolean;
  adminMessage: string;
  versionMismatch?: boolean;
  expectedVersion?: string;        // minimum supported version, e.g. "1.3.9"
  error?: string;                  // only when status === 'error'
};
```

| Field | Notes |
| --- | --- |
| `status` | `"healthy"` when the binary resolves, meets the minimum version, and admin is available on Windows; `"degraded"` otherwise; `"error"` on probe failure. |
| `binarySource` | `'env'` (`$OSCFG_BIN` override - **not** `OSCFG_BINARY`), `'bundled'` (`resources/oscfg/<plat>/` - dev only, never shipped), `'installed'` (well-known install path), `'msix'` (winget MSIX alias), `'path'` (`$PATH`). |
| `requiresAdminForAllOps` | `true` on Windows - the preview CLI initializes a log file in a protected dir on every spawn. |
| `adminBlocked` | `true` on Windows without admin. Drives `<HealthIndicator />` + `<CliRequiredModal />`. |
| `versionMismatch` | `true` only when the resolved numeric version is below the minimum supported version. Newer patch, minor, major, and preview builds are accepted. |
| `expectedVersion` | The minimum supported version from `OSCFG_MINIMUM_VERSION` in `packages/core/src/oscfg/registered-types.ts`. |

## `cfs.health.recheck()` - channel `cfs:health:recheck`

> **Added in v0.2.0.** Clears the 60s cache and reprobes. Same response
> shape as `check()`. Pairs with `<CliRequiredModal />` so the user
> doesn't need to restart the app after installing OSConfig. Wired
> through `useCliPresence().recheck()`.

## `cfs.settings.get()` / `cfs.settings.set(patch)` - channels `cfs:settings:get` / `cfs:settings:set`

> **Added in v0.3.1.** A userData-side settings store (`<userData>/settings.json`) with atomic write and 1-second read cache.

```ts
type SettingsSchema = {
  historyRetention: number;              // 5-1000, default 20
  preDeploySnapshotRetention: number;    // 1-50, default 5
  auditPackPiiWarningDismissed: boolean;
};
```

`cfs.settings.get()` returns the full settings object. `cfs.settings.set(patch)` merges the patch into the store. Env vars `CONFIGFORGE_HISTORY_MAX_RETENTION` and `CFS_PRE_DEPLOY_SNAPSHOT_RETENTION` win as power-user overrides. The older `CONFIGFORGE_HISTORY_MAX_COUNT` path is still honored by the history store fallback.

## See also

- [Architecture - `oscfg` CLI contract](../architecture/oscfg-cli.md)
- [Architecture - Module map](../architecture/module-map.md)
- [`AGENTS.md` - CLI contract](https://github.com/Azure/ConfigForge/blob/main/AGENTS.md#cli-contract-things-runoscfg-guarantees)
- [`apps/desktop/CI.md`](https://github.com/Azure/ConfigForge/blob/main/apps/desktop/CI.md) - release & smoke-test pipeline
- [API Reference - `cfs.manifests.*`](./manifests.md)
