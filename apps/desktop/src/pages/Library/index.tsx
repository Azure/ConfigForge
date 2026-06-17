// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  SearchRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  BookOpenRegular,
  ShieldRegular,
  ShieldCheckmarkRegular,
  OpenRegular,
  ArrowDownloadRegular,
  DocumentBulletListRegular,
  DesktopRegular,
  WindowConsoleRegular,
  BranchCompareRegular,
  DismissRegular,
  AddRegular,
  SubtractRegular,
  ArrowSyncRegular,
} from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { ExternalLink } from "../../components/ExternalLink";
import { CATEGORIES, type BaselineEntry } from "../../data/baseline-catalog";
import { cfs } from "../../lib/cfs";
import { useLibraryFilters, type PlatformFilter } from "./state/useLibraryFilters";
import { useTranslation } from "react-i18next";

const PLATFORM_FILTERS: { id: PlatformFilter; label: string }[] = [
  { id: "all", label: "All Platforms" },
  { id: "windows", label: "Windows" },
  { id: "linux", label: "Linux" },
];

const categoryMeta: Record<
  BaselineEntry["category"],
  { label: string; color: string; icon: typeof ShieldRegular }
> = {
  "security-baseline": {
    label: "Security Baseline",
    color: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20",
    icon: ShieldRegular,
  },
  "secured-core": {
    label: "Secured Core",
    color: "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-900/20",
    icon: ShieldCheckmarkRegular,
  },
  defender: {
    label: "Defender",
    color: "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20",
    icon: ShieldCheckmarkRegular,
  },
  "linux-security": {
    label: "Linux Security",
    color: "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/20",
    icon: ShieldRegular,
  },
  "feature-scenario": {
    label: "Feature Scenario",
    color: "text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/20",
    icon: ShieldRegular,
  },
  "cis-benchmark": {
    label: "CIS Benchmark",
    color: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20",
    icon: ShieldCheckmarkRegular,
  },
};

/* ── CSV parsing & diff helpers ───────────────────────────────── */

