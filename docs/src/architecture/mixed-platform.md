# Mixed-platform classification

`detectManifestPlatform()` (in
[`packages/core/src/platform.ts`](https://github.com/ABMFST/ConfigForge/blob/main/packages/core/src/platform.ts))
classifies a manifest into one of four buckets based on the resource
types it contains. The classification drives soft warnings at
register time and hard gates at deploy time.

> **Registration is platform-agnostic.** A Linux manifest registers
> fine on a Windows host, and vice versa. Platform mismatch only
> surfaces as a `warnings[]` entry. The hard gate fires later, in
> `runDeploy` / `revertManifest`.

## Classification buckets

| Return value | Meaning | Deploy/audit from this host? |
| --- | --- | --- |
| `windows` | At least one known Windows-only type and no known Linux-only types. Current Windows-only types are `Microsoft.Windows/AccountPolicy`, `Microsoft.Windows/AuditPolicy`, `Microsoft.Windows/CSP`, `Microsoft.Windows/Registry`, and `Microsoft.Windows/UserRightsAssignment`. | Windows only. |
| `linux` | At least one known Linux-only type and no known Windows-only types. Current Linux-only types are `Linux/FilePermission`, `Linux/KernelModule`, and `Linux/User`. | Linux only. |
| `cross-platform` | No known Windows-only or Linux-only resource types. Includes neutral `Microsoft.OSConfig/*` wrappers/types such as `Test`, `Group`, `File`, and `FileLine`. | Windows or Linux, subject to CLI/admin gates. |
| `mixed` | Both known Windows-only and known Linux-only types appear in the same resource tree. | Never; split into per-platform manifests. |

Unknown types do not force a platform classification. They remain forward-compatible registration warnings when they are not in the targeted CLI allowlist.

## Recursive walk

The classifier walks nested resources inside `Microsoft.OSConfig/Group` (`properties.resources`) and `Microsoft.OSConfig/Test` (`properties.resource`). This prevents a manifest from being classified as `cross-platform` when a platform-specific resource is wrapped by a neutral OSConfig wrapper.

The same resource walk is bounded by a maximum depth guard so malformed deeply nested manifests do not overflow the stack.

## Consumer rule: branch on `'mixed'`

Every consumer that switches on the platform must have a `'mixed'`
branch:

```ts
switch (detectManifestPlatform(resources)) {
  case 'windows':         /* Windows path */ break;
  case 'linux':           /* Linux path   */ break;
  case 'cross-platform':  /* either path  */ break;
  case 'mixed':           /* refuse, surface warning */ break;
}
```

Forgetting the `'mixed'` branch is a bug. The TS compiler enforces
exhaustiveness on the discriminated union return type
(`ManifestPlatform`).

## Deploy/audit gate

`runDeploy()` rejects platform-incompatible manifests before CLI-backed work:

1. The OSConfig CLI must resolve through `resolveOscfgBinary()`.
2. The manifest platform must be `cross-platform` or match the host (`win32` → `windows`, all other supported hosts → `linux`).
3. `mixed` is always rejected.
4. Enforce mode checks Administrator/root privileges before `oscfg apply`.

Audit mode also shells out to `oscfg`; on Windows, read-only audit still requires elevation because the upstream CLI initializes protected logging.

## Mac author flavor

The `main` branch is the Windows/Linux full-build line. Renderer helper functions `safeCfs()` and `hasCfsNamespace()` exist because the sibling macOS author flavor can omit deploy/elevation/health/audit namespaces. Code that may be shared with that flavor should feature-detect those namespaces before calling them.

## See also

- [Registration semantics](./registration-semantics.md)
- [Reference → Registered types](../reference/registered-types.md)
- [`oscfg` CLI contract](./oscfg-cli.md)
