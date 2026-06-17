// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


/**
 * Full per-manifest rationale log.
 *
 * Read-only auditor view of every entry captured by the "Why?" prompt in
 * the manifest editor (PR27). Source: GET /api/manifests/[id]/rationale.
 *
 * The editor sidebar (RecentRationaleSidebar) only shows the last 3
 * entries for the currently-selected resource. This page is the cross-
 * resource, full-history surface — chronological, searchable, and
 * exportable as CSV for offline review.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ArrowLeftRegular,
  SearchRegular,
  ArrowDownloadRegular,
  DocumentRegular,
  CheckmarkCircleRegular,
  DismissRegular as XIcon,
} from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, MessageBarTitle, Spinner } from "@fluentui/react-components";
import type { RationaleEntry } from "@configforge/core/manifest/rationale-store";
import { cfs } from "../lib/cfs";

interface ApiResponse {
  entries: RationaleEntry[];
}

export function RationaleLogPage() {
  const params = useParams<{ id: string }>();
  const manifestId = decodeURIComponent(params.id ?? '');
  const { t } = useTranslation('manifest-editor');

  const [entries, setEntries] = useState<RationaleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showSkipped, setShowSkipped] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    cfs.rationale
      .list(manifestId)
      .then((data) => {
        if (cancelled) return;
        const entries = (data as ApiResponse).entries;
        setEntries(Array.isArray(entries) ? entries : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifestId]);

  // Reverse-chronological (newest first). The API returns oldest-first.
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.ts.localeCompare(a.ts)),
    [entries],
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return sorted.filter((e) => {
      if (!showSkipped && e.skipped) return false;
      if (!q) return true;
      return (
        e.resourceName.toLowerCase().includes(q) ||
        (e.author ?? "").toLowerCase().includes(q) ||
        (e.reason ?? "").toLowerCase().includes(q)
      );
    });
  }, [sorted, filter, showSkipped]);

  const stats = useMemo(() => {
    const total = entries.length;
    const skipped = entries.filter((e) => e.skipped).length;
    const captured = total - skipped;
    return { total, captured, skipped };
  }, [entries]);

  const downloadCsv = () => {
    const header = ["timestamp", "author", "setting", "reason", "skipped"];
    const rows = sorted.map((e) => [
      e.ts,
      e.author ?? "",
      e.resourceName ?? "",
      (e.reason ?? "").replace(/[\r\n]+/g, " "),
      e.skipped ? "true" : "false",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(cell)).join(","))
      .join("\n");
    const today = new Date().toISOString().split("T")[0];
    const safe = manifestId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}-rationale-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Link
            to={`/manifests/${encodeURIComponent(manifestId)}`}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            <ArrowLeftRegular className="h-3.5 w-3.5" />
            {t("rationale.backToManifest")}
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-white">
            <DocumentRegular className="h-5 w-5" />
            {t("rationale.logTitle")} <span className="font-mono text-lg">{manifestId}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("rationale.logDescription")}
          </p>
        </div>
        {entries.length > 0 && (
          <Button
            appearance="secondary"
            onClick={downloadCsv}
            icon={<ArrowDownloadRegular />}
            title={t("rationale.downloadCsvTitle")}
          >
            {t("rationale.downloadCsv")}
          </Button>
        )}
      </div>

      {/* Stats row */}
      {!loading && !error && entries.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-4">
          <StatCard label={t("rationale.stats.total")} value={stats.total} />
          <StatCard
            label={t("rationale.stats.withRationale")}
            value={stats.captured}
            icon={<CheckmarkCircleRegular className="h-4 w-4 text-emerald-500" />}
          />
          <StatCard
            label={t("rationale.stats.skipped")}
            value={stats.skipped}
            icon={<XIcon className="h-4 w-4 text-slate-400" />}
          />
        </div>
      )}

      {/* Filter row */}
      {!loading && !error && entries.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <SearchRegular className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("rationale.filterPlaceholder")}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={showSkipped}
              onChange={(e) => setShowSkipped(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600"
            />
            {t("rationale.showSkipped")}
          </label>
          {filter && (
            <span className="text-xs text-slate-400">
              {t("rationale.filterCount", { visible: visible.length, total: entries.length })}
            </span>
          )}
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-12 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          <Spinner size="tiny" />
          {t("rationale.loading")}
        </div>
      )}

      {!loading && error && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>{t("rationale.loadErrorTitle")}</MessageBarTitle>
            <span className="font-mono text-xs">{error}</span>
          </MessageBarBody>
        </MessageBar>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <DocumentRegular className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("rationale.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("rationale.emptyDescription")}
          </p>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">{t("rationale.table.timestamp")}</th>
                                <th className="px-4 py-3 font-medium">{t("rationale.table.author")}</th>
                                <th className="px-4 py-3 font-medium">{t("rationale.table.resource")}</th>
                                <th className="px-4 py-3 font-medium">{t("rationale.table.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => (
                <tr
                  key={`${e.ts}-${i}`}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-slate-500 dark:text-slate-400">
                    <span title={e.ts}>{formatTimestamp(e.ts)}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-top">
                    {e.skipped ? (
                      <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        {t("rationale.skippedBadge")}
                      </span>
                    ) : (
                      <span className="text-slate-700 dark:text-slate-300">
                        {coerceAuthor(e.author, t("rationale.unknownAuthor"))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-xs text-slate-700 dark:text-slate-300">
                    {e.resourceName}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700 dark:text-slate-300">
                    {e.skipped ? (
                      <em className="text-slate-400">{t("rationale.noReasonSkipped")}</em>
                    ) : (
                      <span className="whitespace-pre-wrap break-words">{e.reason}</span>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                    {t("rationale.noFilterMatches")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Local helpers ───────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  icon?: React.ReactNode;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function csvEscape(value: string): string {
  if (value === "") return "";
  // CSV-injection guard (OWASP): if a cell starts with =, +, -, @, or a
  // tab/CR, Excel may parse it as a formula. Prefix with a single quote
  // so the cell is still readable but won't auto-execute.
  let safe = value;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = `'${safe}`;
  }
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function coerceAuthor(value: unknown, unknownLabel: string): string {
  if (value == null) return unknownLabel;
  const s = String(value).trim();
  return s.length === 0 ? unknownLabel : s;
}

/** Format an ISO timestamp as "YYYY-MM-DD HH:mm" in the user's local time. */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
