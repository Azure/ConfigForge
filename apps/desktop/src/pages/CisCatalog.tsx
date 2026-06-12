// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CIS Catalog page.
 *
 * Surfaces everything the user needs to enable CIS cross-references:
 * - Status (loaded / not loaded / schema error)
 * - Three supported ingestion paths:
 *   1. XCCDF+OVAL XML files from CIS Workbench (highest coverage)
 *   2. Azure Policy CIS baseline JSON from the Azure portal
 *   3. Legacy OSConfig CIS pipeline JSON (cis-mappings.json)
 * - Discovered files (XCCDF, Azure Policy JSON) with metadata
 * - Open folder / Re-check actions
 * - Diagnostic: did-you-mean for typos, schema mismatch detection
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookmarkRegular,
  CheckmarkCircleRegular,
  WarningRegular,
  ArrowSyncRegular,
  FolderOpenRegular,
  CopyRegular,
  DocumentRegular,
} from "@fluentui/react-icons";
import { MessageBar, MessageBarBody, MessageBarTitle, Button } from "@fluentui/react-components";
import { cfs } from "../lib/cfs";
import { _resetCisAvailableCacheForTests } from "../components/use-cis-available";
import { useTranslation } from "react-i18next";

interface ExpectedFile {
  name: string;
  description: string;
  required: boolean;
  present: boolean;
}

interface UnexpectedFile {
  name: string;
  didYouMean: string | null;
}

interface XccdfFile {
  filename: string;
  platform: "windows" | "linux" | "unknown";
  product: string;
  version: string;
  title: string;
  hasOval: boolean;
}

interface AzurePolicyCisFile {
  filename: string;
  platform: "windows" | "linux" | "unknown";
  benchmarkName: string;
  benchmarkVersion: string;
  ruleCount: number;
}

interface Status {
  available: boolean;
  dataDir?: string;
  files?: ExpectedFile[];
  unexpectedFiles?: UnexpectedFile[];
  schemaError?: string | null;
  source?: "json" | "xccdf" | "both";
  xccdfFiles?: XccdfFile[];
  azurePolicyCisFiles?: AzurePolicyCisFile[];
}

