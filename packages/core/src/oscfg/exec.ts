// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { runOscfg } from './runner';
import { normalizeRegistryValueType } from './registry-types';
import type { OscfgExecOptions, OscfgResource, OscfgResult } from './types';

/**
 * Execute a resource operation directly, bypassing namespaces. This is the
 * replacement for `Invoke-Native get`/`set` patterns in the old
 * Microsoft.OSConfig module.
 *
 *   oscfg exec resource --mode <get|set|remove|list> --type <T> \
 *                       [--properties <JSON>] --output json
 *
 * The real CLI (oscfg 1.3.8-preview18) expects `--properties` to be a JSON
 * object string, not a `k=v,k=v` list. We verified empirically: passing
 * `keyPath=X,valueName=Y` yields `missing field \`valueName\`` even though
 * the key is right there — the CLI never tries the kv parser. Passing
 * `{"keyPath":"X","valueName":"Y"}` works and round-trips the live device
 * state on the other end. So JSON it is.
 *
 * `exec resource` does NOT take `-n/--namespace` — it targets a provider
 * directly, not a namespace.
 *
 * PR19: when calling the `Microsoft.Windows/Registry` provider, normalize
 * any Win32-style `valueType` (REG_DWORD/REG_SZ/...) to the DSC-style
 * names oscfg accepts (Dword/String/...). Without this, audit/get/set on
 * a Defender-baseline-shaped resource fails with "os error 87".
 */
export async function execResource(
  opts: OscfgExecOptions,
): Promise<OscfgResult<OscfgResource>> {
  const properties = maybeNormalizeRegistryProps(opts.type, opts.properties);
  const propString = serializeProperties(properties);
  const args = [
    'exec',
    'resource',
    '--mode',
    opts.mode,
    '--type',
    opts.type,
  ];
  if (opts.name) {
    args.push('--name', opts.name);
  }
  if (propString) {
    args.push('--properties', propString);
  }
  args.push('--output', 'json');

  return runOscfg<OscfgResource>(args, { timeoutMs: opts.timeoutMs });
}

/**
 * If the resource is `Microsoft.Windows/Registry` (or a Test wrapper that
 * targets it), translate Win32 REG_* `valueType` values to DSC-style
 * names. Walks recursively so a Test wrapper's `properties.resource.
 * properties.valueType` is also normalized.
 */
function maybeNormalizeRegistryProps(
  type: string,
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) return props;
  // Inline-shaped registry resource: {keyPath, valueName, valueType, value}
  if (type === 'Microsoft.Windows/Registry' && 'valueType' in props) {
    return { ...props, valueType: normalizeRegistryValueType(props.valueType) };
  }
  // Test wrapper: nested `resource.properties.valueType`. Cheap deep
  // walk — props are tiny per-resource.
  if (type === 'Microsoft.OSConfig/Test') {
    return walkAndNormalize(props) as Record<string, unknown>;
  }
  return props;
}

function walkAndNormalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walkAndNormalize);
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'valueType') {
      out[k] = normalizeRegistryValueType(v);
    } else {
      out[k] = walkAndNormalize(v);
    }
  }
  return out;
}

/**
 * Serialize a property dict to the CLI's --properties format (JSON).
 *
 * Example: { keyPath: 'HKLM:\\Software\\MyApp', valueName: 'Version', value: 1 }
 *   -> '{"keyPath":"HKLM:\\\\Software\\\\MyApp","valueName":"Version","value":1}'
 *
 * Returns empty string for empty input (caller should then omit the flag).
 */
export function serializeProperties(
  props: Record<string, unknown> | undefined,
): string {
  if (!props || Object.keys(props).length === 0) return '';
  return JSON.stringify(props);
}
