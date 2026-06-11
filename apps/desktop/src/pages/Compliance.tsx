// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheckmarkRegular,
  WarningRegular,
  ArrowSyncRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DocumentRegular,
  ArrowDownloadRegular,
  CheckmarkCircleRegular,
  DismissCircleRegular,
  InfoRegular,
} from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { ConflictDetector } from "../components/conflict-detector";
import { cfs } from "../lib/cfs";
import { useTranslation } from "react-i18next";

interface ValidationField {
  hasSchema: boolean;
  hasEnforcementValues: boolean;
  hasComplianceCriteria: boolean;
  issues: string[];
}

interface ManifestSummary {
  name: string;
  resourceCount: number;
  resourceTypes: string[];
  hasEnforcementValues: boolean;
  hasComplianceCriteria: boolean;
  hasSchema: boolean;
  exportReady: { yaml: boolean; json: boolean; mof: boolean; azurepolicy: boolean };
  issues: string[];
}

export function CompliancePage() {
  const { t } = useTranslation("compliance");
  const [manifests, setManifests] = useState<ManifestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await cfs.manifests.list({});

      const rawList: unknown[] = Array.isArray((json as { data?: unknown }).data)
        ? (json as { data: unknown[] }).data
        : (json as { data?: unknown }).data
          ? [(json as { data: unknown }).data]
          : [];
      const summaries: ManifestSummary[] = rawList
        .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
        .map((m) => {
          const name = String(m.Name ?? m.name ?? "unnamed");
          const resources = (m.Resources ?? m.resources ?? []) as Record<string, unknown>[];
          const types = Array.from(
            new Set(resources.map((r) => String(r.type ?? r.Type ?? "unknown"))),
          );

          // Validation summary is computed server-side from the actual source
          // YAML — it knows about Group/Test wrappers, $schema, enforcement
          // values inside nested resources, etc. Fall back to a minimal
          // "we have a list of resources" view only when the field is missing
          // (e.g. CLI-only namespaces with no ConfigForge registration).
          const validation = (m.Validation ?? null) as ValidationField | null;

          return {
            name,
            resourceCount: resources.length,
            resourceTypes: types,
            hasEnforcementValues: validation?.hasEnforcementValues ?? false,
            hasComplianceCriteria: validation?.hasComplianceCriteria ?? false,
            hasSchema: validation?.hasSchema ?? false,
            exportReady: {
              // v0.2.15: every supported format only needs at least one
              // resource. The previous CSP→MOF carve-out was a stale UI
              // safeguard — the backend MOF generator handles CSP just
              // fine. Removed to stop hiding the Export button for
              // valid manifests.
              yaml: resources.length > 0,
              json: resources.length > 0,
              mof: resources.length > 0,
              azurepolicy: resources.length > 0,
            },
            issues: validation?.issues ?? [],
          };
        })
        .filter((m) => {
          if (m.name === "unnamed") {
            // v0.2.15: previously dropped silently; surface to console
            // so backend bugs that produce nameless manifests don't
            // disappear from the UI without a trace.
            console.warn("[Compliance] dropping manifest with no name", m);
            return false;
          }
          return true;
        });

      setManifests(summaries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const toggleExpanded = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalManifests = manifests.length;
  // v0.2.15: "Export Ready" means "actually has at least one exportable
  // format". The previous `issues.length === 0` undercounted: a manifest
  // with 0 issues AND 0 resources passed the filter even though no per-
  // format button rendered.
  const readyCount = manifests.filter((m) => m.issues.length === 0 && m.resourceCount > 0).length;
  const issueCount = manifests.filter((m) => m.issues.length > 0).length;
  const totalResources = manifests.reduce((s, m) => s + m.resourceCount, 0);
  // v0.2.15: memoize the name array so child <ConflictDetector> doesn't
  // refire its `useEffect([manifestNames])` on every parent render — the
  // previous inline `manifests.map(...)` literal was a fresh reference
  // each pass and triggered a fresh round of N IPC fetches per render.
  const manifestNames = useMemo(() => manifests.map((m) => m.name), [manifests]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t("overview.extracted.text1")}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("overview.extracted.text2")}
          </p>
        </div>
        <Button
          appearance="secondary"
          onClick={fetchAll}
          disabled={loading}
          icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
        >
          {t("overview.extracted.text3")}
        </Button>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
      )}

      {!loading && (
        <>
          {/* Overview cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <OverviewCard
              icon={<DocumentRegular className="h-5 w-5 text-blue-500" />}
              label={t("overview.extracted.text4")}
              value={totalManifests}
              color="blue"
            />
            <OverviewCard
              icon={<CheckmarkCircleRegular className="h-5 w-5 text-emerald-500" />}
              label={t("overview.extracted.text5")}
              value={readyCount}
              color="emerald"
            />
            <OverviewCard
              icon={<WarningRegular className="h-5 w-5 text-amber-500" />}
              label={t("overview.extracted.text6")}
              value={issueCount}
              color="amber"
            />
            <OverviewCard
              icon={<ShieldCheckmarkRegular className="h-5 w-5 text-indigo-500" />}
              label={t("overview.extracted.text7")}
              value={totalResources}
              color="indigo"
            />
          </div>

          {/* Per-manifest validation */}
          {manifests.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
              <DocumentRegular className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">
                {t("overview.extracted.text8")}
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t("overview.extracted.text9")}
              </p>
              <Link
                to="/manifests/new"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                {t("overview.extracted.text10")}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {manifests.map((m) => {
                const isExpanded = expanded.has(m.name);
                const isReady = m.issues.length === 0;

                return (
                  <div
                    key={m.name}
                    className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    {/* Header */}
                    <button
                      onClick={() => toggleExpanded(m.name)}
                      className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {isExpanded ? (
                          <ChevronDownRegular className="h-4 w-4 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRightRegular className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        {isReady ? (
                          <CheckmarkCircleRegular className="h-5 w-5 shrink-0 text-emerald-500" />
                        ) : (
                          <WarningRegular className="h-5 w-5 shrink-0 text-amber-500" />
                        )}
                        <span
                          className="shrink-0 whitespace-nowrap font-semibold text-slate-900 dark:text-white"
                          title={m.name}
                        >
                          {m.name}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400"
                          title={`${m.resourceCount} resources · ${m.resourceTypes.join(", ")}`}
                        >
                          {m.resourceCount}
                          {t("overview.extracted.text11")}
                          {m.resourceTypes.join(", ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.issues.length > 0 && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                            {m.issues.length}{" "}
                            {m.issues.length === 1
                              ? t("overview.extracted.text12")
                              : t("overview.extracted.text13")}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-slate-200 px-6 py-5 dark:border-slate-800">
                        <div className="grid gap-6 lg:grid-cols-2">
                          {/* Validation */}
                          <div>
                            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                              <InfoRegular className="h-4 w-4" />
                              {t("overview.extracted.text14")}
                            </h4>
                            <div className="space-y-2 text-sm">
                              <DetailRow
                                label={t("overview.extracted.text15")}
                                value={String(m.resourceCount)}
                              />
                              <DetailRow
                                label={t("overview.extracted.text16")}
                                value={m.resourceTypes.join(", ") || "None"}
                              />
                              <DetailRow
                                label={t("overview.extracted.text17")}
                                value={m.hasSchema ? "Yes" : "No"}
                                ok={true}
                              />
                              <DetailRow
                                label={t("overview.extracted.text18")}
                                value={
                                  m.hasEnforcementValues
                                    ? "Yes, will enforce on apply"
                                    : "No, report/audit only"
                                }
                                ok={true}
                              />
                              <DetailRow
                                label={t("overview.extracted.text19")}
                                value={m.hasComplianceCriteria ? "Yes" : "No"}
                                ok={true}
                              />
                            </div>

                            {m.issues.length > 0 && (
                              <div className="mt-4">
                                <h4 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                                  {t("overview.extracted.text20")}
                                </h4>
                                <ul className="space-y-1">
                                  {m.issues.map((issue, i) => (
                                    <li
                                      key={i}
                                      className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"
                                    >
                                      <DismissCircleRegular className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      <span className="min-w-0 flex-1 break-words">{issue}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Export readiness */}
                          <div>
                            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                              <ArrowDownloadRegular className="h-4 w-4" />
                              {t("overview.extracted.text21")}
                            </h4>
                            <div className="space-y-2">
                              <ExportRow
                                format="YAML (.osc.yaml)"
                                ready={m.exportReady.yaml}
                                name={m.name}
                                fmt="yaml"
                              />
                              <ExportRow
                                format="JSON (.json)"
                                ready={m.exportReady.json}
                                name={m.name}
                                fmt="json"
                              />
                              <ExportRow
                                format="MOF (Azure Policy)"
                                ready={m.exportReady.mof}
                                name={m.name}
                                fmt="mof"
                              />
                              <ExportRow
                                format="Azure Policy Definition"
                                ready={m.exportReady.azurepolicy}
                                name={m.name}
                                fmt="azurepolicy"
                              />
                              <ExportRow
                                format="CSV (Spreadsheet)"
                                ready={m.exportReady.yaml}
                                name={m.name}
                                fmt="excel"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Quick actions */}
                        <div className="mt-5 flex items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                          <Link
                            to={`/manifests/${encodeURIComponent(m.name)}`}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            <DocumentRegular className="h-4 w-4" />
                            {t("overview.extracted.text22")}
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Conflict detection */}
          {manifestNames.length > 1 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t("overview.extracted.text23")}
              </h2>
              <ConflictDetector manifestNames={manifestNames} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OverviewCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "blue" | "emerald" | "amber" | "indigo";
}) {
  const bg = {
    blue: "bg-blue-50 dark:bg-blue-900/20",
    emerald: "bg-emerald-50 dark:bg-emerald-900/20",
    amber: "bg-amber-50 dark:bg-amber-900/20",
    indigo: "bg-indigo-50 dark:bg-indigo-900/20",
  }[color];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className={`mb-3 inline-flex rounded-lg p-2.5 ${bg}`}>{icon}</div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function DetailRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      <span
        className={`font-medium ${ok === false ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-white"}`}
      >
        {value}
      </span>
    </div>
  );
}

function ExportRow({
  format,
  ready,
  name,
  fmt,
}: {
  format: string;
  ready: boolean;
  name: string;
  fmt: "yaml" | "json" | "mof" | "azurepolicy" | "excel";
}) {
  const { t } = useTranslation("compliance");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const handleExport = async () => {
    setErrMsg(null);
    try {
      const res = (await cfs.exportChannel.save({ name, format: fmt })) as
        | { ok: true; path: string }
        | { ok: false; status?: number; error?: string };
      // The IPC layer returns `{ok:false, error:'cancelled'}` when the
      // user dismisses the file picker — silently ignore that case but
      // surface any other failure (permission, disk full, bad path).
      if (res && (res as { ok?: boolean }).ok === false) {
        const errObj = res as { error?: string };
        const e = errObj.error ?? "export failed";
        if (e !== "cancelled") setErrMsg(e);
      }
    } catch (err) {
      // v0.2.15: previously swallowed silently. Anything that throws
      // here is a real failure (the cancel case returns a structured
      // envelope, not an exception).
      setErrMsg(err instanceof Error ? err.message : "Export failed");
    }
  };
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {ready ? (
            <CheckmarkCircleRegular className="h-4 w-4 text-emerald-500" />
          ) : (
            <DismissCircleRegular className="h-4 w-4 text-slate-400" />
          )}
          <span className="text-sm text-slate-700 dark:text-slate-300">{format}</span>
        </div>
        {ready && (
          <Button type="button" appearance="primary" size="small" onClick={handleExport}>
            {t("overview.extracted.text24")}
          </Button>
        )}
      </div>
      {errMsg && (
        <div
          className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          <DismissCircleRegular className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{errMsg}</span>
        </div>
      )}
    </div>
  );
}
