// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React, { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { useTranslation } from "react-i18next";
import { ArrowDownRegular, ArrowUpRegular } from "@fluentui/react-icons";
import {
  DESIRED_VALUE_COLUMN,
  SETTING_NAME_COLUMN,
  formatVisualValue,
  groupVisualSettings,
  nextVisualSort,
  sortVisualSettings,
  type VisualSortState,
} from "../visual-viewer";

export interface VisualManifestViewerProps {
  /** Canonical YAML source. Parsing is display-only and never writes editor state. */
  source: string;
}

type ParsedGroups =
  | { kind: "ready"; groups: ReturnType<typeof groupVisualSettings> }
  | { kind: "error" };

function categoryName(resourceType: string): string {
  const slash = resourceType.lastIndexOf("/");
  return slash >= 0 && slash < resourceType.length - 1
    ? resourceType.slice(slash + 1)
    : resourceType;
}

export const VisualManifestViewer = React.memo(function VisualManifestViewer({
  source,
}: VisualManifestViewerProps) {
  const { t } = useTranslation("manifest-editor");
  const [sortByType, setSortByType] = useState<Record<string, VisualSortState | null>>({});

  useEffect(() => {
    setSortByType({});
  }, [source]);

  const parsed = useMemo<ParsedGroups>(() => {
    try {
      return {
        kind: "ready",
        groups: groupVisualSettings(yaml.load(source)),
      };
    } catch {
      return { kind: "error" };
    }
  }, [source]);

  if (parsed.kind === "error") {
    return (
      <div className="flex min-h-80 items-center justify-center p-8">
        <div
          role="status"
          className="max-w-xl border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t("viewer.visualParseError")}
        </div>
      </div>
    );
  }

  if (parsed.groups.length === 0) {
    return (
      <div className="flex min-h-80 items-center justify-center p-8 text-sm text-slate-500 dark:text-slate-400">
        {t("viewer.empty")}
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={t("viewer.visualRegionLabel")}
      className="max-h-[min(62vh,48rem)] min-h-[28rem] space-y-7 overflow-y-auto px-5 py-5 [scrollbar-gutter:stable] sm:px-6"
    >
      {parsed.groups.map((group) => {
        const sort = sortByType[group.resourceType] ?? null;
        const rows = sortVisualSettings(group.settings, sort);
        const shortName = categoryName(group.resourceType);

        return (
          <section key={group.resourceType} aria-labelledby={`visual-group-${group.resourceType}`}>
            <div className="mb-2 flex min-w-0 items-baseline gap-3">
              <h3
                id={`visual-group-${group.resourceType}`}
                className="text-sm font-semibold text-slate-950 dark:text-slate-100"
              >
                {shortName}
              </h3>
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {t("viewer.settingCount", { count: group.settings.length })}
              </span>
              <code
                className="min-w-0 truncate text-[11px] text-slate-400 dark:text-slate-500"
                title={group.resourceType}
              >
                {group.resourceType}
              </code>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table
                aria-label={t("viewer.categoryTableLabel", { category: shortName })}
                className="min-w-max border-collapse text-left text-sm"
              >
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    {group.columns.map((column) => {
                      const active = sort?.column === column;
                      const label =
                        column === SETTING_NAME_COLUMN
                          ? t("viewer.settingName")
                          : column === DESIRED_VALUE_COLUMN
                            ? t("resourceDetails.desiredValue")
                            : column;
                      return (
                        <th
                          key={column}
                          scope="col"
                          aria-sort={active ? sort.direction : undefined}
                          className={`border-b border-r border-slate-200 px-0 font-semibold text-slate-700 last:border-r-0 dark:border-slate-700 dark:text-slate-200 ${
                            column === SETTING_NAME_COLUMN
                              ? "sticky left-0 z-[1] bg-slate-100 dark:bg-slate-800"
                              : ""
                          }`}
                        >
                          <button
                            type="button"
                            aria-label={label}
                            onClick={() => {
                              setSortByType((current) => ({
                                ...current,
                                [group.resourceType]: nextVisualSort(
                                  current[group.resourceType] ?? null,
                                  column,
                                ),
                              }));
                            }}
                            className="flex min-h-10 w-full min-w-40 items-center justify-between gap-3 px-3 py-2 text-left outline-none hover:bg-slate-200/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-slate-700/70"
                          >
                            <span>{label}</span>
                            {active && (
                              <span data-testid="sort-direction-icon" aria-hidden="true">
                                {sort.direction === "ascending" ? (
                                  <ArrowUpRegular className="h-3.5 w-3.5" />
                                ) : (
                                  <ArrowDownRegular className="h-3.5 w-3.5" />
                                )}
                              </span>
                            )}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {rows.map((setting) => (
                    <tr key={setting.id} className="align-top">
                      {group.columns.map((column) => {
                        const rawValue =
                          column === SETTING_NAME_COLUMN
                            ? setting.settingName
                            : column === DESIRED_VALUE_COLUMN
                              ? setting.desiredValue
                              : setting.properties[column];
                        const formatted = formatVisualValue(rawValue);
                        const visibleValue =
                          formatted ||
                          (column === SETTING_NAME_COLUMN
                            ? t("viewer.unnamedSetting")
                            : t("viewer.emptyValue"));
                        return (
                          <td
                            key={column}
                            title={formatted || undefined}
                            className={`max-w-[34rem] min-w-40 border-r border-slate-100 px-3 py-2.5 text-slate-700 last:border-r-0 dark:border-slate-800 dark:text-slate-300 ${
                              column === SETTING_NAME_COLUMN
                                ? "sticky left-0 bg-white font-medium text-slate-950 dark:bg-slate-900 dark:text-slate-100"
                                : ""
                            }`}
                          >
                            <span className="block whitespace-pre-wrap break-words">
                              {visibleValue}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
});
