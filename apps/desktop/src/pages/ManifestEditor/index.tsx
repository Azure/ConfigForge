// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


import React, { useState, useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useNavigationGuard } from "../../lib/use-navigation-guard";
import { Link } from "react-router-dom";
import {
  useRationalePrompt,
  RationalePromptModal,
} from "../../components/use-rationale-prompt";
import { useCisAvailable } from "../../components/use-cis-available";
import yaml from "js-yaml";
import {
  ArrowLeftRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { MessageBar, MessageBarBody } from "@fluentui/react-components";
import type { OscResource } from "@configforge/core/types";
import type { DeployProgressEvent as _DeployProgressEvent } from "@configforge/core/handlers/deploy";
import { detectManifestPlatform } from "@configforge/core/platform";
import { cfs } from "../../lib/cfs";
import { CliRequiredModal } from "../../components/CliRequiredModal";
import { useCliPresence } from "../../hooks/useCliPresence";
import { useManifestEditorState } from "./state/useManifestEditorState";
import { useDeployFlow } from "./state/useDeployFlow";
import { useDocsModal } from "./state/useDocsModal";
import { DocsModal } from "./components/DocsModal";
import { ManifestContent } from "./components/ManifestContent";
import { DeployResultPanel } from "./components/DeployResultPanel";
import { ComplianceTable } from "./components/ComplianceTable";
import { ManifestHeader } from "./components/ManifestHeader";
import { Breadcrumb } from "../../components/Breadcrumb";

export function ManifestDetailPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const manifestName = decodeURIComponent(params.id ?? '');
  const cisAvailable = useCisAvailable();
  const { t } = useTranslation(["manifest-editor", "manifests"]);

  const [deleting, setDeleting] = useState(false);
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

  // Phase B.3 — docs modal lives in a hook so the v0.1.11 copy-timer
  // cleanup is testable in isolation. Phase C.1 — the modal JSX
  // lives in components/DocsModal.tsx; we just need the generate
  // entrypoint here so the action-bar button can wire up the source
  // content.
  const docs = useDocsModal(manifestName);
  const generateDocs = docs.handleGenerateDocs;

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
    setEditing,
    editedContent,
    setEditedContent,
    savedContent,
    setSavedContent,
    setSaving,
    activeFormat,
    setActiveFormat,
    formatCache,
    currentDisplayContent,
    hasUnsavedChanges,
  } = editorState;

  // Detect platform — prefer the stored platform from the API response,
  // fall back to parsing the YAML content (which has the full resource
  // tree including nested Test wrapper inner resources). Computed
  // before useDeployFlow because the deploy hook consumes it.
  let detectedPlatform: ReturnType<typeof detectManifestPlatform> = 'cross-platform';
  const storedPlatform = (manifest as Record<string, unknown> | null)?.Platform as string | undefined;
  if (storedPlatform === 'windows' || storedPlatform === 'linux' || storedPlatform === 'mixed') {
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
    setStatus,
    setError,
    fetchData,
  });
  const {
    deployResult,
    setDeployResult,
    cliGateFeature,
    setCliGateFeature,
  } = deploy;

  const handleDelete = async () => {
    if (!confirm(t("actions.removeConfirm", { name: manifestName }))) return;
    setDeleting(true);
    try {
      await cfs.manifests.delete(manifestName);
      navigate("/manifests");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"));
      setDeleting(false);
    }
  };

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
          setError(t("messages.savedWithWarning", { warning: (json as { data: { _warning: string } }).data._warning }));
        }

        formatCache.current = { yaml: editedContent };
        setActiveFormat('yaml');
        setEditing(false);
        // v0.1.13 fix — record the new "saved" baseline so the
        // unsaved-changes blocker doesn't fire on the next navigation
        // (Save just made editedContent === savedContent).
        setSavedContent(editedContent);

        try {
          sessionStorage.setItem("configforge-flash", t("messages.saveSuccess", { name: manifestName }));
        } catch { /* non-critical */ }

        // v0.1.13 fix — refresh `manifest` + `status` from the
        // server after save. The `cfs.manifests.register` response
        // only confirms the write; the in-memory `manifest` object
        // (Resources, Platform, etc.) is still the pre-save copy.
        // Without this, switching to the visual builder or looking
        // at the compliance sidebar after a save shows stale
        // Resources until the user manually navigates away + back.
        // We intentionally don't await — the user's UI is already
        // in a good state via the optimistic formatCache update;
        // this just rehydrates the secondary panels in the
        // background.
        fetchData();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.saveFailed"));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [manifestName, editedContent, fetchData, t],
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
    // Use `savedContent` (the last on-disk baseline) as 'before', NOT
    // `formatCache.current.yaml`. The visual-builder Add/Edit/Remove
    // handlers overwrite formatCache.current.yaml with the edited
    // buffer, which would make `before === editedContent` and skip
    // the rationale prompt entirely after visual-builder-only edits.
    const before = savedContent || formatCache.current.yaml || "";
    await rationale.requestSave(before, editedContent);
  }, [rationale, editedContent, savedContent, formatCache]);

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
  useNavigationGuard(
    hasUnsavedChanges,
    t("actions.leaveUnsavedConfirm", { name: manifestName }),
  );

  const handleResourceAdd = (resource: { name: string; type: string; properties: Record<string, unknown>; compliance?: { equals: unknown } }) => {
    try {
      const parsed = yaml.load(editedContent) as Record<string, unknown> | null;
      const doc = parsed && typeof parsed === 'object' ? parsed : { $schema: 'https://aka.ms/osc/schemas/prerelease/document.json' };
      const existingResources = Array.isArray(doc.resources) ? (doc.resources as Record<string, unknown>[]) : [];

      const newResource: Record<string, unknown> = {
        name: resource.name,
        type: resource.type,
        properties: resource.properties,
      };
      if (resource.compliance) {
        newResource.compliance = resource.compliance;
      }

      doc.resources = [...existingResources, newResource];
      const newYaml = yaml.dump(doc, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false });
      setEditedContent(newYaml);
      formatCache.current = { yaml: newYaml };
      setActiveFormat('yaml');
    } catch {
      // Fallback: append raw YAML
      const resourceYaml = `  - name: "${resource.name}"\n    type: ${resource.type}\n    properties:\n${Object.entries(resource.properties)
        .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
        .join("\n")}`;
      setEditedContent(editedContent.trimEnd() + "\n" + resourceYaml + "\n");
      // v0.1.14: the fallback path appends raw YAML, but if the user
      // was on the JSON or MOF tab when they clicked Add Resource,
      // they wouldn't see the appended snippet — the visible editor
      // is a different format. Switching to the YAML tab guarantees
      // the new content is visible. The happy path already does
      // this above; this just keeps both paths consistent. (UX
      // medium from the v0.1.13 edge-case backlog.)
      setActiveFormat('yaml');
    }
  };

  const handleExport = async (format: "yaml" | "json" | "mof" | "excel" | "azurepolicy") => {
    setExportOpen(false);
    try {
      await cfs.exportChannel.save({ name: manifestName, format });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.exportFailed"));
    }
  };

  const handleGenerateDocs = async () => {
    const content = editedContent || formatCache.current.yaml || "";
    await generateDocs(content);
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
    detectedPlatform === 'windows'
      ? { label: t('manifests:card.platform.windows'), cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
      : detectedPlatform === 'linux'
        ? { label: t('manifests:card.platform.linux'), cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }
        : { label: t('manifests:card.platform.crossPlatform'), cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/30 dark:text-slate-400' };
  // ResourcePicker expects narrow 'windows' | 'linux' | undefined; treat
  // mixed manifests as "show everything" (same as cross-platform) so users
  // can continue editing either side.
  const editorPlatform =
    detectedPlatform === 'cross-platform' || detectedPlatform === 'mixed'
      ? undefined
      : detectedPlatform;

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
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
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* v0.2.0, BYO-CLI install dialog (same component Manifests.tsx
         uses). Opens from handleDeploy when OSConfig isn't installed. */}
      <CliRequiredModal
        open={cliGateFeature !== null}
        feature={cliGateFeature ?? t("features.deploy")}
        onDismiss={() => setCliGateFeature(null)}
        presence={presence}
      />
      {/* Header + action button clusters (Phase C.5/C.6 — see components/ManifestHeader.tsx) */}
      <Breadcrumb
        items={[
          { label: t('manifests:page.title'), to: '/manifests' },
          { label: manifestName },
        ]}
      />
      <ManifestHeader
        manifestName={manifestName}
        manifest={manifest}
        platformBadge={platformBadge}
        editorState={editorState}
        deploy={deploy}
        rationaleBusy={rationale.state.busy}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        duplicating={duplicating}
        deleting={deleting}
        onSaveClick={handleSaveClick}
        onCancelEdit={() => {
          setEditing(false);
          const cached = formatCache.current[activeFormat];
          if (cached !== undefined) setEditedContent(cached);
        }}
        onDuplicate={handleDuplicate}
        onExport={handleExport}
        onExportDocs={handleExportDocs}
        onGenerateDocs={handleGenerateDocs}
        onDelete={handleDelete}
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
      {error && (error.includes('CSP') || error.includes('authority') || error.includes('Declared Configuration')) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <WarningRegular className="h-4 w-4" />
            {t("cspTroubleshooting.title")}
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-400">
            <li>• {t("cspTroubleshooting.declaredConfig")}</li>
            <li>• {t("cspTroubleshooting.registryWorks")}</li>
            <li>• {t("cspTroubleshooting.engineRegistered")}</li>
            <li>• <Trans i18nKey="cspTroubleshooting.tryMetadata" ns="manifest-editor" components={{ code: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50" /> }} /></li>
          </ul>
        </div>
      )}

      {/* Manifest Content (Phase C.2 — see components/ManifestContent.tsx) */}
      <ManifestContent
        editorState={editorState}
        editorPlatform={editorPlatform}
        cisAvailable={cisAvailable}
        manifestName={manifestName}
        onResourceAdd={handleResourceAdd}
      />

      {/* Compliance Status (Phase C.4 — see components/ComplianceTable.tsx) */}
      <ComplianceTable
        resources={complianceResources}
        expandedResource={expandedResource}
        setExpandedResource={setExpandedResource}
        complianceShowAll={complianceShowAll}
        setComplianceShowAll={setComplianceShowAll}
      />

      {/* Documentation Modal (Phase C.1 — see components/DocsModal.tsx) */}
      <DocsModal docs={docs} />

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

