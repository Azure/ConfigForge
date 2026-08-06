// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
} from "@fluentui/react-components";
import {
  ArrowCounterclockwiseRegular,
  ArrowDownloadRegular,
  ArrowUndoRegular,
  ChevronDownRegular,
  ClipboardCheckmarkRegular,
  CopyRegular,
  DeleteRegular,
  DismissRegular,
  DocumentRegular,
  EditRegular,
  HistoryRegular,
  PlayRegular,
  SaveRegular,
  ShieldCheckmarkRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { OscManifest } from "@configforge/core/types";
import { AuditProgressCounter } from "../../../components/AuditProgressCounter";
import { hasCfsNamespace, safeCfs } from "../../../lib/cfs";
import { HAS_DEPLOY } from "../../../lib/flavor";
import type { ManifestEditorState } from "../state/useManifestEditorState";
import type { DeployFlow } from "../state/useDeployFlow";
import type { ManifestViewerMode } from "./ManifestContent";

export interface ManifestDetailFooterProps {
  manifestName: string;
  manifest: OscManifest | null;
  editorState: ManifestEditorState;
  deploy: DeployFlow;
  viewerMode: ManifestViewerMode;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  duplicating: boolean;
  deleting: boolean;
  undoing: boolean;
  undoAvailable: boolean;
  undoEditing: boolean;
  rationaleBusy: boolean;
  saveBlocked: boolean;
  onClose: () => void;
  onDuplicate: () => void;
  onExport: (format: "yaml" | "json" | "mof" | "excel") => void;
  onExportDocs: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onCheckCompliance: () => void;
  onSaveClick: () => void;
}

const footerLinkClass =
  "cfs-footer-action cfs-footer-link inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded px-3 text-sm font-medium text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800";

export const ManifestDetailFooter = React.memo(function ManifestDetailFooter({
  manifestName,
  manifest,
  editorState,
  deploy,
  viewerMode,
  exportOpen,
  setExportOpen,
  duplicating,
  deleting,
  undoing,
  undoAvailable,
  undoEditing,
  rationaleBusy,
  saveBlocked,
  onClose,
  onDuplicate,
  onExport,
  onExportDocs,
  onDelete,
  onUndo,
  onCheckCompliance,
  onSaveClick,
}: ManifestDetailFooterProps) {
  const { t } = useTranslation(["manifest-editor", "common", "manifests"]);
  const { editing, isEditable, saving, beginEditing, formatCache } = editorState;
  const {
    deploying,
    deployProgress,
    deployMenuOpen,
    setDeployMenuOpen,
    reverting,
    handleDeploy,
    handleRevert,
  } = deploy;
  const operationBusy = deleting || undoing || deploying || reverting || saving || rationaleBusy;
  const busy = operationBusy || editing;
  const deployApi = hasCfsNamespace("deploy") ? safeCfs("deploy") : undefined;
  const revertApi = hasCfsNamespace("revert") ? safeCfs("revert") : undefined;
  const canDeploy = HAS_DEPLOY && typeof deployApi?.run === "function";
  const canRevert = HAS_DEPLOY && typeof revertApi?.apply === "function";
  const revertAvailable = manifest?.RevertAvailable || manifest?.Deployed;
  const canEdit = viewerMode === "visual" ? formatCache.current.yaml !== undefined : isEditable;
  const disabledLinkClass = editing ? "pointer-events-none opacity-50" : "";

  return (
    <footer
      data-testid="manifest-detail-footer"
      className="cfs-manifest-footer z-20 shrink-0 border-t border-slate-200 bg-white/98 shadow-[0_-8px_24px_-24px_rgba(15,23,42,0.65)] dark:border-slate-800 dark:bg-slate-950/98"
    >
      <div className="cfs-footer-bar mx-auto min-h-14 w-full px-4 py-2 lg:px-8">
        <Button
          appearance="subtle"
          size="small"
          icon={<DismissRegular />}
          onClick={onClose}
          aria-label={t("actions.closeBaseline")}
          title={t("actions.closeBaseline")}
          className="cfs-footer-action cfs-footer-close-action shrink-0"
        >
          <span className="cfs-footer-close-label">{t("actions.closeBaseline")}</span>
        </Button>

        <div
          className="cfs-footer-divider cfs-footer-divider-leading h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700"
          aria-hidden="true"
        />

        <div className="cfs-footer-actions min-w-0">
          <div className="cfs-footer-action-group">
            <Button
              appearance="subtle"
              size="small"
              icon={deleting ? <Spinner size="tiny" /> : <DeleteRegular />}
              onClick={onDelete}
              disabled={busy}
              aria-label={t("actions.deleteBaseline")}
              title={t("actions.deleteBaseline")}
              className="cfs-footer-action shrink-0 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            >
              <span className="cfs-footer-secondary-label">{t("actions.deleteBaseline")}</span>
            </Button>

            <div
              className="cfs-footer-divider mx-1 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700"
              aria-hidden="true"
            />

            <Button
              appearance="subtle"
              size="small"
              icon={undoing ? <Spinner size="tiny" /> : <ArrowUndoRegular />}
              onClick={onUndo}
              disabled={operationBusy || !undoAvailable}
              title={
                undoAvailable
                  ? t(undoEditing ? "actions.undoEditTitle" : "actions.undoTitle")
                  : t("actions.undoUnavailable")
              }
              aria-label={t("actions.undo")}
              className="cfs-footer-action shrink-0"
            >
              <span className="cfs-footer-secondary-label">{t("actions.undo")}</span>
            </Button>

            <div
              className="cfs-footer-divider mx-1 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700"
              aria-hidden="true"
            />

            <Button
              appearance="subtle"
              size="small"
              icon={duplicating ? <Spinner size="tiny" /> : <CopyRegular />}
              onClick={onDuplicate}
              disabled={duplicating || busy}
              title={t("actions.duplicateTitle")}
              aria-label={t("actions.duplicate")}
              className="cfs-footer-action shrink-0"
            >
              <span className="cfs-footer-secondary-label">{t("actions.duplicate")}</span>
            </Button>

            <Link
              to={`/manifests/${encodeURIComponent(manifestName)}/audit-pack`}
              className={`${footerLinkClass} ${disabledLinkClass}`}
              title={t("actions.auditPackTitle")}
              aria-label={t("actions.auditPack")}
              aria-disabled={editing}
              tabIndex={editing ? -1 : undefined}
              onClick={(event) => {
                if (editing) event.preventDefault();
              }}
            >
              <ClipboardCheckmarkRegular aria-hidden="true" />
              <span className="cfs-footer-secondary-label">{t("actions.auditPack")}</span>
            </Link>

            <Button
              appearance="subtle"
              size="small"
              icon={<ShieldCheckmarkRegular />}
              onClick={onCheckCompliance}
              disabled={deleting || deploying || reverting || saving}
              aria-label={t("actions.checkCompliance")}
              title={t("actions.checkCompliance")}
              className="cfs-footer-action shrink-0"
            >
              <span className="cfs-footer-secondary-label">{t("actions.checkCompliance")}</span>
            </Button>

            <Button
              appearance="subtle"
              size="small"
              icon={<DocumentRegular />}
              onClick={onExportDocs}
              disabled={busy}
              aria-label={t("actions.docs")}
              className="cfs-footer-action shrink-0"
              title={t("actions.generateDocsTitle")}
            >
              <span className="cfs-footer-secondary-label">{t("actions.docs")}</span>
            </Button>

            <Link
              to={`/manifests/${encodeURIComponent(manifestName)}/history`}
              className={`${footerLinkClass} ${disabledLinkClass}`}
              title={t("actions.history")}
              aria-label={t("actions.history")}
              aria-disabled={editing}
              tabIndex={editing ? -1 : undefined}
              onClick={(event) => {
                if (editing) event.preventDefault();
              }}
            >
              <HistoryRegular aria-hidden="true" />
              <span className="cfs-footer-secondary-label">{t("actions.history")}</span>
            </Link>

            <Menu
              open={!editing && exportOpen}
              onOpenChange={(_event, data) => {
                if (!editing) setExportOpen(data.open);
              }}
            >
              <MenuTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowDownloadRegular />}
                  disabled={busy}
                  aria-label={t("actions.export")}
                  title={t("actions.export")}
                  className="cfs-footer-action shrink-0"
                >
                  <span className="cfs-footer-secondary-label">{t("actions.export")}</span>
                  <ChevronDownRegular className="cfs-footer-chevron ml-1" aria-hidden="true" />
                </Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={() => onExport("yaml")}>{t("export.formats.yaml")}</MenuItem>
                  <MenuItem onClick={() => onExport("json")}>{t("export.formats.json")}</MenuItem>
                  <MenuItem onClick={() => onExport("mof")}>{t("export.formats.mof")}</MenuItem>
                  <MenuItem onClick={() => onExport("excel")}>{t("export.formats.csv")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>

            {(canDeploy || canRevert) && (
              <div
                className="cfs-footer-divider mx-1 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700"
                aria-hidden="true"
              />
            )}

            {canDeploy && (
              <Menu
                open={!editing && deployMenuOpen}
                onOpenChange={(_event, data) => {
                  if (!editing) setDeployMenuOpen(data.open);
                }}
              >
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    appearance="primary"
                    size="small"
                    icon={deploying ? <Spinner size="tiny" /> : <PlayRegular />}
                    disabled={busy}
                    aria-label={t("common:features.deploy")}
                    title={t("common:features.deploy")}
                    className="cfs-footer-action shrink-0 bg-emerald-700 hover:bg-emerald-800"
                  >
                    <span className="cfs-footer-secondary-label">
                      {deploying && deployProgress?.resourcesTotal ? (
                        <AuditProgressCounter
                          completed={deployProgress.resourcesCompleted ?? 0}
                          total={deployProgress.resourcesTotal}
                        />
                      ) : (
                        t("common:features.deploy")
                      )}
                    </span>
                    <ChevronDownRegular className="cfs-footer-chevron ml-1" aria-hidden="true" />
                  </Button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem
                      icon={<ShieldCheckmarkRegular />}
                      onClick={() => {
                        setDeployMenuOpen(false);
                        void handleDeploy("audit");
                      }}
                      secondaryContent={t("deploy.auditDescription")}
                    >
                      {t("manifests:features.audit")}
                    </MenuItem>
                    <MenuItem
                      icon={<PlayRegular />}
                      onClick={() => {
                        setDeployMenuOpen(false);
                        void handleDeploy("enforce");
                      }}
                      secondaryContent={t("deploy.enforceDescription")}
                    >
                      {t("manifests:actions.enforce")}
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            )}

            {canRevert && (
              <Button
                appearance="subtle"
                size="small"
                icon={reverting ? <Spinner size="tiny" /> : <ArrowCounterclockwiseRegular />}
                onClick={() => void handleRevert()}
                disabled={busy || !revertAvailable}
                title={revertAvailable ? t("actions.revertTitle") : t("actions.noRevertTitle")}
                aria-label={t("actions.revert")}
                className="cfs-footer-action shrink-0 text-amber-700 dark:text-amber-400"
              >
                <span className="cfs-footer-secondary-label">{t("actions.revert")}</span>
              </Button>
            )}
          </div>
        </div>

        <div
          className="cfs-footer-divider cfs-footer-divider-trailing h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700"
          aria-hidden="true"
        />

        {editing ? (
          <Button
            appearance="primary"
            size="medium"
            icon={saving || rationaleBusy ? <Spinner size="tiny" /> : <SaveRegular />}
            onClick={onSaveClick}
            disabled={saving || rationaleBusy || saveBlocked}
            title={saveBlocked ? t("visual.fixValidationBeforeSave") : undefined}
            aria-label={t("common:buttons.save")}
            className="cfs-footer-action cfs-footer-primary-action shrink-0"
          >
            <span className="cfs-footer-primary-label">{t("common:buttons.save")}</span>
          </Button>
        ) : (
          <Button
            appearance="primary"
            size="medium"
            icon={<EditRegular />}
            onClick={() => {
              if (viewerMode === "visual") beginEditing("visual");
              else beginEditing();
            }}
            disabled={busy || !canEdit}
            title={
              !canEdit
                ? t(
                    viewerMode === "visual"
                      ? "content.visualEditUnavailable"
                      : "content.mofEditUnsupported",
                  )
                : undefined
            }
            aria-label={t("actions.edit")}
            className="cfs-footer-action cfs-footer-primary-action shrink-0"
          >
            <span className="cfs-footer-primary-label">{t("actions.edit")}</span>
          </Button>
        )}
      </div>
    </footer>
  );
});
