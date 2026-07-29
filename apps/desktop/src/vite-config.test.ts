// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

describe("Vite renderer targets", () => {
  it("uses ES2022 for builds and dependency optimization", async () => {
    const config = await viteConfig({
      command: "serve",
      mode: "development",
      isSsrBuild: false,
      isPreview: false,
    });

    expect(config.build?.target).toBe("es2022");
    expect(config.optimizeDeps?.esbuildOptions?.target).toBe("es2022");
  });
});
