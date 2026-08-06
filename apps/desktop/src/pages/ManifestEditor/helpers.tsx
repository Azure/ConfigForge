// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure helpers + presentational sub-component for the ManifestEditor page.
 *
 * Extracted from `index.tsx` during the v0.2.x page-split refactor
 * (Phase A.2). None of these read or write component state; they're
 * called directly from the page composition and from tests.
 *
 * Anything that needs `useState` / `useEffect` / `useRef` lives in
 * `./state/` instead (Phase A.3 onward).
 */

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { OscResource } from "@configforge/core/types";
import { stringifyLosslessJson } from "@configforge/core/manifest/lossless";

// ── Shared types ────────────────────────────────────────────────────

export type ComplianceStatus =
  | "compliant"
  | "noncompliant"
  | "indeterminate"
  | "error"
  | "unknown";

export type FormatTab = "yaml" | "json" | "mof";

// ── Constants ───────────────────────────────────────────────────────

export const FORMAT_TABS: { key: FormatTab; label: string }[] = [
  { key: "yaml", label: "YAML" },
  { key: "json", label: "JSON" },
  { key: "mof", label: "MOF" },
];

export const EDITOR_LANGUAGE: Record<FormatTab, "yaml" | "json" | "plaintext"> = {
  yaml: "yaml",
  json: "json",
  mof: "plaintext",
};

/**
 * perf W2 / C1: cap initial rows in the compliance + deploy-result
 * tables. With ~326 resources, the synchronous render of every row
 * drops scroll FPS to ~30-40 on the deploy result panel. Most users
 * scan the summary stats and rarely need to read every row; the
 * "Show all NN" affordance opts in to the full render when they do.
 *
 * Tuned to 50: enough that small/medium manifests (≤50 resources)
 * render in full without the toggle, but small enough that the worst
 * case (1000+ resources, 10K+ cells) doesn't tank first-paint.
 */
export const INITIAL_TABLE_ROWS = 50;

// ── Pure helpers ────────────────────────────────────────────────────

export function normalizeStatus(raw?: string): ComplianceStatus {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower === "compliant") return "compliant";
  if (
    lower === "noncompliant" ||
    lower === "non-compliant" ||
    lower === "notcompliant" ||
    lower === "not compliant"
  )
    return "noncompliant";
  if (lower === "indeterminate" || lower === "could not read") return "indeterminate";
  if (lower === "error") return "error";
  return "unknown";
}

export function getPlatformLabel(type: string, t: TFunction<"manifest-editor">): { label: string; cls: string } {
  const lower = type.toLowerCase();
  if (lower.includes("windows") || lower.includes("csp"))
    return {
      label: t("platform.windows"),
      cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    };
  if (lower.includes("linux"))
    return {
      label: t("platform.linux"),
      cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    };
  // Microsoft.OSConfig/Test is a wrapper — platform depends on what it wraps
  if (lower === "microsoft.osconfig/test")
    return {
      label: t("platform.test"),
      cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    };
  return {
    label: t("platform.crossPlatform"),
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-700/30 dark:text-slate-400",
  };
}

export function extractPropertyPath(properties: Record<string, unknown>): string | null {
  // Common property paths from OSConfig resources
  for (const key of ["keyPath", "path", "cspPath", "uri", "filePath", "registryPath"]) {
    if (typeof properties[key] === "string") return properties[key] as string;
  }
  return null;
}

function formatResourceValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value !== "object") return String(value);
  try {
    return stringifyLosslessJson(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ── ResourceDetailPanel ─────────────────────────────────────────────

export function ResourceDetailPanel({ resource }: { resource: OscResource }) {
  const { t } = useTranslation("manifest-editor");
  const platform = getPlatformLabel(resource.type, t);
  const propertyPath = extractPropertyPath(resource.properties ?? {});
  const properties = resource.properties ?? {};
  const propertyEntries = Object.entries(properties).filter(
    ([k]) => k !== "compliance" && k !== "value",
  );

  return (
    <div className="mx-6 mb-4 mt-1 rounded-lg border border-blue-100 bg-blue-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${platform.cls}`}>
          {platform.label}
        </span>
        <code className="break-all rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {resource.type}
        </code>
        {resource.compliance && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              resource.compliance.status?.toLowerCase() === "compliant"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : resource.compliance.status?.toLowerCase() === "noncompliant" ||
                    resource.compliance.status?.toLowerCase() === "non-compliant"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
            }`}
          >
            {resource.compliance.status}
          </span>
        )}
      </div>

      {resource.compliance?.reason && (
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          <span className="font-medium">{t("resourceDetails.reason")}:</span> {resource.compliance.reason}
        </p>
      )}

      {resource.value !== undefined && resource.value !== null && (
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          <span className="font-medium">{t("resourceDetails.desiredValue")}:</span>{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-700">
            {formatResourceValue(resource.value)}
          </code>
        </p>
      )}

      {propertyPath && (
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          <span className="font-medium">{t("resourceDetails.path")}:</span>{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-700 break-all">
            {propertyPath}
          </code>
        </p>
      )}

      {propertyEntries.length > 0 && (
        <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-700/50">
                <th className="px-3 py-1.5 text-left font-medium text-slate-500 dark:text-slate-400">{t("resourceDetails.property")}</th>
                <th className="px-3 py-1.5 text-left font-medium text-slate-500 dark:text-slate-400">{t("resourceDetails.value")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {propertyEntries.map(([key, val]) => (
                <tr key={key}>
                  <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {key}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400 break-all">
                    <code className="text-xs">
                      {formatResourceValue(val)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
