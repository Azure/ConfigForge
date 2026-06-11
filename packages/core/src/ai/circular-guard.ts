// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Circular-reference guard for AI inputs.
//
// Rick (Geeta's research): "AI can have circular reasoning… refer to a
// user's own documents when answering a net-new question."
//
// Our defense: tag every piece of AI-generated content with a marker
// before it leaves the system, then refuse to ground the AI on content
// that carries that marker. Marker absence is "unknown" (treated as
// user-written content) — never the inverse, so old un-tagged content
// keeps working.
//
// CF-SEC-007 (audit follow-up): the inline HTML-comment marker can be
// removed from a string before it's fed back to the AI ("strip-and-launder"
// attack), defeating the marker-based check. We complement the marker
// signal with an in-process content-hash registry: whenever we tag a
// string we ALSO record its hash, so a re-presented copy without the
// marker is still recognised. The registry is intentionally per-process
// (does not persist) — it raises the bar for an attacker that controls
// content but doesn't process state, without growing unbounded across
// sessions. Persistent attestation is out of scope here.
//
// Why a hand-rolled hash instead of `crypto.createHash`: this module is
// pulled into the renderer bundle via the @configforge/core barrel.
// Vite externalises Node's `crypto` for browser builds and the resulting
// `createHash` is undefined at runtime, breaking `npm run build:renderer`
// on both flavors. A pure-JS 64-bit FNV-1a-derived hash is browser-safe,
// has no dependency footprint, and is more than strong enough for this
// threat model (the registry exists to make accidental and casual reuse
// detectable, not to resist a determined hash-collision attacker — the
// marker check remains the primary signal). For ~4k entries, 64-bit gives
// a birthday-collision probability ≈ 1e-12.

/** Match prefix — we accept any rev number, but require the literal prefix. */
export const AI_GENERATED_MARKER = '<!-- ai-generated:rev=';

const MARKER_LINE_REGEX = /^<!--\s*ai-generated:rev=\d+\s*-->\s*\r?\n?/m;

/**
 * In-process registry of content hashes that we have tagged as AI-generated
 * in this run. NFC-normalised 64-bit hashes (two FNV-1a 32-bit passes with
 * different seeds, concatenated) so the same content tagged from different
 * code paths (or after a `stripAiMarker` round-trip) maps to the same key.
 *
 * Bounded at MAX_REGISTRY_ENTRIES on a FIFO basis to keep memory finite in
 * long-running sessions. The eviction policy is intentionally lossy: an
 * attacker that can flood the registry past the cap can evict legitimate
 * entries. Mitigation: the marker-based check still applies and remains the
 * primary signal; the registry is a strengthening, not a replacement.
 */
const MAX_REGISTRY_ENTRIES = 4096;
const aiGeneratedHashes = new Set<string>();
const aiGeneratedHashOrder: string[] = [];

/**
 * 32-bit FNV-1a hash, seeded. Pure JS, browser-safe, sync. Math.imul keeps
 * the multiplication in 32-bit lane so the result stays portable across
 * engines (V8 / SpiderMonkey treat the >>> 0 conversion identically).
 */
function fnv1a32(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashContent(content: string): string {
  // NFC normalize so visually identical but byte-different strings map
  // to the same key. Two independent 32-bit FNV-1a passes with different
  // seeds give an effective 64-bit hash (concatenated as hex).
  const norm = content.normalize('NFC');
  const a = fnv1a32(norm, 0x811c9dc5);
  const b = fnv1a32(norm, 0xcbf29ce4);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function rememberAiGeneratedHash(content: string): void {
  const key = hashContent(content);
  if (aiGeneratedHashes.has(key)) return;
  aiGeneratedHashes.add(key);
  aiGeneratedHashOrder.push(key);
  while (aiGeneratedHashOrder.length > MAX_REGISTRY_ENTRIES) {
    const evicted = aiGeneratedHashOrder.shift();
    if (evicted) aiGeneratedHashes.delete(evicted);
  }
}

/**
 * Test-only escape hatch: wipe the in-process registry. Production code
 * should never call this — it intentionally defeats the spoof-resistance
 * the registry provides. Exported (rather than vi.mocked) so tests can
 * isolate cases without monkey-patching internal module state.
 */
export function __resetAiGeneratedRegistryForTests(): void {
  aiGeneratedHashes.clear();
  aiGeneratedHashOrder.length = 0;
}

/**
 * Prepend an AI-generated marker line to `content`. Idempotent: if the
 * content already carries a marker we replace it with the new rev rather
 * than stacking markers.
 *
 * Side effect (CF-SEC-007): records the marker-stripped content hash in
 * the spoof-resistance registry so a subsequent re-presentation of the
 * same content (with or without the marker) is still detected as AI.
 */
export function tagAsAiGenerated(content: string, rev: number): string {
  const stripped = stripAiMarker(content);
  const safeRev = Number.isFinite(rev) && rev >= 0 ? Math.floor(rev) : 0;
  // Record BOTH the marker-stripped body and the final tagged form so
  // either presentation re-presented to the system is recognised.
  rememberAiGeneratedHash(stripped);
  const tagged = `<!-- ai-generated:rev=${safeRev} -->\n${stripped}`;
  rememberAiGeneratedHash(tagged);
  return tagged;
}

/**
 * Returns true if the content carries the AI-generated marker anywhere
 * OR its (marker-stripped) hash is in the spoof-resistance registry.
 * Anywhere — not just the first line — because users may paste an
 * AI-generated chunk into the middle of a manifest and we want to detect
 * that too (the test below covers the partial-document case).
 */
export function isAiGenerated(content: string): boolean {
  if (typeof content !== 'string' || content.length === 0) return false;
  if (content.includes(AI_GENERATED_MARKER)) return true;
  // CF-SEC-007: also consult the in-process hash registry so an attacker
  // can't launder AI content by stripping the marker before re-feeding it
  // to the system in the same session.
  const strippedKey = hashContent(stripAiMarker(content));
  if (aiGeneratedHashes.has(strippedKey)) return true;
  return false;
}

/**
 * Throw a descriptive error if `content` is AI-generated. Intended to be
 * called as a guard at every place where user-supplied input is about to
 * be used as ground truth for a new AI prompt.
 */
export function assertNotAiGenerated(content: string, ctx: string): void {
  if (isAiGenerated(content)) {
    throw new Error(
      `Refusing to use AI-generated content as ground truth (${ctx}). ` +
        `Detected marker "${AI_GENERATED_MARKER}…" or matching hash in the ` +
        `AI-content registry. This protects against circular reasoning — feed ` +
        `the AI authoritative sources (CIS, NIST, MSDocs, registered manifests), ` +
        `not prior AI output.`
    );
  }
}

/**
 * Remove the AI-generated marker line from `content` (for display).
 * Removes only the first occurrence — markers should not nest, and if
 * they somehow did we'd want to preserve the inner one as a signal.
 */
export function stripAiMarker(content: string): string {
  if (typeof content !== 'string' || content.length === 0) return content;
  return content.replace(MARKER_LINE_REGEX, '');
}
