// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { dumpLosslessYaml, parseLosslessYaml } from './manifest/lossless';

/**
 * Canonical normalization for manifests so the diff viewer can compare two
 * manifests that describe the same intent regardless of:
 *   - YAML vs JSON format
 *   - key ordering
 *   - resource ordering within the `resources:` list
 *   - casing of top-level keys (Resources vs resources)
 *   - incidental whitespace / comments
 *
 * Produces deterministic YAML text. If parsing fails (e.g. garbled input),
 * returns the original text as-is so diff still shows *something*.
 *
 * Callers:
 *   - /diff page (side-by-side line diff)
 *   - ai analyzer (resource-level diff)
 *
 * Goal: when a user loads the same manifest as YAML on the left and JSON on
 * the right, they should see ZERO differences.
 */

interface CanonicalResource {
  name: string;
  type: string;
  properties: Record<string, unknown>;
  [extra: string]: unknown;
}

interface CanonicalManifest {
  $schema?: string;
  name?: string;
  resources: CanonicalResource[];
}

const RESOURCE_ORDER_KEY = ['name', 'type', 'properties'];

/**
 * Parse either YAML or JSON into an object. js-yaml accepts JSON because
 * JSON is a subset of YAML, so one parser handles both.
 */
function parseManifest(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseLosslessYaml(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickCaseInsensitive<T = unknown>(
  obj: Record<string, unknown>,
  keys: string[],
): T | undefined {
  for (const k of keys) {
    if (k in obj) return obj[k] as T;
    const lower = k.toLowerCase();
    for (const actual of Object.keys(obj)) {
      if (actual.toLowerCase() === lower) return obj[actual] as T;
    }
  }
  return undefined;
}

function canonicalizeResource(raw: unknown): CanonicalResource | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = pickCaseInsensitive<string>(r, ['name']);
  const type = pickCaseInsensitive<string>(r, ['type']);
  const props = pickCaseInsensitive<Record<string, unknown>>(r, ['properties']);
  if (!name || !type) return null;

  const canonProps = props ? canonicalizeProperties(props) : {};

  const out: CanonicalResource = {
    name: String(name),
    type: String(type),
    properties: canonProps,
  };

  // Preserve any other top-level resource fields (dependsOn, tags, etc.)
  // in a deterministic order, lowercased.
  for (const [k, v] of Object.entries(r)) {
    const lower = k.toLowerCase();
    if (lower === 'name' || lower === 'type' || lower === 'properties') continue;
    out[lower] = canonicalizeValue(v);
  }
  return out;
}

/**
 * Recursively canonicalize properties:
 *   - sort object keys
 *   - normalize primitive values (numbers stay numbers, '1' stays '1')
 *   - preserve nested `resources:` arrays (walking into them)
 */
function canonicalizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(props).sort();
  for (const k of keys) {
    sorted[k] = canonicalizeValue(props[k]);
  }
  return sorted;
}

function canonicalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) {
    // Preserve array order for generic arrays; sort `resources` arrays by
    // name so resource ordering doesn't affect the diff.
    return v.map((item) => {
      if (item && typeof item === 'object' && 'name' in (item as object) && 'type' in (item as object)) {
        return canonicalizeResource(item);
      }
      return canonicalizeValue(item);
    });
  }
  if (typeof v === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(v as Record<string, unknown>).sort();
    for (const k of keys) {
      sorted[k] = canonicalizeValue((v as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return v;
}

/**
 * Walk a parsed manifest and pull out every `resources:` array at any depth,
 * merging into a single flat list. The OSConfig document model allows group
 * resources that contain nested `resources:` under `properties`; for diff
 * purposes we compare the *flat* set of leaf configurations.
 *
 * Actually — we DON'T flatten. Flattening would lose semantic grouping. We
 * just canonicalize each resource in place and sort siblings by name.
 */
function buildCanonical(parsed: Record<string, unknown>): CanonicalManifest {
  const schema = pickCaseInsensitive<string>(parsed, ['$schema', 'schema']);
  const name = pickCaseInsensitive<string>(parsed, ['name']);
  const rawResources = pickCaseInsensitive<unknown[]>(parsed, ['resources']);
  const resources: CanonicalResource[] = [];
  if (Array.isArray(rawResources)) {
    for (const r of rawResources) {
      const c = canonicalizeResource(r);
      if (c) resources.push(c);
    }
    resources.sort((a, b) => a.name.localeCompare(b.name));
  }
  const out: CanonicalManifest = { resources };
  if (schema) out.$schema = String(schema);
  if (name) out.name = String(name);
  return out;
}

/**
 * Reorder each resource's top-level keys so {name, type, properties, ...rest}
 * emit in a stable, human-readable order. js-yaml preserves insertion order.
 */
function orderResourceKeys(r: CanonicalResource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RESOURCE_ORDER_KEY) {
    if (k in r) out[k] = (r as Record<string, unknown>)[k];
  }
  const extras = Object.keys(r)
    .filter((k) => !RESOURCE_ORDER_KEY.includes(k))
    .sort();
  for (const k of extras) out[k] = (r as Record<string, unknown>)[k];
  return out;
}

/**
 * Normalize a manifest (YAML or JSON text) into canonical YAML text.
 * Returns the original input if parsing fails.
 */
export function normalizeManifestForDiff(text: string): string {
  const parsed = parseManifest(text);
  if (!parsed) return text;
  const canon = buildCanonical(parsed);

  const doc: Record<string, unknown> = {};
  if (canon.$schema) doc.$schema = canon.$schema;
  if (canon.name) doc.name = canon.name;
  doc.resources = canon.resources.map(orderResourceKeys);

  try {
    return dumpLosslessYaml(doc, {
      lineWidth: 120,
      noRefs: true,
      quotingType: '"',
      sortKeys: false, // we've already ordered keys ourselves
    });
  } catch {
    return text;
  }
}

/**
 * Return the parsed canonical structure for programmatic diff (AI analyzer,
 * changelog). Null if parsing fails.
 */
export function parseManifestCanonical(text: string): CanonicalManifest | null {
  const parsed = parseManifest(text);
  if (!parsed) return null;
  return buildCanonical(parsed);
}

export type { CanonicalManifest, CanonicalResource };
