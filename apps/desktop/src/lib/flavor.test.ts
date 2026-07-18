// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("renderer flavor flags", () => {
  it("defaults to full device capabilities", async () => {
    vi.stubEnv("VITE_CFS_FLAVOR", "");
    const flavor = await import("./flavor");
    expect(flavor.FLAVOR).toBe("full");
    expect(flavor.HAS_DEPLOY).toBe(true);
    expect(flavor.HAS_ACTIVITY_FEED).toBe(true);
  });

  it("disables device capabilities for the author flavor", async () => {
    vi.stubEnv("VITE_CFS_FLAVOR", "author");
    const flavor = await import("./flavor");
    expect(flavor.FLAVOR).toBe("author");
    expect(flavor.HAS_DEPLOY).toBe(false);
    expect(flavor.HAS_ELEVATION).toBe(false);
    expect(flavor.HAS_DEVICE_AUDIT).toBe(false);
    expect(flavor.HAS_HEALTH).toBe(false);
    expect(flavor.HAS_ACTIVITY_FEED).toBe(true);
  });
});
