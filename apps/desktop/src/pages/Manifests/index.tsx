// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  DocumentRegular,
  AddRegular,
  DeleteRegular,
  EyeRegular,
  ArrowSyncRegular,
  FolderOpenRegular,
  PlayRegular,
  ArrowCounterclockwiseRegular,
  SearchRegular,
  CheckboxCheckedRegular,
  CheckboxUncheckedRegular,
  DismissRegular,
  ChevronDownRegular,
  ShieldCheckmarkRegular,
} from "@fluentui/react-icons";
import {
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  Spinner,
} from "@fluentui/react-components";
import { TintedSpinner } from "../../components/TintedSpinner";
import { DangerButton } from "../../components/DangerButton";
import { AuditProgressCounter } from "../../components/AuditProgressCounter";
import { CliRequiredModal } from "../../components/CliRequiredModal";
import { WindowsLogo } from "../../components/WindowsLogo";
import { useCliPresence } from "../../hooks/useCliPresence";
import type { DeployProgressEvent } from "@configforge/core/handlers/deploy";
import { detectManifestPlatform } from "@configforge/core/platform";
import { BASELINE_CATALOG } from "../../data/baseline-catalog";
import { cfs } from "../../lib/cfs";
import { HAS_DEPLOY } from "../../lib/flavor";
import { useManifestList } from "./state/useManifestList";
import { useFlashMessage } from "./state/useFlashMessage";
import { useBulkSelection } from "./state/useBulkSelection";

