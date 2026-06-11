# Registered types

The whitelist of resource types ConfigForge knows about for the
targeted CLI version. **Source of truth:**
[`packages/core/src/oscfg/registered-types.ts`](https://github.com/ABMFST/ConfigForge/blob/main/packages/core/src/oscfg/registered-types.ts),
including the `OSCFG_CLI_VERSION` constant currently set to
`1.3.9-preview11`. This page is a documentation copy of that source;
if it disagrees with the source file, the source file wins. The
`resources/oscfg/` tree is only a dev convenience drop for optional
local binaries and does not contain a canonical type catalog.

Note: since v0.2.0 the binary is **not bundled** - "targeted CLI"
means the version the whitelist in source was last probed against,
not what the user happens to have installed. The runtime resolver
discovers whatever `oscfg` is on the host (see the
[`oscfg` CLI contract](../architecture/oscfg-cli.md) for discovery
order).

## Registered on Windows (code whitelist for `OSCFG_CLI_VERSION`)

| Type | Notes |
| --- | --- |
| `Microsoft.Windows/CSP` | Configuration Service Provider - the OMA-DM-style policy surface. |
| `Microsoft.Windows/Registry` | Registry value - `keyPath` + `valueName` + `valueType` (use `Dword` / `String` / … or the legacy `REG_*` names) + `value`. All three of `keyPath`, `valueName`, `valueType` are schema-required. |
| `Microsoft.Windows/AccountPolicy` | Password / lockout policies. |
| `Microsoft.Windows/AuditPolicy` | Audit subcategories. |
| `Microsoft.Windows/UserRightsAssignment` | `Se*Privilege` / `Se*Right` user rights. |
| `Microsoft.OSConfig/Test` | Compliance assertion wrapper. |
| `Microsoft.OSConfig/Group` | Cross-platform group wrapper. |
| `Microsoft.OSConfig/File` | File content management. |
| `Microsoft.OSConfig/FileLine` | Single-line file edits. |
| `Microsoft.OSConfig/DeviceInfo` | Read-only device info. |
| `Microsoft.OSConfig/Firmware` | Read-only firmware info. |

## Registered on Linux (code whitelist for `OSCFG_CLI_VERSION`)

| Type | Notes |
| --- | --- |
| `Microsoft.OSConfig/File` | Cross-platform. |
| `Microsoft.OSConfig/FileLine` | Cross-platform. |
| `Microsoft.OSConfig/Test` | Cross-platform - same wrapper as Windows. |
| `Microsoft.OSConfig/Group` | Cross-platform group wrapper. |
| `Microsoft.OSConfig/DeviceInfo` | Read-only. |
| `Microsoft.OSConfig/Firmware` | Read-only. |
| `Linux/FilePermission` | POSIX file mode + ownership. |
| `Linux/KernelModule` | Kernel module load state. |
| `Linux/User` | Local user account state. |

> The Linux side is **untested end-to-end** in CI. The whitelist
> reflects the CLI's registered types; live deploy/audit on a Linux
> host is community-validated rather than CI-gated.

## "Aspirational" - what that meant

Earlier versions of `oscfg` returned `Unsupported resource type` for
`Microsoft.Windows/AccountPolicy`, `AuditPolicy`, and
`UserRightsAssignment`. Manifests using them registered with a soft
warning but the CLI couldn't apply them. Those types **landed in
preview11** and are now fully supported.

If you encounter a baseline that still produces `Unsupported resource
type`, it means the type is not supported by your installed CLI or is
missing from ConfigForge's host-platform whitelist - the manifest still
registers but the soft warning surfaces in the response's `warnings[]`
field, and unaffected resources still apply.

## How the whitelist is used

| Caller | What it does with the whitelist |
| --- | --- |
| `registerManifest()` (`packages/core/src/handlers/manifests.ts`) | Walks the manifest's resource types. Anything not in `REGISTERED_{WINDOWS,LINUX}_TYPES` produces a soft warning **only when the manifest targets this host's platform** (so a Linux manifest registered on Windows doesn't spam Windows-only-type false positives). |
| `detectManifestPlatform()` (`packages/core/src/platform.ts`) | Looks up each type's platform tag (`Microsoft.Windows/*` → windows, `Linux/*` → linux). `'mixed'` falls out of seeing both Windows and Linux tags. |
| Editor form (`apps/desktop/src/components/resource-picker.tsx`) | Renders inputs based on per-type property hints. |
| CIS cross-reference (`packages/core/src/cis/`) | Filters which CIS rules can match against which types (only when CIS data is available locally - see the [glossary](./glossary.md#cis)). |

## Updating the whitelist

When upstream adds a new type:

1. Probe the CLI: `scripts/discovery.ps1` or
   `scripts/probe-types.ps1` against the new CLI build.
2. Add the type to `REGISTERED_WINDOWS_TYPES` /
   `REGISTERED_LINUX_TYPES` in
   `packages/core/src/oscfg/registered-types.ts`.
3. Bump `OSCFG_CLI_VERSION` to match the targeted CLI.
4. Update tests in
   `packages/core/src/oscfg/registered-types.test.ts`.
5. Add a one-liner to the [changelog](../changelog.md).

See [Adding an oscfg type](../contributing/adding-oscfg-types.md)
for the full checklist.

## See also

- [Reference → Manifest schema](./manifest-schema.md)
- [Architecture → `oscfg` CLI contract](../architecture/oscfg-cli.md)
