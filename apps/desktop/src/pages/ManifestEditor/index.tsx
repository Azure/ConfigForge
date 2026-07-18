// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useNavigationGuard } from "../../lib/use-navigation-guard";
import { Link } from "react-router-dom";
import { useRationalePrompt, RationalePromptModal } from "../../components/use-rationale-prompt";
import { useCisAvailable } from "../../components/use-cis-available";
import { useBaselineWorkspace } from "../../components/BaselineWorkspace";
import yaml from "js-yaml";
import { ArrowLeftRegular, DismissRegular, WarningRegular } from "@fluentui/react-icons";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import type { OscResource } from "@configforge/core/types";
import type { DeployProgressEvent as _DeployProgressEvent } from "@configforge/core/handlers/deploy";
import { detectManifestPlatform } from "@configforge/core/platform";
import { cfs } from "../../lib/cfs";
import { CliRequiredModal } from "../../components/CliRequiredModal";
import { useCliPresence } from "../../hooks/useCliPresence";
import { useManifestEditorState } from "./state/useManifestEditorState";
import { useDeployFlow } from "./state/useDeployFlow";
import { ManifestContent } from "./components/ManifestContent";
import type { ManifestViewerMode } from "./components/ManifestContent";
import { DeployResultPanel } from "./components/DeployResultPanel";
import { ComplianceTable } from "./components/ComplianceTable";
import { ManifestHeader } from "./components/ManifestHeader";
import { ManifestDetailFooter } from "./components/ManifestDetailFooter";
import { Breadcrumb } from "../../components/Breadcrumb";
import {
  flattenVisualSettings,
  parseVisualManifest,
  validateVisualSettings,
} from "./visual-viewer";

