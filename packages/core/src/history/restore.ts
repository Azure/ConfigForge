// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Safe restore: auto-snapshots the current manifest YAML BEFORE re-registering
 * with the snapshot content, so the user always has a recovery point if the
 * registration step fails.
 *
 * Implementation note: the operations are injected via the `RestoreClient`
 * interface so unit tests can drive each branch (snapshot-fetch failure,
 * empty current registration, auto-snapshot failure, register failure)
 * without spinning up the Next runtime or hitting disk.
 */

export interface RestoreClient {
  /** Read snapshot content. Throw if not found / unreachable. */
  fetchSnapshotContent: (name: string, id: string) => Promise<string>;
  /**
   * Read the current registered YAML. Throw on unrecoverable error.
   * Return '' when there is no current registration (e.g. registered-then-
   * deleted-from-CLI). An empty string short-circuits auto-snapshot.
   */
  fetchCurrentYaml: (name: string) => Promise<string>;
  /** Save current YAML as a new history entry. */
  saveAutoSnapshot: (name: string, currentYaml: string, message: string) => Promise<void>;
  /** Re-register the manifest with the snapshot content. */
  registerManifest: (name: string, yaml: string) => Promise<void>;
}

export interface RestoreResult {
  ok: boolean;
  /** True iff an auto-snapshot of the prior state was successfully written. */
  autoSnapshotted: boolean;
  error?: string;
}

/** Build a default RestoreClient backed by `fetch` against the local API. */
export function defaultBrowserClient(): RestoreClient {
  return {
    async fetchSnapshotContent(name, id) {
      const r = await fetch(
        `/api/history?name=${encodeURIComponent(name)}&id=${encodeURIComponent(id)}`,
      );
      const j = (await r.json()) as { data?: { content?: string }; error?: string };
      if (!r.ok || !j?.data?.content) {
        throw new Error(j?.error ?? 'Snapshot not found');
      }
      return j.data.content;
    },
    async fetchCurrentYaml(name) {
      const r = await fetch(
        `/api/manifests?name=${encodeURIComponent(name)}&format=Yaml`,
      );
      if (!r.ok) {
        // If the manifest isn't currently registered we treat that as "no
        // current YAML" rather than a hard error — the restore proceeds
        // without an auto-snapshot.
        return '';
      }
      const j = (await r.json()) as { data?: unknown };
      const data = j?.data;
      if (data == null) return '';
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    },
    async saveAutoSnapshot(name, currentYaml, message) {
      const r = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: currentYaml, message }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `auto-snapshot HTTP ${r.status}`);
    },
    async registerManifest(name, yaml) {
      const r = await fetch('/api/manifests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: yaml }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `register HTTP ${r.status}`);
    },
  };
}

/**
 * Orchestrate a safe restore.
 *
 * Order of operations (must not change without updating tests):
 *   1. Fetch snapshot content (no side effects yet).
 *   2. Fetch current YAML ('' is allowed only when the lookup succeeds and
 *      confirms there is no current registration).
 *   3. Auto-snapshot current YAML — IF non-empty. If this step fails we
 *      refuse to proceed: re-registering without a recovery point would
 *      be a destructive operation with no rollback.
 *   4. Re-register with the snapshot content.
 *
 * Returns `{ ok, autoSnapshotted, error? }`. `autoSnapshotted=true` when
 * step 3 succeeded; the caller can use this to surface "your previous
 * state is in history as <auto-snapshot-id>" UX.
 */
export async function safeRestore(
  manifestName: string,
  snapshotId: string,
  client: RestoreClient,
): Promise<RestoreResult> {
  let snapshotContent: string;
  try {
    snapshotContent = await client.fetchSnapshotContent(manifestName, snapshotId);
  } catch (err) {
    return {
      ok: false,
      autoSnapshotted: false,
      error: `Snapshot fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let currentYaml = '';
  try {
    currentYaml = await client.fetchCurrentYaml(manifestName);
  } catch (err) {
    return {
      ok: false,
      autoSnapshotted: false,
      error: `Current manifest fetch failed (refusing to restore without knowing whether a recovery snapshot is required): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let autoSnapshotted = false;
  if (currentYaml) {
    try {
      await client.saveAutoSnapshot(
        manifestName,
        currentYaml,
        `Auto-snapshot before restore of ${snapshotId}`,
      );
      autoSnapshotted = true;
    } catch (err) {
      return {
        ok: false,
        autoSnapshotted: false,
        error: `Auto-snapshot failed (refusing to restore without a recovery point): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  try {
    await client.registerManifest(manifestName, snapshotContent);
  } catch (err) {
    return {
      ok: false,
      autoSnapshotted,
      error: `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, autoSnapshotted };
}
