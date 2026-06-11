// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:rationale:list` (GET /api/manifests/[id]/rationale).
 *
 * POST is in `rationale-write.ts` (Phase 4 pass B — JSON mutations).
 */
import { isValidNamespace } from '../oscfg';
import { readRationale } from '../manifest/rationale-store';
import { HandlerError } from './errors';

export async function getRationaleEntries(rawId: string): Promise<{
  entries: Awaited<ReturnType<typeof readRationale>>;
}> {
  let decoded = rawId;
  try {
    decoded = decodeURIComponent(rawId);
  } catch {
    // tolerate already-decoded ids
  }
  if (!isValidNamespace(decoded)) {
    throw new HandlerError(
      400,
      `Invalid manifest id: ${JSON.stringify(decoded)}. Allowed: A-Z a-z 0-9 . _ - (1-96 chars).`,
    );
  }
  const entries = await readRationale(decoded);
  return { entries };
}
