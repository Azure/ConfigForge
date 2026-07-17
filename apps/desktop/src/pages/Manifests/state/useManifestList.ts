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
import type { OscComplianceSummary, OscManifest } from "@configforge/core/types";
import { detectManifestPlatform } from "@configforge/core/platform";
import { useDebounce } from "@configforge/core/use-debounce";
import { cfs } from "../../../lib/cfs";

export type OperatingSystemFilter =
  | "all"
  | "windows"
  | "linux"
  | "mixed"
  | "cross-platform"
  | "unknown";
export type IssuesFilter = "all" | "no-issues" | "has-issues";
export type ComplianceFilter = "all" | "all-compliant" | "partially-compliant" | "not-audited";
export type LastModifiedFilter =
  | "all"
  | "today"
  | "previous-7-days"
  | "previous-30-days"
  | "older-than-30-days"
  | "unknown";

type FilterOption<T extends string> = Exclude<T, "all">;

export interface ManifestComplianceState {
  audited: boolean;
  compliant: number;
  unknown: number;
  total: number;
  ratio: number | null;
  category: FilterOption<ComplianceFilter>;
}

export function getManifestIssueCount(manifest: OscManifest): number {
  return Array.isArray(manifest.Validation?.issues) ? manifest.Validation.issues.length : 0;
}

function normalizedComplianceStatus(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[\s_-]+/g, "") : "";
}

export function getManifestCompliance(manifest: OscManifest): ManifestComplianceState {
  const persisted = manifest.Compliance;
  if (
    persisted &&
    Number.isFinite(persisted.compliant) &&
    Number.isFinite(persisted.nonCompliant)
  ) {
    // "Could not read" / indeterminate resources are not evidence of
    // non-compliance. Exclude them (and transport errors) from the
    // denominator rather than lowering the displayed compliance rate.
    const total = Math.max(0, persisted.compliant) + Math.max(0, persisted.nonCompliant);
    const unknown = Math.max(0, persisted.indeterminate) + Math.max(0, persisted.errors);
    if (total === 0) {
      return {
        audited: false,
        compliant: 0,
        unknown,
        total: 0,
        ratio: null,
        category: "not-audited",
      };
    }
    const compliant = Math.max(0, Math.min(persisted.compliant, total));
    const ratio = compliant / total;
    return {
      audited: true,
      compliant,
      unknown,
      total,
      ratio,
      category:
        compliant === total && unknown === 0 ? "all-compliant" : "partially-compliant",
    };
  }

  const statuses = (manifest.Resources ?? [])
    .map((resource) => normalizedComplianceStatus(resource.compliance?.status))
    .filter(Boolean);
  const determinateStatuses = statuses.filter(
    (status) => status === "compliant" || status === "noncompliant",
  );
  if (determinateStatuses.length === 0) {
    return {
      audited: false,
      compliant: 0,
      unknown: statuses.length,
      total: 0,
      ratio: null,
      category: "not-audited",
    };
  }
  const compliant = determinateStatuses.filter((status) => status === "compliant").length;
  const unknown = statuses.length - determinateStatuses.length;
  return {
    audited: true,
    compliant,
    unknown,
    total: determinateStatuses.length,
    ratio: compliant / determinateStatuses.length,
    category:     compliant === determinateStatuses.length && unknown === 0
      ? "all-compliant"
      : "partially-compliant",
  };
}

