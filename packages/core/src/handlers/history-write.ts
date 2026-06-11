// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handlers for `cfs:history:save` and `cfs:history:delete`,
 * matching `POST /api/history` and `DELETE /api/history`.
 */
import { saveSnapshot, deleteSnapshot } from '../history';
import { HandlerError } from './errors';

export interface SaveSnapshotRequest {
  name: string;
  content: string;
  message?: string;
}

export interface DeleteSnapshotRequest {
  name: string;
  id: string;
}

export async function saveHistorySnapshot(req: SaveSnapshotRequest): Promise<{
  data: Awaited<ReturnType<typeof saveSnapshot>>;
}> {
  if (!req || typeof req !== 'object') {
    throw new HandlerError(400, 'Request body must be a JSON object');
  }
  if (typeof req.name !== 'string' || !req.name) {
    throw new HandlerError(400, 'name is required');
  }
  if (typeof req.content !== 'string') {
    throw new HandlerError(400, 'content is required and must be a string');
  }
  if (req.message !== undefined && typeof req.message !== 'string') {
    throw new HandlerError(400, 'message must be a string when provided');
  }
  try {
    const data = await saveSnapshot(req.name, req.content, req.message);
    return { data };
  } catch (err) {
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

export async function deleteHistorySnapshot(
  req: DeleteSnapshotRequest,
): Promise<{ message: string }> {
  if (!req || typeof req !== 'object') {
    throw new HandlerError(400, 'Request must include name and id');
  }
  if (typeof req.name !== 'string' || !req.name) {
    throw new HandlerError(400, 'name is required');
  }
  if (typeof req.id !== 'string' || !req.id) {
    throw new HandlerError(400, 'id is required');
  }
  try {
    await deleteSnapshot(req.name, req.id);
    return { message: `Snapshot '${req.id}' deleted` };
  } catch (err) {
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
