// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tooltip,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowCounterclockwiseRegular,
  ArrowSortDownRegular,
  ArrowSortUpRegular,
  ArrowSyncRegular,
  BranchCompareRegular,
  DeleteRegular,
  DesktopRegular,
  FolderOpenRegular,
  OpenRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import type { OscManifest } from "@configforge/core/types";
import { WindowsLogo } from "../../components/WindowsLogo";
import {
  useBaselineWorkspace,
  type DeletedBaselineRegistrationBackup,
} from "../../components/BaselineWorkspace";
import { cfs } from "../../lib/cfs";
import { useDateFormatter, useNumberFormatter } from "../../lib/format";
import {
  createMatrixDiffLocationState,
  createPairwiseDiffLocationState,
} from "../Diff/location-state";
import {
  getManifestCompliance,
  getManifestIssueCount,
  getManifestLastModifiedDate,
  useManifestList,
  type ComplianceFilter,
  type IssuesFilter,
  type LastModifiedFilter,
  type OperatingSystemFilter,
} from "./state/useManifestList";
import { useBulkSelection } from "./state/useBulkSelection";

const LAST_MODIFIED_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};
const LOCAL_CALENDAR_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};
const PERCENT_FORMAT: Intl.NumberFormatOptions = {
  style: "percent",
  maximumFractionDigits: 0,
};
const STICKY_HEADER_CELL_CLASS =
  "sticky top-0 z-20 border-b border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800";

