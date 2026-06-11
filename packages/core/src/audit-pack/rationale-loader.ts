// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Adapter: map `../manifest/rationale-store`'s on-disk RationaleEntry
 * shape onto the audit-pack's render shape.
 *
 * Store layout per entry:
 *   { ts, author, resourceName, oldValue, newValue, reason, skipped? }
 *
 * Audit-pack render needs only `{ timestamp, author?, resourceName?, reason }`.
 * `oldValue` / `newValue` are intentionally dropped — auditors get the
 * before/after via the version-history section, not the rationale log,
 * and the rationale renderer caps each entry at ~3 lines anyway.
 *
 * Behavior:
 *   - File missing or empty → returns `undefined` so the audit-pack
 *     omits the section entirely (no empty heading).
 *   - Skipped entries (`skipped:true` with empty reason) are kept in
 *     the output with a sentinel reason so auditors can see the
 *     explicit no-rationale events. The user actively chose "skip"
 *     when the prompt asked them — that's an audit-relevant signal.
 *   - Any other read failure → log + return `undefined` (fail-soft;
 *     never poison the entire audit-pack on one bad sub-section).
 */
import { readRationale, type RationaleEntry as StoreEntry } from '../manifest/rationale-store';
import type { RationaleEntry } from './index';

export async function tryLoadRationale(name: string): Promise<RationaleEntry[] | undefined> {
  let stored: StoreEntry[];
  try {
    stored = await readRationale(name);
  } catch (err) {
    // readRationale already maps ENOENT to []; this catches harder
    // failures (parse errors at the file level, EACCES, etc.).
    console.warn('[audit-pack] readRationale failed:', err);
    return undefined;
  }
  if (stored.length === 0) return undefined;

  return stored.map((e): RationaleEntry => {
    const trimmedReason = (e.reason ?? '').trim();
    const reason = trimmedReason.length > 0
      ? e.reason
      : (e.skipped ? '(rationale skipped)' : '');
    const out: RationaleEntry = {
      timestamp: e.ts,
      reason,
    };
    if (e.author) out.author = e.author;
    if (e.resourceName) out.resourceName = e.resourceName;
    return out;
  });
}
