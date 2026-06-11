// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-005 / CF-SEC-006 — shared markdown escape helpers.
 *
 * Manifest-, history-, rationale-, and provenance-derived strings that
 * flow into generated Markdown (audit packs, doc-generator output) are
 * UNTRUSTED. Without escaping, a crafted manifest can spoof headings,
 * inject misleading links/images, break tables, smuggle HTML autolinks,
 * or hide failed checks from a reviewer who treats the report as
 * authoritative.
 *
 * These helpers are the single trust boundary for untrusted strings
 * rendered in our generated markdown. Trusted constants (section
 * headings, schema URIs we control, etc.) are emitted as literals.
 *
 * Exports:
 *   - `escMdInline(value)`  — paragraph/list/inline-emphasis text.
 *                             Strips control chars, collapses newlines,
 *                             backslash-escapes every CommonMark
 *                             punctuation char plus `<`/`>`/`|`.
 *   - `escMdCell(value)`    — same as `escMdInline`, named for table-
 *                             cell context (single-row collapse + pipe
 *                             escape are inherent in escMdInline).
 *   - `escInlineCode(value)` — for content inside `` `…` `` spans.
 *                             Strips control chars, neutralises
 *                             backticks. Caller supplies the span.
 *   - `safeAutoLink(url)`   — validates `url` via WHATWG `URL`, requires
 *                             `http:` / `https:`, and returns either a
 *                             sanitized autolink (`<https://…>`) or the
 *                             URL as escaped plain text when validation
 *                             fails. Returns `null` when no URL was
 *                             provided.
 */

// CommonMark §6.3 — punctuation that backslash-escape preserves. We
// escape every char in this set so no markdown / HTML construct
// survives untrusted input. `<` and `>` are also escaped so raw HTML
// autolinks and inline HTML tags cannot reach the renderer.
const MD_PUNCT_RE = /[\\`*_{}[\]()#+\-.!<>|~]/g;

// Strip all C0/DEL control characters (mirrors PDF sections' safeText).
// We keep tab as a literal space to avoid weird rendering quirks.
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

function stripControl(s: string): string {
  return s.replace(CTRL_RE, '');
}

export function escMdInline(value: unknown): string {
  if (value == null) return '';
  let s = String(value);
  s = stripControl(s);
  // Collapse all CR/LF runs to a single space so a multi-line value
  // cannot break out of a paragraph / list item / table cell into a
  // new markdown block.
  s = s.replace(/\r?\n|\r/g, ' ');
  s = s.replace(MD_PUNCT_RE, '\\$&');
  return s;
}

export function escMdCell(value: unknown): string {
  // Within a GFM table cell the pipe is the column delimiter. The
  // CommonMark backslash escape (`\|`) is honoured by every renderer
  // we care about — `escMdInline` already escapes it. This helper
  // exists so call sites in table-row builders read intentionally.
  return escMdInline(value);
}

export function escInlineCode(value: unknown): string {
  if (value == null) return '';
  // Inline code spans (`` `foo` ``) render everything literally
  // EXCEPT a balanced run of backticks closing the span. Replacing
  // backticks with a visually similar Unicode character is cheaper
  // and safer than dynamically choosing a longer fence.
  //
  // We also collapse newlines to spaces so an untrusted value can't
  // break out of the `…` span into a new markdown block (the literal
  // newline ends the code span and lets the next line be a heading).
  return stripControl(String(value))
    .replace(/\r?\n|\r/g, ' ')
    .replace(/`/g, '\u02CB');
}

export function safeAutoLink(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  // Reject embedded whitespace, angle brackets, backticks, quotes, and
  // backslashes up front; `new URL()` would otherwise accept some of
  // these and we want a clean autolink boundary.
  if (/[\s<>`"\\]/.test(rawUrl)) return escMdInline(rawUrl);
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return escMdInline(rawUrl);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return escMdInline(rawUrl);
  }
  const safe = parsed.toString();
  // Belt-and-suspenders: re-check that the serialized URL has no
  // `<`/`>` left. The URL spec percent-encodes these, but a future
  // engine drift mustn't be allowed to break the autolink syntax.
  if (/[<>]/.test(safe)) return escMdInline(safe);
  return `<${safe}>`;
}
