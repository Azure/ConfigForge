// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { ManifestEditor } from "../components/manifest-editor";
import { Breadcrumb } from "../components/Breadcrumb";
import { DiffViewer } from "../components/diff-viewer";
import { safeRestore } from "@configforge/core/history/restore";
import { stringifyLosslessJson } from "@configforge/core/manifest/lossless";
import { electronRestoreClient } from "../lib/electron-restore-client";
import { cfs } from "../lib/cfs";
import {
  ArrowLeftRegular,
  HistoryRegular,
  EyeRegular,
  BranchCompareRegular,
  ArrowCounterclockwiseRegular,
  DeleteRegular,
  DismissRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { useDateFormatter, useNumberFormatter } from "../lib/format";

interface HistoryEntry {
  id: string;
  manifestName: string;
  timestamp: string;
  content: string;
  message?: string;
  size?: number;
  /** PR27: change-author capture. The "why this change?" comment the
   *  user entered when saving the manifest. Already stored per-snapshot
   *  in the meta sidecar; surfaced here for the design team's request
   *  to show save comments in the History list items. */
  rationale?: string;
  author?: string;
  authorEmail?: string;
}

/** What `/api/history?name=...` returns: metadata only, no content. */
type HistoryEntryMeta = Omit<HistoryEntry, "content">;

type ViewMode = "list" | "view" | "compare";

export function ManifestHistoryPage() {
  const params = useParams<{ id: string }>();
  const manifestName = decodeURIComponent(params.id);
  const { t } = useTranslation(["history", "common", "sidebar"]);
  const timestampFormatter = useDateFormatter({
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const fileSizeFormatter = useNumberFormatter({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const [entries, setEntries] = useState<HistoryEntryMeta[]>([]);
  const [currentYaml, setCurrentYaml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // View / compare state
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);

  // Restore modal state
  const [restoreCandidate, setRestoreCandidate] = useState<HistoryEntryMeta | null>(null);
  const [restorePreview, setRestorePreview] = useState<{
    snapshotYaml: string;
    currentYaml: string;
  } | null>(null);
  const [restoring, setRestoring] = useState(false);

  // v0.1.13 fix — counter token so concurrent View / Compare /
  // Restore loads don't race. Previously a user who clicked View on
  // snapshot A then Compare on snapshot B before A finished could
  // end up with A's content rendered in B's compare view (or vice
  // versa) — whichever fetch resolved last won setSelectedEntry +
  // setViewMode, ignoring user intent. Each load bumps this counter
  // and tags its request; resolution handlers bail if the live
  // counter has moved on.
  const loadTokenRef = useRef(0);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await cfs.history.list({ name: manifestName });
      const data = (res as { data?: HistoryEntryMeta[] }).data;
      if (data) setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.historyLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [manifestName]);

  /**
   * Lazy fetch a single snapshot (with content) and the current manifest
   * YAML (only needed for Compare). Returns `null` and surfaces an error
   * via `setError` if either fetch fails.
   */
  const loadSelected = useCallback(
    async (
      entry: HistoryEntryMeta,
      mode: "view" | "compare",
    ): Promise<HistoryEntry | null> => {
      setActionLoading(entry.id);
      setError(null);
      const token = ++loadTokenRef.current;
      try {
        const fetches: Promise<unknown>[] = [
          cfs.history.list({ name: manifestName, id: entry.id }),
        ];
        if (mode === "compare") {
          fetches.push(cfs.manifests.status(manifestName));
        }
        const results = await Promise.all(fetches);
        // Bail if a later loadSelected (different snapshot or different
        // mode) has been issued while this fetch was in flight.
        if (token !== loadTokenRef.current) return null;
        const snapshotRes = results[0] as { data?: HistoryEntry; error?: string };
        if (!snapshotRes?.data) {
          throw new Error(snapshotRes?.error ?? t("errors.snapshotNotFound"));
        }
        if (mode === "compare") {
          const currentRes = results[1] as { data?: unknown };
          if (currentRes?.data != null) {
            const data = currentRes.data;
            setCurrentYaml(
              typeof data === "string"
                ? data
                : (stringifyLosslessJson(data, 2) ?? String(data)),
            );
          }
        }
        return snapshotRes.data;
      } catch (err) {
        if (token !== loadTokenRef.current) return null;
        setError(err instanceof Error ? err.message : t("errors.snapshotLoadFailed"));
        return null;
      } finally {
        if (token === loadTokenRef.current) setActionLoading(null);
      }
    },
    [manifestName],
  );

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const formatTimestamp = useCallback(
    (iso: string): string => {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : timestampFormatter.format(date);
    },
    [timestampFormatter],
  );

  const formatFileSize = useCallback(
    (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${fileSizeFormatter.format(bytes / 1024)} KB`;
      return `${fileSizeFormatter.format(bytes / (1024 * 1024))} MB`;
    },
    [fileSizeFormatter],
  );

  const handleView = async (entry: HistoryEntryMeta) => {
    const full = await loadSelected(entry, "view");
    if (!full) return;
    setSelectedEntry(full);
    setViewMode("view");
  };

  const handleCompare = async (entry: HistoryEntryMeta) => {
    const full = await loadSelected(entry, "compare");
    if (!full) return;
    setSelectedEntry(full);
    setViewMode("compare");
  };

  const handleClosePanel = () => {
    setSelectedEntry(null);
    setViewMode("list");
  };

  const handleRestore = async (entry: HistoryEntryMeta) => {
    setActionLoading(entry.id);
    setError(null);
    try {
      const [snapRes, curRes] = await Promise.all([
        cfs.history.list({ name: manifestName, id: entry.id }),
        cfs.manifests.status(manifestName).catch(() => ({ data: "" })),
      ]);
      const snapData = (snapRes as { data?: HistoryEntry; error?: string });
      if (!snapData?.data?.content) {
        throw new Error(snapData?.error ?? t("errors.snapshotNotFound"));
      }
      const cur = (curRes as { data?: unknown }).data;
      setRestoreCandidate(entry);
      setRestorePreview({
        snapshotYaml: snapData.data.content as string,
        currentYaml:
          typeof cur === "string"
            ? cur
            : cur
              ? (stringifyLosslessJson(cur, 2) ?? String(cur))
              : "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.restorePreviewLoadFailed"));
    } finally {
      setActionLoading(null);
    }
  };

  const cancelRestore = () => {
    // v0.1.14: bump the restore token so any in-flight confirmRestore
    // bails on resolve. Without this, closing the modal mid-restore
    // left `restoring=true` AND the safeRestore eventually resolved,
    // setting selectedEntry/viewMode/etc. on a closed modal. UI was
    // stuck spinning until the next interaction. See restoreTokenRef
    // below. (Lifecycle medium from the v0.1.13 edge-case backlog.)
    restoreTokenRef.current += 1;
    setRestoreCandidate(null);
    setRestorePreview(null);
    setRestoring(false);
  };

  const restoreTokenRef = useRef(0);

  const confirmRestore = async () => {
    if (!restoreCandidate) return;
    const entry = restoreCandidate;
    const myToken = ++restoreTokenRef.current;
    setRestoring(true);
    setError(null);
    try {
      const result = await safeRestore(manifestName, entry.id, electronRestoreClient());
      if (myToken !== restoreTokenRef.current) return;
      if (!result.ok) {
        // Surface auto-snapshot success even on failure so the user knows
        // their previous state is recoverable.
        const recovery = result.autoSnapshotted
          ? t("errors.restoreRecoverySuffix")
          : "";
        throw new Error(`${result.error ?? t("errors.restoreFailed")}${recovery}`);
      }
      await fetchHistory();
      if (myToken !== restoreTokenRef.current) return;
      setViewMode("list");
      setSelectedEntry(null);
      setRestoreCandidate(null);
      setRestorePreview(null);
    } catch (err) {
      if (myToken !== restoreTokenRef.current) return;
      setError(err instanceof Error ? err.message : t("errors.restoreFailed"));
    } finally {
      if (myToken === restoreTokenRef.current) setRestoring(false);
    }
  };

  const handleDelete = async (entry: HistoryEntryMeta) => {
    if (!confirm(t("confirm.deleteSnapshot", { time: formatTimestamp(entry.timestamp) }))) return;

    setActionLoading(entry.id);
    setError(null);
    try {
      await cfs.history.delete({ name: manifestName, id: entry.id });

      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      if (selectedEntry?.id === entry.id) {
        handleClosePanel();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Breadcrumb
        items={[
          { label: 'My Baselines', to: '/manifests' },
          { label: manifestName, to: `/manifests/${encodeURIComponent(manifestName)}` },
          { label: 'History' },
        ]}
      />
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to={`/manifests/${encodeURIComponent(manifestName)}`}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <ArrowLeftRegular className="h-4 w-4" />
          Back
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <HistoryRegular className="h-6 w-6 text-blue-500" />
            Version History
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('header.summary', { manifestName, count: entries.length })}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Spinner size="medium" />
        </div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 py-20 dark:border-slate-700">
          <HistoryRegular className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
          <p className="text-lg font-medium text-slate-500 dark:text-slate-400">
            No history recorded for this baseline
          </p>
          <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
            Snapshots are saved automatically when you register or update the baseline.
          </p>
        </div>
      )}

      {/* Timeline + detail panel */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left: Timeline */}
          <div className="space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-lg border p-4 transition-colors ${
                  selectedEntry?.id === entry.id
                    ? "border-blue-500 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/10"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                }`}
              >
                {/* Timestamp + message + rationale (save comment) */}
                <div className="mb-3">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {formatTimestamp(entry.timestamp)}
                  </p>
                  {entry.author && (
                    <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                      by {entry.author}
                    </p>
                  )}
                  {entry.message && (
                    <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                      {entry.message}
                    </p>
                  )}
                  {entry.rationale && (
                    <blockquote className="mt-2 border-l-2 border-blue-400 bg-blue-50/60 px-2 py-1 text-xs italic text-slate-700 dark:border-blue-600 dark:bg-blue-900/15 dark:text-slate-300" title={t('timeline.rationaleTitle')}>
                      “{entry.rationale}”
                    </blockquote>
                  )}
                  {entry.size != null && (
                    <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                      {formatFileSize(entry.size)}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleView(entry)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <EyeRegular className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    onClick={() => handleCompare(entry)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <BranchCompareRegular className="h-3.5 w-3.5" />
                    {t('actions.compareCurrent')}
                  </button>
                  <button
                    onClick={() => handleRestore(entry)}
                    disabled={actionLoading === entry.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20"
                    title="Replaces the baseline's authored YAML content with this snapshot. Different from the editor's Revert (which undoes a deploy on this device)."
                  >
                    {actionLoading === entry.id ? (
                      <Spinner size="tiny" />
                    ) : (
                      <ArrowCounterclockwiseRegular className="h-3.5 w-3.5" />
                    )}
                    Restore snapshot
                  </button>
                  <button
                    onClick={() => handleDelete(entry)}
                    disabled={actionLoading === entry.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <DeleteRegular className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Detail panel */}
          <div>
            {viewMode === "list" && (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 py-20 dark:border-slate-700">
                <EyeRegular className="mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  Select a snapshot to view or compare
                </p>
              </div>
            )}

            {viewMode === "view" && selectedEntry && (
              <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Snapshot Content
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatTimestamp(selectedEntry.timestamp)}
                    </p>
                  </div>
                  <button
                    onClick={handleClosePanel}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <DismissRegular className="h-4 w-4" />
                  </button>
                </div>
                <div className="h-[500px] p-2">
                  <ManifestEditor value={selectedEntry.content} readOnly height="100%" />
                </div>
              </div>
            )}

            {viewMode === "compare" && selectedEntry && (
              <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {t('diff.compareTitle')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Snapshot ({formatTimestamp(selectedEntry.timestamp)}) vs Current
                    </p>
                  </div>
                  <button
                    onClick={handleClosePanel}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  >
                    <DismissRegular className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-2">
                  <DiffViewer
                    left={selectedEntry.content}
                    right={currentYaml}
                    leftTitle={t("diff.snapshot")}
                    rightTitle={t("diff.current")}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Restore confirmation modal */}
      {restoreCandidate && restorePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-modal-title"
        >
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div className="flex items-start gap-3">
                <WarningRegular className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                <div>
                  <h3
                    id="restore-modal-title"
                    className="text-base font-semibold text-slate-900 dark:text-white"
                  >
                    Restore baseline from snapshot
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Snapshot from {formatTimestamp(restoreCandidate.timestamp)}
                    {restoreCandidate.message ? `: ${restoreCandidate.message}` : ""}
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    The current baseline will be auto-snapshotted before
                    restore so you can roll back. Re-registering may
                    re-deploy the desired state to managed devices.
                  </p>
                </div>
              </div>
              <button
                onClick={cancelRestore}
                disabled={restoring}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label={t('restore.closeAria')}
              >
                <DismissRegular className="h-5 w-5" />
              </button>
            </div>

            {/* Diff body */}
            <div className="min-h-[300px] flex-1 overflow-auto p-4">
              {restorePreview.currentYaml ? (
                <DiffViewer
                  left={restorePreview.currentYaml}
                  right={restorePreview.snapshotYaml}
                  leftTitle={t("restore.diffCurrent")}
                  rightTitle={t("restore.diffAfterRestore")}
                />
              ) : (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    No current registered baseline was found, so no auto-snapshot
                    will be created. Restore will register the snapshot content
                    as a new baseline.
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3 dark:border-slate-800">
              <Button
                appearance="secondary"
                onClick={cancelRestore}
                disabled={restoring}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={confirmRestore}
                disabled={restoring}
                icon={
                  restoring ? (
                    <Spinner size="tiny" />
                  ) : (
                    <ArrowCounterclockwiseRegular />
                  )
                }
              >
                {restoring ? t('restore.buttonLoading') : t('actions.restoreDeploys')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
