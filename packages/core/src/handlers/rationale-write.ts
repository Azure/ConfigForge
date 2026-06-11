// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:rationale:append` and
 * `POST /api/manifests/[id]/rationale`.
 *
 * Author resolution happens server-side via `resolveAuthor()` so the
 * client cannot spoof an author. The Next.js wrapper enforces
 * same-origin CSRF protection at the HTTP layer; the IPC wrapper
 * doesn't need that since renderer→main is not subject to CSRF.
 */
import { isValidNamespace } from '../oscfg';
import { resolveAuthor } from '../history/author';
import { appendRationale, type RationaleEntry } from '../manifest/rationale-store';
import { HandlerError } from './errors';

const REASON_MAX_LEN = 500;

export interface AppendRationaleRequest {
  id: string;
  resourceName: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  skipped?: boolean;
}

export async function appendRationaleEntry(
  req: AppendRationaleRequest,
): Promise<{ ok: true; entry: RationaleEntry }> {
  if (!req || typeof req !== 'object') {
    throw new HandlerError(400, 'Body must be a JSON object');
  }

  // Decode + validate namespace.
  let decoded = req.id;
  try {
    decoded = decodeURIComponent(req.id);
  } catch {
    // tolerate already-decoded ids
  }
  if (!isValidNamespace(decoded)) {
    throw new HandlerError(
      400,
      `Invalid manifest id: ${JSON.stringify(decoded)}. Allowed: A-Z a-z 0-9 . _ - (1-96 chars).`,
    );
  }

  if (typeof req.resourceName !== 'string' || req.resourceName.trim() === '') {
    throw new HandlerError(400, 'resourceName must be a non-empty string');
  }
  if (req.resourceName.length > 1024) {
    throw new HandlerError(400, 'resourceName is too long (max 1024 chars)');
  }
  if (req.skipped !== undefined && typeof req.skipped !== 'boolean') {
    throw new HandlerError(400, 'skipped must be a boolean if provided');
  }
  const skipped = req.skipped === true;

  if (req.reason !== undefined && typeof req.reason !== 'string') {
    throw new HandlerError(400, 'reason must be a string if provided');
  }
  const reason = typeof req.reason === 'string' ? req.reason : '';

  if (!skipped && reason.trim() === '') {
    throw new HandlerError(400, 'reason is required when skipped is false');
  }
  if (reason.length > REASON_MAX_LEN) {
    throw new HandlerError(
      400,
      `reason is too long (max ${REASON_MAX_LEN} chars; got ${reason.length})`,
    );
  }

  let author = '';
  try {
    const resolved = await resolveAuthor();
    author = resolved.name;
  } catch {
    author = '';
  }

  const entry: RationaleEntry = {
    ts: new Date().toISOString(),
    author,
    resourceName: req.resourceName,
    oldValue: req.oldValue,
    newValue: req.newValue,
    reason,
    ...(skipped ? { skipped: true } : {}),
  };

  try {
    await appendRationale(decoded, entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'append failed';
    throw new HandlerError(500, message);
  }
  return { ok: true, entry };
}