export function ManifestsPage() {
  const { t } = useTranslation(["manifests", "common"]);
  const list = useManifestList();
  const {
    manifests,
    setManifests,
    loading,
    error,
    setError,
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    filteredManifests,
    platformByName,
    fetchManifests,
  } = list;

  const flash = useFlashMessage();
  const { flashMessage, setFlashMessage, scheduleAutoDismiss } = flash;

  const selection = useBulkSelection();
  const { selected, toggleSelect, toggleSelectAll, clear: clearSelection, removeFromSelection } =
    selection;

  const [deleting, setDeleting] = useState<string | null>(null);
  const [deploying, setDeploying] = useState<string | null>(null);
  // v0.2.0, opens the install-required dialog when the user clicks
  // Deploy/Audit/Revert/BulkDeploy while OSConfig isn't installed.
  // `cliGateFeature` carries the label that gets bolded inside the
  // dialog ("Deploy", "Audit", "Revert", "Bulk deploy"). Reset to
  // null when the dialog closes.
  const [cliGateFeature, setCliGateFeature] = useState<string | null>(null);
  const presence = useCliPresence();
  // v0.1.9: per-audit/enforce progress, populated by the
  // `cfs:deploy:progress` channel via cfs.deploy.run's onProgress
  // callback.
  const [deployProgress, setDeployProgress] = useState<DeployProgressEvent | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [deployMenuName, setDeployMenuName] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{ name: string; message: string; success: boolean } | null>(null);
  const [bulkDeploying, setBulkDeploying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; action: 'deploy' | 'delete' } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const handleDelete = async (name: string) => {
    if (!confirm(t("confirm.delete", { name }))) return;
    setDeleting(name);
    try {
      await cfs.manifests.delete(name);
      setManifests((prev) => prev.filter((m) => m.Name !== name));
      // v0.1.13 fix — drop the just-deleted manifest from `selected`
      // too. Previously the name lingered in the selection Set as a
      // ghost: the count badge ("3 selected") was wrong, "Select all"
      // toggle math was off, and a follow-up bulk delete would try to
      // re-delete the already-gone manifest and surface a spurious
      // "1 failed" in the bulk result banner.
      removeFromSelection(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('messages.deleteFailed'));
    } finally {
      setDeleting(null);
    }
  };

  const handleDeploy = async (name: string, mode: 'audit' | 'enforce') => {
    // v0.2.0, bring-your-own-CLI gate. Refuse before the confirm dialog
    // so the user gets an install path instead of a confusing
    // "do you want to deploy?" -> "spawn failed" sequence.
    if (!presence.installed) {
      setCliGateFeature(mode === 'audit' ? t('features.audit') : t('features.deploy'));
      return;
    }
    // Use the server-reported platform from the manifest registration
    // (accurate even when accessing from a different OS via browser).
    // Fall back to resource-type detection only if Platform isn't stored.
    const manifest = manifests.find((m) => m.Name === name);
    if (manifest) {
      const platform = manifest.Platform
        ?? detectManifestPlatform(
          (manifest.Resources ?? []).map((r) => ({ type: r.type }))
        );
      // Let the SERVER decide if the manifest matches the host platform.
      // The client doesn't reliably know the server OS (navigator.userAgent
      // reflects the browser, not the server). We only block mixed manifests
      // client-side; all other platform checks are server-side (deploy route
      // lines 232-250 for audit, lines 349-367 for enforce).
      if (platform === 'mixed') {
        setDeployResult({
          name,
          message: t('messages.mixedPlatform'),
          success: false,
        });
        scheduleAutoDismiss(() => setDeployResult(null), 10000);
        return;
      }
    }

    const modeLabel = mode === 'audit' ? t('modes.audit') : t('modes.enforce');
    if (!confirm(t('confirm.deploy', { name, mode: modeLabel }))) return;
    setDeploying(name);
    setDeployResult(null);
    setDeployProgress(null);
    try {
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const nameSlug = slugify(name);
      const catalogEntry = BASELINE_CATALOG.find(
        (b) => b.id === name || b.name === name || slugify(b.name) === nameSlug || slugify(b.id) === nameSlug
      );
      const payload: { name: string; mode: 'audit' | 'enforce'; scenarioName?: string; platform?: string; jobId: string } = {
        name,
        mode,
        // crypto.randomUUID is available in Electron renderer. Fall
        // back to a timestamp+random combo on the off chance the
        // bundler strips it (e.g. a future Node-only test runner).
        jobId:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
      if (catalogEntry?.scenarioName) {
        payload.scenarioName = catalogEntry.scenarioName;
        payload.platform = catalogEntry.platform;
      }

      const json = await cfs.deploy.run(payload, (event) => setDeployProgress(event));
      setDeployResult({
        name,
        message: json.message ?? t("messages.deploySuccess", { host: json.data?.Hostname ?? "this device" }),
        success: true,
      });
      scheduleAutoDismiss(() => setDeployResult(null), 10000);

      if (json.data?.Resources && Array.isArray(json.data.Resources)) {
        const deployResources = json.data.Resources.map((r: { name: string; type: string; status: string; reason: string }) => ({
          name: r.name,
          type: r.type,
          properties: {},
          compliance: { status: r.status, reason: r.reason ?? '' },
        }));
        setManifests((prev) =>
          prev.map((m) => {
            if (m.Name !== name) return m;
            return { ...m, Resources: deployResources };
          })
        );
        try {
          sessionStorage.setItem(`configforge-compliance-${name}`, JSON.stringify({ name, resources: deployResources }));
        } catch { /* non-critical */ }
      }
    } catch (err) {
      setDeployResult({
        name,
        message: err instanceof Error ? err.message : t("messages.deployFailed"),
        success: false,
      });
    } finally {
      setDeploying(null);
      setDeployProgress(null);
    }
  };

  const handleRevert = async (name: string) => {
    // v0.2.0, bring-your-own-CLI gate.
    if (!presence.installed) {
      setCliGateFeature(t('features.revert'));
      return;
    }
    if (
      !confirm(t('confirm.revert', { name }))
    ) return;
    setReverting(name);
    setDeployResult(null);
    try {
      const json = await cfs.revert.apply({ name });
      setDeployResult({ name, message: (json as { message?: string }).message ?? t('messages.reverted'), success: true });
      fetchManifests();
    } catch (err) {
      setDeployResult({ name, message: err instanceof Error ? err.message : t('messages.revertFailed'), success: false });
    } finally {
      setReverting(null);
    }
  };

  // Search filter + platformByName are computed inside `useManifestList`.
  // toggleSelect / toggleSelectAll come from `useBulkSelection`.

  const handleBulkDeploy = async () => {
    const names = Array.from(selected);
    if (names.length === 0) return;

    // v0.2.0, bring-your-own-CLI gate. Same preflight as single-deploy.
    if (!presence.installed) {
      setCliGateFeature(t('features.bulkDeploy'));
      return;
    }

    // Mixed-platform check only — let the server handle cross-OS validation
    const mixedManifests = names.filter((n) => {
      const p = platformByName.get(n);
      return p === 'mixed';
    });
    if (mixedManifests.length > 0) {
      setBulkResult({
        succeeded: 0,
        failed: mixedManifests.length,
        action: 'deploy',
      });
      scheduleAutoDismiss(() => setBulkResult(null), 10000);
      setDeployResult({
        name: mixedManifests[0],
        message: t("messages.mixedSelection", { count: mixedManifests.length }),
        success: false,
      });
      scheduleAutoDismiss(() => setDeployResult(null), 10000);
      return;
    }

    if (!confirm(t("confirm.bulkDeploy", { count: names.length }))) return;
    setBulkDeploying(true);
    setBulkResult(null);
    setDeployResult(null);
    const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setBulkProgress({ current: 0, total: names.length });
    let completed = 0;
    const results = await Promise.allSettled(
      names.map(async (name) => {
        // v0.1.14: dropped the dead `payload: Record<string, string>`
        // builder that the previous version constructed and then
        // ignored — the actual cfs.deploy.run call manually spread
        // the catalog scenario fields back in regardless. The new
        // shape is identical to handleDeploy: look up the catalog
        // entry, build the request inline.
        const nameSlug = slugify(name);
        const catalogEntry = BASELINE_CATALOG.find(
          (b) => b.id === name || b.name === name || slugify(b.name) === nameSlug || slugify(b.id) === nameSlug
        );
        try {
          await cfs.deploy.run({
            name,
            mode: 'enforce',
            ...(catalogEntry?.scenarioName
              ? { scenarioName: catalogEntry.scenarioName, platform: catalogEntry.platform }
              : {}),
          });
        } catch (err) {
          // v0.1.11 fix — preserve the original error so the user can
          // see *why* this manifest failed (admin required, network
          // error, validation, etc.) instead of a generic "Deploy
          // failed" string. The result is still aggregated into the
          // succeeded/failed counts below; logging the reason gives
          // us a debug breadcrumb in the renderer console too.
          console.error(`[bulk-deploy] "${name}" failed:`, err);
          throw err instanceof Error
            ? err
            : new Error(t("messages.deployFailedFor", { name }));
        } finally {
          completed += 1;
          setBulkProgress({ current: completed, total: names.length });
        }
      })
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    setBulkProgress(null);
    setBulkDeploying(false);
    setBulkResult({ succeeded, failed, action: 'deploy' });
    scheduleAutoDismiss(() => setBulkResult(null), 10000);
    clearSelection();
    fetchManifests();
  };

  const handleBulkDelete = async () => {
    const names = Array.from(selected);
    if (names.length === 0) return;
    if (!confirm(t("confirm.bulkDelete", { count: names.length }))) return;
    setBulkDeleting(true);
    setBulkResult(null);
    setDeployResult(null);
    setBulkProgress({ current: 0, total: names.length });
    let completed = 0;
    const results = await Promise.allSettled(
      names.map(async (name) => {
        try {
          await cfs.manifests.delete(name);
          // v0.1.13 fix — optimistic per-success update so the user
          // sees cards disappear in real time as the bulk progresses.
          // Previously every card stayed visible for the full duration
          // of the bulk operation (only the progress bar moved); the
          // cards only vanished at the end after fetchManifests().
          // For a 20-manifest bulk delete that felt like nothing was
          // happening for 5+ seconds. Now `Deleting 7/20…` lines up
          // visually with 7 cards actually gone.
          setManifests((prev) => prev.filter((m) => m.Name !== name));
        } catch (err) {
          // v0.1.11 fix — preserve original error so failures aren't
          // mysteries. See the bulk-deploy variant above for the
          // full rationale.
          console.error(`[bulk-delete] "${name}" failed:`, err);
          throw err instanceof Error
            ? err
            : new Error(t("messages.deleteFailed"));
        } finally {
          completed += 1;
          setBulkProgress({ current: completed, total: names.length });
        }
      })
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    setBulkProgress(null);
    setBulkDeleting(false);
    setBulkResult({ succeeded, failed, action: 'delete' });
    scheduleAutoDismiss(() => setBulkResult(null), 10000);
    clearSelection();
    fetchManifests();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* v0.2.0 - BYO-CLI install dialog. Opens from handleDeploy /
         handleAudit / handleRevert / handleBulkDeploy when OSConfig
         isn't installed. The auto-dismiss-on-install behavior comes
         from CliRequiredModal itself. */}
      <CliRequiredModal
        open={cliGateFeature !== null}
        feature={cliGateFeature ?? t('features.deploy')}
        onDismiss={() => setCliGateFeature(null)}
        presence={presence}
      />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('page.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('page.description')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <SearchRegular className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('search.placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:placeholder:text-slate-500 w-56"
            />
          </div>
          <Button
            appearance="secondary"
            onClick={fetchManifests}
            disabled={loading}
            icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
          >
            {t('common:buttons.refresh')}
          </Button>
          <Link
            to="/manifests/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <AddRegular className="h-4 w-4" />
            {t('actions.registerNew')}
          </Link>
        </div>
      </div>

      {/* Flash message */}
      {flashMessage && (
        <MessageBar intent="success">
          <MessageBarBody>{flashMessage}</MessageBarBody>
          <MessageBarActions>
            <Button
              appearance="transparent"
              icon={<DismissRegular />}
              aria-label={t('common:buttons.dismiss')}
              onClick={() => setFlashMessage(null)}
            />
          </MessageBarActions>
        </MessageBar>
      )}

      {/* Error */}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* Deploy result */}
      {deployResult && (
        <MessageBar intent={deployResult.success ? 'success' : 'error'}>
          <MessageBarBody>{deployResult.message}</MessageBarBody>
          <MessageBarActions>
            <Button
              appearance="transparent"
              icon={<DismissRegular />}
              aria-label={t('common:buttons.dismiss')}
              onClick={() => setDeployResult(null)}
            />
          </MessageBarActions>
        </MessageBar>
      )}

      {/* Bulk deploy result */}
      {bulkResult && (
        <MessageBar intent="info">
          <MessageBarBody>
            {t('messages.bulkResult', {
              action: bulkResult.action,
              succeeded: bulkResult.succeeded,
              failedText: bulkResult.failed > 0 ? t('messages.bulkFailedText', { count: bulkResult.failed }) : '',
            })}
          </MessageBarBody>
          <MessageBarActions>
            <Button
              appearance="transparent"
              icon={<DismissRegular />}
              aria-label={t('common:buttons.dismiss')}
              onClick={() => setBulkResult(null)}
            />
          </MessageBarActions>
        </MessageBar>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && manifests.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <FolderOpenRegular className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">
            {t('empty.sectionTitle')}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('empty.sectionDescription')}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              to="/manifests/new"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <AddRegular className="h-4 w-4" />
              {t('actions.registerNew')}
            </Link>
            {/* v0.3.0 (#8c): secondary CTA pointing to the bundled
                library so a first-time admin who doesn't know what
                OSConfig YAML looks like can pick a ready-made
                baseline instead of staring at an empty editor. */}
            <Link
              to="/library"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('empty.browseLibrary')}
            </Link>
          </div>
        </div>
      )}

      {/* No search results */}
      {!loading && manifests.length > 0 && filteredManifests.length === 0 && debouncedSearch.trim() && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <SearchRegular className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">
            {t('search.noResultsTitle')}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('search.noResultsDescription', { query: searchQuery })}
          </p>
        </div>
      )}

      {/* Manifest cards */}
      {!loading && filteredManifests.length > 0 && (
        <>
          {/* Select all */}
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <button
              onClick={() => toggleSelectAll(filteredManifests)}
              className="inline-flex items-center gap-2 hover:text-slate-700 dark:hover:text-slate-200"
            >
              {selected.size === filteredManifests.length && filteredManifests.length > 0 ? (
                <CheckboxCheckedRegular className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              ) : (
                <CheckboxUncheckedRegular className="h-4 w-4" />
              )}
              {selected.size === filteredManifests.length && filteredManifests.length > 0 ? t('selection.deselectAll') : t('selection.selectAll')}
            </button>
            {selected.size > 0 && (
              <span className="text-xs text-slate-400 dark:text-slate-500">({t('selection.selected', { count: selected.size })})</span>
            )}
          </div>
          <div className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
            {filteredManifests.map((manifest) => {
            const resourceCount = manifest.Resources?.length ?? 0;
            const compliant = manifest.Resources?.filter(
              (r) => r.compliance?.status?.toLowerCase() === "compliant"
            ).length ?? 0;
            const noncompliant = manifest.Resources?.filter(
              (r) => {
                const s = r.compliance?.status?.toLowerCase();
                return s === "noncompliant" || s === "notcompliant" || s === "non-compliant";
              }
            ).length ?? 0;
            // Resources the audit returned a status for that is neither compliant
            // nor non-compliant (indeterminate / error / "could not read"). Mirrors
            // the amber bucket in the manifest detail view so the card totals add up
            // (Compliant + Issues + Could not read) instead of silently dropping them.
            const couldNotRead = manifest.Resources?.filter(
              (r) => {
                const s = r.compliance?.status?.toLowerCase();
                if (!s) return false;
                return (
                  s !== "compliant" &&
                  s !== "noncompliant" &&
                  s !== "notcompliant" &&
                  s !== "non-compliant" &&
                  s !== "not compliant"
                );
              }
            ).length ?? 0;

            const manifestPlatform = platformByName.get(manifest.Name) ?? 'unknown';
            const pBadge =
              manifestPlatform === 'windows'
                ? { label: t('card.platform.windows'), cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
                : manifestPlatform === 'linux'
                  ? { label: t('card.platform.linux'), cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }
                  : manifestPlatform === 'mixed'
                    ? { label: t('card.platform.mixed'), cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
                    : { label: t('card.platform.crossPlatform'), cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/30 dark:text-slate-400' };

            return (
              <div
                key={manifest.Name}
                className={`group rounded-lg border bg-white p-6 shadow-sm transition-colors hover:border-blue-300 dark:bg-slate-900 dark:hover:border-blue-700 ${
                  selected.has(manifest.Name)
                    ? "border-blue-400 ring-1 ring-blue-400 dark:border-blue-600 dark:ring-blue-600"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                {/*
                  Card header — H1 fix.
                  Original layout truncated long manifest names ("cis-ws2022-…",
                  "Microsoft-D…") to 1 line, making 4+ cards visually
                  interchangeable. Now we use a 2-row layout:
                    Row 1: checkbox + icon + platform pill
                    Row 2: full manifest name (line-clamp-2, break-words)
                  Hover-title is preserved for the rare 3+-line outliers.
                */}
                <div className="mb-4 space-y-2">
                  <div className="flex items-start gap-3">
                    {/* Selection checkbox */}
                    <button
                      onClick={() => toggleSelect(manifest.Name)}
                      className="mt-1 shrink-0 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                      role="checkbox"
                      aria-checked={selected.has(manifest.Name)}
                      aria-label={t('card.selectAria', { name: manifest.Name })}
                    >
                      {selected.has(manifest.Name) ? (
                        <CheckboxCheckedRegular className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <CheckboxUncheckedRegular className="h-5 w-5" />
                      )}
                    </button>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/30">
                      <DocumentRegular className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${pBadge.cls}`}>
                        {manifestPlatform === 'windows' && <WindowsLogo className="h-3 w-3" />}
                        {pBadge.label}
                      </span>
                    </div>
                  </div>
                  <h3
                    className="line-clamp-2 break-words text-sm font-semibold text-slate-900 dark:text-white"
                    title={manifest.Name}
                  >
                    {manifest.Name}
                  </h3>
                </div>

                {/* Stats */}
                <div className="mb-4 grid grid-cols-4 gap-2">
                  <div className="min-w-0 rounded-md bg-slate-50 px-1.5 py-2 text-center dark:bg-slate-800">
                    <p className="truncate text-lg font-bold text-slate-900 dark:text-white">{resourceCount}</p>
                    <p className="mt-0.5 text-[10px] uppercase leading-tight tracking-tight text-slate-500 dark:text-slate-400">
                      {t('card.stats.resources')}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-md bg-emerald-50 px-1.5 py-2 text-center dark:bg-emerald-900/20">
                    <p className="truncate text-lg font-bold text-emerald-600 dark:text-emerald-400">{compliant}</p>
                    <p className="mt-0.5 text-[10px] uppercase leading-tight tracking-tight text-slate-500 dark:text-slate-400">
                      {t('card.stats.compliant')}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-md bg-red-50 px-1.5 py-2 text-center dark:bg-red-900/20">
                    <p className="truncate text-lg font-bold text-red-600 dark:text-red-400">{noncompliant}</p>
                    <p className="mt-0.5 text-[10px] uppercase leading-tight tracking-tight text-slate-500 dark:text-slate-400">
                      {t('card.stats.issues')}
                    </p>
                  </div>
                  <div
                    className="min-w-0 rounded-md bg-amber-50 px-1.5 py-2 text-center dark:bg-amber-900/20"
                    title={t('card.stats.couldNotReadTitle')}
                  >
                    <p className="truncate text-lg font-bold text-amber-600 dark:text-amber-400">{couldNotRead}</p>
                    <p className="mt-0.5 text-[10px] uppercase leading-tight tracking-tight text-slate-500 dark:text-slate-400">
                      {t('card.stats.couldNotRead')}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/manifests/${encodeURIComponent(manifest.Name)}`}
                    className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    style={{ minWidth: '5.5rem' }}
                    title={t('card.viewTitle', { name: manifest.Name })}
                  >
                    <EyeRegular className="h-4 w-4 shrink-0" />
                    <span>{t('actions.view')}</span>
                  </Link>
                  <div className="relative shrink-0">
                    {HAS_DEPLOY && (
                    <button
                      onClick={() => setDeployMenuName(deployMenuName === manifest.Name ? null : manifest.Name)}
                      disabled={deploying === manifest.Name || reverting === manifest.Name || deleting === manifest.Name}
                      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                    >
                      {deploying === manifest.Name ? (
                        <Spinner size="tiny" />
                      ) : (
                        <PlayRegular className="h-4 w-4 shrink-0" />
                      )}
                      <span>
                        {deploying === manifest.Name && deployProgress?.resourcesTotal
                          ? (
                            <AuditProgressCounter
                              completed={deployProgress.resourcesCompleted ?? 0}
                              total={deployProgress.resourcesTotal}
                            />
                          )
                          : t('actions.deploy')}
                      </span>
                      <ChevronDownRegular className="h-3 w-3 shrink-0" />
                    </button>
                    )}
                    {HAS_DEPLOY && deployMenuName === manifest.Name && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setDeployMenuName(null)} />
                        <div className="absolute left-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                          <button
                            onClick={() => { setDeployMenuName(null); handleDeploy(manifest.Name, 'audit'); }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            <ShieldCheckmarkRegular className="h-4 w-4 shrink-0 text-blue-500" />
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-200">{t('actions.audit')}</p>
                              <p className="text-[10px] text-slate-400">{t('actions.checkCompliance')}</p>
                            </div>
                          </button>
                          <button
                            onClick={() => { setDeployMenuName(null); handleDeploy(manifest.Name, 'enforce'); }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            <PlayRegular className="h-4 w-4 shrink-0 text-emerald-500" />
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-200">{t('actions.enforce')}</p>
                              <p className="text-[10px] text-slate-400">{t('actions.applySettings')}</p>
                            </div>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {HAS_DEPLOY && (
                  <button
                    onClick={() => handleRevert(manifest.Name)}
                    disabled={
                      reverting === manifest.Name ||
                      deploying === manifest.Name ||
                      deleting === manifest.Name ||
                      // v0.3.0 (#18): no point letting the user click
                      // Revert on a manifest that has never been
                      // deployed. `Deployed` mirrors `lastAppliedAt`
                      // not null in the registration JSON.
                      !manifest.Deployed
                    }
                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-200 p-2 text-amber-500 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
                    title={
                      manifest.Deployed
                        ? t('card.revertTitle', { name: manifest.Name })
                        : t('card.noRevertTitle', { name: manifest.Name })
                    }
                    aria-label={t('card.revertAria', { name: manifest.Name })}
                  >
                    {reverting === manifest.Name ? (
                      <Spinner size="tiny" />
                    ) : (
                      <ArrowCounterclockwiseRegular className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  )}
                  <button
                    onClick={() => handleDelete(manifest.Name)}
                    disabled={deleting === manifest.Name || deploying === manifest.Name || reverting === manifest.Name}
                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:hover:border-red-700 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title={t('card.deleteTitle')}
                    aria-label={t('card.deleteAria', { name: manifest.Name })}
                  >
                    {deleting === manifest.Name ? (
                      <Spinner size="tiny" />
                    ) : (
                      <DeleteRegular className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
            {bulkDeploying && bulkProgress ? (
              <div className="flex items-center gap-3">
                <TintedSpinner intent="success" size="tiny" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('bulk.deploying', bulkProgress)}
                </span>
                <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : bulkDeleting && bulkProgress ? (
              <div className="flex items-center gap-3">
                <TintedSpinner intent="danger" size="tiny" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('bulk.deleting', bulkProgress)}
                </span>
                <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-red-500 transition-all duration-300"
                    style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                {HAS_DEPLOY && (
                <Button
                  appearance="primary"
                  onClick={handleBulkDeploy}
                  icon={<PlayRegular />}
                >
                  {t('bulk.deployCount', { count: selected.size })}
                </Button>
                )}
                <DangerButton
                  onClick={handleBulkDelete}
                  icon={<DeleteRegular />}
                >
                  {t('bulk.deleteCount', { count: selected.size })}
                </DangerButton>
                <Button
                  appearance="secondary"
                  onClick={clearSelection}
                  icon={<DismissRegular />}
                >
                  {t('common:buttons.cancel')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
