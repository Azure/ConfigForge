// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANIFEST_VIEWER_MODE_STORAGE_KEY,
  readManifestViewerMode,
  writeManifestViewerMode,
} from "./viewer-mode-preference";

describe("manifest viewer mode preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults each baseline to Code mode", () => {
    expect(readManifestViewerMode("baseline-a")).toBe("code");
  });

  it("stores modes independently per baseline", () => {
    writeManifestViewerMode("baseline-a", "visual");
    writeManifestViewerMode("baseline-b", "code");

    expect(readManifestViewerMode("baseline-a")).toBe("visual");
    expect(readManifestViewerMode("baseline-b")).toBe("code");
  });

  it("ignores malformed and unsupported persisted values", () => {
    window.localStorage.setItem(
      MANIFEST_VIEWER_MODE_STORAGE_KEY,
      JSON.stringify({
        valid: "visual",
        invalid: "preview",
      }),
    );

    expect(readManifestViewerMode("valid")).toBe("visual");
    expect(readManifestViewerMode("invalid")).toBe("code");
  });

  it("does not break the viewer when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => writeManifestViewerMode("baseline-a", "visual")).not.toThrow();
  });
});