interface CsvRow {
  name: string;
  expectedValue: string;
  [key: string]: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const nameIdx = headers.findIndex((h) => /^name$/i.test(h));
  const valIdx = headers.findIndex((h) => /expected\s*value/i.test(h));
  if (nameIdx === -1) return [];
  return lines
    .slice(1)
    .map((line) => {
      const cols = splitCsvLine(line);
      return {
        name: (cols[nameIdx] ?? "").trim(),
        expectedValue: valIdx >= 0 ? (cols[valIdx] ?? "").trim() : "",
      };
    })
    .filter((r) => r.name);
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

interface DiffResult {
  added: CsvRow[];
  removed: CsvRow[];
  changed: { name: string; oldValue: string; newValue: string }[];
}

function diffCsvRows(leftRows: CsvRow[], rightRows: CsvRow[]): DiffResult {
  const leftMap = new Map(leftRows.map((r) => [r.name, r]));
  const rightMap = new Map(rightRows.map((r) => [r.name, r]));

  const added: CsvRow[] = [];
  const removed: CsvRow[] = [];
  const changed: { name: string; oldValue: string; newValue: string }[] = [];

  rightMap.forEach((row, name) => {
    if (!leftMap.has(name)) {
      added.push(row);
    } else {
      const left = leftMap.get(name)!;
      if (left.expectedValue !== row.expectedValue) {
        changed.push({ name, oldValue: left.expectedValue, newValue: row.expectedValue });
      }
    }
  });
  leftMap.forEach((row, name) => {
    if (!rightMap.has(name)) {
      removed.push(row);
    }
  });
  return { added, removed, changed };
}

export function LibraryPage() {
  const { t } = useTranslation("manifests");
  const navigate = useNavigate();
  const {
    search,
    setSearch,
    category,
    setCategory,
    platformFilter,
    setPlatformFilter,
    expanded,
    setExpanded,
    filtered,
  } = useLibraryFilters();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Version comparison state
  const [compareEntry, setCompareEntry] = useState<BaselineEntry | null>(null);
  const [leftVersion, setLeftVersion] = useState("");
  const [rightVersion, setRightVersion] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  // v0.1.14: token-bail on Compare Versions. Without this, closing
  // the modal mid-fetch left `compareLoading=true` AND the in-flight
  // fetch later resolved into the now-closed modal's state — so
  // reopening showed a stuck spinner + the previous compare's diff.
  // Bumping the token on close (closeCompareModal below) and on
  // every new runCompare lets the stale fetch detect it's been
  // superseded and bail. (Fetch-race medium from the v0.1.13
  // edge-case backlog.)
  const compareTokenRef = useRef(0);
  const closeCompareModal = useCallback(() => {
    compareTokenRef.current += 1;
    setCompareEntry(null);
    setCompareLoading(false);
    setDiffResult(null);
    setCompareError(null);
  }, []);

  const handleUseTemplate = useCallback(
    async (entry: BaselineEntry) => {
      if (!entry.manifestUrl) return;
      setLoadingId(entry.id);
      setError(null);
      try {
        const json = await cfs.library.get({ id: entry.id, content: true });
        if (!json.content) {
          throw new Error(json.note ?? "No manifest content available");
        }

        // v0.1.14: atomic template handoff + quota-failure path.
        // Previously the 3 setItem calls ran sequentially with no
        // try/catch — if sessionStorage was full mid-sequence, the
        // first write threw but the next 2 still attempted, leaving
        // partial state (e.g. name + platform set but content
        // missing). That confused /manifests/new which saw a
        // template handoff but couldn't read the content. Now we
        // wrap in try/catch and on QuotaExceededError clear any
        // stale `configforge-compliance-*` cache entries (those are
        // recoverable) and retry once. If we still can't write, we
        // surface the error to the user so they know the handoff
        // failed instead of silently navigating away with partial
        // state. (Storage medium from the v0.1.13 edge-case backlog.)
        const writeTemplate = (): boolean => {
          try {
            sessionStorage.setItem("baseline-template-content", json.content);
            sessionStorage.setItem("baseline-template-name", entry.name);
            sessionStorage.setItem("baseline-template-platform", entry.platform);
            return true;
          } catch (err) {
            const name = (err as { name?: string } | null)?.name;
            // Only treat known quota errors as recoverable.
            if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
              return false;
            }
            throw err;
          }
        };
        if (!writeTemplate()) {
          // Evict recoverable caches (compliance cache only — never
          // touch other 'baseline-template-*' keys).
          const evictable: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith("configforge-compliance-")) evictable.push(k);
          }
          for (const k of evictable) sessionStorage.removeItem(k);
          if (!writeTemplate()) {
            throw new Error(
              "Browser storage is full. Close other tabs or clear cached compliance results, then try again.",
            );
          }
        }
        navigate("/manifests/new?fromLibrary=true");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoadingId(null);
      }
    },
    [navigate],
  );

  const openCompare = useCallback((entry: BaselineEntry) => {
    const versions = entry.versions ?? [];
    setCompareEntry(entry);
    setLeftVersion(versions.length >= 2 ? versions[1].version : "");
    setRightVersion(versions.length >= 1 ? versions[0].version : "");
    setDiffResult(null);
    setCompareError(null);
  }, []);

  const runCompare = useCallback(async () => {
    if (!compareEntry?.versions || !leftVersion || !rightVersion) return;
    const myToken = ++compareTokenRef.current;
    setCompareLoading(true);
    setCompareError(null);
    setDiffResult(null);
    try {
      const leftUrl = compareEntry.versions.find((v) => v.version === leftVersion)?.csvUrl;
      const rightUrl = compareEntry.versions.find((v) => v.version === rightVersion)?.csvUrl;
      if (!leftUrl || !rightUrl) throw new Error("Version URL not found");

      const [leftJson, rightJson] = await Promise.all([
        cfs.baselineCsv.fetch({ url: leftUrl }),
        cfs.baselineCsv.fetch({ url: rightUrl }),
      ]);
      if (myToken !== compareTokenRef.current) return;
      const leftRows = parseCsv(leftJson.text);
      const rightRows = parseCsv(rightJson.text);
      setDiffResult(diffCsvRows(leftRows, rightRows));
    } catch (err) {
      if (myToken !== compareTokenRef.current) return;
      setCompareError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      if (myToken === compareTokenRef.current) setCompareLoading(false);
    }
  }, [compareEntry, leftVersion, rightVersion]);

  /* Deploy from library — commented out for V1, flow is: Use as Template → Register → Deploy
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{
    id: string;
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
  } | null>(null);
    const handleDeployManifest = useCallback(async (entry: BaselineEntry) => {
    // ... deploy manifest logic ...
  }, []);
    const handleDeployScenario = useCallback(async (entry: BaselineEntry) => {
    // ... deploy scenario logic ...
  }, []);
  */

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t("library.extracted.text1")}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("library.extracted.text2")}{" "}
          <ExternalLink
            href="https://github.com/microsoft/osconfig"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("library.extracted.text3")}
          </ExternalLink>{" "}
          {t("library.extracted.text4")}
        </p>
      </div>

      {/* Error */}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* SearchRegular */}
        <div className="relative flex-1">
          <SearchRegular className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("library.extracted.text5")}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
        </div>

        {/* Platform filter */}
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
          {PLATFORM_FILTERS.map((pf) => (
            <button
              key={pf.id}
              onClick={() => setPlatformFilter(pf.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
                platformFilter === pf.id
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {pf.id === "windows" && <DesktopRegular className="h-3.5 w-3.5" />}
              {pf.id === "linux" && <WindowConsoleRegular className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{pf.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              category === cat.id
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Empty */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <BookOpenRegular className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">
            {t("library.extracted.text8")}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("library.extracted.text9")}
          </p>
        </div>
      )}

      {/* Cards */}
      {filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((entry) => {
            const isExpanded = expanded === entry.id;
            const meta = categoryMeta[entry.category];
            const CatIcon = meta.icon;
            const isLoading = loadingId === entry.id;

            return (
              <div
                key={entry.id}
                className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm transition-colors hover:border-blue-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700"
              >
                {/* Card body */}
                <div className="flex flex-1 flex-col p-6 min-w-0">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <span
                      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.color}`}
                    >
                      <CatIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{meta.label}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          entry.platform === "windows"
                            ? "bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400"
                            : "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                        }`}
                      >
                        {entry.platform === "windows" ? (
                          <DesktopRegular className="h-3 w-3" />
                        ) : (
                          <WindowConsoleRegular className="h-3 w-3" />
                        )}
                        {entry.platform === "windows"
                          ? t("library.extracted.text12")
                          : t("library.extracted.text13")}
                      </span>
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {t("library.extracted.text14")}
                        {entry.version}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                    {entry.name}
                  </h3>
                  <p className="mt-1 line-clamp-3 text-xs text-slate-500 dark:text-slate-400">
                    {entry.description}
                  </p>

                  {/* Scenario badge — `min-w-0` + `truncate` lets the
                     long scenario id (e.g. "cis-windows-server-2022-
                     member-server") shrink instead of pushing the
                     badge outside the card. */}
                  {entry.scenarioName && (
                    <div className="mt-2 flex max-w-full items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
                      <ShieldCheckmarkRegular className="h-3 w-3 shrink-0" />
                      <span className="shrink-0">{t("library.extracted.text15")}</span>
                      <code className="min-w-0 truncate font-mono" title={entry.scenarioName}>
                        {entry.scenarioName}
                      </code>
                    </div>
                  )}

                  {/* Resource count / types summary */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {entry.resourceCount != null && (
                      <span>
                        {entry.resourceCount}
                        {" "}
                        {t("library.extracted.text16")}
                      </span>
                    )}
                    <span>
                      {entry.resourceTypes.length}
                      {" "}
                      {t("library.extracted.text17")}
                      {entry.resourceTypes.length !== 1 ? t("library.extracted.text18") : ""}
                    </span>
                  </div>

                  {/* Actions — always available now */}

                  {/* Expandable resource types */}
                  <div className="mt-4">
                    <button
                      onClick={() => setExpanded(isExpanded ? null : entry.id)}
                      className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {isExpanded ? (
                        <ChevronDownRegular className="h-3 w-3" />
                      ) : (
                        <ChevronRightRegular className="h-3 w-3" />
                      )}
                      {isExpanded ? t("library.extracted.text19") : t("library.extracted.text20")}
                      {" "}
                      {t("library.extracted.text21")}
                    </button>

                    {isExpanded && (
                      <ul className="mt-2 space-y-1">
                        {entry.resourceTypes.map((rt) => (
                          <li
                            key={rt}
                            className="break-all rounded bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {rt}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Card footer actions */}
                <div className="flex flex-col gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
                  {/* Use as Template — available for all baselines with content */}
                  {entry.manifestUrl && (
                    <Button
                      appearance="primary"
                      onClick={() => handleUseTemplate(entry)}
                      // v0.1.13 fix — disable ALL Use as Template
                      // buttons (not just this entry's) while ANY
                      // template load is in flight. Previously the
                      // disabled check was `loadingId === entry.id`,
                      // so a user who clicked baseline A then baseline
                      // B before A finished kicked off two concurrent
                      // cfs.library.get fetches that both raced to
                      // overwrite sessionStorage. The slower fetch
                      // won — so a user who clicked B last could end
                      // up on /manifests/new pre-filled with A's
                      // content. Disable-all forces serial loads.
                      disabled={loadingId !== null}
                      icon={isLoading ? <Spinner size="tiny" /> : <DocumentBulletListRegular />}
                      style={{ width: "100%" }}
                    >
                      {isLoading ? t("library.extracted.text22") : t("library.extracted.text23")}
                    </Button>
                  )}

                  {/* Secondary actions */}
                  <div className="flex gap-2">
                    {entry.csvUrl && (
                      <ExternalLink
                        href={entry.csvUrl}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <ArrowDownloadRegular className="h-3 w-3" />
                        {t("library.extracted.text24")}
                      </ExternalLink>
                    )}
                    {entry.githubUrl && (
                      <ExternalLink
                        href={entry.githubUrl}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <OpenRegular className="h-3 w-3" />
                        {t("library.extracted.text25")}
                      </ExternalLink>
                    )}
                  </div>

                  {/* Compare Versions — only for baselines with version history */}
                  {entry.versions && entry.versions.length >= 2 && (
                    <button
                      onClick={() => openCompare(entry)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <BranchCompareRegular className="h-3.5 w-3.5" />
                      {t("library.extracted.text26")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Version Comparison Modal ──────────────────────────── */}
      {compareEntry && compareEntry.versions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {t("library.extracted.text27")}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{compareEntry.name}</p>
              </div>
              <button
                onClick={closeCompareModal}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <DismissRegular className="h-5 w-5" />
              </button>
            </div>

            {/* Version selectors */}
            <div className="flex items-end gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t("library.extracted.text28")}
                </label>
                <select
                  value={leftVersion}
                  onChange={(e) => setLeftVersion(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {compareEntry.versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {t("library.extracted.text29")}
                      {v.version}
                    </option>
                  ))}
                </select>
              </div>
              <span className="pb-2 text-sm text-slate-400">→</span>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t("library.extracted.text30")}
                </label>
                <select
                  value={rightVersion}
                  onChange={(e) => setRightVersion(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {compareEntry.versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {t("library.extracted.text31")}
                      {v.version}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                appearance="primary"
                onClick={runCompare}
                disabled={compareLoading || leftVersion === rightVersion}
                icon={compareLoading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
              >
                {t("library.extracted.text32")}
              </Button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {compareError && (
                <MessageBar intent="error">
                  <MessageBarBody>{compareError}</MessageBarBody>
                </MessageBar>
              )}

              {leftVersion === rightVersion && !compareLoading && (
                <p className="text-center text-sm text-slate-400 py-8">
                  {t("library.extracted.text33")}
                </p>
              )}

              {diffResult && (
                <div className="space-y-6">
                  {/* Summary badges */}
                  <div className="flex flex-wrap gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                      <AddRegular className="h-3 w-3" />
                      {diffResult.added.length}
                      {t("library.extracted.text34")}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-900/20 dark:text-red-400">
                      <SubtractRegular className="h-3 w-3" />
                      {diffResult.removed.length}
                      {t("library.extracted.text35")}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                      <ArrowSyncRegular className="h-3 w-3" />
                      {diffResult.changed.length}
                      {t("library.extracted.text36")}
                    </span>
                  </div>

                  {diffResult.added.length === 0 &&
                    diffResult.removed.length === 0 &&
                    diffResult.changed.length === 0 && (
                      <p className="text-center text-sm text-slate-400 py-4">
                        {t("library.extracted.text37")}
                        {leftVersion}
                        {t("library.extracted.text38")}
                        {rightVersion}.
                      </p>
                    )}

                  {/* Added settings */}
                  {diffResult.added.length > 0 && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        <AddRegular className="h-4 w-4" />
                        {t("library.extracted.text39")}
                        {rightVersion}
                      </h3>
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                                {t("library.extracted.text40")}
                              </th>
                              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                                {t("library.extracted.text41")}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {diffResult.added.map((row) => (
                              <tr
                                key={row.name}
                                className="bg-emerald-50/50 dark:bg-emerald-900/10"
                              >
                                <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">
                                  {row.name}
                                </td>
                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                  {row.expectedValue}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Removed settings */}
                  {diffResult.removed.length > 0 && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-400">
                        <SubtractRegular className="h-4 w-4" />
                        {t("library.extracted.text42")}
                        {rightVersion}
                      </h3>
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                                {t("library.extracted.text43")}
                              </th>
                              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                                {t("library.extracted.text44")}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {diffResult.removed.map((row) => (
                              <tr key={row.name} className="bg-red-50/50 dark:bg-red-900/10">
                                <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">
                                  {row.name}
                                </td>
                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                  {row.expectedValue}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Changed settings */}
                  {diffResult.changed.length > 0 && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
                        <ArrowSyncRegular className="h-4 w-4" />
                        {t("library.extracted.text45")}
                      </h3>
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                                {t("library.extracted.text46")}
                              </th>
                              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                                {t("library.extracted.text47")}
                                {leftVersion}
                              </th>
                              <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">
                                {t("library.extracted.text48")}
                                {rightVersion}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {diffResult.changed.map((ch) => (
                              <tr key={ch.name} className="bg-amber-50/50 dark:bg-amber-900/10">
                                <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">
                                  {ch.name}
                                </td>
                                <td className="px-3 py-2 text-red-600 line-through dark:text-red-400">
                                  {ch.oldValue}
                                </td>
                                <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400">
                                  {ch.newValue}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
