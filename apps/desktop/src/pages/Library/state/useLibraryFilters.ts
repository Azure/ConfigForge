// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useMemo, useState } from "react";
import { BASELINE_CATALOG, CATEGORIES, type BaselineEntry } from "../../../data/baseline-catalog";

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type PlatformFilter = "all" | "windows" | "linux";

export interface UseLibraryFiltersOptions {
  /** Optional override for the catalog. Tests may pass a smaller fixture. */
  catalog?: readonly BaselineEntry[];
}

/**
 * Owns the Library page's filter UI state (search, category, platform)
 * and the derived filtered catalog list. Pure, deterministic — does not
 * touch IPC or sessionStorage.
 */
export function useLibraryFilters(options: UseLibraryFiltersOptions = {}) {
  const catalog = options.catalog ?? BASELINE_CATALOG;

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return catalog.filter((b) => {
      if (category !== "all" && b.category !== category) return false;
      if (platformFilter !== "all" && b.platform !== platformFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          b.name.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.resourceTypes.some((rt) => rt.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [catalog, category, platformFilter, search]);

  return {
    search,
    setSearch,
    category,
    setCategory,
    platformFilter,
    setPlatformFilter,
    expanded,
    setExpanded,
    filtered,
  };
}
