// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Page header for the ManifestEditor — title row, platform badge,
 * back link, and the full action button cluster (edit / save / cancel
 * / duplicate / export drawer / history / audit-pack / deploy
 * menu / revert / remove).
 *
 * Phase C.5 + C.6 of the page-split refactor. Composing the export
 * drawer (C.5) and the action cluster (C.6) together is intentional —
 * they share the same flex container and overflow behaviour, so
 * splitting them across files makes the layout harder to reason about
 * for no real benefit.
 *
 * No state of its own. The page passes the `useManifestEditorState`
 * and `useDeployFlow` hook returns down, plus a callbacks object for
 * the few handlers that still live on the page (handleSaveClick,
 * handleDuplicate, handleExport, handleExportDocs, handleDelete).
 * Phase D may consolidate those into a hook.
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRegular,
  EditRegular,
  DeleteRegular,
  ArrowDownloadRegular,
  ChevronDownRegular,
  SaveRegular,
  DismissRegular,
  HistoryRegular,
  PlayRegular,
  CopyRegular,
  ArrowCounterclockwiseRegular,
  ShieldCheckmarkRegular,
  ClipboardCheckmarkRegular,
} from "@fluentui/react-icons";
import { Spinner } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { ManifestEditorState } from "../state/useManifestEditorState";
import type { DeployFlow } from "../state/useDeployFlow";
import type { OscManifest } from "@configforge/core/types";
import { AuditProgressCounter } from "../../../components/AuditProgressCounter";
import { WindowsLogo } from "../../../components/WindowsLogo";

export interface ManifestHeaderProps {
  manifestName: string;
  manifest: OscManifest | null;
  platformBadge: { label: string; cls: string; platform?: "windows" | "linux" | "mixed" | "cross-platform" };

  editorState: ManifestEditorState;
  deploy: DeployFlow;
  rationaleBusy: boolean;

  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  duplicating: boolean;
  deleting: boolean;

  onSaveClick: () => void;
  onCancelEdit: () => void;
  onDuplicate: () => void;
  onExport: (format: "yaml" | "json" | "mof" | "excel" | "azurepolicy") => void;
  onExportDocs: () => void;
  onDelete: () => void;
}

