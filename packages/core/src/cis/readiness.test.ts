// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from "vitest";
import { getCisReadiness } from "./readiness";

describe("getCisReadiness", () => {
  it("requires OVAL for XCCDF", () => {
    expect(
      getCisReadiness({ available: true, xccdfFiles: [{ hasOval: false }] }),
    ).toEqual({ detected: true, partial: false, usable: false });
    expect(
      getCisReadiness({ available: true, xccdfFiles: [{ hasOval: true }] }),
    ).toEqual({ detected: true, partial: false, usable: true });
  });

  it("requires positive rules for Azure Policy JSON", () => {
    expect(
      getCisReadiness({ available: true, azurePolicyCisFiles: [{ ruleCount: 0 }] }),
    ).toEqual({ detected: true, partial: false, usable: false });
    expect(
      getCisReadiness({ available: true, azurePolicyCisFiles: [{ ruleCount: 1 }] }),
    ).toEqual({ detected: true, partial: false, usable: true });
  });

  it("requires both mappings and a rule catalog for legacy JSON", () => {
    expect(
      getCisReadiness({ source: "json", legacyMappingsLoaded: true }).usable,
    ).toBe(false);
    expect(getCisReadiness({ legacyRuleCatalogCount: 1 }).usable).toBe(false);
    expect(
      getCisReadiness({
        source: "json",
        legacyMappingsLoaded: true,
        legacyRuleCatalogCount: 1,
      }).usable,
    ).toBe(true);
  });

  it("reports mixed usable and unusable catalogs as partial", () => {
    expect(
      getCisReadiness({
        source: "json",
        legacyMappingsLoaded: true,
        legacyRuleCatalogCount: 0,
        azurePolicyCisFiles: [{ ruleCount: 4 }],
        xccdfFiles: [{ hasOval: false }],
      }),
    ).toEqual({ detected: true, partial: true, usable: true });
  });

  it("does not let a usable catalog hide an invalid legacy source", () => {
    expect(
      getCisReadiness({
        source: "json",
        legacyMappingsLoaded: true,
        legacyRuleCatalogCount: 0,
        azurePolicyCisFiles: [{ ruleCount: 4 }],
      }),
    ).toEqual({ detected: true, partial: true, usable: true });
  });

  it("does not infer legacy readiness from Azure filenames", () => {
    expect(
      getCisReadiness({
        available: true,
        files: [
          { name: "cis-mappings.json", present: true },
          { name: "cis-ws2025-rules.json", present: true },
        ],
        azurePolicyCisFiles: [{ ruleCount: 4 }],
        legacyMappingsLoaded: false,
        legacyRuleCatalogCount: 0,
      }),
    ).toEqual({ detected: true, partial: false, usable: true });
  });
});
