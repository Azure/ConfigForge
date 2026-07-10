// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Manifests page list state — fetch + token-bail race-guard +
 * search filter + memoised platform lookup.
 *
 * Extracted from `Manifests.tsx` page body. Owns the v0.1.14 race
 * guard that drops stale `cfs.manifests.list` responses when the
 * user double-Refreshes (without this, faster later list could be
 * clobbered by a slower earlier one resolving last).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OscManifest } from "@configforge/core/types";
import { detectManifestPlatform } from "@configforge/core/platform";
import { useDebounce } from "@configforge/core/use-debounce";
import { cfs } from "../../../lib/cfs";

export interface ManifestListState {
  manifests: OscManifest[];
  setManifests: React.Dispatch<React.SetStateAction<OscManifest[]>>;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  /** Debounced search value (200ms) for performance with large lists. */
  debouncedSearch: string;
  filteredManifests: OscManifest[];
  /** Map of manifest name → resolved platform (memoised on
   * `manifests` identity so the 360-resource bulk-deploy check
   * doesn't re-run on every render). */
  platformByName: Map<string, string>;
  fetchManifests: () => Promise<void>;
}

export function useManifestList(): ManifestListState {
  const [manifests, setManifests] = useState<OscManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 200);

  // v0.1.14: token-bail on `cfs.manifests.list` to prevent stale
  // responses from a slower earlier Refresh clobbering newer state.
  // Without this, rapid-fire Refresh clicks could flicker the UI
  // between earlier (stale) and later (fresh) manifest lists. We
  // bump the token on every fetch and ignore any setState that
  // doesn't match the current token. (Fetch-race protection medium
  // from the v0.1.13 edge-case backlog.)
  const listTokenRef = useRef(0);

  const fetchManifests = useCallback(async () => {
    const myToken = ++listTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const json = await cfs.manifests.list({});
      if (myToken !== listTokenRef.current) return;
      const data = (json as { data?: unknown }).data;
      const raw: unknown[] = Array.isArray(data) ? data : data ? [data] : [];
      const normalized = raw
        .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
        .map((m) => {
          const name = (m.Name ?? m.name ?? "unnamed") as string;
          let resources = (m.Resources ?? m.resources ?? []) as OscManifest["Resources"];
          if (
            !resources ||
            resources.length === 0 ||
            !resources.some((r) => r.compliance?.status)
          ) {
            try {
              const cached = sessionStorage.getItem(`configforge-compliance-${name}`);
              if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.resources?.length) resources = parsed.resources;
              }
            } catch {
              /* ignore */
            }
          }
          return {
            Name: name,
            Source: (m.Source ?? m.source ?? "Local") as string,
            Status: (m.Status ?? m.status) as string | undefined,
            Platform: (m.Platform ?? m.platform) as string | undefined,
            Resources: resources,
            Deployed: Boolean(m.Deployed ?? m.deployed),
            LastAppliedAt: (m.LastAppliedAt ?? m.lastAppliedAt ?? null) as string | null,
          };
        })
        .filter((m) => m.Name && m.Name !== "unnamed");
      if (myToken !== listTokenRef.current) return;
      setManifests(normalized);
    } catch (err) {
      if (myToken !== listTokenRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (myToken === listTokenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchManifests();
  }, [fetchManifests]);

  // Search filter (uses debounced value for performance)
  const filteredManifests = useMemo(() => {
    if (!debouncedSearch.trim()) return manifests;
    const q = debouncedSearch.toLowerCase();
    return manifests.filter((m) => {
      if (m.Name.toLowerCase().includes(q)) return true;
      if (m.Resources?.some((r) => r.type?.toLowerCase().includes(q))) return true;
      if (m.Resources?.some((r) => r.name?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [manifests, debouncedSearch]);

  // v0.1.14: precompute platform per manifest once instead of in the
  // card-map AND in bulk handlers. Previously detectManifestPlatform
  // ran for every card on every render — for a 50-manifest tenant
  // with ~300 resources each that's 15K detect-platform calls per
  // re-render. Memoizing by manifests-array identity keeps it to one
  // pass per change. (Perf medium from the v0.1.13 edge-case backlog.)
  const platformByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of manifests) {
      const p =
        (m as unknown as { Platform?: string }).Platform ??
        detectManifestPlatform((m.Resources ?? []).map((r) => ({ type: r.type })));
      map.set(m.Name, p);
    }
    return map;
  }, [manifests]);

  return useMemo(
    () => ({
      manifests,
      setManifests,
      loading,
      error,
      setError,
      searchQuery,
      setSearchQuery,
      debouncedSearch,
      filteredManifests,
      platformByName,
      fetchManifests,
    }),
    [
      manifests,
      loading,
      error,
      searchQuery,
      debouncedSearch,
      filteredManifests,
      platformByName,
      fetchManifests,
    ],
  );
}
