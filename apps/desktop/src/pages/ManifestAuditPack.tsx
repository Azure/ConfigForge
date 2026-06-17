// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR28: /manifests/[id]/audit-pack
 *
 * Auditor-friendly download surface. Two prominent buttons (PDF primary,
 * Markdown secondary) plus an inline iframe preview for the PDF.
 * Sidebar shows what's in the pack with availability checkmarks.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Breadcrumb } from "../components/Breadcrumb";
import {
  ArrowLeftRegular,
  DocumentRegular,
  ArrowDownloadRegular,
  CheckmarkCircleRegular,
  CircleHintRegular,
} from "@fluentui/react-icons";
import { MessageBar, MessageBarBody, MessageBarTitle, Spinner } from "@fluentui/react-components";
import { cfs } from "../lib/cfs";
import { HAS_DEVICE_AUDIT } from "../lib/flavor";
import { useTranslation } from "react-i18next";

interface Availability {
  history: boolean;
  rationale: boolean;
  /** v0.1.6: derived from the last persisted device-audit run OR the
   *  legacy `?against=<id>` query param. Either is sufficient to show
   *  Compliance content in the PDF. */
  compliance: boolean;
}

interface ManifestSummary {
  namespace: string;
  displayName: string;
  platform: string;
  registered: boolean;
  historyCount: number;
}

