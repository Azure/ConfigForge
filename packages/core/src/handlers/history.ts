// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handlers for `cfs:history:list`, `cfs:history:get`,
 * matching `GET /api/history?name=…[&id=…]`.
 *
 * Mutations (POST + DELETE) live in `history-write.ts`.
 */
import { getHistory, getSnapshot } from '../history';
import { HandlerError } from './errors';

export async function listHistory(name: string): Promise<{
  data: Awaited<ReturnType<typeof getHistory>>;
}> {
  if (!name) throw new HandlerError(400, 'name is required');
  try {
    const data = await getHistory(name);
    return { data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (
      message.startsWith('Invalid manifest name') ||
      message === 'Path traversal blocked'
    ) {
      throw new HandlerError(400, message);
    }
    throw err;
  }
}

export async function getHistoryEntry(name: string, id: string): Promise<{
  data: NonNullable<Awaited<ReturnType<typeof getSnapshot>>>;
}> {
  if (!name) throw new HandlerError(400, 'name is required');
  if (!id) throw new HandlerError(400, 'id is required');
  try {
    const entry = await getSnapshot(name, id);
    if (!entry) throw new HandlerError(404, `Snapshot '${id}' not found`);
    return { data: entry };
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (
      message.startsWith('Invalid manifest name') ||
      message.startsWith('Invalid snapshot id') ||
      message === 'Path traversal blocked'
    ) {
      throw new HandlerError(400, message);
    }
    throw err;
  }
}