export function ManifestDetailPage() {
  const params = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const manifestName = decodeURIComponent(params.id ?? "");
  const cisAvailable = useCisAvailable();
  const { t } = useTranslation(["manifest-editor", "manifests"]);
  const { closeBaseline, refresh: refreshWorkspace } = useBaselineWorkspace();

  const [deleting, setDeleting] = useState(false);
  const [complianceDrawerOpen, setComplianceDrawerOpen] = useState(false);
  const [visualDraftValid, setVisualDraftValid] = useState(true);
  const visualDraftValidRef = useRef(true);
  const [viewerSelection, setViewerSelection] = useState<{
    manifestName: string;
    mode: ManifestViewerMode;
  }>({ manifestName, mode: "code" });
  const viewerMode = viewerSelection.manifestName === manifestName ? viewerSelection.mode : "code";
  const handleViewerModeChange = useCallback(
    (mode: ManifestViewerMode) => setViewerSelection({ manifestName, mode }),
    [manifestName],
  );
  const [expandedResource, setExpandedResource] = useState<number | null>(null);
  // perf W2 / C1: large compliance + deploy-result tables (typical
  // tenant: ~326 resources) used to render synchronously, dropping
  // scroll FPS to ~30-40 and stalling rationale-prompt interaction.
  // Lightweight strategy: render only the first INITIAL_TABLE_ROWS, with a
  // "Show all NN" toggle for power users. Avoids pulling in
  // @tanstack/react-virtual (extra dep, agent-territory risk on
  // package-lock.json) while keeping the expand-row affordance and
  // the existing keyboard / accessibility behaviour intact for the
  // visible slice.
  const [complianceShowAll, setComplianceShowAll] = useState(false);
  const [deployRowsShowAll, setDeployRowsShowAll] = useState(false);
  const presence = useCliPresence();

  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    setExportOpen(false);
  }, [manifestName]);

  // Phase A.3 — core load + edit + format-tab state lives in a hook
  // so it can be unit-tested in isolation (Phase B). The hook return
  // is passed wholesale to ManifestHeader / ManifestContent in Phase
  // C; the page only destructures the fields it still touches in
  // handlers or in the loading / error JSX.
  const editorState = useManifestEditorState(manifestName);
  const {
    manifest,
    status,
    setStatus,
    loading,
    error,
    setError,
    fetchData,
    editing,
    setEditing,
    cancelEditing,
    editedContent,
    savedContent,
    setSavedContent,
    setSaving,
    activeFormat,
    formatCache,
    currentDisplayContent,
    hasUnsavedChanges,
  } = editorState;

  const visualSourceValid = useMemo(() => {
    if (!editing || activeFormat !== "yaml") return true;
    try {
      return (
        validateVisualSettings(
          flattenVisualSettings(parseVisualManifest(editedContent)),
        ).length === 0
      );
    } catch {
      return false;
    }
  }, [activeFormat, editedContent, editing]);
  const visualEditValid = visualSourceValid && visualDraftValid;

  const handleVisualDraftValidityChange = useCallback((valid: boolean) => {
    visualDraftValidRef.current = valid;
    setVisualDraftValid(valid);
  }, []);

  const handleCancelEditing = useCallback(() => {
    handleVisualDraftValidityChange(true);
    cancelEditing();
  }, [cancelEditing, handleVisualDraftValidityChange]);

  useEffect(() => {
    handleVisualDraftValidityChange(true);
  }, [handleVisualDraftValidityChange, manifestName]);

  // Detect platform — prefer the stored platform from the API response,
  // fall back to parsing the YAML content (which has the full resource
  // tree including nested Test wrapper inner resources). Computed
  // before useDeployFlow because the deploy hook consumes it.
  let detectedPlatform: ReturnType<typeof detectManifestPlatform> = "cross-platform";
  const storedPlatform = (manifest as Record<string, unknown> | null)?.Platform as
    | string
    | undefined;
  if (storedPlatform === "windows" || storedPlatform === "linux" || storedPlatform === "mixed") {
    detectedPlatform = storedPlatform;
  } else if (currentDisplayContent) {
    try {
      const parsed = yaml.load(currentDisplayContent) as Record<string, unknown> | null;
      if (parsed && Array.isArray(parsed.resources)) {
        detectedPlatform = detectManifestPlatform(parsed.resources);
      }
    } catch {
      // ignore parse errors
    }
  }

  // Phase B.2 — deploy + revert + CLI-gate flow lives in a hook so
  // the v0.1.14 cancel-on-unmount ref handoff is testable in isolation.
  const deploy = useDeployFlow({
    manifestName,
    presenceInstalled: presence.installed,
    detectedPlatform,
    registrationRevision: manifest?.Revision,
    setStatus,
    setError,
    fetchData,
  });
  const { deployResult, setDeployResult, cliGateFeature, setCliGateFeature } = deploy;

  const handleDelete = async () => {
    if (!confirm(t("actions.removeConfirm", { name: manifestName }))) return;
    setDeleting(true);
    try {
      await cfs.manifests.delete(manifestName);
      closeBaseline(manifestName);
      await Promise.allSettled([refreshWorkspace()]);
      navigate("/manifests");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"));
      setDeleting(false);
    }
  };

  const handleClose = () => {
    closeBaseline(manifestName);
    navigate("/manifests");
  };

  const handleCheckCompliance = useCallback(() => {
    setComplianceDrawerOpen(true);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (new URLSearchParams(location.search).get("section") !== "compliance") return;
    handleCheckCompliance();
  }, [handleCheckCompliance, loading, location.search]);

  const handleSave = useCallback(
    async (extra?: { rationale?: string; skipped?: boolean; changeSummary?: string }) => {
      setSaving(true);
      setError(null);
      try {
        const requestBody = {
          name: manifestName,
          content: editedContent,
          ...(extra?.rationale && !extra.skipped ? { rationale: extra.rationale } : {}),
          ...(extra?.changeSummary ? { changeSummary: extra.changeSummary } : {}),
        };
        const json = await cfs.manifests.register(requestBody);

        if ((json as { data?: { _warning?: string } })?.data?._warning) {
          setError(
            t("messages.savedWithWarning", {
              warning: (json as { data: { _warning: string } }).data._warning,
            }),
          );
        }

        // Keep the successfully submitted representation available if the
        // canonical YAML re-read encounters an IPC error. On success,
        // fetchData replaces this cache with normalized YAML.
        formatCache.current = { [activeFormat]: editedContent };
        setSavedContent(editedContent);
        setEditing(false);
        // Re-read the persisted registration so the editor always returns
        // to canonical YAML. This matters when Save originated from JSON:
        // labeling the JSON buffer as cached YAML would briefly expose the
        // wrong representation and could seed the next edit incorrectly.
        await fetchData();

        try {
          sessionStorage.setItem(
            "configforge-flash",
            t("messages.saveSuccess", { name: manifestName }),
          );
        } catch {
          /* non-critical */
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.saveFailed"));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [manifestName, activeFormat, editedContent, fetchData, formatCache, setSavedContent, t],
  );

  // PR27: rationale-prompt wrapper. We intercept the Save click, ask the
  // user "why?", POST the rationale, then run the existing handleSave.
  // The hook is no-op when the YAML is byte-identical or structurally
  // equivalent — so unchanged saves don't pop the modal.
  const rationale = useRationalePrompt({
    manifestId: manifestName,
    onSave: handleSave,
  });

  const handleSaveClick = useCallback(async () => {
    if (!visualSourceValid || !visualDraftValidRef.current) return;
    // Use `savedContent` (the last on-disk baseline) as 'before', NOT
    // `formatCache.current.yaml`. Spreadsheet edits update the cached YAML
    // buffer, which would otherwise make `before === editedContent` and
    // skip the rationale prompt after visual-only edits.
    const before = savedContent || formatCache.current.yaml || "";
    await rationale.requestSave(before, editedContent);
  }, [rationale, editedContent, savedContent, formatCache, visualSourceValid]);

  // v0.1.13 / v0.1.15 — unsaved-changes navigation guard.
  //
  // v0.1.13 originally tried react-router-dom's `useBlocker` here,
  // but that hook calls `useDataRouterContext` internally and
  // requires a Data Router (`createHashRouter` + `<RouterProvider>`).
  // Our app uses the legacy declarative `<HashRouter>` so useBlocker
  // threw on first render and crashed the entire editor route. The
  // bug stayed hidden because v0.1.13 was probed only on the
  // /manifests list view, not on /manifests/:id where the editor
  // actually mounts.
  //
  // v0.1.15 replaces it with a custom hook that intercepts clicks
  // on in-app anchor links + beforeunload. See
  // `src/lib/use-navigation-guard.ts` for the trade-offs.
  //
  // We compare the live `editedContent` against the last
  // `savedContent` baseline (seeded on load + on each successful
  // save). `editing` is part of the predicate because users in
  // read-only mode haven't entered the editor yet — no need to
  // nag them on navigation in that case. The flag is computed by
  // `useManifestEditorState` (Phase A.3) — destructured above.
  useNavigationGuard(hasUnsavedChanges, t("actions.leaveUnsavedConfirm", { name: manifestName }));

  const handleExport = async (format: "yaml" | "json" | "mof" | "excel" | "azurepolicy") => {
    setExportOpen(false);
    try {
      await cfs.exportChannel.save({ name: manifestName, format });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.exportFailed"));
    }
  };

  const [duplicating, setDuplicating] = useState(false);

  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      const yamlContent = formatCache.current.yaml ?? editedContent;
      if (!yamlContent) {
        const status = await cfs.manifests.status(manifestName);
        const data = (status as { data?: unknown }).data;
        const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        sessionStorage.setItem("baseline-template-content", content);
      } else {
        sessionStorage.setItem("baseline-template-content", yamlContent);
      }
      sessionStorage.setItem("baseline-template-name", `${manifestName}-copy`);
      if (detectedPlatform === "windows" || detectedPlatform === "linux") {
        sessionStorage.setItem("baseline-template-platform", detectedPlatform);
      }
      navigate("/manifests/new?fromLibrary=true");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.duplicateFailed"));
    } finally {
      setDuplicating(false);
    }
  };

  const handleExportDocs = async () => {
    setExportOpen(false);
    try {
      const json = await cfs.docs.get(manifestName);
      const blob = new Blob([json.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.exportFailed"));
    }
  };

  const complianceResources: OscResource[] = status?.resources ?? manifest?.Resources ?? [];

  const platformBadge =
    detectedPlatform === "windows"
      ? {
          label: t("platform.windows"),
          cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
          platform: detectedPlatform,
        }
      : detectedPlatform === "linux"
        ? {
            label: t("platform.linux"),
            cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
            platform: detectedPlatform,
          }
        : {
            label: t("platform.crossPlatform"),
            cls: "bg-slate-100 text-slate-600 dark:bg-slate-700/30 dark:text-slate-400",
            platform: detectedPlatform,
          };
  // Mixed and cross-platform manifests expose all spreadsheet row templates
  // so either platform's settings remain editable.
  const editorPlatform =
    detectedPlatform === "cross-platform" || detectedPlatform === "mixed"
      ? undefined
      : detectedPlatform;

  if (loading) {
    return (
      <div className="h-full overflow-y-auto p-6 lg:p-8">
        <div className="mx-auto max-w-[96rem] space-y-6">
          <div className="flex items-center gap-4">
            <Link
              to="/manifests"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400"
            >
              <ArrowLeftRegular className="h-4 w-4" />
              {t("actions.back")}
            </Link>
            <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* v0.2.0, BYO-CLI install dialog (same component Manifests.tsx
         uses). Opens from handleDeploy when OSConfig isn't installed. */}
      <CliRequiredModal
        open={cliGateFeature !== null}
        feature={cliGateFeature ?? t("features.deploy")}
        onDismiss={() => setCliGateFeature(null)}
        presence={presence}
      />

      <Drawer
        type="overlay"
        position="end"
        size="medium"
        open={complianceDrawerOpen}
        onOpenChange={(_event, data) => setComplianceDrawerOpen(data.open)}
      >
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label={t("actions.closeCompliance")}
                onClick={() => setComplianceDrawerOpen(false)}
              />
            }
          >
            {t("compliance.sectionTitle")}
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody data-testid="compliance-drawer">
          <ComplianceTable
            resources={complianceResources}
            expandedResource={expandedResource}
            setExpandedResource={setExpandedResource}
            complianceShowAll={complianceShowAll}
            setComplianceShowAll={setComplianceShowAll}
          />
        </DrawerBody>
      </Drawer>

      <div
        data-testid="manifest-detail-scroll-region"
        className="min-h-0 flex-1 overflow-y-auto px-6 py-6 [scrollbar-gutter:stable] lg:px-8 lg:py-7"
      >
        <div className="mx-auto max-w-[96rem] space-y-6">
          <Breadcrumb
            items={[
              { label: t("manifests:page.title"), to: "/manifests" },
              { label: manifestName },
            ]}
          />
          <ManifestHeader
            manifestName={manifestName}
            manifest={manifest}
            platformBadge={platformBadge}
            editorState={editorState}
            onCancelEdit={handleCancelEditing}
          />

          {/* Deploy result (Phase C.3 — see components/DeployResultPanel.tsx) */}
          <DeployResultPanel
            deployResult={deployResult}
            setDeployResult={setDeployResult}
            deployRowsShowAll={deployRowsShowAll}
            setDeployRowsShowAll={setDeployRowsShowAll}
          />

          {/* Error */}
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}

          {/* CSP Troubleshooting */}
          {error &&
            (error.includes("CSP") ||
              error.includes("authority") ||
              error.includes("Declared Configuration")) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <WarningRegular className="h-4 w-4" />
                  {t("cspTroubleshooting.title")}
                </h3>
                <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-400">
                  <li>• {t("cspTroubleshooting.declaredConfig")}</li>
                  <li>• {t("cspTroubleshooting.registryWorks")}</li>
                  <li>• {t("cspTroubleshooting.engineRegistered")}</li>
                  <li>
                    •{" "}
                    <Trans
                      i18nKey="cspTroubleshooting.tryMetadata"
                      ns="manifest-editor"
                      components={{
                        code: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50" />,
                      }}
                    />
                  </li>
                </ul>
              </div>
            )}

          {/* Manifest Content (Phase C.2 — see components/ManifestContent.tsx) */}
          <ManifestContent
            editorState={editorState}
            editorPlatform={editorPlatform}
            cisAvailable={cisAvailable}
            manifestName={manifestName}
            viewerMode={viewerMode}
            onViewerModeChange={handleViewerModeChange}
            onVisualDraftValidityChange={handleVisualDraftValidityChange}
          />

          {/* Compliance Status (Phase C.4 — see components/ComplianceTable.tsx) */}
          <div
            id="baseline-compliance"
            role="region"
            aria-label={t("compliance.sectionTitle")}
            tabIndex={-1}
            className="scroll-mt-4 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <ComplianceTable
              resources={complianceResources}
              expandedResource={expandedResource}
              setExpandedResource={setExpandedResource}
              complianceShowAll={complianceShowAll}
              setComplianceShowAll={setComplianceShowAll}
            />
          </div>
        </div>
      </div>

      <ManifestDetailFooter
        manifestName={manifestName}
        manifest={manifest}
        editorState={editorState}
        deploy={deploy}
        viewerMode={viewerMode}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        duplicating={duplicating}
        deleting={deleting}
        rationaleBusy={rationale.state.busy}
        saveBlocked={!visualEditValid}
        onClose={handleClose}
        onDuplicate={handleDuplicate}
        onExport={handleExport}
        onExportDocs={handleExportDocs}
        onDelete={handleDelete}
        onCheckCompliance={handleCheckCompliance}
        onSaveClick={handleSaveClick}
      />

      {/* PR27: Rationale prompt — appears on Save when content has changed */}
      <RationalePromptModal
        state={rationale.state}
        submitReason={rationale.submitReason}
        skip={rationale.skip}
        cancel={rationale.cancel}
      />
    </div>
  );
}
