// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Provenance / bibliography utilities for AI responses.
//
// Geeta's research surfaced a concrete fear: AI hallucinations + circular
// reasoning. Every AI response from `lib/ai/*` should be able to surface
// exactly which sources it grounded on. This module is the type + helper
// layer for that.

export type AiSourceKind =
  | 'CIS'
  | 'NIST'
  | 'MSDocs'
  | 'GPO'
  | 'manifest'
  | 'user-input';

export interface AiSource {
  kind: AiSourceKind;
  label: string;
  url?: string;
  /** 0..1 — how confident we are that this source actually backs the claim. */
  confidence: number;
}

export interface Provenance {
  sources: AiSource[];
  /** 0..1 — fraction of claims with at least one cited source. */
  citationCoverage: number;
}

const TRACKING_PARAM_PATTERNS: readonly RegExp[] = [
  /^utm_/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^mc_(eid|cid)$/i,
  /^ocid$/i,
];

/**
 * Normalize a URL for dedupe purposes:
 *  - lowercases the host
 *  - strips the fragment (#...)
 *  - strips utm_* and other common tracking params
 *
 * Returns the original string verbatim if it's not parseable as a URL — we
 * never want to mask an upstream bug by silently rewriting a "url" that
 * was actually a free-form label.
 */
export function normalizeUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';
  const drop: string[] = [];
  parsed.searchParams.forEach((_value, key) => {
    if (TRACKING_PARAM_PATTERNS.some((re) => re.test(key))) drop.push(key);
  });
  for (const key of drop) parsed.searchParams.delete(key);
  // Keep the trailing-slash question idempotent: URL.toString already does
  // that for us.
  return parsed.toString();
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function sourceKey(s: AiSource): string {
  const url = s.url ? normalizeUrl(s.url) : '';
  return `${s.kind}::${s.label}::${url}`;
}

/**
 * Drop duplicates by (kind, label, normalized url). When duplicates collide
 * we keep the one with the higher confidence — that way an upstream pass
 * that refines confidence doesn't get clobbered by an earlier weaker entry.
 */
export function dedupeSources(sources: AiSource[]): AiSource[] {
  const byKey = new Map<string, AiSource>();
  for (const s of sources) {
    const key = sourceKey(s);
    const existing = byKey.get(key);
    if (!existing || s.confidence > existing.confidence) {
      byKey.set(key, { ...s, confidence: clamp01(s.confidence) });
    }
  }
  return Array.from(byKey.values());
}

/**
 * Compute citation coverage from a list of sources. This is intentionally
 * conservative:
 *  - empty source list → 0
 *  - mean of `confidence` across deduped sources, clamped to 0..1
 *
 * Callers that want stricter coverage (e.g. per-claim) can compute their
 * own value and pass it through `decorateWithProvenance` directly via the
 * underlying object.
 */
export function computeCitationCoverage(sources: AiSource[]): number {
  if (sources.length === 0) return 0;
  const sum = sources.reduce((acc, s) => acc + clamp01(s.confidence), 0);
  return clamp01(sum / sources.length);
}

/**
 * Decorate an arbitrary AI response object with a `provenance` field. The
 * returned value is a shallow copy of `response` with `provenance` set to
 * a deduped/normalized bibliography.
 *
 * Backwards-compatible: if `response` already has a `provenance` we MERGE
 * sources rather than overwrite, so a response that's been decorated by
 * an upstream pass (retrieval) and then a downstream pass (post-hoc
 * evidence linking) accumulates evidence.
 */
export function decorateWithProvenance<T>(
  response: T,
  sources: AiSource[]
): T & { provenance: Provenance } {
  const existing =
    response && typeof response === 'object' && 'provenance' in response
      ? ((response as { provenance?: Provenance }).provenance ?? null)
      : null;
  const merged = dedupeSources([...(existing?.sources ?? []), ...sources]);
  const provenance: Provenance = {
    sources: merged,
    citationCoverage: computeCitationCoverage(merged),
  };
  return { ...(response as object), provenance } as T & { provenance: Provenance };
}
