// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { runOscfg } from './runner';
import { stringifyLosslessJson } from '../manifest/lossless';
import { normalizeManifestRegistryTypes } from './registry-types';
import { normalizeOscfgArray } from './get';
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
 * Registry aliases are normalized to the `REG_*` forms used by the current
 * upstream schema, `docs/resources/windows/Registry.md`,
 * `examples/registry.osc.yaml`, and Microsoft Learn set/test/quickstart
 * files. Verified provider versions can accept `Dword` with exit code 0 while
 * leaving the registry unchanged.
 */
export function execResource(
  opts: OscfgExecOptions & { mode: 'list' },
): Promise<OscfgResult<OscfgResource[]>>;
export function execResource(
  opts: OscfgExecOptions & { mode: Exclude<OscfgExecOptions['mode'], 'list'> },
): Promise<OscfgResult<OscfgResource>>;
export function execResource(
  opts: OscfgExecOptions,
): Promise<OscfgResult<OscfgResource | OscfgResource[]>>;
export async function execResource(
  opts: OscfgExecOptions,
): Promise<OscfgResult<OscfgResource | OscfgResource[]>> {
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

  const result = await runOscfg<unknown>(args, { timeoutMs: opts.timeoutMs });
  if (!result.success) return { ...result, data: null };

  // oscfg 1.3.x emits one object for direct exec calls, while 1.4.3 emits a
  // single-item array. Normalize both shapes before the audit fallback reads
  // compliance or provider values.
  const resources = normalizeOscfgArray<OscfgResource>(result.data);
  if (opts.mode === 'list') return { ...result, data: resources };
  if (resources.length === 0) return { ...result, data: null };
  if (resources.length > 1) {
    return {
      ...result,
      success: false,
      data: null,
      error: `oscfg exec resource returned ${resources.length} resources; expected exactly one`,
    };
  }
  return { ...result, data: resources[0] };
}

/**
 * Normalize Registry resources recursively so direct calls plus Test and
 * Group wrappers all receive canonical valueType and keyPath syntax.
 */
function maybeNormalizeRegistryProps(
  type: string,
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) return props;
  const normalized = normalizeManifestRegistryTypes({ type, properties: props });
  return normalized.properties;
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
  return stringifyLosslessJson(props) ?? '';
}
