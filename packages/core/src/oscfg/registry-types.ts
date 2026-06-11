// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Normalize Windows registry value-type strings before they're sent to
 * `oscfg`'s `Microsoft.Windows/Registry` provider.
 *
 * The `oscfg` CLI uses DSC-style names (`Dword`, `String`, `MultiString`,
 * `Binary`, `QWord`, `ExpandString`, `None`). Many real-world inputs —
 * Microsoft Defender baselines, ConfigurationManager exports,
 * group-policy CSVs — use the Windows API names instead (`REG_DWORD`,
 * `REG_SZ`, `REG_MULTI_SZ`, `REG_BINARY`, `REG_QWORD`, `REG_EXPAND_SZ`,
 * `REG_NONE`). Sending those API names to oscfg fails with
 * "The parameter is incorrect. (os error 87)" — every rule silently
 * dies on enforce.
 *
 * This helper translates between the two spellings, leaving any
 * already-DSC-spelled value untouched. It also accepts and preserves
 * unknown values (returns them as-is) so the CLI can surface its own
 * error message rather than us masking it.
 *
 * @internal
 */

/** Maps Win32 REG_* names to the DSC-style names oscfg accepts. */
const REG_TO_DSC: Readonly<Record<string, string>> = {
  REG_NONE: 'None',
  REG_SZ: 'String',
  REG_EXPAND_SZ: 'ExpandString',
  REG_BINARY: 'Binary',
  REG_DWORD: 'Dword',
  REG_DWORD_LITTLE_ENDIAN: 'Dword',
  REG_DWORD_BIG_ENDIAN: 'Dword',
  REG_MULTI_SZ: 'MultiString',
  REG_QWORD: 'QWord',
  REG_QWORD_LITTLE_ENDIAN: 'QWord',
};

/**
 * Normalize a single `valueType` string. Case-insensitive on the input
 * for the REG_* spellings (some baselines emit lower-case `reg_dword`).
 * Returns the input unchanged if it's already a DSC name or doesn't
 * match a known REG_* alias.
 */
export function normalizeRegistryValueType(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const upper = input.toUpperCase();
  if (upper in REG_TO_DSC) return REG_TO_DSC[upper];
  return input;
}

/**
 * Walk a manifest object and normalize every `valueType` string found
 * under any `Microsoft.Windows/Registry` resource — including those
 * nested inside `Microsoft.OSConfig/Test` wrappers and
 * `Microsoft.OSConfig/Group` containers.
 *
 * Mutates a deep clone (does not mutate the input) and returns it.
 *
 * @internal
 */
export function normalizeManifestRegistryTypes<T>(manifest: T): T {
  if (manifest === null || typeof manifest !== 'object') return manifest;
  // Cheap deep clone: manifests are pure JSON-y data after YAML parse.
  const clone: unknown = structuredClone(manifest);
  walk(clone, 0);
  return clone as T;
}

const MAX_DEPTH = 50;

function walk(node: unknown, depth: number): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  // If this object IS a Microsoft.Windows/Registry resource, normalize
  // its `properties.valueType`.
  if (obj.type === 'Microsoft.Windows/Registry') {
    const props = (obj.properties ?? obj.Properties) as Record<string, unknown> | undefined;
    if (props && 'valueType' in props) {
      props.valueType = normalizeRegistryValueType(props.valueType);
    }
  }
  // Recurse into every value — this handles Test wrappers
  // (`properties.resource.properties.valueType`) and Group wrappers
  // (`properties.resources[].properties.valueType`) without us having
  // to enumerate the wrapper shapes. Cheap because manifests are
  // tiny relative to the registry of types we'd otherwise have to know.
  for (const v of Object.values(obj)) walk(v, depth + 1);
}

/**
 * Normalize a YAML string containing a manifest. Round-trips through
 * `yaml.load` / `yaml.dump`, which means comments and exotic YAML tags
 * are lost. That's acceptable for the apply path (oscfg only cares
 * about the value tree, not formatting), but callers that need to
 * preserve verbatim YAML should call `normalizeManifestRegistryTypes`
 * on the parsed object instead.
 *
 * Returns the original string unchanged if parsing fails — we'd rather
 * let oscfg surface its own YAML error than mask it here.
 *
 * @internal
 */
export function normalizeManifestRegistryTypesInYaml(yamlText: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('js-yaml') as typeof import('js-yaml');
  let doc: unknown;
  try {
    doc = yaml.load(yamlText);
  } catch {
    return yamlText;
  }
  // Fast path: if the text doesn't even mention REG_, skip the round-trip.
  if (!/REG_/i.test(yamlText)) return yamlText;
  const normalized = normalizeManifestRegistryTypes(doc);
  try {
    return yaml.dump(normalized, { lineWidth: -1, noRefs: true });
  } catch {
    return yamlText;
  }
}
