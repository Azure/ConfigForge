// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  ArrowLeftRegular,
  ArrowDownloadRegular,
  DocumentRegular,
  ShieldCheckmarkRegular,
  ShieldErrorRegular,
  ShieldDismissRegular,
  CheckmarkCircleRegular,
  SubtractCircleRegular,
} from "@fluentui/react-icons";
import { MessageBar, MessageBarBody, MessageBarTitle, Spinner } from "@fluentui/react-components";
import { useCisAvailable } from "../components/use-cis-available";
import { cfs } from "../lib/cfs";
import { useTranslation } from "react-i18next";

type ComplianceStatus = "matched" | "mismatched" | "missing";

interface PerRule {
  ruleName: string;
  status: ComplianceStatus;
  myValue?: unknown;
  expected?: unknown;
  type?: string;
  severity: string;
  gpoPath?: string | null;
  ruleId?: string;
}

interface ComplianceReport {
  matched: number;
  mismatched: number;
  missing: number;
  score: number;
  total: number;
  severityBreakdown: Record<string, { matched: number; mismatched: number; missing: number }>;
  perRule: PerRule[];
  extras: Array<{ ruleName: string; type?: string }>;
}

interface ComplianceResponse {
  manifest: string;
  against: string;
  baselineName: string;
  generatedAt: string;
  report: ComplianceReport;
}

const CIS_BASELINES: { id: string; label: string }[] = [
  { id: "cis-ws2025-ms", label: "CIS WS2025 - Member Server" },
  { id: "cis-ws2025-dc", label: "CIS WS2025 - Domain Controller" },
  { id: "cis-ws2022-ms", label: "CIS WS2022 - Member Server" },
  { id: "cis-ws2022-dc", label: "CIS WS2022 - Domain Controller" },
  { id: "cis-ws2019-ms", label: "CIS WS2019 - Member Server" },
  { id: "cis-ws2019-dc", label: "CIS WS2019 - Domain Controller" },
  { id: "cis-ws2016-ms", label: "CIS WS2016 - Member Server" },
  { id: "cis-ws2016-dc", label: "CIS WS2016 - Domain Controller" },
];

function scoreColor(score: number): { ring: string; text: string; label: string } {
  if (score >= 90)
    return {
      ring: "stroke-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
      label: "Strong",
    };
  if (score >= 70)
    return {
      ring: "stroke-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      label: "Partial",
    };
  return { ring: "stroke-red-500", text: "text-red-600 dark:text-red-400", label: "Low" };
}

function severityBadgeClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "critical") return "bg-red-900/60 text-red-300 border-red-800";
  if (s === "important") return "bg-amber-900/60 text-amber-300 border-amber-800";
  if (s === "warning") return "bg-yellow-900/60 text-yellow-300 border-yellow-800";
  if (s === "informational") return "bg-blue-900/60 text-blue-300 border-blue-800";
  return "bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-700";
}

type Tab = "matched" | "mismatched" | "missing" | "extras";

