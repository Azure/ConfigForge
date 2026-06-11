// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR27: "Recent rationale" sidebar widget.
 *
 * Lives next to the existing CIS sidebar in the editor. Shows the last
 * few rationale entries for the resource currently selected in the
 * editor. Auto-refreshes when (manifestId, resourceName) changes.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HistoryRegular, ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { Spinner } from "@fluentui/react-components";
import type { RationaleEntry } from "@configforge/core/manifest/rationale-store";
import { cfs } from "../lib/cfs";
import { useDateFormatter, useRelativeTimeFormatter } from "../lib/format";
import { useTranslation } from "react-i18next";

export interface RecentRationaleSidebarProps {
  /** Manifest namespace; when undefined, the widget is hidden. */
  manifestId?: string;
  /** Currently-selected resource (from cursor context). */
  resourceName: string | null;
  /** Max entries to render. Defaults to 3 per spec. */
  limit?: number;
  /**
   * When true, render only the header strip (one line) — content is
   * hidden until the user clicks the chevron. Defaults to true so the
   * editor gets back horizontal space; the user can opt-in per session.
   */
  collapsed?: boolean;
  /** Toggle handler for the chevron. Required when `collapsed` is used. */
  onToggleCollapsed?: () => void;
  /**
   * Layout mode. `sidebar` (default) renders the in-component
   * collapse header. `drawer` skips the header — the parent bottom
   * drawer's tab already handles open/close, so a second header is
   * redundant.
   */
  mode?: "sidebar" | "drawer";
}

export function RecentRationaleSidebar({
  manifestId,
  resourceName,
  limit = 3,
  collapsed = false,
  onToggleCollapsed,
  mode = "sidebar",
}: RecentRationaleSidebarProps) {
  const { t } = useTranslation("common");
  const dateFormatter = useDateFormatter({ dateStyle: 'medium' });
  const relativeTimeFormatter = useRelativeTimeFormatter({ numeric: 'auto' });
  const [entries, setEntries] = useState<RationaleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manifestId || !resourceName) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    cfs.rationale
      .list(manifestId)
      .then((body) => {
        if (cancelled) return;
        const filtered = (body as { entries: RationaleEntry[] }).entries.filter(
          (e) => e.resourceName === resourceName,
        );
        // Newest first, then truncate to `limit`.
        filtered.reverse();
        setEntries(filtered.slice(0, limit));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifestId, resourceName, limit]);

  if (!manifestId || !resourceName) return null;

  // Drawer mode: the parent's bottom-drawer tab already controls
  // open/close, so we render only the body (no second collapse
  // header that would feel redundant).
  if (mode === "drawer") {
    return (
      <div className="px-3 py-3" data-testid="recent-rationale-sidebar">
        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Spinner size="tiny" />
            {t("components.recentRationale.extracted.text1")}
          </div>
        )}
        {!loading && error && (
          <div className="text-xs text-red-400" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="text-xs text-slate-300">
            {t("components.recentRationale.extracted.text2")}
          </div>
        )}
        {!loading && !error && entries.length > 0 && (
          <ul className="space-y-2">
            {entries.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span title={e.ts} className="font-medium tabular-nums text-blue-300">
                    {relativeTime(e.ts, relativeTimeFormatter, dateFormatter)}
                  </span>
                  <span aria-hidden className="text-slate-500">
                    ·
                  </span>
                  {e.skipped ? (
                    <span className="rounded-full border border-slate-600 bg-slate-800 px-1.5 py-0 text-[10px] text-slate-300">
                      {t("components.recentRationale.extracted.text3")}
                    </span>
                  ) : (
                    <span className="text-slate-200">
                      {e.author || t("components.recentRationale.extracted.text4")}
                    </span>
                  )}
                </div>
                <div
                  className="text-xs text-slate-300"
                  title={e.skipped ? t("components.recentRationale.extracted.text5") : e.reason}
                >
                  {e.skipped ? (
                    <em className="text-slate-500">
                      {t("components.recentRationale.extracted.text6")}
                    </em>
                  ) : (
                    e.reason
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          to={`/manifests/${encodeURIComponent(manifestId)}/rationale`}
          className="mt-3 inline-block text-[11px] text-blue-400 hover:underline"
        >
          {t("components.recentRationale.extracted.text7")}
        </Link>
      </div>
    );
  }

  const header = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-slate-300 hover:bg-slate-800/60"
      title={
        collapsed
          ? t("components.recentRationale.extracted.text8")
          : t("components.recentRationale.extracted.text9")
      }
      data-testid="recent-rationale-toggle"
    >
      {collapsed ? (
        <ChevronRightRegular className="h-3 w-3 shrink-0 text-slate-500" />
      ) : (
        <ChevronDownRegular className="h-3 w-3 shrink-0 text-slate-500" />
      )}
      <HistoryRegular className="h-3.5 w-3.5 text-blue-400" />
      <span className="text-xs font-semibold">
        {t("components.recentRationale.extracted.text10")}
      </span>
      {entries.length > 0 && (
        <span className="ml-auto rounded-full bg-slate-800 px-1.5 py-0 text-[10px] text-slate-400">
          {entries.length}
        </span>
      )}
    </button>
  );

  if (collapsed) {
    return (
      <div className="border-t border-slate-800" data-testid="recent-rationale-sidebar">
        {header}
      </div>
    );
  }

  return (
    <div className="border-t border-slate-800" data-testid="recent-rationale-sidebar">
      {header}
      <div className="px-3 pb-3">
        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Spinner size="tiny" />
            {t("components.recentRationale.extracted.text11")}
          </div>
        )}
        {!loading && error && (
          <div className="text-xs text-red-400" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="text-xs text-slate-500">
            {t("components.recentRationale.extracted.text12")}
          </div>
        )}
        {!loading && !error && entries.length > 0 && (
          <ul className="space-y-2">
            {entries.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span title={e.ts} className="font-medium tabular-nums text-blue-300">
                    {relativeTime(e.ts, relativeTimeFormatter, dateFormatter)}
                  </span>
                  <span aria-hidden className="text-slate-500">
                    ·
                  </span>
                  {e.skipped ? (
                    <span className="rounded-full border border-slate-600 bg-slate-800 px-1.5 py-0 text-[10px] text-slate-300">
                      {t("components.recentRationale.extracted.text13")}
                    </span>
                  ) : (
                    <span className="text-slate-200">
                      {e.author || t("components.recentRationale.extracted.text14")}
                    </span>
                  )}
                </div>
                <div
                  className="truncate text-xs text-slate-300"
                  title={e.skipped ? t("components.recentRationale.extracted.text15") : e.reason}
                >
                  {e.skipped ? (
                    <em className="text-slate-500">
                      {t("components.recentRationale.extracted.text16")}
                    </em>
                  ) : (
                    e.reason
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          to={`/manifests/${encodeURIComponent(manifestId)}/rationale`}
          className="mt-3 inline-block text-[11px] text-blue-400 hover:underline"
        >
          {t("components.recentRationale.extracted.text17")}
        </Link>
      </div>
    </div>
  );
}

function relativeTime(
  iso: string,
  relativeTimeFormatter: Intl.RelativeTimeFormat,
  dateFormatter: Intl.DateTimeFormat,
): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return relativeTimeFormatter.format(0, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return relativeTimeFormatter.format(-diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return relativeTimeFormatter.format(-diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return relativeTimeFormatter.format(-diffDay, 'day');
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return relativeTimeFormatter.format(-diffMo, 'month');
  return dateFormatter.format(new Date(t));
}
