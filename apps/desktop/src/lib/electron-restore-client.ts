// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.2.21 — Electron-backed `RestoreClient` for `safeRestore`.
 *
 * The shared `defaultBrowserClient()` in
 * `@configforge/core/history/restore.ts` uses `fetch('/api/...')` —
 * a Next.js-era pattern that has no server in the packaged Electron
 * app. Every restore attempt silently fails with "Failed to fetch."
 *
 * This client delegates the same four operations
 * (`fetchSnapshotContent`, `fetchCurrentYaml`, `saveAutoSnapshot`,
 * `registerManifest`) to the live IPC bridge via `window.cfs.*`. The
 * History page should pass `electronRestoreClient(name)` into
 * `safeRestore()` instead of `defaultBrowserClient()`.
 */
import type { RestoreClient } from '@configforge/core/history/restore';
import { cfs } from './cfs';

export function electronRestoreClient(): RestoreClient {
  return {
    async fetchSnapshotContent(name, id) {
      // `cfs.history.list({name, id})` dispatches to `getHistoryEntry`
      // when an id is present; the response shape is `{data: {...snapshot}}`
      // with `content` on the snapshot object.
      const entry = await cfs.history.list({ name, id });
      const data = (entry as { data?: { content?: string } | null }).data;
      if (!data || typeof data.content !== 'string') {
        throw new Error(`Snapshot '${id}' not found for manifest '${name}'`);
      }
      return data.content;
    },
    async fetchCurrentYaml(name) {
      try {
        // `manifests.status` returns reconstructed YAML for the
        // currently-registered manifest (the same source we read in
        // the conflict detector since v0.2.17).
        const json = await cfs.manifests.status(name);
        const data = (json as { data?: unknown }).data;
        if (typeof data === 'string') return data;
        if (data == null) return '';
        return JSON.stringify(data, null, 2);
      } catch {
        // If the manifest isn't currently registered, treat as
        // "no current YAML" — the restore proceeds without an
        // auto-snapshot (matches `defaultBrowserClient` behavior).
        return '';
      }
    },
    async saveAutoSnapshot(name, currentYaml, message) {
      await cfs.history.save({ name, content: currentYaml, message });
    },
    async registerManifest(name, yaml) {
      await cfs.manifests.register({ name, content: yaml });
    },
  };
}
