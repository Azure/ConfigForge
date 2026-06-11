// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SparkleRegular,
  WarningRegular,
  CheckmarkCircleRegular,
  InfoRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  BookOpenRegular,
  EyeRegular,
  EyeOffRegular,
} from "@fluentui/react-icons";
import { Spinner } from "@fluentui/react-components";
import type { DiffAnalysis, RiskLevel } from "@configforge/core/ai/analyzer";
import type { AiSource } from "@configforge/core/ai/provenance";
import { ExternalLink } from "./ExternalLink";
import { useNumberFormatter } from "../lib/format";

interface AiAnalysisPanelProps {
  analysis: DiffAnalysis | null;
  isLoading: boolean;
  /**
   * Optional override summary derived from the matrix-builder counts.
   * When provided, replaces the analyzer's built-in summary string so
   * the AI panel's numbers match ResourceChangesPanel exactly. Without
   * this, the two panels can show different counts because the analyzer
   * uses its own per-name diff while buildMatrix does cross-baseline
   * type-aware merging.
   */
  overrideSummary?: string;
}

// FNV-1a 32-bit — small, deterministic, no crypto needed; only used as a
// debug "input fingerprint" for the Show-your-work panel.
function inputFingerprint(analysis: DiffAnalysis): string {
  const seed = JSON.stringify({
    a: analysis.addedResources,
    r: analysis.removedResources,
    c: analysis.changedResources.map((c) => `${c.name}:${c.field}`),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const sourceKindStyle: Record<AiSource["kind"], string> = {
  CIS: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800",
  NIST: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800",
  MSDocs: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-800",
  GPO: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800",
  manifest: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  "user-input": "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
};

const riskConfig: Record<
  RiskLevel,
  { labelKey: string; bg: string; text: string; border: string; icon: React.ReactNode }
> = {
  low: {
    labelKey: "ai.risk.low",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800",
    icon: <CheckmarkCircleRegular className="h-4 w-4" />,
  },
  medium: {
    labelKey: "ai.risk.medium",
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
    icon: <WarningRegular className="h-4 w-4" />,
  },
  high: {
    labelKey: "ai.risk.high",
    bg: "bg-red-50 dark:bg-red-900/20",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-200 dark:border-red-800",
    icon: <WarningRegular className="h-4 w-4" />,
  },
};

function SourcesSection({
  sources,
  coverage,
}: {
  sources: AiSource[];
  coverage: number;
}) {
  const [open, setOpen] = useState(true);
  const { t } = useTranslation("diff");
  const percentFormatter = useNumberFormatter({ maximumFractionDigits: 0 });
  const confidenceFormatter = useNumberFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const empty = sources.length === 0;
  return (
    <div className="border-b border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
      >
        <span className="flex items-center gap-2">
          <BookOpenRegular className="h-4 w-4 text-slate-400" />
          {t('ai.sourcesTitle')}
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {sources.length}
          </span>
          {!empty && (
            <span className="text-xs font-normal text-slate-400">
              · {t('ai.coverage', { percent: percentFormatter.format(coverage * 100) })}
            </span>
          )}
        </span>
        {open ? (
          <ChevronDownRegular className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRightRegular className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="px-6 pb-3">
          {empty ? (
            <p className="text-xs text-orange-600 dark:text-orange-400">
              {t('ai.noSourcesAdvisory')}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {sources.map((s, idx) => {
                const style = sourceKindStyle[s.kind];
                const chip = (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${style}`}
                    title={t('ai.confidence', { value: confidenceFormatter.format(s.confidence) })}
                  >
                    <span className="font-semibold uppercase tracking-wide">
                      {s.kind}
                    </span>
                    <span>{s.label}</span>
                  </span>
                );
                return (
                  <li key={`${s.kind}-${s.label}-${idx}`}>
                    {s.url ? (
                      <ExternalLink
                        href={s.url}
                        className="hover:opacity-80"
                      >
                        {chip}
                      </ExternalLink>
                    ) : (
                      chip
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function AiAnalysisPanel({ analysis, isLoading, overrideSummary }: AiAnalysisPanelProps) {
  const [showWork, setShowWork] = useState(false);
  const { t } = useTranslation("diff");
  const percentFormatter = useNumberFormatter({ maximumFractionDigits: 0 });
  const confidenceFormatter = useNumberFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 px-6 py-4">
          <Spinner size="extra-small" />
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {t('ai.analyzing')}
          </span>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  const risk = riskConfig[analysis.riskLevel];
  const provenance = analysis.provenance;
  const sources = provenance?.sources ?? [];
  const coverage = provenance?.citationCoverage ?? 0;
  const lowConfidence = sources.length === 0 || coverage < 0.5;

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <SparkleRegular className="h-5 w-5 text-blue-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('ai.title')}
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {t('ai.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowWork((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            aria-pressed={showWork}
            aria-label={t('ai.showWork')}
          >
            {showWork ? <EyeOffRegular className="h-3.5 w-3.5" /> : <EyeRegular className="h-3.5 w-3.5" />}
            {t('ai.showWork')}
          </button>
          {/* Risk badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${risk.bg} ${risk.text} ${risk.border}`}
          >
            {risk.icon}
            {t(risk.labelKey)}
          </span>
        </div>
      </div>

      {/* Sources / bibliography */}
      <SourcesSection sources={sources} coverage={coverage} />

      {/* Low-confidence banner */}
      {lowConfidence && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <WarningRegular className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {t('ai.lowConfidence')}{' '}
            {sources.length === 0
              ? t('ai.noSourcesCited')
              : t('ai.citationCoverageValue', { percent: percentFormatter.format(coverage * 100) })}
          </span>
        </div>
      )}

      {/* Show-your-work panel */}
      {showWork && (
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-900/60">
          <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
{`${t('ai.inputFingerprint')}: ${inputFingerprint(analysis)}
${t('ai.sources')} (${sources.length}):
${sources.map((s) => `  - [${s.kind}] ${s.label}${s.url ? ` <${s.url}>` : ""} (conf=${confidenceFormatter.format(s.confidence)})`).join("\n") || `  ${t('ai.none')}`}
${t('ai.citationCoverage')}: ${confidenceFormatter.format(coverage)}`}
          </pre>
        </div>
      )}

      {/* Summary — prefer matrix-derived override so the AI panel's
          numbers match the Resource Changes panel exactly. */}
      <div className="flex items-start gap-3 px-6 py-4">
        <InfoRegular className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {overrideSummary ?? analysis.summary}
        </p>
      </div>

      {/* Resource list sections moved to the dedicated ResourceChangesPanel
          on the Diff page so we don't render the same data twice. This
          AI panel now owns: risk level (header), summary, sources. */}
    </div>
  );
}
