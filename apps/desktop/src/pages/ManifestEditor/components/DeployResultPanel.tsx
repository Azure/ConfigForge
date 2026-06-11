// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Post-deploy result panel for the ManifestEditor page.
 *
 * Renders the success/warning/error banner, host + compliance
 * counters, per-resource table (capped via INITIAL_TABLE_ROWS), and
 * the deploy timestamp. Reads from the `useDeployFlow` hook's
 * `deployResult` slot.
 *
 * Phase C.3 of the page-split refactor.
 */
import React from "react";
import {
  WarningRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { INITIAL_TABLE_ROWS } from "../helpers";
import type { DeployResult } from "../state/useDeployFlow";

export interface DeployResultPanelProps {
  deployResult: DeployResult | null;
  setDeployResult: (result: DeployResult | null) => void;
  deployRowsShowAll: boolean;
  setDeployRowsShowAll: (show: boolean) => void;
}

export const DeployResultPanel = React.memo(function DeployResultPanel({
  deployResult,
  setDeployResult,
  deployRowsShowAll,
  setDeployRowsShowAll,
}: DeployResultPanelProps) {
  const { t } = useTranslation("manifest-editor");
  if (!deployResult) return null;

  return (
    <div
      className={`rounded-lg border p-5 ${
        deployResult.success
          ? deployResult.warning
            ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
            : "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
          : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          {/* Header */}
          <div className="flex items-center gap-2">
            {deployResult.success ? (
              deployResult.warning ? (
                <WarningRegular className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ) : (
                <CheckmarkCircleRegular className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              )
            ) : (
              <WarningRegular className="h-5 w-5 text-red-600 dark:text-red-400" />
            )}
            <span
              className={`font-semibold ${
                deployResult.success
                  ? deployResult.warning
                    ? "text-amber-800 dark:text-amber-300"
                    : "text-emerald-800 dark:text-emerald-300"
                  : "text-red-800 dark:text-red-300"
              }`}
            >
              {deployResult.message}
            </span>
          </div>

          {/* Inline warning (partial audit / incomplete state) */}
          {deployResult.warning && (
            <div className="rounded-md border border-amber-300 bg-amber-100/70 dark:border-amber-700 dark:bg-amber-900/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <span className="font-medium">{t("deployResult.warning")}:</span> {deployResult.warning}
            </div>
          )}

          {/* Detailed status */}
          {deployResult.data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg bg-white/60 dark:bg-slate-800/40 px-3 py-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t("deployResult.host")}</p>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {deployResult.data.Hostname}
                  </p>
                </div>
                <div className="rounded-lg bg-white/60 dark:bg-slate-800/40 px-3 py-2">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("deployResult.compliant")}</p>
                  <p className="font-bold text-emerald-700 dark:text-emerald-300">
                    {deployResult.data.Compliant}
                  </p>
                </div>
                <div className="rounded-lg bg-white/60 dark:bg-slate-800/40 px-3 py-2">
                  <p className="text-xs text-red-600 dark:text-red-400">{t("deployResult.nonCompliant")}</p>
                  <p className="font-bold text-red-700 dark:text-red-300">
                    {deployResult.data.NonCompliant}
                  </p>
                </div>
                {((deployResult.data.Indeterminate ?? 0) + (deployResult.data.Errors ?? 0)) > 0 ? (
                  <div
                    className="rounded-lg bg-white/60 dark:bg-slate-800/40 px-3 py-2"
                    title={t("deployResult.couldNotReadTitle")}
                  >
                    <p className="text-xs text-amber-600 dark:text-amber-400">{t("deployResult.couldNotRead")}</p>
                    <p className="font-bold text-amber-700 dark:text-amber-300">
                      {(deployResult.data.Indeterminate ?? 0) + (deployResult.data.Errors ?? 0)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-white/60 dark:bg-slate-800/40 px-3 py-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("tables.resources")}</p>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {deployResult.data.TotalResources}
                    </p>
                  </div>
                )}
              </div>

              {/* Per-resource breakdown */}
              {deployResult.data.Resources && deployResult.data.Resources.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
                    {t("deployResult.viewResources", { count: deployResult.data.Resources.length })}
                  </summary>
                  <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full table-fixed text-xs">
                      <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400" style={{ width: '22%' }}>
                            {t("tables.resource")}
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400" style={{ width: '20%' }}>
                            {t("tables.type")}
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400" style={{ width: '14%' }}>
                            {t("tables.status")}
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            {t("tables.reason")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {/* perf W2 / C1: cap at INITIAL_TABLE_ROWS until "Show all" is clicked */}
                        {(deployRowsShowAll
                          ? deployResult.data.Resources
                          : deployResult.data.Resources.slice(0, INITIAL_TABLE_ROWS)
                        ).map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="px-3 py-1.5 align-top text-slate-900 dark:text-white">
                              <span className="block truncate" title={r.name}>
                                {r.name}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 align-top text-slate-500 dark:text-slate-400">
                              <code className="block truncate text-[10px]" title={r.type}>{r.type}</code>
                            </td>
                            <td className="px-3 py-1.5 align-top">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  r.status === "compliant"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    : r.status === "noncompliant"
                                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 align-top text-slate-600 dark:text-slate-400">
                              <span className="block truncate" title={r.reason ?? undefined}>
                                {r.reason ?? "-"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!deployRowsShowAll && deployResult.data.Resources.length > INITIAL_TABLE_ROWS && (
                    <button
                      onClick={() => setDeployRowsShowAll(true)}
                      className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {t("tables.showAllResources", { count: deployResult.data.Resources.length })}
                      <span className="ml-1 text-slate-500 dark:text-slate-500">
                        {t("tables.showingFirst", { count: INITIAL_TABLE_ROWS })}
                      </span>
                    </button>
                  )}
                </details>
              )}

              {/* Warning if partial errors */}
              {deployResult.data.DeployError && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <WarningRegular className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{t("deployResult.warning")}: {deployResult.data.DeployError}</span>
                </div>
              )}

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("deployResult.deployedAt", { time: deployResult.data.Timestamp })}
              </p>
            </>
          )}
        </div>
        <button
          onClick={() => setDeployResult(null)}
          className="ml-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          ✕
        </button>
      </div>
    </div>
  );
});