export function AuditPackPage() {
  const { t } = useTranslation("audit-pack");
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const manifestName = useMemo(() => decodeURIComponent(params?.id ?? ""), [params?.id]);
  const against = searchParams.get("against");

  // The cfs-blob:// protocol handler(apps/desktop/electron/protocol-handler.ts)
  // serves the audit-pack PDF inline so the iframe renders it without a
  // disk save. The download buttons go through cfs.auditPack.save which
  // shows a native file-save dialog.
  const previewUrl = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("format", "pdf");
    if (against) qs.set("against", against);
    return `cfs-blob://audit-pack/${encodeURIComponent(manifestName)}?${qs.toString()}`;
  }, [manifestName, against]);

  // v0.1.13 fix — track in-flight download state per format so the
  // user can't spam-click and queue up multiple native Save-As
  // dialogs (which on Win stack and require dismissing in order;
  // on Linux the second one can silently overwrite the first
  // depending on the destination). Previously handleDownload had
  // no `downloading` state and the buttons were always clickable.
  const [downloadingFormat, setDownloadingFormat] = useState<"pdf" | "markdown" | null>(null);

  const handleDownload = async (format: "pdf" | "markdown") => {
    if (downloadingFormat !== null) return;

    // v0.3.0 (#24): one-shot PII warning before the audit-pack
    // download. The pack embeds the hostname (and a generated-at
    // timestamp) into the rendered PDF / Markdown; customers
    // routinely share these with external auditors, ticket
    // systems, or third-party reviewers. Surface the disclosure
    // BEFORE the native save dialog so the user can decide
    // whether to redact the hostname in their org's workflow.
    // Stored dismissal lives in localStorage so the cohort sees
    // the warning once per machine.
    const PII_WARN_KEY = "cfs.auditpack.pii-warning.dismissedAt";
    let piiWarningDismissed = false;
    try {
      piiWarningDismissed = !!window.localStorage.getItem(PII_WARN_KEY);
    } catch {
      // localStorage unavailable; show the warning to be safe
    }
    if (!piiWarningDismissed) {
      const hostname =
        (summary as { Hostname?: string } | null)?.Hostname ??
        (typeof window !== "undefined" && (window as unknown as { hostname?: string }).hostname) ??
        "your machine";
      const proceed = window.confirm(
        `This audit pack includes your machine's hostname (${hostname}) and the generation timestamp. ` +
          `Before sharing outside your organisation, redact or remove the hostname if it's sensitive.\n\n` +
          `Click OK to continue, or Cancel to abort.\n\n` +
          `(Tip: this notice is shown once per device. Your choice is remembered.)`,
      );
      if (!proceed) return;
      try {
        window.localStorage.setItem(PII_WARN_KEY, new Date().toISOString());
      } catch {
        /* swallow — the dismissal will re-show next time, harmless */
      }
    }

    setDownloadingFormat(format);
    try {
      await cfs.auditPack.save({
        id: manifestName,
        format,
        ...(against ? { against } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingFormat(null);
    }
  };

  const [summary, setSummary] = useState<ManifestSummary | null>(null);
  const [availability, setAvailability] = useState<Availability>({
    history: false,
    rationale: false,
    compliance: !!against,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // v0.1.14: switched from `cfs.manifests.list({ includeResources:
        // true })` to `cfs.manifests.get(manifestName)`. The list
        // endpoint serializes EVERY manifest (~5-10 MB on a
        // 50-manifest tenant) just so we can find the one matching
        // `manifestName` for its display name + platform. `.get`
        // returns the single manifest directly. Same data, ~50×
        // less serialization on a busy tenant. (Perf medium from
        // the v0.1.13 edge-case backlog.)
        const auditPromise: Promise<{ snapshot?: unknown } | null> = HAS_DEVICE_AUDIT
          ? (cfs.auditResults!.get(manifestName) as Promise<{ snapshot?: unknown }>)
          : Promise.resolve(null);
        const [manifestRes, historyRes, rationaleRes, auditRes] = await Promise.allSettled([
          cfs.manifests.get(manifestName),
          cfs.history.list({ name: manifestName }),
          cfs.rationale.list(manifestName),
          auditPromise,
        ]);

        // v0.1.11 fix — log any rejected branches so a broken IPC
        // channel actually shows up in DevTools / main.log instead
        // of silently dropping the sidebar checkmark or compliance
        // table. Same pattern bit us hard in v0.1.10 (the
        // audit-results dynamic-import bug stayed invisible for
        // several releases because the rejection was swallowed).
        if (manifestRes.status === "rejected") {
          console.error("[AuditPack] cfs.manifests.get failed:", manifestRes.reason);
        }
        if (historyRes.status === "rejected") {
          console.error("[AuditPack] cfs.history.list failed:", historyRes.reason);
        }
        if (rationaleRes.status === "rejected") {
          console.error("[AuditPack] cfs.rationale.list failed:", rationaleRes.reason);
        }
        if (auditRes.status === "rejected") {
          console.error("[AuditPack] cfs.auditResults.get failed:", auditRes.reason);
        }

        let registered = false;
        let displayName = manifestName;
        let platform = "unknown";
        if (manifestRes.status === "fulfilled") {
          const body = manifestRes.value;
          const match = body.data;
          if (match) {
            registered = true;
            displayName = match.DisplayName ?? match.Name ?? manifestName;
            platform = match.Platform ?? platform;
          }
        }

        let historyCount = 0;
        if (historyRes.status === "fulfilled") {
          const body = historyRes.value as { data?: unknown[] };
          historyCount = Array.isArray(body.data) ? body.data.length : 0;
        }

        let rationaleCount = 0;
        if (rationaleRes.status === "fulfilled") {
          const body = rationaleRes.value as { entries?: unknown[] };
          rationaleCount = Array.isArray(body.entries) ? body.entries.length : 0;
        }

        let hasDeviceAudit = false;
        if (auditRes.status === "fulfilled") {
          const body = auditRes.value as { snapshot?: unknown };
          hasDeviceAudit = body.snapshot != null;
        }

        if (cancelled) return;
        setSummary({
          namespace: manifestName,
          displayName,
          platform,
          registered,
          historyCount,
        });
        setAvailability({
          history: historyCount > 0,
          rationale: rationaleCount > 0,
          compliance: hasDeviceAudit || !!against,
        });
        if (!registered) {
          setError(`Baseline "${manifestName}" is not registered.`);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [manifestName, against]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link
            to={`/manifests/${encodeURIComponent(manifestName)}`}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeftRegular className="h-4 w-4" />
            {t("extracted.text1")}
          </Link>
          <h1 className="ml-4 truncate text-lg font-semibold">
            <DocumentRegular className="mr-2 inline h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {t("extracted.text2")}
            {summary?.displayName ?? manifestName}
          </h1>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_280px]">
        <section className="space-y-4">
          <Breadcrumb
            items={[
              { label: "Baselines", to: "/manifests" },
              { label: manifestName, to: `/manifests/${encodeURIComponent(manifestName)}` },
              { label: "Audit Pack" },
            ]}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleDownload("pdf")}
              disabled={downloadingFormat !== null}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloadingFormat === "pdf" ? (
                <Spinner size="tiny" />
              ) : (
                <ArrowDownloadRegular className="h-4 w-4" />
              )}
              {downloadingFormat === "pdf" ? t("extracted.text5") : t("extracted.text6")}
            </button>
            <button
              type="button"
              onClick={() => handleDownload("markdown")}
              disabled={downloadingFormat !== null}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {downloadingFormat === "markdown" ? (
                <Spinner size="tiny" />
              ) : (
                <ArrowDownloadRegular className="h-4 w-4" />
              )}
              {downloadingFormat === "markdown" ? t("extracted.text9") : t("extracted.text10")}
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Spinner size="tiny" />
              {t("extracted.text11")}
            </div>
          )}
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>{t("extracted.text12")}</MessageBarTitle>
                {error}
              </MessageBarBody>
            </MessageBar>
          )}

          {!loading && !error && summary?.registered && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="border-b border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/70 px-4 py-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t("extracted.text13")}
              </div>
              <iframe
                src={previewUrl}
                title={`Audit pack PDF preview for ${summary.displayName}`}
                className="block w-full"
                style={{ height: "80vh" }}
              />
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t("extracted.text14")}
            </h2>
            <ul className="space-y-1 text-xs">
              <Item ok>{t("extracted.text15")}</Item>
              <Item ok={availability.compliance}>
                {t("extracted.text16")}

                {!availability.compliance && (
                  <span className="ml-1 text-slate-500">
                    {t("extracted.text17")}
                    <code className="rounded bg-slate-200 dark:bg-slate-800 px-1">?against=…</code>)
                  </span>
                )}
              </Item>
              <Item ok={availability.history}>
                {t("extracted.text18")}
                {summary ? ` (${summary.historyCount})` : ""}
              </Item>
              <Item ok={availability.rationale}>
                {t("extracted.text19")}

                {!availability.rationale && (
                  <span className="ml-1 text-slate-500">{t("extracted.text20")}</span>
                )}
              </Item>
              {/*
                 v0.1.6: AI citations row removed. The provenance feature
                 was wired through the PDF + Markdown renderers but never
                 connected to a real source — `tryLoadProvenance()` always
                 returned undefined, so the section never rendered, and
                 showing "AI citations (none cached)" implied an
                 infrastructure that didn't exist. When the provenance
                 store is built, restore this row alongside the renderer
                 wiring.
                */}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 p-4 text-xs text-slate-500 dark:text-slate-400">
            <p>{t("extracted.text21")}</p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Item({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  // UI C4: pair the contrast tiers correctly. Previously the included
  // ("ok") items rendered with text-slate-200 (~1.3:1 on bg-white/60,
  // fails WCAG AA) and the missing items got text-slate-400 — semantically
  // inverted (included looked fainter than missing). Now: included reads
  // strong on light, subtle on dark; missing reads muted + opacity-60 in
  // both modes so absence is communicated without dropping below AA.
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckmarkCircleRegular className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CircleHintRegular className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-500" />
      )}
      <span
        className={
          ok
            ? "text-slate-700 dark:text-slate-200"
            : "text-slate-500 dark:text-slate-500 opacity-60"
        }
      >
        {children}
      </span>
    </li>
  );
}
