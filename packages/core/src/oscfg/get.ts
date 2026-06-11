// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { runOscfg } from './runner';
import type {
  OscfgGetResourceOptions,
  OscfgNamespace,
  OscfgResource,
  OscfgResult,
} from './types';

/**
 * List all namespaces.
 *   oscfg get namespace --output json
 *
 * Response shape (preview18): plain JSON string array, e.g.
 *   ["default", "secbase1", "securitybaselinev1"]
 *
 * Equivalent to old `Get-OscManifest` (list all).
 */
export async function getNamespaces(
  timeoutMs?: number,
): Promise<OscfgResult<OscfgNamespace[]>> {
  const result = await runOscfg<unknown>(
    ['get', 'namespace', '--output', 'json'],
    { timeoutMs },
  );
  if (!result.success) return { ...result, data: null };

  const raw = normalizeArray<unknown>(result.data);
  const namespaces: OscfgNamespace[] = raw.map((entry) => {
    if (typeof entry === 'string') return { name: entry };
    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const name =
        (typeof obj.name === 'string' && obj.name) ||
        (typeof obj.namespace === 'string' && obj.namespace) ||
        '';
      return { name, ...obj };
    }
    return { name: String(entry) };
  });

  return { ...result, data: namespaces };
}

/**
 * Get resources. If `name` is omitted, returns all resources in the namespace.
 *   oscfg get resource [NAME] [-n <NS>] --output <fmt>
 *
 * Note: NAME is a positional argument in the current CLI (oscfg 1.3.8-preview18).
 *
 * Covers old `Get-OscManifest -Name` and `Get-OscManifestStatus -Name`.
 */
export async function getResources(
  opts: OscfgGetResourceOptions = {},
): Promise<OscfgResult<OscfgResource[]>> {
  const args = ['get', 'resource'];
  // Insert a `--` separator before the positional NAME so resource names
  // beginning with `-` (e.g. `-h`, `--version`) are not misparsed as flags
  // by the underlying clap parser. Without this, `getResources({ name: '-h' })`
  // would print oscfg's help text to stdout and silently return an empty
  // resource list.
  if (opts.name) args.push('--', opts.name);
  if (opts.namespace) args.push('-n', opts.namespace);
  args.push('--output', opts.output ?? 'json');

  const result = await runOscfg<unknown>(args, { timeoutMs: opts.timeoutMs });
  if (!result.success) return { ...result, data: null };

  // Non-JSON requested: return raw text
  if (opts.output && opts.output !== 'json') {
    return {
      ...result,
      data: typeof result.data === 'string' ? ([result.data as unknown] as unknown as OscfgResource[]) : [],
    };
  }

  return { ...result, data: normalizeArray<OscfgResource>(result.data) };
}

/**
 * Get a single resource by name (convenience wrapper).
 */
export async function getResourceByName(
  name: string,
  namespace?: string,
  timeoutMs?: number,
): Promise<OscfgResult<OscfgResource | null>> {
  const result = await getResources({ name, namespace, timeoutMs });
  if (!result.success) return { ...result, data: null };
  return { ...result, data: (result.data && result.data[0]) || null };
}

/**
 * Helper: the CLI may return a single object or an array depending on args.
 * Always coerce to array for consistent handling.
 */
function normalizeArray<T>(raw: unknown): T[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'object') {
    // Some CLIs wrap results as { items: [...] } or { resources: [...] }
    const obj = raw as Record<string, unknown>;
    for (const key of ['items', 'resources', 'namespaces', 'data']) {
      const maybe = obj[key];
      if (Array.isArray(maybe)) return maybe as T[];
    }
    return [raw as T];
  }
  return [];
}
