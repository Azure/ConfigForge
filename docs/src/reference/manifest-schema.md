# Manifest schema

This page describes the current app-side manifest validation surfaces.
The on-disk JSON Schema at
[`apps/desktop/src/data/osc-manifest-schema.json`](https://github.com/ABMFST/ConfigForge/blob/main/apps/desktop/src/data/osc-manifest-schema.json)
drives Monaco/editor validation for the form-supported Windows resource
types. Registration also runs the core shape validator in
`packages/core/src/platform.ts`. The targeted `oscfg` version is tracked
separately in `packages/core/src/oscfg/registered-types.ts`.

## Top-level grammar

```yaml
resources:                       # REQUIRED - top-level ARRAY
  - name: <string>               # REQUIRED for top-level resources
    type: <string>               # REQUIRED, fully-qualified, slash-notation
    properties: { ... }          # optional at core shape level; per-type schemas may require it
```

> **Note:** `resources:` must be an array of objects. A bare
> object, a string, or a non-existent key all produce a status-400
> hard block at register time. `properties`, when present, must be an
> object. The editor JSON Schema requires `properties` for the known
> Windows resource definitions it models.

## Reserved property keys

The following keys are special - interpreted by the CLI rather
than passed through to the resource:

| Key | Used by | Purpose |
| --- | --- | --- |
| `expression` | `Microsoft.OSConfig/Test` | Compliance assertion expression. |
| `compliance` | `Microsoft.OSConfig/Test` | One of `equal`, `gte`, `lte`, … |
| `template` | `Microsoft.OSConfig/Test` | Optional message template. |
| `resource` | `Microsoft.OSConfig/Test` | The resource the test asserts on. |

## Resource wrappers

`Microsoft.OSConfig/Group` and `Microsoft.OSConfig/Test` are
*wrappers* - they nest other resources:

```yaml
resources:
  - name: ssh-hardening
    type: Microsoft.OSConfig/Group
    properties:
      resources:                # ← nested array
        - name: PermitRootLogin
          type: Microsoft.OSConfig/Test
          properties:
            resource:
              type: Microsoft.OSConfig/FileLine
              properties:
                path: /etc/ssh/sshd_config
                line: PermitRootLogin no
            expression: "PermitRootLogin == 'no'"
            compliance: equal
```

The core validator walks both wrappers recursively. A `'mixed'`
platform manifest is detected even when the offending type is
buried inside a wrapper.

## Registry resource

The most-used Windows resource. **All three** of `keyPath`,
`valueName`, and `valueType` are required at the schema level - see
the `required: ["keyPath","valueName","valueType"]` line in the
shipped JSON Schema's `registry` definition. The `value` shape is
constrained by `valueType` via a `oneOf`:

```yaml
resources:
  - name: NTLMOutgoingHardening
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\SYSTEM\CurrentControlSet\Control\Lsa\MSV1_0
      valueName: NtlmMinClientSec
      valueType: Dword
      value: 537395200
```

### Legal `valueType` values and matching `value` shapes

The shipped schema accepts **both** the modern OSConfig names and
the legacy `REG_*` names. The pairing rules are:

| `valueType` | `value` JSON type |
| --- | --- |
| `String`, `ExpandString`, `Binary`, `REG_SZ`, `REG_EXPAND_SZ`, `REG_BINARY` | `string` |
| `Dword`, `QWord`, `REG_DWORD`, `REG_QWORD` | `integer` |
| `MultiString`, `REG_MULTI_SZ` | `array` of `string` |

A `value` whose type doesn't match the `valueType` category will
fail the editor JSON-Schema `oneOf` constraint. The core register
validator is intentionally lighter and only enforces manifest shape.

> The CSV / security-definition import (`packages/core/src/handlers/import.ts`)
> calls `inferRegistryValueType(expectedValue)` to satisfy the
> `valueType` requirement automatically - integer-shaped strings or
> numbers become `Dword`, everything else becomes `String`. Adding
> new import sources? Re-use that helper.

## `Microsoft.OSConfig/BaselineRule` placeholder (v0.2.2+)

Emitted by the importer when the source is an Azure Policy Guest Configuration baseline catalog (a JSON with a `settingsReference[]` array). Each entry maps to one of these placeholders carrying the rule **identity** (`ruleId`, `displayName`, `severity`, `schemaType`, `originalSettingName`) without the implementation. The OSConfig agent on the target machine is the only thing that knows how to evaluate each rule by its `ruleId`.

```yaml
resources:
  - name: 1_1_1_1_Ensure_cramfs_kernel_module_is_not_available
    type: Microsoft.OSConfig/BaselineRule
    properties:
      ruleId: 2b568469-ea61-c184-66ba-db6720414ddd
      displayName: 1.1.1.1 Ensure cramfs kernel module is not available
      severity: Critical
      schemaType: string
```

This type is intentionally **not** in the editor's schema validator's `oneOf` - the validator flags it as an unknown type so users see the constraint immediately. The oscfg CLI also doesn't recognise it, so audit/deploy fails loudly. The Azure Policy export refuses any manifest containing this type (would silently report Compliant for every VM otherwise). Map each placeholder to a concrete resource type (`Microsoft.Windows/Registry`, `Microsoft.OSConfig/FileLine`, etc.) with real implementation details before deployment.

## CSP resource

```yaml
resources:
  - name: TelemetryAllowed
    type: Microsoft.Windows/CSP
    properties:
      path: ./Vendor/MSFT/Policy/Config/System/AllowTelemetry
      type: integer
      value: 0
```

`properties.path` is either a string or `{ get, set }` object pair
(see the `csp` definition in the schema). `properties.type` is one
of `string` / `integer` / `boolean` / `array`. `properties.name` is
optional.

## Audit policy resource

```yaml
resources:
  - name: AuditLogonEvents
    type: Microsoft.Windows/AuditPolicy
    properties:
      subcategory: "Logon"
      value: 3        # 0=none, 1=success, 2=failure, 3=success+failure
```

`Microsoft.Windows/AuditPolicy` is in the current registered-type
whitelist. Earlier preview builds returned `Unsupported resource type`
for it; ConfigForge surfaced that as a soft warning at register time.
If you target an older CLI version, that soft-warning path still
triggers - see [Reference → Registered types](./registered-types.md).

## Validation

Validation is split across two layers:

| Check | Where | What it does |
| --- | --- | --- |
| `validateManifestSchema()` | `packages/core/src/platform.ts` | Top-level object, required `resources` array, resource object/name/type checks, optional `properties` object check, recursive Group/Test traversal. Hard errors → status 400. |
| `detectManifestPlatform()` | `packages/core/src/platform.ts` | Classifies into `windows` / `linux` / `cross-platform` / `mixed`. |
| `hasMixedPlatformResources()` | `packages/core/src/platform.ts` | Independent mixed-platform detector (catches mixes buried in wrappers). |
| `isRegisteredType(t, platform)` | `packages/core/src/oscfg/registered-types.ts` | Whitelist lookup. Types missing from the whitelist soft-warn at register time when the manifest targets this host. |
| Editor inline validator | `apps/desktop/src/components/manifest-editor.tsx` | The tighter Monaco-side validator: enforces e.g. `keyPath` + `valueName` + `valueType` on Registry resources for early UX feedback. |
| Editor JSON-Schema validator | Monaco JSON language service against `apps/desktop/src/data/osc-manifest-schema.json` | The structural pass for schema-modeled resources. |

## Verified bounds

The code currently exposes these verified app-side bounds:

| Bound | Default |
| --- | --- |
| Max Group/Test traversal depth in core validation | 50 |
| Max IPC manifest/import content payload | 10 MB (`MAX_MANIFEST_CONTENT_LEN` / `MAX_IMPORT_BYTES`, CF-SEC-003) |

No separate max-resource-count or per-field string bound is documented
here because the current core validator does not expose one.

## See also

- [Reference → Registered types](./registered-types.md)
- [Architecture → Mixed-platform classification](../architecture/mixed-platform.md)
- [Quick Start → Your first manifest](../quick-start/first-manifest.md)