export function CisCatalogPage() {
  const { t } = useTranslation("cis-catalog");
  const [status, setStatus] = useState<Status | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async (recheck: boolean) => {
    setRefreshing(true);
    setActionMsg(null);
    try {
      const s = recheck ? await cfs.cis.recheck() : await cfs.cis.status();
      setStatus(s as Status);
      if (recheck) {
        // The Re-check action just re-scanned the data dir on the main
        // process. Invalidate the renderer-side module-level cache too,
        // so other pages (Diff tab, manifest editor, etc.) re-fetch
        // availability on next mount instead of returning the stale
        // "no CIS data" answer from app boot.
        _resetCisAvailableCacheForTests();
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Could not load CIS status");
      setStatus({ available: false });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const openFolder = useCallback(async () => {
    setOpening(true);
    setActionMsg(null);
    try {
      const res = await cfs.cis.revealDataDir();
      setStatus((s) => (s ? { ...s, dataDir: res.path } : { available: false, dataDir: res.path }));
      setActionMsg(`Opened: ${res.path}`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Could not open folder");
    } finally {
      setOpening(false);
    }
  }, []);

  const copyPath = useCallback(async () => {
    if (!status?.dataDir) return;
    try {
      await navigator.clipboard.writeText(status.dataDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [status?.dataDir]);

  const available = status?.available ?? null;
  const dataDir = status?.dataDir ?? null;
  const xccdfFiles = status?.xccdfFiles ?? [];
  const azurePolicyFiles = status?.azurePolicyCisFiles ?? [];
  const hasXccdf = xccdfFiles.length > 0;
  const _hasAzurePolicy = azurePolicyFiles.some((f) => f.ruleCount > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
          <BookmarkRegular className="h-6 w-6 text-blue-500" />
          {t("extracted.text1")}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("extracted.text2")} {t("extracted.text3")}{" "}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {t("extracted.text4")}
          </span>{" "}
          {t("extracted.text5")}{" "}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {t("extracted.text6")}
          </span>{" "}
          {t("extracted.text7")}
        </p>
      </div>

      {/* Status card */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("extracted.text8")}
        </h2>
        <div className="mt-3 flex items-start gap-3">
          {available === null ? (
            <>
              <ArrowSyncRegular className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-slate-400" />
              <p className="text-sm text-slate-600 dark:text-slate-400">{t("extracted.text9")}</p>
            </>
          ) : available ? (
            <>
              <CheckmarkCircleRegular className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {t("extracted.text10")}

                  {status?.source && (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {status.source === "xccdf"
                        ? hasXccdf
                          ? t("extracted.text12")
                          : t("extracted.text13")
                        : status.source === "json"
                          ? t("extracted.text15")
                          : t("extracted.text16")}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t("extracted.text17")}
                </p>
              </div>
            </>
          ) : (
            <>
              <WarningRegular className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {t("extracted.text18")}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t("extracted.text19")}{" "}
                  <strong>{t("extracted.text20")}</strong>.
                </p>
                {status?.schemaError && (
                  <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 dark:border-red-700 dark:bg-red-900/20">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                      {t("extracted.text21")}
                    </p>
                    <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                      {status.schemaError}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Supported formats */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("extracted.text22")}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {t("extracted.text23")}{" "}
          <strong>{t("extracted.text24")}</strong>{" "}
          {t("extracted.text25")}{" "}
          <strong>{t("extracted.text26")}</strong>
          {t("extracted.text27")}
        </p>

        <div className="mt-4 space-y-4">
          {/* Option 1: Azure Policy JSON */}
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-700 dark:bg-blue-900/20">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("extracted.text28")}

              <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {t("extracted.text29")}
              </span>
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {t("extracted.text30")}{" "}
              <strong>{t("extracted.text31")}</strong>{" "}
              {t("extracted.text32")}
            </p>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {t("extracted.text33")}
            </p>
          </div>

          {/* Option 2: XCCDF+OVAL */}
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("extracted.text34")}

              <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {t("extracted.text35")}
              </span>
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {t("extracted.text36")}{" "}
              <strong>{t("extracted.text37")}</strong>
              {t("extracted.text38")}{" "}
              <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">*-xccdf.xml</code>{" "}
              {t("extracted.text39")}{" "}
              <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">*-oval.xml</code>
              {t("extracted.text40")}
            </p>
          </div>
        </div>

        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <strong>{t("extracted.text41")}</strong>
          {t("extracted.text42")}
        </p>
      </div>

      {/* Discovered XCCDF files */}
      {hasXccdf && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 shadow-sm dark:border-emerald-800 dark:bg-emerald-900/20">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-900 dark:text-emerald-200">
            <DocumentRegular className="h-5 w-5" />
            {t("extracted.text43")}
            {xccdfFiles.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {xccdfFiles.map((xf) => (
              <li
                key={xf.filename}
                className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-800 dark:bg-slate-900"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    xf.platform === "windows"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                      : xf.platform === "linux"
                        ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {xf.platform}
                </span>
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {xf.title}
                </span>
                {xf.hasOval ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {t("extracted.text44")}
                  </span>
                ) : (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {t("extracted.text45")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Discovered Azure Policy CIS files */}
      {azurePolicyFiles.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 shadow-sm dark:border-blue-800 dark:bg-blue-900/20">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-blue-900 dark:text-blue-200">
            <DocumentRegular className="h-5 w-5" />
            {t("extracted.text46")}
            {azurePolicyFiles.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {azurePolicyFiles.map((af) => (
              <li
                key={af.filename}
                className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 dark:border-blue-800 dark:bg-slate-900"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    af.platform === "windows"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                      : af.platform === "linux"
                        ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {af.platform}
                </span>
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {af.benchmarkName}
                  {t("extracted.text47")}
                  {af.benchmarkVersion}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {af.ruleCount}
                  {t("extracted.text48")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Folder + actions */}
      {dataDir && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t("extracted.text49")}
          </h2>
          <div className="mt-3 flex items-center gap-2">
            <code
              className="flex-1 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              title={dataDir}
            >
              {dataDir}
            </code>
            <Button
              appearance="subtle"
              size="small"
              icon={<CopyRegular />}
              onClick={copyPath}
              title={t("extracted.text50")}
            >
              {copied ? t("extracted.text51") : t("extracted.text52")}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              appearance="primary"
              icon={<FolderOpenRegular />}
              onClick={openFolder}
              disabled={opening}
            >
              {opening ? t("extracted.text53") : t("extracted.text54")}
            </Button>
            <Button
              appearance="subtle"
              icon={<ArrowSyncRegular />}
              onClick={() => load(true)}
              disabled={refreshing}
            >
              {refreshing ? t("extracted.text55") : t("extracted.text56")}
            </Button>
            {actionMsg && (
              <span className="text-xs text-slate-500 dark:text-slate-400">{actionMsg}</span>
            )}
          </div>
        </div>
      )}

      {/* Files-in-folder diagnostic */}
      {status?.unexpectedFiles && status.unexpectedFiles.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 shadow-sm dark:border-amber-700 dark:bg-amber-900/20">
          <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
            {t("extracted.text57")}
          </h2>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{t("extracted.text58")}</p>
          <ul className="mt-3 space-y-2">
            {status.unexpectedFiles.map((f) => (
              <li
                key={f.name}
                className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm dark:border-amber-800 dark:bg-slate-900"
              >
                <code className="break-all rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                  {f.name}
                </code>
                {f.didYouMean && (
                  <>
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      {t("extracted.text59")}
                    </span>
                    <code className="break-all rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
                      {f.didYouMean}
                    </code>
                    <span className="text-xs text-amber-700 dark:text-amber-300">?</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Back link */}
      <div className="flex items-center gap-3">
        <Link
          to="/manifests"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {t("extracted.text60")}
        </Link>
      </div>

      {available === false && (
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>{t("extracted.text61")}</MessageBarTitle>
            {t("extracted.text62")}
          </MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}