function formatLocalCalendarDate(date: Date, formatter: Intl.DateTimeFormat): string {
  const parts = new Map(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

function normalizeBaselineIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldShowNamespace(displayName: string, namespace: string): boolean {
  return (
    displayName !== namespace &&
    normalizeBaselineIdentity(displayName) !== normalizeBaselineIdentity(namespace)
  );
}

function BaselinePlatformMark({ platform }: { platform: string }) {
  if (platform === "windows") {
    return (
      <span aria-hidden="true" className="inline-flex">
        <WindowsLogo className="h-4 w-4 shrink-0" />
      </span>
    );
  }
  if (platform === "linux") {
    return (
      <span
        role="img"
        aria-label="Linux"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none"
      >
        🐧
      </span>
    );
  }
  return <DesktopRegular className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />;
}

type Feedback = {
  intent: "success" | "error" | "info";
  message: string;
};

type OperationKind = "delete" | "undo" | "refresh" | "open" | "diff";
type ManifestSortColumn =
  | "baseline"
  | "operatingSystem"
  | "settings"
  | "issues"
  | "compliant"
  | "dateModified";
type ManifestSortDirection = "ascending" | "descending";

interface ManifestSortState {
  column: ManifestSortColumn | null;
  direction: ManifestSortDirection | null;
}

interface SortableHeaderProps {
  column: ManifestSortColumn;
  label: string;
  widthClass?: string;
  sort: ManifestSortState;
  onSort: (column: ManifestSortColumn) => void;
}

function SortableHeader({
  column,
  label,
  widthClass = "",
  sort,
  onSort,
}: SortableHeaderProps) {
  const active = sort.column === column ? sort.direction : null;
  return (
    <th
      aria-sort={active ?? undefined}
      className={`${STICKY_HEADER_CELL_CLASS} ${widthClass}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="-mx-3 -my-2 flex w-[calc(100%+1.5rem)] items-center justify-start gap-1.5 px-3 py-2 text-left transition-colors hover:bg-[#E4E9F0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600 dark:hover:bg-slate-700"
      >
        <span>{label}</span>
        {active === "ascending" && (
          <ArrowSortUpRegular className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {active === "descending" && (
          <ArrowSortDownRegular className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

function settingCount(manifest: OscManifest): number {
  return manifest.ResourceCount ?? manifest.Resources?.length ?? 0;
}

export function ManifestsPage() {
  const { t } = useTranslation(["manifests", "common"]);
  const navigate = useNavigate();
  const list = useManifestList();
  const selection = useBulkSelection();
  const {
    openBaselines,
    openBaseline,
    openManyBaselines,
    closeManyBaselines,
    refresh: refreshWorkspace,
    lastDeletedBatch,
    setLastDeletedBatch,
  } = useBaselineWorkspace();
  const dateFormatter = useDateFormatter(LAST_MODIFIED_FORMAT);
  const localCalendarDateFormatter = useDateFormatter(LOCAL_CALENDAR_DATE_FORMAT);
  const percentFormatter = useNumberFormatter(PERCENT_FORMAT);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAction, setBusyAction] = useState<OperationKind | null>(null);
  const [sort, setSort] = useState<ManifestSortState>({
    column: null,
    direction: null,
  });
  const operationRef = useRef<{ kind: OperationKind; token: symbol } | null>(null);

  const {
    manifests,
    loading,
    error,
    searchQuery,
    setSearchQuery,
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
  } = list;
  const { selected, setSelected, toggleSelect, toggleSelectAll } = selection;

  const selectedNames = Array.from(selected).filter((name) =>
    manifests.some((manifest) => manifest.Name === name),
  );
  const allFilteredSelected =
    filteredManifests.length > 0 &&
    filteredManifests.every((manifest) => selected.has(manifest.Name));
  const someFilteredSelected = filteredManifests.some((manifest) => selected.has(manifest.Name));
  const selectAllRef = useRef<HTMLInputElement>(null);

  const toggleSort = (column: ManifestSortColumn) => {
    setSort((current) => {
      if (current.column !== column || current.direction === null) {
        return { column, direction: "ascending" };
      }
      if (current.direction === "ascending") {
        return { column, direction: "descending" };
      }
      return { column: null, direction: null };
    });
  };

  const sortedManifests = useMemo(() => {
    if (!sort.column || !sort.direction) return filteredManifests;
    const direction = sort.direction === "ascending" ? 1 : -1;
    const compareText = (left: string, right: string) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    const compareNumber = (left: number, right: number) => left - right;

    return filteredManifests
      .map((manifest, originalIndex) => ({ manifest, originalIndex }))
      .sort((leftEntry, rightEntry) => {
        const left = leftEntry.manifest;
        const right = rightEntry.manifest;
        let comparison = 0;
        switch (sort.column) {
          case "baseline":
            comparison = compareText(
              left.DisplayName || left.Name,
              right.DisplayName || right.Name,
            );
            break;
          case "operatingSystem":
            comparison = compareText(
              platformByName.get(left.Name) ?? "unknown",
              platformByName.get(right.Name) ?? "unknown",
            );
            break;
          case "settings":
            comparison = compareNumber(settingCount(left), settingCount(right));
            break;
          case "issues":
            comparison = compareNumber(
              getManifestIssueCount(left),
              getManifestIssueCount(right),
            );
            break;
          case "compliant":
            comparison = compareNumber(
              getManifestCompliance(left).ratio ?? -1,
              getManifestCompliance(right).ratio ?? -1,
            );
            break;
          case "dateModified":
            comparison = compareNumber(
              getManifestLastModifiedDate(left)?.getTime() ?? Number.NEGATIVE_INFINITY,
              getManifestLastModifiedDate(right)?.getTime() ?? Number.NEGATIVE_INFINITY,
            );
            break;
        }
        return comparison === 0
          ? leftEntry.originalIndex - rightEntry.originalIndex
          : comparison * direction;
      })
      .map(({ manifest }) => manifest);
  }, [filteredManifests, platformByName, sort]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [allFilteredSelected, someFilteredSelected]);

  const beginOperation = (kind: OperationKind): symbol | null => {
    if (operationRef.current) return null;
    const token = Symbol(kind);
    operationRef.current = { kind, token };
    setBusyAction(kind);
    return token;
  };

  const finishOperation = (token: symbol) => {
    if (operationRef.current?.token !== token) return;
    operationRef.current = null;
    setBusyAction(null);
  };

  const refreshAll = async (force = false) => {
    await Promise.allSettled([
      fetchManifests(force ? { force: true } : undefined),
      refreshWorkspace(),
    ]);
  };

  const handleRefresh = async () => {
    const token = beginOperation("refresh");
    if (!token) return;
    try {
      setFeedback(null);
      await refreshAll(true);
    } finally {
      finishOperation(token);
    }
  };

  const handleOpenRow = (name: string) => {
    const token = beginOperation("open");
    if (!token) return;
    try {
      openBaseline(name);
      navigate(`/manifests/${encodeURIComponent(name)}`);
    } finally {
      finishOperation(token);
    }
  };

  const handleOpenCompliance = (name: string) => {
    openBaseline(name);
    navigate(`/manifests/${encodeURIComponent(name)}?section=compliance`);
  };

  const handleOpenSelected = () => {
    if (selectedNames.length === 0) return;
    const token = beginOperation("open");
    if (!token) return;
    try {
      openManyBaselines(selectedNames);
    } finally {
      finishOperation(token);
    }
  };

  const handleDiffSelected = () => {
    if (selectedNames.length < 2 || selectedNames.length > 10) return;
    const token = beginOperation("diff");
    if (!token) return;
    try {
      const state =
        selectedNames.length === 2
          ? createPairwiseDiffLocationState(selectedNames)
          : createMatrixDiffLocationState(selectedNames);
      navigate("/diff", {
        state,
      });
    } finally {
      finishOperation(token);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedNames.length === 0) return;
    const token = beginOperation("delete");
    if (!token) return;
    const namesToDelete = [...selectedNames];
    try {
      if (
        !window.confirm(
          t("confirm.bulkDeleteBaselineContentOnly", {
            count: namesToDelete.length,
          }),
        )
      ) {
        return;
      }

      setFeedback(null);
      // The privileged registry operation captures metadata + source and
      // removes that same revision under one namespace lock. The renderer
      // retains only UI-local tab state.
      const reopenNames = new Set(openBaselines);
      const results = await Promise.allSettled(
        namesToDelete.map((name) => cfs.manifests.delete(name, { requireRecovery: true })),
      );
      const deleted: DeletedBaselineRegistrationBackup[] = [];
      const failed: string[] = [];
      let firstFailure: unknown;
      results.forEach((result, index) => {
        const requestedName = namesToDelete[index];
        if (result.status === "fulfilled" && result.value.data.recovery) {
          const recovery = result.value.data.recovery;
          deleted.push({
            name: recovery.namespace,
            displayName: recovery.displayName,
            content: recovery.sourceYaml,
            source: recovery.source,
            ...(recovery.sourceId ? { sourceId: recovery.sourceId } : {}),
            reopen: reopenNames.has(recovery.namespace),
          });
          return;
        }

        failed.push(requestedName);
        firstFailure ??=
          result.status === "rejected"
            ? result.reason
            : new Error(`Delete did not return recovery content for "${requestedName}"`);
      });

      if (deleted.length > 0) {
        // Undo restores only a new registration from captured source YAML.
        // deleteManifest also removes deploy/history/rationale/audit state,
        // and no public API can reconstruct those stores.
        setLastDeletedBatch(deleted);
        closeManyBaselines(deleted.map((backup) => backup.name));
      }
      setSelected(new Set(failed));
      await refreshAll();

      if (failed.length > 0) {
        if (deleted.length === 0) {
          setFeedback({
            intent: "error",
            message: t("administration.messages.captureFailed", {
              error:
                firstFailure instanceof Error
                  ? firstFailure.message
                  : t("administration.messages.unknownError"),
            }),
          });
        } else {
          setFeedback({
            intent: "error",
            message: t("administration.messages.deletePartial", {
              deleted: deleted.length,
              failed: failed.length,
            }),
          });
        }
      } else {
        setFeedback({
          intent: "success",
          message: t("administration.messages.deleteSuccess", {
            count: deleted.length,
          }),
        });
      }
    } catch (captureError) {
      setFeedback({
        intent: "error",
        message: t("administration.messages.captureFailed", {
          error:
            captureError instanceof Error
              ? captureError.message
              : t("administration.messages.unknownError"),
        }),
      });
    } finally {
      finishOperation(token);
    }
  };

  const handleUndoDelete = async () => {
    if (!lastDeletedBatch?.length) return;
    const token = beginOperation("undo");
    if (!token) return;
    const batch = lastDeletedBatch;
    try {
      setFeedback(null);
      const results = await Promise.allSettled(
        batch.map((backup) =>
          cfs.manifests.restore({
            namespace: backup.name,
            displayName: backup.displayName,
            content: backup.content,
            source: backup.source,
            ...(backup.sourceId ? { sourceId: backup.sourceId } : {}),
          }),
        ),
      );
      const restored = batch.filter((_, index) => results[index]?.status === "fulfilled");
      const failed = batch.filter((_, index) => results[index]?.status === "rejected");

      openManyBaselines(restored.filter((backup) => backup.reopen).map((backup) => backup.name));
      setLastDeletedBatch(failed.length > 0 ? failed : null);
      await refreshAll();

      if (failed.length > 0) {
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        const failureMessage =
          firstFailure?.reason instanceof Error
            ? firstFailure.reason.message
            : t("administration.messages.unknownError");
        setFeedback({
          intent: "error",
          message: t("administration.messages.undoPartial", {
            restored: restored.length,
            failed: failed.length,
            error: failureMessage,
          }),
        });
      } else {
        setFeedback({
          intent: "info",
          message: t("administration.messages.undoSuccess", {
            count: restored.length,
          }),
        });
      }
    } finally {
      finishOperation(token);
    }
  };

  const diffDisabled = selectedNames.length < 2 || selectedNames.length > 10;
  const actionsBusy = busyAction !== null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-950 dark:text-white">
              {t("page.title")}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t("page.description")}
            </p>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t("administration.showing", {
              filtered: filteredManifests.length,
              total: manifests.length,
            })}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(_, data) => setSearchQuery(data.value)}
            contentBefore={<SearchRegular />}
            aria-label={t("administration.search.label")}
            placeholder={t("administration.search.placeholder")}
            className="min-w-56 flex-1"
          />

          <select
            value={operatingSystemFilter}
            onChange={(event) =>
              setOperatingSystemFilter(event.target.value as OperatingSystemFilter)
            }
            aria-label={t("administration.filters.operatingSystem.label")}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">{t("administration.filters.operatingSystem.all")}</option>
            {filterOptions.operatingSystems.map((option) => (
              <option key={option} value={option}>
                {t(`administration.filters.operatingSystem.options.${option}`)}
              </option>
            ))}
          </select>

          <select
            value={issuesFilter}
            onChange={(event) => setIssuesFilter(event.target.value as IssuesFilter)}
            aria-label={t("administration.filters.issues.label")}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">{t("administration.filters.issues.all")}</option>
            {filterOptions.issues.map((option) => (
              <option key={option} value={option}>
                {t(`administration.filters.issues.options.${option}`)}
              </option>
            ))}
          </select>

          <select
            value={complianceFilter}
            onChange={(event) => setComplianceFilter(event.target.value as ComplianceFilter)}
            aria-label={t("administration.filters.compliance.label")}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">{t("administration.filters.compliance.all")}</option>
            {filterOptions.compliance.map((option) => (
              <option key={option} value={option}>
                {t(`administration.filters.compliance.options.${option}`)}
              </option>
            ))}
          </select>

          <select
            value={lastModifiedFilter}
            onChange={(event) => setLastModifiedFilter(event.target.value as LastModifiedFilter)}
            aria-label={t("administration.filters.lastModified.label")}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">{t("administration.filters.lastModified.all")}</option>
            {filterOptions.lastModified.map((option) => (
              <option key={option} value={option}>
                {t(`administration.filters.lastModified.options.${option}`)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {(error || feedback) && (
        <div className="shrink-0 px-5 pt-3">
          <MessageBar intent={error ? "error" : feedback?.intent}>
            <MessageBarBody>{error ?? feedback?.message}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-auto px-5 pb-3">
        {loading && manifests.length === 0 ? (
          <div className="flex h-full items-center justify-center pt-3">
            <Spinner label={t("administration.loading")} />
          </div>
        ) : manifests.length === 0 ? (
          <div className="mt-3 flex h-[calc(100%-0.75rem)] min-h-56 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-6 text-center dark:border-slate-700 dark:bg-slate-900">
            <FolderOpenRegular className="mb-3 h-9 w-9 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t("empty.sectionTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t("empty.sectionDescription")}
            </p>
          </div>
        ) : (
          <div className="isolate mt-3 min-w-[760px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table
              aria-label={t("page.title")}
              className="w-full border-separate border-spacing-0 text-left text-sm"
            >
              <thead className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                <tr>
                  <th className={`${STICKY_HEADER_CELL_CLASS} w-11`}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={() => toggleSelectAll(filteredManifests)}
                      aria-label={t("administration.table.selectAll")}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                  </th>
                  <SortableHeader
                    column="baseline"
                    label={t("administration.table.baseline")}
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    column="operatingSystem"
                    label={t("administration.table.operatingSystem")}
                    widthClass="w-44"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    column="settings"
                    label={t("administration.table.settings")}
                    widthClass="w-24"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    column="issues"
                    label={t("administration.table.issues")}
                    widthClass="w-36"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    column="compliant"
                    label={t("administration.table.compliant")}
                    widthClass="w-40"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    column="dateModified"
                    label={t("administration.table.dateModified")}
                    widthClass="w-32"
                    sort={sort}
                    onSort={toggleSort}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredManifests.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      {t("administration.table.noMatches")}
                    </td>
                  </tr>
                ) : (
                  sortedManifests.map((manifest) => {
                    const platform = platformByName.get(manifest.Name) ?? "unknown";
                    const issues = getManifestIssueCount(manifest);
                    const compliance = getManifestCompliance(manifest);
                    const displayName = manifest.DisplayName || manifest.Name;
                    const lastModifiedDate = getManifestLastModifiedDate(manifest);
                    const modifiedDateLabel = lastModifiedDate
                      ? formatLocalCalendarDate(lastModifiedDate, localCalendarDateFormatter)
                      : "—";
                    const modifiedTitle = lastModifiedDate
                      ? t("administration.table.lastModifiedTitle", {
                          date: dateFormatter.format(lastModifiedDate),
                        })
                      : t("administration.table.lastModifiedUnknown");
                    const platformLabel = t(
                      `administration.filters.operatingSystem.options.${
                        ["windows", "linux", "mixed", "cross-platform"].includes(platform)
                          ? platform
                          : "unknown"
                      }`,
                    );
                    const issuesTitle =
                      issues === 0
                        ? t("administration.status.noValidationIssues")
                        : manifest.Validation?.issues.join("\n");
                    const issuesLabel =
                      issues === 0
                        ? t("administration.status.noIssues")
                        : t("administration.status.issueCount", { count: issues });
                    const issuesTooltipContent =
                      issues > 0 && issuesTitle ? (
                        <span className="block whitespace-pre-line">{issuesTitle}</span>
                      ) : (
                        issuesTitle ?? issuesLabel
                      );
                    const issuesDescriptionId = `validation-issues-${manifest.Name.replace(
                      /[^a-zA-Z0-9_-]/g,
                      "-",
                    )}`;
                    const complianceTitle = compliance.audited
                      ? compliance.unknown > 0
                        ? t("administration.status.complianceIncompleteTitle", {
                            compliant: compliance.compliant,
                            total: compliance.total,
                            unknown: compliance.unknown,
                          })
                        : t("administration.status.complianceTitle", {
                            compliant: compliance.compliant,
                            total: compliance.total,
                          })
                      : t("administration.status.notAuditedTitle");
                    const baselineTooltip = `${displayName} — ${manifest.Name}. ${modifiedTitle}`;

                    return (
                      <tr
                        key={manifest.Name}
                        className={`text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60 ${
                          selected.has(manifest.Name) ? "bg-blue-50/70 dark:bg-blue-950/30" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(manifest.Name)}
                            onChange={() => toggleSelect(manifest.Name)}
                            aria-label={t("administration.table.selectBaseline", {
                              name: manifest.Name,
                            })}
                            className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                          />
                        </td>
                        <td className="min-w-0 px-3 py-2">
                          <Tooltip
                            content={baselineTooltip}
                            relationship="description"
                          >
                            <span className="inline-flex max-w-full">
                              <button
                                type="button"
                                onClick={() => handleOpenRow(manifest.Name)}
                                disabled={actionsBusy}
                                aria-label={t("administration.table.openBaseline", {
                                  name: manifest.Name,
                                })}
                                className="group flex max-w-full items-center gap-2 text-left"
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                  <BaselinePlatformMark platform={platform} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block max-w-[34rem] truncate font-medium text-blue-700 group-hover:underline dark:text-blue-300">
                                    {displayName}
                                  </span>
                                  {shouldShowNamespace(displayName, manifest.Name) && (
                                    <span className="block max-w-[34rem] truncate text-xs text-slate-500 dark:text-slate-400">
                                      {manifest.Name}
                                    </span>
                                  )}
                                </span>
                              </button>
                            </span>
                          </Tooltip>
                        </td>
                        <td className="px-3 py-2">
                          <Tooltip content={platformLabel} relationship="description" withArrow>
                            <span
                              aria-label={platformLabel}
                              className="inline-flex items-center gap-2"
                            >
                              <BaselinePlatformMark platform={platform} />
                              <span className="truncate">{platformLabel}</span>
                            </span>
                          </Tooltip>
                        </td>
                        <td className="px-3 py-2 text-left tabular-nums">
                          {settingCount(manifest)}
                        </td>
                        <td className="px-3 py-2">
                          <Tooltip
                            content={issuesTooltipContent}
                            relationship="description"
                            withArrow
                          >
                            <span
                              aria-describedby={
                                issues > 0 && issuesTitle ? issuesDescriptionId : undefined
                              }
                              aria-label={issuesLabel}
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                issues === 0
                                  ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                  : "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              }`}
                            >
                              {issuesLabel}
                            </span>
                          </Tooltip>
                          {issues > 0 && issuesTitle && (
                            <span id={issuesDescriptionId} className="sr-only">
                              {issuesTitle}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Tooltip content={complianceTitle} relationship="description" withArrow>
                            <button
                              type="button"
                              onClick={() => handleOpenCompliance(manifest.Name)}
                              aria-label={t("administration.table.openCompliance", {
                                name: manifest.Name,
                              })}
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium outline-none hover:ring-2 hover:ring-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600 ${
                                compliance.category === "all-compliant"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  : compliance.category === "partially-compliant"
                                    ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                                    : "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              }`}
                            >
                              {compliance.category === "all-compliant"
                                ? t("administration.status.allCompliant")
                                : compliance.category === "partially-compliant"
                                  ? t("administration.status.percentCompliant", {
                                      percent: percentFormatter.format(compliance.ratio ?? 0),
                                    })
                                  : t("administration.status.notAudited")}
                            </button>
                          </Tooltip>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                          <Tooltip content={modifiedTitle} relationship="description" withArrow>
                            <span aria-label={modifiedTitle} className="inline-block">
                              {modifiedDateLabel}
                            </span>
                          </Tooltip>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            appearance="secondary"
            icon={
              busyAction === "undo" ? <Spinner size="tiny" /> : <ArrowCounterclockwiseRegular />
            }
            onClick={() => void handleUndoDelete()}
            disabled={!lastDeletedBatch?.length || actionsBusy}
            aria-label={t("administration.actions.undoAria")}
          >
            {t("administration.actions.undo")}
          </Button>
          <Button
            appearance="secondary"
            icon={busyAction === "delete" ? <Spinner size="tiny" /> : <DeleteRegular />}
            onClick={() => void handleDeleteSelected()}
            disabled={selectedNames.length === 0 || actionsBusy}
            aria-label={t("administration.actions.deleteAria")}
          >
            {t("administration.actions.delete")}
          </Button>
          <Button
            appearance="secondary"
            icon={<BranchCompareRegular />}
            onClick={handleDiffSelected}
            disabled={diffDisabled || actionsBusy}
            aria-label={t("administration.actions.diffAria")}
            title={selectedNames.length > 10 ? t("administration.actions.diffMaximum") : undefined}
          >
            {t("administration.actions.diff")}
          </Button>
          <Button
            appearance="secondary"
            icon={<OpenRegular />}
            onClick={handleOpenSelected}
            disabled={selectedNames.length === 0 || actionsBusy}
            aria-label={t("administration.actions.openAria")}
          >
            {t("administration.actions.open")}
          </Button>
          {selectedNames.length > 0 && (
            <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
              {t("selection.selected", { count: selectedNames.length })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            appearance="secondary"
            icon={busyAction === "refresh" ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
            onClick={() => void handleRefresh()}
            disabled={busyAction !== null}
          >
            {t("common:buttons.refresh")}
          </Button>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={() => navigate("/manifests/new")}
            disabled={actionsBusy}
          >
            {t("administration.actions.create")}
          </Button>
        </div>
      </footer>
    </div>
  );
}
