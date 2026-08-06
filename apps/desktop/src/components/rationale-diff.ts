// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR27: pure helpers for the rationale-prompt hook.
 *
 * This file is intentionally separate from `use-rationale-prompt.tsx` so
 * the diff-detection logic can be unit-tested under Vitest without a DOM
 * or React testing harness. Any logic in the hook that doesn't *need* a
 * React lifecycle should live here.
 */
import {
  parseLosslessYaml,
  stringifyLosslessJson,
} from '@configforge/core/manifest/lossless';

export interface ResourceDiff {
  /** The `name` field of the resource. Used as the rationale entry's resourceName. */
  resourceName: string;
  /** Verb of the change — useful for diff-summary text in the modal. */
  kind: 'added' | 'removed' | 'modified';
  /** Pre-change shape (resource object) — null for additions. */
  oldValue: unknown;
  /** Post-change shape — null for removals. */
  newValue: unknown;
}

/**
 * Cheap structural compare using lossless JSON serialization. We don't need to
 * pretty-print, just hash by canonical form. `JSON.stringify` is
 * NON-deterministic for object-key order — but here both sides come
 * from `js-yaml` which preserves insertion order, so equal documents
 * produce equal strings.
 *
 * Edge case: NaN/Infinity → "null" in JSON; we treat those as absent on
 * purpose since manifest YAML doesn't admit them anyway.
 */
function structuralEqual(a: unknown, b: unknown): boolean {
  return stringifyLosslessJson(a) === stringifyLosslessJson(b);
}

/**
 * Extract the `resources:` array from a YAML/JSON manifest string.
 * Returns `[]` on parse failure or when the document doesn't have a
 * top-level `resources` array — this is intentionally permissive
 * because the editor may show non-manifest documents (security-defs,
 * partial drafts, etc.) that should still flow through Save without
 * triggering the rationale modal.
 */
export function extractResources(content: string): Array<Record<string, unknown>> {
  if (typeof content !== 'string' || content.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = parseLosslessYaml(content);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const top = parsed as Record<string, unknown>;
  const resources = top.resources;
  if (!Array.isArray(resources)) return [];
  return resources.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
}

/**
 * Compute a per-resource diff between two manifests. Returns an empty
 * array when the two manifests are structurally identical.
 *
 * Resource identity = `name` field. Two resources sharing a name are
 * compared structurally for `modified`; absent-on-one-side is added or
 * removed. Resources with no `name` field are silently dropped — the
 * server-side validator catches that as a hard error elsewhere, no
 * point doubling up the message in the rationale UX.
 */
export function diffResources(
  before: string,
  after: string,
): ResourceDiff[] {
  const a = extractResources(before);
  const b = extractResources(after);

  const aByName = new Map<string, Record<string, unknown>>();
  for (const r of a) {
    if (typeof r.name === 'string' && r.name) aByName.set(r.name, r);
  }
  const bByName = new Map<string, Record<string, unknown>>();
  for (const r of b) {
    if (typeof r.name === 'string' && r.name) bByName.set(r.name, r);
  }

  const diffs: ResourceDiff[] = [];

  // Walk B in order so the diffs come back in editor order — the modal
  // shows them top-down and the user expects "first change first".
  // Use Array.from to side-step the tsconfig's lack of `target: es2015+`
  // (Map iteration via `for-of` requires downlevelIteration).
  for (const [name, post] of Array.from(bByName.entries())) {
    const pre = aByName.get(name);
    if (!pre) {
      diffs.push({ resourceName: name, kind: 'added', oldValue: null, newValue: post });
    } else if (!structuralEqual(pre, post)) {
      diffs.push({ resourceName: name, kind: 'modified', oldValue: pre, newValue: post });
    }
  }

  for (const [name, pre] of Array.from(aByName.entries())) {
    if (!bByName.has(name)) {
      diffs.push({ resourceName: name, kind: 'removed', oldValue: pre, newValue: null });
    }
  }

  return diffs;
}

/**
 * Decide whether to show the rationale modal. Returns `true` only when
 * the two manifests differ in some structural way that the user should
 * be asked to justify. Whitespace / comment-only edits do NOT count —
 * we compare the parsed-and-renormalized resource list, not raw bytes.
 *
 * Sanity cap: if the computed diff exceeds `MAX_DIFFS` resources it's
 * almost certainly either a bulk import/replace or one side failed to
 * parse (e.g. mid-edit YAML). Either way the rationale UX adds little
 * value and would generate dozens of POSTs, so we skip the prompt and
 * let the save proceed unfiltered. Single-resource ergonomic edits —
 * the actual common case — are unaffected.
 */
const MAX_DIFFS_FOR_PROMPT = 20;

export function shouldPromptForRationale(before: string, after: string): boolean {
  // Cheap byte-equal short-circuit — most "saves with no changes" hit this.
  if (before === after) return false;
  const diffs = diffResources(before, after);
  if (diffs.length === 0) return false;
  if (diffs.length > MAX_DIFFS_FOR_PROMPT) return false;
  return true;
}

/**
 * Build a one-line human-readable summary of a diff list, e.g.
 *   "EnableUAC modified, NewSetting added (2 changes)"
 *
 * Used by the modal to remind the user what they're justifying. Capped
 * at the first ~3 entries to keep the modal compact.
 */
export function summarizeDiff(diffs: ResourceDiff[], cap = 3): string {
  if (diffs.length === 0) return 'no changes';
  const parts = diffs.slice(0, cap).map((d) => `${d.resourceName} ${d.kind}`);
  if (diffs.length > cap) {
    return `${parts.join(', ')} (+${diffs.length - cap} more)`;
  }
  return parts.join(', ');
}