export const ManifestHeader = React.memo(function ManifestHeader({
  manifestName,
  manifest,
  platformBadge,
  editorState,
  deploy,
  rationaleBusy,
  exportOpen,
  setExportOpen,
  duplicating,
  deleting,
  onSaveClick,
  onCancelEdit,
  onDuplicate,
  onExport,
  onExportDocs,
  onDelete,
}: ManifestHeaderProps) {
  const { editing, isEditable, saving, beginEditing } = editorState;
  const {
    deploying,
    deployProgress,
    deployMenuOpen,
    setDeployMenuOpen,
    reverting,
    handleDeploy,
    handleRevert,
  } = deploy;
  const { t } = useTranslation(["manifest-editor", "common", "manifests"]);

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex items-center gap-4">
        <Link
          to="/manifests"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <ArrowLeftRegular className="h-4 w-4" />
          {t("actions.back")}
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{manifestName}</h1>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${platformBadge.cls}`}
            >
              {platformBadge.platform === "windows" && <WindowsLogo className="h-3.5 w-3.5" />}
              {platformBadge.label}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      {editing ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onCancelEdit}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <DismissRegular className="h-4 w-4" />
            {t("common:buttons.cancel")}
          </button>
          <button
            onClick={onSaveClick}
            disabled={saving || rationaleBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving || rationaleBusy ? <Spinner size="tiny" /> : <SaveRegular className="h-4 w-4" />}
            {t("common:buttons.save")}
          </button>
        </div>
      ) : (
        // UI H8: Two logical clusters separated by gap-x-4. The cluster
        // boundary IS the visual separation (no literal divider), so the
        // destructive Remove button can never end up adjacent to a benign
        // action like History after a flex-wrap reflow. At wide widths both
        // clusters fit on one row; at narrow widths each cluster wraps
        // independently. Remove keeps explicit destructive styling so it
        // visually stands apart even within its own cluster.
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Cluster A: Read / Export */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={beginEditing}
              disabled={!isEditable}
              title={!isEditable ? t("content.mofEditUnsupported") : undefined}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <EditRegular className="h-3.5 w-3.5" />
              {t("actions.edit")}
            </button>

            <button
              onClick={onDuplicate}
              disabled={duplicating}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              title={t("actions.duplicateTitle")}
            >
              {duplicating ? <Spinner size="tiny" /> : <CopyRegular className="h-3.5 w-3.5" />}
              {t("actions.duplicate")}
            </button>

            {/* Export dropdown (Phase C.5 — formerly its own component slot) */}
            <div className="relative">
              <button
                onClick={() => setExportOpen(!exportOpen)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ArrowDownloadRegular className="h-3.5 w-3.5" />
                {t("actions.export")}
                <ChevronDownRegular className="h-3 w-3" />
              </button>
              {exportOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setExportOpen(false)}
                  />
                  <div className="absolute left-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    {(
                      [
                        { key: "yaml", label: t("export.formats.yaml") },
                        { key: "json", label: t("export.formats.json") },
                        { key: "mof", label: t("export.formats.mof") },
                        { key: "azurepolicy", label: t("export.formats.azurePolicy") },
                        { key: "excel", label: t("export.formats.csv") },
                      ] as const
                    ).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => onExport(key)}
                        className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        {label}
                      </button>
                    ))}
                    <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                    <button
                      onClick={onExportDocs}
                      className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {t("export.documentation")}
                    </button>
                  </div>
                </>
              )}
            </div>

            <Link
              to={`/manifests/${encodeURIComponent(manifestName)}/history`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <HistoryRegular className="h-3.5 w-3.5" />
              {t("actions.history")}
            </Link>

            <Link
              to={`/manifests/${encodeURIComponent(manifestName)}/audit-pack`}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              title={t("actions.auditPackTitle")}
            >
              <ClipboardCheckmarkRegular className="h-3.5 w-3.5" />
              {t("actions.auditPack")}
            </Link>
          </div>

          {/* Cluster B: Deploy / Destructive */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Deploy dropdown */}
            <div className="relative">
              <button
                onClick={() => setDeployMenuOpen(!deployMenuOpen)}
                disabled={deploying || reverting || deleting || saving}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {deploying ? <Spinner size="tiny" /> : <PlayRegular className="h-3.5 w-3.5" />}
                {deploying && deployProgress?.resourcesTotal ? (
                  <AuditProgressCounter
                    completed={deployProgress.resourcesCompleted ?? 0}
                    total={deployProgress.resourcesTotal}
                  />
                ) : (
                  t("common:features.deploy")
                )}
                <ChevronDownRegular className="h-3 w-3" />
              </button>
              {deployMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setDeployMenuOpen(false)}
                  />
                  <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <button
                      onClick={() => {
                        setDeployMenuOpen(false);
                        handleDeploy("audit");
                      }}
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <ShieldCheckmarkRegular className="mt-0.5 h-4 w-4 text-blue-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                          {t("manifests:features.audit")}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t("deploy.auditDescription")}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setDeployMenuOpen(false);
                        handleDeploy("enforce");
                      }}
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <PlayRegular className="mt-0.5 h-4 w-4 text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                          {t("manifests:actions.enforce")}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t("deploy.enforceDescription")}
                        </p>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleRevert}
              disabled={
                reverting ||
                deploying ||
                deleting ||
                saving ||
                // v0.3.0 (#18): no point letting the user click Revert
                // when nothing has ever been deployed. `lastAppliedAt`
                // null means this manifest has been registered but
                // never deployed — there's no snapshot to roll back
                // to and no enforcement to remove.
                !manifest?.Deployed
              }
              className="inline-flex items-center gap-2 rounded-lg border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-600 transition-colors hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
              title={
                manifest?.Deployed
                  ? t("actions.revertTitle")
                  : t("actions.noRevertTitle")
              }
            >
              {reverting ? (
                <Spinner size="tiny" />
              ) : (
                <ArrowCounterclockwiseRegular className="h-3.5 w-3.5" />
              )}
              {t("actions.revert")}
            </button>

            <button
              onClick={onDelete}
              disabled={deleting || deploying || reverting || saving}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:border-red-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:border-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-300"
            >
              {deleting ? <Spinner size="tiny" /> : <DeleteRegular className="h-3.5 w-3.5" />}
              {t("actions.remove")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
