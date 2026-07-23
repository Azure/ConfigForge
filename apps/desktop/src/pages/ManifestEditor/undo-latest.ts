// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
  safeRestore,
  type RestoreClient,
  type RestoreResult,
} from "@configforge/core/history/restore";

interface HistoryEntryMeta {
  id: string;
  timestamp?: string;
}

export interface HistoryListApi {
  list: (request: {
    name: string;
    id?: string;
  }) => Promise<{ data?: unknown }>;
}

export const NO_PREVIOUS_VERSION_ERROR = "No previous saved version is available to undo.";

function normalizeEntries(response: { data?: unknown }): HistoryEntryMeta[] {
  if (!Array.isArray(response.data)) return [];
  return response.data
    .filter(
      (entry): entry is HistoryEntryMeta =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as { id?: unknown }).id === "string",
    )
    .sort((left, right) =>
      (right.timestamp ?? "").localeCompare(left.timestamp ?? ""),
    );
}

function normalizeYaml(source: string): string {
  return source.replace(/\r\n/g, "\n").trim();
}

async function findUndoSnapshotId(
  manifestName: string,
  history: HistoryListApi,
  restoreClient: RestoreClient,
): Promise<string | null> {
  const [response, currentYaml] = await Promise.all([
    history.list({ name: manifestName }),
    restoreClient.fetchCurrentYaml(manifestName),
  ]);
  const normalizedCurrent = normalizeYaml(currentYaml);
  for (const entry of normalizeEntries(response)) {
    const snapshot = await restoreClient.fetchSnapshotContent(
      manifestName,
      entry.id,
    );
    if (normalizeYaml(snapshot) !== normalizedCurrent) return entry.id;
  }
  return null;
}

export async function hasUndoableHistory(
  manifestName: string,
  history: HistoryListApi,
  restoreClient: RestoreClient,
): Promise<boolean> {
  return (await findUndoSnapshotId(manifestName, history, restoreClient)) !== null;
}

export async function undoLatestManifestChange(
  manifestName: string,
  history: HistoryListApi,
  restoreClient: RestoreClient,
): Promise<RestoreResult> {
  const snapshotId = await findUndoSnapshotId(
    manifestName,
    history,
    restoreClient,
  );
  if (!snapshotId) {
    return {
      ok: false,
      autoSnapshotted: false,
      error: NO_PREVIOUS_VERSION_ERROR,
    };
  }
  return safeRestore(manifestName, snapshotId, restoreClient);
}
