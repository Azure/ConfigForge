// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLibraryFilters } from "./useLibraryFilters";
import type { BaselineEntry } from "../../../data/baseline-catalog";

const fixture: BaselineEntry[] = [
  {
    id: "win-cis-1",
    name: "Windows CIS L1",
    description: "Windows Workstation Level 1",
    platform: "windows",
    category: "cis-benchmark",
    resourceTypes: ["Microsoft.Windows/Registry"],
    version: "1.0.0",
    sourceUrl: "https://example.com/win-cis",
    manifestUrl: undefined,
  } as unknown as BaselineEntry,
  {
    id: "lin-cis-1",
    name: "Linux CIS L1",
    description: "Ubuntu Server Level 1",
    platform: "linux",
    category: "cis-benchmark",
    resourceTypes: ["Microsoft.OSConfig/FileLine"],
    version: "1.0.0",
    sourceUrl: "https://example.com/lin-cis",
    manifestUrl: undefined,
  } as unknown as BaselineEntry,
  {
    id: "win-sec-baseline",
    name: "Microsoft Security Baseline",
    description: "Microsoft Windows Security Baseline",
    platform: "windows",
    category: "security-baseline",
    resourceTypes: ["Microsoft.Windows/Registry", "Microsoft.Windows/Defender"],
    version: "23H2",
    sourceUrl: "https://example.com/baseline",
    manifestUrl: undefined,
  } as unknown as BaselineEntry,
];

describe("useLibraryFilters", () => {
  it("returns the full catalog when no filters are set", () => {
    const { result } = renderHook(() => useLibraryFilters({ catalog: fixture }));
    expect(result.current.filtered.length).toBe(3);
    expect(result.current.search).toBe("");
    expect(result.current.category).toBe("all");
    expect(result.current.platformFilter).toBe("all");
    expect(result.current.expanded).toBeNull();
  });

  it("filters by category", () => {
    const { result } = renderHook(() => useLibraryFilters({ catalog: fixture }));
    act(() => {
      result.current.setCategory("cis-benchmark");
    });
    expect(result.current.filtered.length).toBe(2);
    expect(result.current.filtered.every((b) => b.category === "cis-benchmark")).toBe(true);
  });

  it("filters by platform", () => {
    const { result } = renderHook(() => useLibraryFilters({ catalog: fixture }));
    act(() => {
      result.current.setPlatformFilter("linux");
    });
    expect(result.current.filtered.length).toBe(1);
    expect(result.current.filtered[0].id).toBe("lin-cis-1");
  });

  it("filters by search query against name, description, and resource types (case-insensitive)", () => {
    const { result } = renderHook(() => useLibraryFilters({ catalog: fixture }));

    act(() => {
      result.current.setSearch("defender");
    });
    expect(result.current.filtered.length).toBe(1);
    expect(result.current.filtered[0].id).toBe("win-sec-baseline");

    act(() => {
      result.current.setSearch("LEVEL 1");
    });
    // Both CIS entries mention "Level 1" in description
    expect(result.current.filtered.length).toBe(2);

    act(() => {
      result.current.setSearch("Microsoft.Windows/Registry");
    });
    // Windows entries with Registry resource type
    expect(result.current.filtered.length).toBe(2);
  });

  it("composes category + platform + search filters", () => {
    const { result } = renderHook(() => useLibraryFilters({ catalog: fixture }));

    act(() => {
      result.current.setCategory("cis-benchmark");
      result.current.setPlatformFilter("windows");
    });
    expect(result.current.filtered.length).toBe(1);
    expect(result.current.filtered[0].id).toBe("win-cis-1");

    act(() => {
      result.current.setSearch("ubuntu");
    });
    // No Windows + CIS entry mentions "ubuntu"
    expect(result.current.filtered.length).toBe(0);
  });

  it("setExpanded toggles the disclosure of a card", () => {
    const { result } = renderHook(() => useLibraryFilters({ catalog: fixture }));
    expect(result.current.expanded).toBeNull();
    act(() => {
      result.current.setExpanded("win-cis-1");
    });
    expect(result.current.expanded).toBe("win-cis-1");
    act(() => {
      result.current.setExpanded(null);
    });
    expect(result.current.expanded).toBeNull();
  });
});
