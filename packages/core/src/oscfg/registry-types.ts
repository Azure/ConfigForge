// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Normalize Windows registry properties before they're sent to `oscfg`'s
 * `Microsoft.Windows/Registry` provider.
 *
 * The current microsoft/osconfig `schema/.document.json` defines only
 * `REG_DWORD`/`REG_QWORD` in its integer enum and `REG_MULTI_SZ` in its
 * array enum. Its `docs/resources/windows/Registry.md`,
 * `examples/registry.osc.yaml`, and Microsoft Learn set/test/quickstart
 * files also use the `REG_*` spellings exclusively.
 *
 * Hardware verification across current OSConfig releases also showed that
 * the provider can return exit code 0 for a compatibility alias such as
 * `Dword` without changing the registry value. ConfigForge therefore accepts
 * known aliases only as an input compatibility feature and emits the current
 * upstream `REG_*` form before execution.
 *
 * Unknown values are preserved so the CLI can surface its own validation
 * error rather than ConfigForge masking it.
 *
 * The Registry provider also requires a colon after recognized hive
 * tokens. It can accept an apply command while leaving an uncolonized
 * keyPath unchanged, so the same apply boundary canonicalizes both
 * properties before the manifest reaches OSConfig.
 *
 * @internal
 */

import { dumpLosslessYaml, parseLosslessYaml } from '../manifest/lossless';

/** Maps accepted aliases to the canonical valueType spellings used by OSConfig. */
const REGISTRY_VALUE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  NONE: 'REG_NONE',
  REG_NONE: 'REG_NONE',
  STRING: 'REG_SZ',
  REG_SZ: 'REG_SZ',
  EXPANDSTRING: 'REG_EXPAND_SZ',
  REG_EXPAND_SZ: 'REG_EXPAND_SZ',
  BINARY: 'REG_BINARY',
  REG_BINARY: 'REG_BINARY',
  DWORD: 'REG_DWORD',
  REG_DWORD: 'REG_DWORD',
  REG_DWORD_LITTLE_ENDIAN: 'REG_DWORD',
  MULTISTRING: 'REG_MULTI_SZ',
  REG_MULTI_SZ: 'REG_MULTI_SZ',
  QWORD: 'REG_QWORD',
  REG_QWORD: 'REG_QWORD',
  REG_QWORD_LITTLE_ENDIAN: 'REG_QWORD',
};

/** Registry hive tokens accepted by the OSConfig Registry provider. */
const HIVE_PREFIXES = new Set([
  'HKEY_LOCAL_MACHINE',
  'HKEY_CURRENT_USER',
  'HKEY_USERS',
  'HKEY_CLASSES_ROOT',
  'HKEY_CURRENT_CONFIG',
  'HKLM',
  'HKCU',
  'HKU',
  'HKCR',
  'HKCC',
]);

/**
 * Return the canonical upstream `REG_*` spelling for a Registry `valueType`.
 *
 * Current canonical values remain byte-for-byte unchanged. Known compatibility
 * aliases are normalized case-insensitively. Unknown values are preserved so
 * callers can defer validation to OSConfig.
 *
 * Repository guards can compare the returned value with the source value to
 * detect legacy aliases without rewriting shipped baselines.
 */
export function canonicalizeRegistryValueType(valueType: string): string {
  return REGISTRY_VALUE_TYPE_ALIASES[valueType.toUpperCase()] ?? valueType;
}

/**
 * Normalize a single `valueType` string to the documented `REG_*` form.
 * Matching is case-insensitive because imported baselines are not always
 * consistent about casing.
 */
export function normalizeRegistryValueType(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  return canonicalizeRegistryValueType(input);
}

/**
 * Add the colon required after a recognized registry hive token.
 *
 * Hive spelling and casing are intentionally preserved. Already-canonical
 * and unknown paths are returned verbatim so this helper only changes the
 * provider syntax known to be required by OSConfig.
 *
 * Repository guards can compare the returned path with the source path to
 * detect a colon-less recognized hive without rewriting the baseline.
 */
export function normalizeRegistryKeyPath(keyPath: string): string {
  if (typeof keyPath !== 'string' || keyPath.length === 0) return keyPath;
  const firstSegmentEnd = keyPath.indexOf('\\');
  const head = firstSegmentEnd === -1 ? keyPath : keyPath.slice(0, firstSegmentEnd);
  if (head.endsWith(':') || !HIVE_PREFIXES.has(head.toUpperCase())) return keyPath;
  const rest = firstSegmentEnd === -1 ? '' : keyPath.slice(firstSegmentEnd);
  return `${head}:${rest}`;
}

/**
 * Walk a manifest object and normalize every `valueType` and `keyPath`
 * found under any `Microsoft.Windows/Registry` resource — including those
 * nested inside `Microsoft.OSConfig/Test` wrappers and
 * `Microsoft.OSConfig/Group` containers.
 *
 * Mutates a deep clone (does not mutate the input) and returns it.
 *
 * @internal
 */
export function normalizeManifestRegistryTypes<T>(manifest: T): T {
  if (manifest === null || typeof manifest !== 'object') return manifest;
  const clone: unknown = structuredClone(manifest);
  walk(clone);
  return clone as T;
}

const MAX_VISITED_NODES = 100_000;

function walk(root: unknown): boolean {
  let changed = false;
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  while (pending.length > 0 && visitedNodes < MAX_VISITED_NODES) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    visitedNodes += 1;

    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }

    const obj = node as Record<string, unknown>;
    if (obj.type === 'Microsoft.Windows/Registry') {
      const rawProperties = obj.properties ?? obj.Properties;
      if (
        rawProperties &&
        typeof rawProperties === 'object' &&
        !Array.isArray(rawProperties)
      ) {
        const props = rawProperties as Record<string, unknown>;
        if ('valueType' in props) {
          const normalizedValueType = normalizeRegistryValueType(props.valueType);
          if (normalizedValueType !== props.valueType) {
            props.valueType = normalizedValueType;
            changed = true;
          }
        }
        if (typeof props.keyPath === 'string') {
          const normalizedKeyPath = normalizeRegistryKeyPath(props.keyPath);
          if (normalizedKeyPath !== props.keyPath) {
            props.keyPath = normalizedKeyPath;
            changed = true;
          }
        }
      }
    }

    // Traverse every value. This handles Test wrappers
    // (`properties.resource.properties.valueType`) and Group wrappers
    // (`properties.resources[].properties.valueType`) without enumerating
    // each container shape.
    pending.push(...Object.values(obj));
  }

  return changed;
}

/**
 * Normalize a YAML string containing a manifest. Round-trips through
 * `yaml.load` / `yaml.dump` only when a Registry property changes. The
 * lossless integer schema prevents QWord values from being rounded, and
 * reference tracking preserves YAML aliases.
 *
 * Returns the original string unchanged if parsing fails — we'd rather
 * let oscfg surface its own YAML error than mask it here.
 *
 * @internal
 */
export function normalizeManifestRegistryTypesInYaml(yamlText: string): string {
  let doc: unknown;
  try {
    doc = parseLosslessYaml(yamlText);
  } catch {
    return yamlText;
  }
  const changed = walk(doc);
  if (!changed) return yamlText;
  try {
    return dumpLosslessYaml(doc, {
      lineWidth: -1,
      noRefs: false,
    });
  } catch {
    return yamlText;
  }
}