export function getManifestLastModifiedDate(manifest: OscManifest): Date | null {
  const timestamp = Date.parse(manifest.LastModifiedAt ?? "");
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export function getLastModifiedBucket(
  manifest: OscManifest,
  now = Date.now(),
): FilterOption<LastModifiedFilter> {
  const modified = getManifestLastModifiedDate(manifest);
  if (!modified) return "unknown";

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const modifiedDay = new Date(modified.getTime());
  modifiedDay.setHours(0, 0, 0, 0);
  const dayDifference = Math.floor(
    (today.getTime() - modifiedDay.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (dayDifference <= 0) return "today";
  if (dayDifference <= 7) return "previous-7-days";
  if (dayDifference <= 30) return "previous-30-days";
  return "older-than-30-days";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function normalizeCompliance(value: unknown): OscComplianceSummary | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const fields = [
    source.total,
    source.compliant,
    source.nonCompliant,
    source.indeterminate,
    source.errors,
  ];
  if (!fields.every((field) => typeof field === "number" && Number.isFinite(field))) {
    return null;
  }
  return {
    auditedAt: optionalString(source.auditedAt) ?? "",
    total: source.total as number,
    compliant: source.compliant as number,
    nonCompliant: source.nonCompliant as number,
    indeterminate: source.indeterminate as number,
    errors: source.errors as number,
  };
}

function normalizeValidation(value: unknown): OscManifest["Validation"] {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return {
    hasSchema: source.hasSchema === true,
    hasEnforcementValues: source.hasEnforcementValues === true,
    hasComplianceCriteria: source.hasComplianceCriteria === true,
    issues: Array.isArray(source.issues)
      ? source.issues.filter((issue): issue is string => typeof issue === "string")
      : [],
  };
}

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
  operatingSystemFilter: OperatingSystemFilter;
  setOperatingSystemFilter: (filter: OperatingSystemFilter) => void;
  issuesFilter: IssuesFilter;
  setIssuesFilter: (filter: IssuesFilter) => void;
  complianceFilter: ComplianceFilter;
  setComplianceFilter: (filter: ComplianceFilter) => void;
  lastModifiedFilter: LastModifiedFilter;
  setLastModifiedFilter: (filter: LastModifiedFilter) => void;
  filterOptions: {
    operatingSystems: FilterOption<OperatingSystemFilter>[];
    issues: FilterOption<IssuesFilter>[];
    compliance: FilterOption<ComplianceFilter>[];
    lastModified: FilterOption<LastModifiedFilter>[];
  };
  /** Map of manifest name → resolved platform (memoised on
   * `manifests` identity so the 360-resource bulk-deploy check
   * doesn't re-run on every render). */
  platformByName: Map<string, string>;
  fetchManifests: (options?: { force?: boolean }) => Promise<void>;
}

export function useManifestList(): ManifestListState {
  const [manifests, setManifests] = useState<OscManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 200);
  const [operatingSystemFilter, setOperatingSystemFilter] = useState<OperatingSystemFilter>("all");
  const [issuesFilter, setIssuesFilter] = useState<IssuesFilter>("all");
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>("all");
  const [lastModifiedFilter, setLastModifiedFilter] = useState<LastModifiedFilter>("all");

  // v0.1.14: token-bail on `cfs.manifests.list` to prevent stale
  // responses from a slower earlier Refresh clobbering newer state.
  // Without this, rapid-fire Refresh clicks could flicker the UI
  // between earlier (stale) and later (fresh) manifest lists. We
  // bump the token on every fetch and ignore any setState that
  // doesn't match the current token. (Fetch-race protection medium
  // from the v0.1.13 edge-case backlog.)
  const listTokenRef = useRef(0);

  const fetchManifests = useCallback(async (options: { force?: boolean } = {}) => {
    const myToken = ++listTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const json = await cfs.manifests.list(options.force === true ? { force: true } : {});
      if (myToken !== listTokenRef.current) return;
      const data = (json as { data?: unknown }).data;
      const raw: unknown[] = Array.isArray(data) ? data : data ? [data] : [];
      const normalized = raw
        .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
        .map((m) => {
          const name = (m.Name ?? m.name ?? "unnamed") as string;
          const revision = optionalString(m.Revision ?? m.revision);
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
                if (parsed.revision === revision && parsed.resources?.length) {
                  resources = parsed.resources;
                }
              }
            } catch {
              /* ignore */
            }
          }
          return {
            Name: name,
            DisplayName: String(m.DisplayName ?? m.displayName ?? name),
            Source: (m.Source ?? m.source ?? "Local") as string,
            RegistrationSource:
              m.RegistrationSource === "user" ||
              m.RegistrationSource === "library" ||
              m.RegistrationSource === "import"
                ? m.RegistrationSource
                : null,
            RegistrationSourceId: optionalString(m.RegistrationSourceId),
            Status: (m.Status ?? m.status) as string | undefined,
            Platform: (m.Platform ?? m.platform) as string | undefined,
            Resources: resources,
            ResourceCount:
              typeof (m.ResourceCount ?? m.resourceCount) === "number"
                ? ((m.ResourceCount ?? m.resourceCount) as number)
                : (resources?.length ?? 0),
            Validation: normalizeValidation(m.Validation ?? m.validation),
            Compliance: normalizeCompliance(m.Compliance ?? m.compliance),
            Deployed: Boolean(m.Deployed ?? m.deployed),
            LastAppliedAt: (m.LastAppliedAt ?? m.lastAppliedAt ?? null) as string | null,
            LastAuditedAt: optionalString(m.LastAuditedAt ?? m.lastAuditedAt),
            RegisteredAt: optionalString(m.RegisteredAt ?? m.registeredAt),
            LastModifiedAt: optionalString(
              m.LastModifiedAt ?? m.lastModifiedAt ?? m.RegisteredAt ?? m.registeredAt,
            ),
            Revision: revision,
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

  const filterOptions = useMemo<ManifestListState["filterOptions"]>(() => {
    const operatingSystems = Array.from(new Set(platformByName.values()))
      .map((platform) =>
        platform === "windows" ||
        platform === "linux" ||
        platform === "mixed" ||
        platform === "cross-platform"
          ? platform
          : "unknown",
      )
      .filter((platform, index, values) => values.indexOf(platform) === index)
      .sort((a, b) => a.localeCompare(b)) as FilterOption<OperatingSystemFilter>[];

    const issueSet = new Set(
      manifests.map((manifest) =>
        getManifestIssueCount(manifest) > 0 ? "has-issues" : "no-issues",
      ),
    );
    const complianceSet = new Set(
      manifests.map((manifest) => getManifestCompliance(manifest).category),
    );
    const lastModifiedSet = new Set(manifests.map((manifest) => getLastModifiedBucket(manifest)));

    const issueOrder: FilterOption<IssuesFilter>[] = ["no-issues", "has-issues"];
    const complianceOrder: FilterOption<ComplianceFilter>[] = [
      "all-compliant",
      "partially-compliant",
      "not-audited",
    ];
    const lastModifiedOrder: FilterOption<LastModifiedFilter>[] = [
      "today",
      "previous-7-days",
      "previous-30-days",
      "older-than-30-days",
      "unknown",
    ];
    return {
      operatingSystems,
      issues: issueOrder.filter((option) => issueSet.has(option)),
      compliance: complianceOrder.filter((option) => complianceSet.has(option)),
      lastModified: lastModifiedOrder.filter((option) => lastModifiedSet.has(option)),
    };
  }, [manifests, platformByName]);

  // A controlled <select> whose value no longer has a matching <option>
  // visually falls back to its first option while React retains the stale
  // value. Reset removed options so the visible "All" state and predicates
  // cannot diverge after refresh/delete.
  useEffect(() => {
    if (
      operatingSystemFilter !== "all" &&
      !filterOptions.operatingSystems.includes(operatingSystemFilter)
    ) {
      setOperatingSystemFilter("all");
    }
    if (issuesFilter !== "all" && !filterOptions.issues.includes(issuesFilter)) {
      setIssuesFilter("all");
    }
    if (complianceFilter !== "all" && !filterOptions.compliance.includes(complianceFilter)) {
      setComplianceFilter("all");
    }
    if (lastModifiedFilter !== "all" && !filterOptions.lastModified.includes(lastModifiedFilter)) {
      setLastModifiedFilter("all");
    }
  }, [complianceFilter, filterOptions, issuesFilter, lastModifiedFilter, operatingSystemFilter]);

  // Search only fields represented as baseline identity in this table.
  // Resource names and types are intentionally excluded: common settings
  // such as "blank password" and Microsoft.Windows/* otherwise make a
  // namespace search appear unresponsive until the query becomes specific.
  const filteredManifests = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return manifests.filter((manifest) => {
      if (
        q &&
        !manifest.Name.toLowerCase().includes(q) &&
        !manifest.DisplayName?.toLowerCase().includes(q)
      ) {
        return false;
      }

      const platform = platformByName.get(manifest.Name) ?? "unknown";
      if (
        operatingSystemFilter !== "all" &&
        (platform === operatingSystemFilter ||
          (operatingSystemFilter === "unknown" &&
            !["windows", "linux", "mixed", "cross-platform"].includes(platform))) === false
      ) {
        return false;
      }

      const issueCategory = getManifestIssueCount(manifest) > 0 ? "has-issues" : "no-issues";
      if (issuesFilter !== "all" && issueCategory !== issuesFilter) return false;

      const complianceCategory = getManifestCompliance(manifest).category;
      if (complianceFilter !== "all" && complianceCategory !== complianceFilter) {
        return false;
      }

      if (lastModifiedFilter !== "all" && getLastModifiedBucket(manifest) !== lastModifiedFilter) {
        return false;
      }
      return true;
    });
  }, [
    manifests,
    debouncedSearch,
    platformByName,
    operatingSystemFilter,
    issuesFilter,
    complianceFilter,
    lastModifiedFilter,
  ]);

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
      operatingSystemFilter,
      setOperatingSystemFilter,
      issuesFilter,
      setIssuesFilter,
      complianceFilter,
      setComplianceFilter,
      lastModifiedFilter,
      setLastModifiedFilter,
      filterOptions,
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
      operatingSystemFilter,
      issuesFilter,
      complianceFilter,
      lastModifiedFilter,
      filterOptions,
      platformByName,
      fetchManifests,
    ],
  );
}
