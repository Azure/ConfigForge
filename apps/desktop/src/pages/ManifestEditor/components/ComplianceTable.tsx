// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Compliance status table for the ManifestEditor page.
 *
 * Renders the per-resource compliance grid with row-expansion + the
 * v0.1.13 "show all" cap (INITIAL_TABLE_ROWS) for large manifests.
 *
 * Phase C.4 of the page-split refactor.
 */
import React, { useMemo, useState } from "react";
import {
  ArrowSortDownRegular,
  ArrowSortRegular,
  ArrowSortUpRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { OscResource } from "@configforge/core/types";
import { ComplianceBadge } from "../../../components/compliance-badge";
import { INITIAL_TABLE_ROWS, normalizeStatus, ResourceDetailPanel } from "../helpers";

export interface ComplianceTableProps {
  resources: OscResource[];
  expandedResource: number | null;
  setExpandedResource: (idx: number | null) => void;
  complianceShowAll: boolean;
  setComplianceShowAll: (show: boolean) => void;
  showHeader?: boolean;
}

type ComplianceFilter = "all" | "compliant" | "noncompliant" | "unread";
type ComplianceSort = null | "ascending" | "descending";

function statusBucket(resource: OscResource): Exclude<ComplianceFilter, "all"> {
  const status = normalizeStatus(resource.compliance?.status);
  if (status === "compliant") return "compliant";
  if (status === "noncompliant") return "noncompliant";
  return "unread";
}

function statusRank(resource: OscResource): number {
  const bucket = statusBucket(resource);
  if (bucket === "compliant") return 0;
  if (bucket === "unread") return 1;
  return 2;
}

export const ComplianceTable = React.memo(function ComplianceTable({
  resources,
  expandedResource,
  setExpandedResource,
  complianceShowAll,
  setComplianceShowAll,
  showHeader = true,
}: ComplianceTableProps) {
  const { t } = useTranslation("manifest-editor");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ComplianceFilter>("all");
  const [statusSort, setStatusSort] = useState<ComplianceSort>(null);

  const filteredResources = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = resources.filter((resource) => {
      if (statusFilter !== "all" && statusBucket(resource) !== statusFilter) return false;
      if (!query) return true;
      return (
        resource.name.toLowerCase().includes(query) ||
        resource.type.toLowerCase().includes(query) ||
        (resource.compliance?.reason ?? "").toLowerCase().includes(query)
      );
    });
    if (!statusSort) return filtered;
    const direction = statusSort === "ascending" ? 1 : -1;
    return [...filtered].sort(
      (left, right) =>
        (statusRank(left) - statusRank(right)) * direction ||
        left.name.localeCompare(right.name),
    );
  }, [resources, search, statusFilter, statusSort]);

  const resetTableView = () => {
    setExpandedResource(null);
    setComplianceShowAll(false);
  };

  const cycleStatusSort = () => {
    setStatusSort((current) =>
      current === null ? "ascending" : current === "ascending" ? "descending" : null,
    );
    setExpandedResource(null);
  };

  const visibleResources = complianceShowAll
    ? filteredResources
    : filteredResources.slice(0, INITIAL_TABLE_ROWS);

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {showHeader && (
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t("compliance.sectionTitle")}
          </h2>
        </div>
      )}

      {resources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-sm text-slate-400 dark:text-slate-500">
          {/* v0.3.0 (#8a): explicit guidance on how to get data here.
              Previously this said only "No compliance data available."
              which left first-time users wondering where to click. */}
          <p className="mb-2 text-slate-600 dark:text-slate-300">{t("compliance.emptyTitle")}</p>
          <p className="text-xs">{t("compliance.emptyDescription")}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <SearchRegular
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  resetTableView();
                }}
                aria-label={t("compliance.searchLabel")}
                placeholder={t("compliance.searchPlaceholder")}
                className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as ComplianceFilter);
                resetTableView();
              }}
              aria-label={t("compliance.filterStatus")}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">{t("compliance.allStatuses")}</option>
              <option value="compliant">{t("deployResult.compliant")}</option>
              <option value="noncompliant">{t("deployResult.nonCompliant")}</option>
              <option value="unread">{t("deployResult.couldNotRead")}</option>
            </select>
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
              {t("compliance.showing", {
                filtered: filteredResources.length,
                total: resources.length,
              })}
            </span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="pl-6 pr-2 py-2 font-medium text-slate-500 dark:text-slate-400 w-8"></th>
                <th
                  className="px-4 py-2 font-medium text-slate-500 dark:text-slate-400"
                  style={{ width: "28%" }}
                >
                  {t("tables.resource")}
                </th>
                <th
                  className="px-4 py-2 font-medium text-slate-500 dark:text-slate-400"
                  style={{ width: "22%" }}
                >
                  {t("tables.type")}
                </th>
                <th
                  aria-sort={statusSort ?? undefined}
                  className="px-4 pr-6 py-2 font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
                  style={{ width: "120px" }}
                >
                  <button
                    type="button"
                    onClick={cycleStatusSort}
                    aria-label={t("compliance.sortStatus")}
                    className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t("tables.status")}
                    {statusSort === null ? (
                      <ArrowSortRegular className="h-3 w-3" />
                    ) : statusSort === "ascending" ? (
                      <ArrowSortUpRegular className="h-3 w-3 text-blue-600" />
                    ) : (
                      <ArrowSortDownRegular className="h-3 w-3 text-blue-600" />
                    )}
                  </button>
                </th>
                <th className="pl-6 pr-4 py-2 font-medium text-slate-500 dark:text-slate-400">
                  {t("tables.reason")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {/* perf W2 / C1: render only the first INITIAL_TABLE_ROWS */}
              {visibleResources.map((resource, idx) => {
                  const isExpanded = expandedResource === idx;
                  return (
                    <React.Fragment key={idx}>
                      <tr
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer select-none"
                        onClick={() => setExpandedResource(isExpanded ? null : idx)}
                      >
                        <td className="pl-6 pr-2 py-2 align-middle text-slate-400 dark:text-slate-500">
                          {isExpanded ? (
                            <ChevronDownRegular className="h-4 w-4" />
                          ) : (
                            <ChevronRightRegular className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-4 py-2 align-middle font-medium text-slate-900 dark:text-white">
                          <span className="block truncate" title={resource.name}>
                            {resource.name}
                          </span>
                        </td>
                        <td className="px-4 py-2 align-middle text-slate-600 dark:text-slate-400">
                          <code
                            className="inline-block max-w-full truncate rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800"
                            title={resource.type}
                          >
                            {resource.type}
                          </code>
                        </td>
                        <td className="px-4 pr-6 py-2 align-middle whitespace-nowrap">
                          <ComplianceBadge
                            status={normalizeStatus(resource.compliance?.status)}
                            reason={resource.compliance?.reason}
                          />
                        </td>
                        <td
                          className="pl-6 pr-4 py-2 align-middle text-sm text-slate-500 dark:text-slate-400"
                        >
                          <span
                            className="block truncate"
                            title={resource.compliance?.reason ?? undefined}
                          >
                            {resource.compliance?.reason || "-"}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="px-0 py-0">
                            <ResourceDetailPanel resource={resource} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              {filteredResources.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    {t("compliance.noMatches")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!complianceShowAll && filteredResources.length > INITIAL_TABLE_ROWS && (
            <div className="border-t border-slate-200 dark:border-slate-800 px-6 py-3">
              <button
                onClick={() => setComplianceShowAll(true)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {t("tables.showAllResources", { count: filteredResources.length })}
                <span className="ml-2 text-slate-500 dark:text-slate-500">
                  {t("tables.showingFirstForPerformance", { count: INITIAL_TABLE_ROWS })}
                </span>
              </button>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
});
