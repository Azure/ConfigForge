// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it, vi } from "vitest";
import type { RestoreClient } from "@configforge/core/history/restore";
import {
  hasUndoableHistory,
  NO_PREVIOUS_VERSION_ERROR,
  undoLatestManifestChange,
} from "./undo-latest";

function restoreClient(
  snapshots: Record<string, string> = {
    current: "resources:\n  - name: current\n",
    previous: "resources:\n  - name: previous\n",
  },
): RestoreClient {
  return {
    fetchSnapshotContent: vi
      .fn()
      .mockImplementation(async (_name: string, id: string) => snapshots[id] ?? ""),
    fetchCurrentYaml: vi.fn().mockResolvedValue("resources:\n  - name: current\n"),
    saveAutoSnapshot: vi.fn().mockResolvedValue(undefined),
    registerManifest: vi.fn().mockResolvedValue(undefined),
  };
}

describe("undoLatestManifestChange", () => {
  it("restores the newest snapshot whose content differs from the current YAML", async () => {
    const history = {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: "late-previous", timestamp: "2026-07-22T10:00:00.000Z" },
          { id: "current", timestamp: "2026-07-22T09:00:00.000Z" },
        ],
      }),
    };
    const client = restoreClient({
      "late-previous": "resources:\n  - name: previous\n",
      current: "resources:\n  - name: current\n",
    });

    await expect(
      undoLatestManifestChange("sample", history, client),
    ).resolves.toEqual({ ok: true, autoSnapshotted: true });

    expect(client.fetchSnapshotContent).toHaveBeenCalledWith(
      "sample",
      "late-previous",
    );
    expect(client.saveAutoSnapshot).toHaveBeenCalledWith(
      "sample",
      "resources:\n  - name: current\n",
      "Auto-snapshot before restore of late-previous",
    );
    expect(client.registerManifest).toHaveBeenCalledWith(
      "sample",
      "resources:\n  - name: previous\n",
    );
  });

  it("reports unavailable when there is no prior saved version", async () => {
    const history = {
      list: vi.fn().mockResolvedValue({
        data: [{ id: "current", timestamp: "2026-07-22T10:00:00.000Z" }],
      }),
    };
    const client = restoreClient();

    await expect(
      undoLatestManifestChange("sample", history, client),
    ).resolves.toEqual({
      ok: false,
      autoSnapshotted: false,
      error: NO_PREVIOUS_VERSION_ERROR,
    });
    expect(client.registerManifest).not.toHaveBeenCalled();
  });

  it("detects whether history contains a version different from current YAML", async () => {
    const history = {
      list: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ id: "current" }] })
        .mockResolvedValueOnce({
          data: [{ id: "current" }, { id: "previous" }],
        }),
    };
    const client = restoreClient();

    await expect(
      hasUndoableHistory("sample", history, client),
    ).resolves.toBe(false);
    await expect(
      hasUndoableHistory("sample", history, client),
    ).resolves.toBe(true);
  });
});
