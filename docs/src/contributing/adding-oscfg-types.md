# Adding a new `oscfg` resource type

When the upstream CLI grows support for a new type, follow this
checklist to surface it in ConfigForge.

## 1. Probe the live CLI

Run `scripts/probe-types.ps1` from an elevated PowerShell on a
machine with the user-installed `oscfg` CLI on `PATH` (ConfigForge
no longer bundles the binary - see [INSTALL.md](https://github.com/ABMFST/ConfigForge/blob/main/INSTALL.md)).
The script walks every supported verb and captures the schema
evidence under `.probe/` (gitignored). Diff `.probe/` against the
prior run to see what's new.

## 2. Update the registered-types whitelist

Add the type to
[`packages/core/src/oscfg/registered-types.ts`](https://github.com/ABMFST/ConfigForge/blob/main/packages/core/src/oscfg/registered-types.ts).
The whitelist is two `as const` arrays - one for Windows, one for
Linux. Add the new type to the appropriate array:

```ts
export const REGISTERED_WINDOWS_TYPES = [
  'Microsoft.Windows/CSP',
  'Microsoft.Windows/Registry',
  // ... existing types ...
  'Microsoft.Windows/YourNewType',  // <- add it here
] as const;
```

Bump `OSCFG_CLI_VERSION` (also exported from this file - currently
`'1.3.9-preview11'`) to match the CLI build you probed against.

If the CLI returns `Unsupported resource type` for the new type,
**don't add it to the whitelist yet** - the soft-warning path
already handles unknown types correctly (`cfs:manifests:register`
resolves with `warnings[]` populated and the manifest still
persisted).

## 3. Update the platform classifier

If the new type is platform-specific, make sure
`detectManifestPlatform()` in
[`packages/core/src/platform.ts`](https://github.com/ABMFST/ConfigForge/blob/main/packages/core/src/platform.ts)
correctly classifies it. The classifier walks
`Microsoft.OSConfig/Group` and `Microsoft.OSConfig/Test` wrappers
recursively - your test should include both wrapped and bare cases.

## 4. Update the schema validator

Two places need to agree on the new type's `properties` shape:

1. **Handler-side validator.** `validateManifestSchema()` in
   `packages/core/src/platform.ts` (and any per-type validators it
   delegates to) must accept the new shape.
2. **Renderer-side JSON schema.**
   [`apps/desktop/src/data/osc-manifest-schema.json`](https://github.com/ABMFST/ConfigForge/blob/main/apps/desktop/src/data/osc-manifest-schema.json)
   is loaded by Monaco's JSON-mode validator so the editor
   surfaces inline errors as the user types. Add a `oneOf` /
   `properties` entry for the new type so the editor matches the
   handler.

The `Microsoft.Windows/Registry` entry is the reference example -
it ties `valueType` to the allowed shape of `value` via `oneOf`.

## 5. Add tests

A registered-types test asserting the type is in the whitelist:

```ts
it('whitelists Microsoft.Windows/YourNewType', () => {
  expect(isRegisteredType('Microsoft.Windows/YourNewType', 'win32')).toBe(true);
});
```

A schema test with a minimal manifest using the new type:

```ts
it('accepts a manifest with the new type', () => {
  const yaml = `resources:\n  - name: x\n    type: Microsoft.Windows/AccountPolicy\n    properties:\n      ...`;
  const result = validateManifestSchema(yaml);
  expect(result.errors).toEqual([]);
});
```

A platform classifier test:

```ts
it('classifies AccountPolicy as windows', () => {
  expect(detectManifestPlatform(parseYaml(yaml))).toBe('windows');
});
```

## 6. Update the Visual row template (optional)

Inline editing works automatically for any existing resource. To offer the
type in **Add setting**, add a `VisualResourceTemplate` entry to
`apps/desktop/src/pages/ManifestEditor/visual-viewer.ts` with safe initial
property values and a platform tag. Add pure-helper and component coverage
for typed values. Complex container/wrapper types such as Group and Test
should remain Code-only unless they can be represented as one safe flat row.

## 7. Update the changelog

Add a concise one-liner under the newest semver section in
`docs/src/changelog.md`. The next docs deploy will pick it up.

> **Heads-up on import paths.** The Next.js-era `src/lib/oscfg/`
> tree was deleted in Phase 10 - all CLI / type-registry logic
> now lives under `packages/core/src/oscfg/` and is consumed by
> both the Electron IPC handlers and the renderer (browser-safe
> code only). Don't recreate the old paths.

## See also

- [Architecture → `oscfg` CLI contract](../architecture/oscfg-cli.md)
- [Reference → Registered types](../reference/registered-types.md)
- [Reference → Manifest schema](../reference/manifest-schema.md)