export function ManifestCompliancePage() {
  const { t } = useTranslation("compliance");
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const manifestName = decodeURIComponent(params.id ?? "");
  const initialAgainst = searchParams.get("against") ?? "cis-ws2025-ms";
  const cisAvailable = useCisAvailable();

  const [against, setAgainst] = useState(initialAgainst);
  const [data, setData] = useState<ComplianceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("missing");
  const [downloading, setDownloading] = useState(false);

  // v0.1.13 fix — race-condition guard. The compliance fetch runs
  // whenever `against` changes (user toggles to a different reference
  // baseline). If the user rapid-switches between baselines, the
  // fetches race: a slow fetch for baseline A can resolve AFTER a
  // fast fetch for baseline B and overwrite the (correct) B data
  // with A's data, leaving the UI showing "Comparing against WS2022"
  // in the dropdown but actually rendering the WS2025 diff. We
  // snapshot the (manifest, against) tuple of each request and bail
  // in the resolution handler if the live tuple has moved on.
  const requestTokenRef = useRef<string>("");
  const liveTokenRef = useRef<string>("");
  liveTokenRef.current = `${manifestName}|${against}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = `${manifestName}|${against}`;
    requestTokenRef.current = token;
    try {
      const body = await cfs.compliance.report({ manifest: manifestName, against });
      if (token !== liveTokenRef.current) return;
      setData(body as ComplianceResponse);
    } catch (e: unknown) {
      if (token !== liveTokenRef.current) return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (token === liveTokenRef.current) setLoading(false);
    }
  }, [manifestName, against]);

  useEffect(() => {
    // Don't fire the request if we already know CIS data isn't bundled —
    // we'll render the friendly empty state instead.
    if (cisAvailable === false) {
      setLoading(false);
      return;
    }
    if (cisAvailable === null) return; // wait for the status check
    void load();
  }, [load, cisAvailable]);

  const downloadMarkdown = useCallback(async () => {
    if (!data) return;
    setDownloading(true);
    try {
      const md = renderMarkdown(data);
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${manifestName}-${data.against}-audit.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, [data, manifestName]);

  const filtered = useMemo<PerRule[]>(() => {
    if (!data) return [];
    if (tab === "extras") return [];
    return data.report.perRule.filter((r) => r.status === tab);
  }, [data, tab]);

  // ── CIS unavailable: friendly empty state ───────────────────────────
  if (cisAvailable === false) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60 px-6 py-4">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Link
              to={`/manifests/${encodeURIComponent(manifestName)}`}
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeftRegular className="h-4 w-4" />
              {t("perManifest.extracted.text1")}
            </Link>
            <h1 className="ml-4 truncate text-lg font-semibold">
              <ShieldCheckmarkRegular className="mr-2 inline h-5 w-5 text-slate-500" />
              {t("perManifest.extracted.text2")}
              {manifestName}
            </h1>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-lg border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 p-8 text-center">
            <SubtractCircleRegular className="mx-auto mb-3 h-10 w-10 text-slate-500" />
            <h2 className="mb-2 text-lg font-semibold text-slate-700 dark:text-slate-200">
              {t("perManifest.extracted.text3")}
            </h2>
            <p className="mx-auto mb-4 max-w-xl text-sm text-slate-500 dark:text-slate-400">
              {t("perManifest.extracted.text4")}
            </p>
            <p className="mb-6 text-xs text-slate-500">
              {t("perManifest.extracted.text5")}{" "}
              <code className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                public/_baselines/cis/README.md
              </code>{" "}
              {t("perManifest.extracted.text6")}
            </p>
            <Link
              to={`/manifests/${encodeURIComponent(manifestName)}/audit-pack`}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
            >
              <DocumentRegular className="h-3.5 w-3.5" />
              {t("perManifest.extracted.text7")}
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const score = data?.report.score ?? 0;
  const sc = scoreColor(score);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link
            to={`/manifests/${encodeURIComponent(manifestName)}`}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeftRegular className="h-4 w-4" />
            {t("perManifest.extracted.text8")}
          </Link>
          <h1 className="ml-4 truncate text-lg font-semibold">
            <ShieldCheckmarkRegular className="mr-2 inline h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {t("perManifest.extracted.text9")}
            {manifestName}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              {t("perManifest.extracted.text10")}
            </label>
            <select
              value={against}
              onChange={(e) => setAgainst(e.target.value)}
              className="rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-2 py-1 text-xs"
            >
              {CIS_BASELINES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <button
              onClick={downloadMarkdown}
              disabled={!data || downloading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700 disabled:opacity-40"
            >
              {downloading ? (
                <Spinner size="tiny" />
              ) : (
                <ArrowDownloadRegular className="h-3.5 w-3.5" />
              )}
              {t("perManifest.extracted.text11")}
            </button>
            <Link
              to={`/manifests/${encodeURIComponent(manifestName)}/audit-pack?against=${encodeURIComponent(against)}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
            >
              <DocumentRegular className="h-3.5 w-3.5" />
              {t("perManifest.extracted.text12")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {loading && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Spinner size="tiny" />
            {t("perManifest.extracted.text13")}
          </div>
        )}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>{t("perManifest.extracted.text14")}</MessageBarTitle>
              {error}
            </MessageBarBody>
          </MessageBar>
        )}
        {!loading && !error && data && (
          <div className="space-y-6">
            {/* Score + summary */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
              <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 p-6">
                <ScoreRing score={score} colorClass={sc.ring} textClass={sc.text} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  icon={
                    <CheckmarkCircleRegular className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  }
                  label={t("perManifest.extracted.text15")}
                  value={data.report.matched}
                />
                <Stat
                  icon={<ShieldDismissRegular className="h-4 w-4 text-red-600 dark:text-red-400" />}
                  label={t("perManifest.extracted.text16")}
                  value={data.report.mismatched}
                />
                <Stat
                  icon={
                    <SubtractCircleRegular className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  }
                  label={t("perManifest.extracted.text17")}
                  value={data.report.missing}
                />
                <Stat
                  icon={<ShieldErrorRegular className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                  label={t("perManifest.extracted.text18")}
                  value={data.report.extras.length}
                />
                <div className="col-span-2 sm:col-span-4 rounded-md border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 p-3 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {data.baselineName}
                  </span>
                  {" - "}
                  {t("perManifest.extracted.text19")}
                  <span className={sc.text}>{sc.label}</span>
                  {t("perManifest.extracted.text20")}
                  {data.report.total}
                </div>
              </div>
            </section>

            {/* Severity breakdown */}
            <section className="rounded-lg border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                {t("perManifest.extracted.text21")}
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(data.report.severityBreakdown).map(([sev, b]) => {
                  const total = b.matched + b.mismatched + b.missing;
                  const pct = total === 0 ? 0 : Math.round((b.matched / total) * 100);
                  return (
                    <div
                      key={sev}
                      className="rounded-md border border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-900/60 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${severityBadgeClass(sev)}`}
                        >
                          {sev}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{pct}%</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {b.matched}
                          {t("perManifest.extracted.text22")}
                        </span>
                        {" · "}
                        <span className="text-red-600 dark:text-red-400">
                          {b.mismatched}
                          {t("perManifest.extracted.text23")}
                        </span>
                        {" · "}
                        <span className="text-amber-600 dark:text-amber-400">
                          {b.missing}
                          {t("perManifest.extracted.text24")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Tabs */}
            <section>
              <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
                <TabButton active={tab === "missing"} onClick={() => setTab("missing")}>
                  {t("perManifest.extracted.text25")}
                  {data.report.missing})
                </TabButton>
                <TabButton active={tab === "mismatched"} onClick={() => setTab("mismatched")}>
                  {t("perManifest.extracted.text26")}
                  {data.report.mismatched})
                </TabButton>
                <TabButton active={tab === "matched"} onClick={() => setTab("matched")}>
                  {t("perManifest.extracted.text27")}
                  {data.report.matched})
                </TabButton>
                <TabButton active={tab === "extras"} onClick={() => setTab("extras")}>
                  {t("perManifest.extracted.text28")}
                  {data.report.extras.length})
                </TabButton>
              </div>
              <div className="mt-4">
                {tab === "extras" ? (
                  <ExtrasList extras={data.report.extras} />
                ) : (
                  <RulesTable rows={filtered} status={tab} />
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function ScoreRing({
  score,
  colorClass,
  textClass,
}: {
  score: number;
  colorClass: string;
  textClass: string;
}) {
  const { t } = useTranslation("compliance");
  const r = 70;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <svg viewBox="0 0 180 180" className="h-44 w-44">
      <circle cx="90" cy="90" r={r} className="fill-none stroke-slate-800" strokeWidth="14" />
      <circle
        cx="90"
        cy="90"
        r={r}
        className={`fill-none ${colorClass}`}
        strokeWidth="14"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 90 90)"
      />

      <text
        x="90"
        y="92"
        textAnchor="middle"
        className={`fill-current ${textClass} text-3xl font-bold`}
      >
        {score}%
      </text>
      <text
        x="90"
        y="112"
        textAnchor="middle"
        className="fill-slate-400 text-[10px] uppercase tracking-widest"
      >
        {t("perManifest.extracted.text30")}
      </text>
    </svg>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 p-3">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-t-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-slate-800 text-slate-100"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function RulesTable({ rows, status }: { rows: PerRule[]; status: ComplianceStatus }) {
  const { t } = useTranslation("compliance");
  if (rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400">
        {t("perManifest.extracted.text31")}
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-slate-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-900/60 text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2">{t("perManifest.extracted.text32")}</th>
            <th className="px-3 py-2">{t("perManifest.extracted.text33")}</th>
            {status !== "missing" && (
              <th className="px-3 py-2">{t("perManifest.extracted.text35")}</th>
            )}
            <th className="px-3 py-2">{t("perManifest.extracted.text36")}</th>
            <th className="px-3 py-2">{t("perManifest.extracted.text37")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-800 align-top">
              <td className="px-3 py-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${severityBadgeClass(r.severity)}`}
                >
                  {r.severity}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="text-slate-700 dark:text-slate-200">{r.ruleName}</div>
                {r.type && <div className="text-[10px] text-slate-500">{r.type}</div>}
              </td>
              {status !== "missing" && (
                <td className="px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  {r.myValue === undefined ? "-" : JSON.stringify(r.myValue)}
                </td>
              )}
              <td className="px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                {r.expected === undefined ? "-" : JSON.stringify(r.expected)}
              </td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.gpoPath ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExtrasList({ extras }: { extras: Array<{ ruleName: string; type?: string }> }) {
  const { t } = useTranslation("compliance");
  if (extras.length === 0) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400">
        {t("perManifest.extracted.text39")}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-slate-800">
      <ul className="divide-y divide-slate-800">
        {extras.map((e, i) => (
          <li key={i} className="px-3 py-2 text-xs">
            <div className="text-slate-700 dark:text-slate-200">{e.ruleName}</div>
            {e.type && <div className="text-[10px] text-slate-500">{e.type}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderMarkdown(data: ComplianceResponse): string {
  const out: string[] = [];
  const r = data.report;
  out.push(`# Compliance Audit Pack: ${data.manifest}`);
  out.push("");
  out.push(`- **Baseline:** \`${data.against}\` (${data.baselineName})`);
  out.push(`- **Generated:** ${data.generatedAt}`);
  out.push(`- **Score:** ${r.score}% (${r.matched} / ${r.total})`);
  out.push(`- **Matched:** ${r.matched}`);
  out.push(`- **Mismatched:** ${r.mismatched}`);
  out.push(`- **Missing:** ${r.missing}`);
  out.push(`- **Extras:** ${r.extras.length}`);
  out.push("");
  out.push("## Severity Breakdown");
  out.push("");
  out.push("| Severity | Matched | Mismatched | Missing |");
  out.push("| --- | ---: | ---: | ---: |");
  for (const [sev, b] of Object.entries(r.severityBreakdown)) {
    out.push(`| ${sev} | ${b.matched} | ${b.mismatched} | ${b.missing} |`);
  }
  out.push("");
  out.push("## Rules");
  out.push("");
  out.push("| Status | Severity | Rule | GPO Path | My Value | Expected |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of r.perRule) {
    const my = row.myValue === undefined ? "" : "`" + JSON.stringify(row.myValue) + "`";
    const exp = row.expected === undefined ? "" : "`" + JSON.stringify(row.expected) + "`";
    const gpo = row.gpoPath ? row.gpoPath.replace(/\|/g, "\\|") : "";
    const name = row.ruleName.replace(/\|/g, "\\|");
    out.push(`| ${row.status} | ${row.severity} | ${name} | ${gpo} | ${my} | ${exp} |`);
  }
  if (r.extras.length > 0) {
    out.push("");
    out.push("## Extras");
    out.push("");
    for (const e of r.extras) {
      out.push(`- ${e.ruleName}${e.type ? ` _(${e.type})_` : ""}`);
    }
  }
  return out.join("\n") + "\n";
}
