// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.



import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  parseLosslessYaml,
  stringifyLosslessJson,
} from "@configforge/core/manifest/lossless";
import { ManifestEditor } from "../../components/manifest-editor";
import { DiffViewer } from "../../components/diff-viewer";
import { AiAnalysisPanel } from "../../components/ai-analysis-panel";
import {
  ArrowSwapRegular,
  ArrowUploadRegular,
  GridRegular,
  ArrowDownloadRegular,
  DocumentRegular,
  SearchRegular,
  FilterRegular,
  ShieldCheckmarkRegular,
} from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { analyzeDiff, generateChangelog, renderChangelogMarkdown, type DiffAnalysis } from "@configforge/core/ai/analyzer";
import { normalizeManifestForDiff } from "@configforge/core/manifest-normalize";
import { buildMatrix } from "@configforge/core/diff/matrix";
import type { OscManifest } from "@configforge/core/types";
import { cfs } from "../../lib/cfs";
import { withTimeout, TimeoutError } from "../../lib/with-timeout";
import { useDiffMatrix, type MatrixApiResponse } from "./state/useDiffMatrix";
import { useCisAvailable } from "../../components/use-cis-available";
import { CisDiffTab } from "./components/CisDiffTab";
import {
  clearMatrixDiffLocationState,
  readMatrixDiffLocationState,
  readPairwiseDiffLocationState,
} from "./location-state";

type InputMode = "paste" | "manifest"; // | "system" — commented out for V2
type DiffTab = "pairwise" | "matrix" | "cis-diff";

export function DiffPage() {
  const { t } = useTranslation(["diff", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const [initialMatrixSelection] = useState(() =>
    readMatrixDiffLocationState(location.state),
  );
  const [initialPairwiseSelection] = useState(() =>
    readPairwiseDiffLocationState(location.state),
  );
  useEffect(() => {
    const consumed = clearMatrixDiffLocationState(location.state);
    if (!consumed.consumed) return;
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { replace: true, state: consumed.state },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);
  const [leftText, setLeftText] = useState("");
  const [rightText, setRightText] = useState("");
  // Default to the manifest picker; we flip to 'paste' automatically if the
  // list comes back empty so the upload/paste UI is still the first thing a
  // user sees when they have nothing registered.
  const [leftMode, setLeftMode] = useState<InputMode>("manifest");
  const [rightMode, setRightMode] = useState<InputMode>("manifest");
  const [showDiff, setShowDiff] = useState(false);

  const [manifests, setManifests] = useState<OscManifest[]>([]);
  const cisAvailable = useCisAvailable();
  const [loadingManifests, setLoadingManifests] = useState(false);
  const [leftManifest, setLeftManifest] = useState(initialPairwiseSelection[0] ?? "");
  const [rightManifest, setRightManifest] = useState(initialPairwiseSelection[1] ?? "");

  // AI analysis state
  const [analysis, setAnalysis] = useState<DiffAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [loadingLeft, setLoadingLeft] = useState(false);
  const [loadingRight, setLoadingRight] = useState(false);
  // v0.2.21: page-level error surface. The Diff page previously
  // swallowed both the analysis-loop and manifest-list errors with
  // empty catch blocks, leaving the user with an unexplained empty
  // state. This banner channel surfaces them in a small MessageBar.
  const [pageError, setPageError] = useState<string | null>(null);
  const setError = setPageError;

  // Per-page cache of manifest YAML bodies so flipping between manifests in
  // the dropdown is instant after the first fetch. Bucketed by namespace.
  const [contentCache] = useState<Map<string, string>>(() => new Map());

  // ── Matrix tab state (PR23) ─────────────────────────────────────────────
  // Owned by useDiffMatrix: selection, fetched data, loading/error,
  // race-guard token, toggle handler, runMatrixCompare, downloadMatrixXlsx,
  // and the 10-cap constant.
  const [activeTab, setActiveTab] = useState<DiffTab>(() =>
    initialMatrixSelection.length > 0 ? "matrix" : "pairwise",
  );
  const {
    matrixSelected,
    matrixData,
    matrixLoading,
    matrixError,
    toggleMatrixSelection,
    reconcileMatrixSelection,
    runMatrixCompare: handleMatrixCompare,
    downloadMatrixXlsx,
  } = useDiffMatrix({ initialSelected: initialMatrixSelection });

  // v0.1.13 fix — token refs so rapid switches between manifests for
  // the left/right side don't race. Previously a slow fetch for
  // manifest A could resolve AFTER a fast fetch for manifest B and
  // overwrite leftText/rightText with the wrong content. The matrix
  // race-guard now lives inside useDiffMatrix.
  const leftLoadTokenRef = useRef(0);
  const rightLoadTokenRef = useRef(0);
  const pairwisePreselectionCancelledRef = useRef(false);
  const invalidateSideLoad = useCallback((side: "left" | "right") => {
    const tokenRef = side === "left" ? leftLoadTokenRef : rightLoadTokenRef;
    tokenRef.current += 1;
    if (side === "left") setLoadingLeft(false);
    else setLoadingRight(false);
    pairwisePreselectionCancelledRef.current = true;
  }, []);
  const handleManualTextChange = useCallback(
    (value: string, side: "left" | "right") => {
      invalidateSideLoad(side);
      if (side === "left") setLeftText(value);
      else setRightText(value);
    },
    [invalidateSideLoad],
  );
  // v0.3.47: Compare button sits in the middle of the form; on smaller
  // windows the diff output renders below the fold and users assume
  // nothing happened. Auto-scroll into view once results are visible.
  const diffResultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showDiff && leftText && rightText) {
      diffResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showDiff, leftText, rightText]);

  const handleCompare = () => {
    setShowDiff(true);
    setAnalysisLoading(true);
    // v0.1.14: actually run analysis off the main thread by deferring
    // through requestAnimationFrame. Previously the comment claimed
    // async but the call was synchronous between two setStates — for
    // a 1 000+ resource manifest that blocked the main thread ~200 ms+
    // (no spinner painted, no Cancel button responsive). Wrapping in
    // rAF yields to the browser long enough to paint the spinner
    // before analyzeDiff runs, so the user sees progress immediately.
    // analyzeDiff is still synchronous so this doesn't help for
    // 10K-resource manifests — those need a web worker — but it
    // covers the realistic 360-resource WS2025 case cleanly. (Perf
    // medium from the v0.1.13 edge-case backlog.)
    requestAnimationFrame(() => {
      try {
        const result = analyzeDiff(normLeft, normRight);
        setAnalysis(result);
      } catch (err) {
        // v0.2.21: previously swallowed silently — a corrupt YAML
        // input would just produce a blank analysis panel with no
        // explanation. Surface the parse/analysis error so the user
        // knows the diff couldn't complete.
        setAnalysis(null);
        setError(err instanceof Error ? err.message : t("errors.analyzeFailed"));
      } finally {
        setAnalysisLoading(false);
      }
    });
  };

  const handleDownloadChangelog = () => {
    try {
      const name = leftManifest || rightManifest || "baseline";
      const beforeLabel = leftManifest || "before";
      const afterLabel = rightManifest || "after";
      const result = generateChangelog(normLeft, normRight, name);
      const md = renderChangelogMarkdown(result, { beforeLabel, afterLabel });

      const today = new Date().toISOString().split("T")[0];
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filename = `${safeName}-changelog-${today}.md`;

      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.analyzeFailed"));
    }
  };

  // Fetch manifests for dropdown
  const fetchManifests = useCallback(async () => {
    setLoadingManifests(true);
    try {
      // v0.3.53: 10s timeout guards against a wedged main-process
      // handler (stuck disk I/O, leaked semaphore, etc.) that would
      // otherwise leave `loadingManifests` true forever. The original
      // bug let the dropdown stay clickable visually but our gating
      // logic (now removed) disabled it — symptom was "dropdown
      // doesn't pop up, persists until restart". Even with the
      // disable removed, surfacing a real error is far better than
      // a silent permanent "Loading…" placeholder.
      const json = await withTimeout(
        cfs.manifests.list({}),
        10_000,
        t('errors.loadManifestsFailed'),
      );
      const data = (json as { data?: unknown }).data;
      if (data) {
        const raw: unknown[] = Array.isArray(data) ? data : [data];
        const normalized = raw
          .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
          .map((m) => ({
            Name: String(m.Name ?? m.name ?? ""),
            Source: String(m.Source ?? m.source ?? ""),
            Resources: (m.Resources ?? m.resources ?? []) as OscManifest["Resources"],
          }))
          .filter((m) => m.Name);
        reconcileMatrixSelection(normalized.map((manifest) => manifest.Name));
        setManifests(normalized);
        if (normalized.length === 0) {
          setLeftMode("paste");
          setRightMode("paste");
        }
      }
    } catch (err) {
      // v0.2.21: previously swallowed silently. A genuine IPC
      // failure (e.g. one of the manifests was deleted externally
      // and the list handler throws) was indistinguishable from a
      // clean empty-state. Surface the error so the user sees
      // something actionable.
      if (err instanceof TimeoutError) {
        setError(
          t("errors.loadManifestsTimeout"),
        );
      } else {
        setError(err instanceof Error ? err.message : t("errors.loadManifestsFailed"));
      }
    } finally {
      setLoadingManifests(false);
    }
  }, [reconcileMatrixSelection, t]);

  useEffect(() => {
    fetchManifests();
  }, [fetchManifests]);

  const loadManifestContent = useCallback(async (
    name: string,
    side: "left" | "right",
  ) => {
    const setText = side === "left" ? setLeftText : setRightText;
    const cached = contentCache.get(name);
    if (cached !== undefined) {
      setText(cached);
      return;
    }
    const setLoading = side === "left" ? setLoadingLeft : setLoadingRight;
    const tokenRef = side === "left" ? leftLoadTokenRef : rightLoadTokenRef;
    const token = ++tokenRef.current;
    setLoading(true);
    try {
      const artifact = await cfs.exportChannel.get({ name, format: 'yaml' });
      // Bail if user switched to a different manifest for this side
      // while this fetch was in flight; the newer fetch is the
      // source of truth for what to display.
      if (token !== tokenRef.current) return;
      const content = typeof artifact.body === 'string'
        ? artifact.body
        : new TextDecoder().decode(artifact.body);
      contentCache.set(name, content);
      setText(content);
    } catch (err) {
      if (token !== tokenRef.current) return;
      const msg = err instanceof Error ? err.message : t('errors.network');
      setText(`# Failed to load baseline "${name}"\n# ${msg}`);
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, [contentCache, t]);

  const pairwisePreselectionAppliedRef = useRef(false);
  useEffect(() => {
    if (
      pairwisePreselectionAppliedRef.current ||
      pairwisePreselectionCancelledRef.current ||
      initialPairwiseSelection.length !== 2 ||
      manifests.length === 0
    ) {
      return;
    }
    const available = new Set(manifests.map((manifest) => manifest.Name));
    const [left, right] = initialPairwiseSelection;
    if (!available.has(left) || !available.has(right)) return;

    pairwisePreselectionAppliedRef.current = true;
    void Promise.all([
      loadManifestContent(left, "left"),
      loadManifestContent(right, "right"),
    ]);
  }, [initialPairwiseSelection, loadManifestContent, manifests]);

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    side: "left" | "right"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    invalidateSideLoad(side);
    const tokenRef = side === "left" ? leftLoadTokenRef : rightLoadTokenRef;
    const token = tokenRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== tokenRef.current) return;
      const text = reader.result as string;
      if (side === "left") setLeftText(text);
      else setRightText(text);
    };
    reader.readAsText(file);
  };

  /* System config — commented out for V2
  const loadSystemConfig = async (
    name: string,
    side: "left" | "right"
  ) => {
    const setLoading = side === "left" ? setLoadingLeft : setLoadingRight;
    const setText = side === "left" ? setLeftText : setRightText;
    setLoading(true);
    setText("# Loading system config for: " + name + "...\n");
    try {
      const res = await fetch(
        `/api/system-config?name=${encodeURIComponent(name)}`
      );
      const json = await res.json();
      if (!res.ok) {
        setText(`# Error loading system config for: ${name}\n# ${json.error ?? "Unknown error"}\n`);
        return;
      }
      if (json.data) {
        const content =
          typeof json.data === "string"
            ? json.data
            : (stringifyLosslessJson(json.data, 2) ?? String(json.data));
        setText(content);
      } else {
        setText(`# No reported configuration found for: ${name}\n# The manifest may not have been deployed yet.\n`);
      }
    } catch (err) {
      setText(`# Failed to fetch system config\n# ${err instanceof Error ? err.message : "Network error"}\n`);
    } finally {
      setLoading(false);
    }
  };
  */

  // Resource-level diff stats + grouped lists from buildMatrix.
  // Line counts grossly overestimate "changes" when the same setting
  // is encoded differently across baselines (e.g. WS2019's "Network
  // access: Allow anonymous SID/Name translation" Registry resource
  // vs WS2025's `AllowAnonymousSIDOrNameTranslation` CSP resource —
  // same setting, many different YAML lines). The matrix knows these
  // are the same resource. Falls back to line-level counts when one
  // side isn't valid YAML.
  const normLeft = useMemo(() => normalizeManifestForDiff(leftText), [leftText]);
  const normRight = useMemo(() => normalizeManifestForDiff(rightText), [rightText]);
  const matrixStats = useMemo(() => {
    if (!showDiff) return null;
    try {
      const lDoc = parseLosslessYaml(leftText);
      const rDoc = parseLosslessYaml(rightText);
      if (!lDoc || !rDoc) return null;
      const rows = buildMatrix([
        { name: 'left', doc: lDoc },
        { name: 'right', doc: rDoc },
      ]);
      const addedRows: typeof rows = [];
      const removedRows: typeof rows = [];
      const changedRows: typeof rows = [];
      const identicalRows: typeof rows = [];
      for (const row of rows) {
        const l = row.values['left'];
        const r = row.values['right'];
        const lp = l && l.status !== 'missing';
        const rp = r && r.status !== 'missing';
        if (!lp && rp) addedRows.push(row);
        else if (lp && !rp) removedRows.push(row);
        else if (lp && rp && r.status === 'differs') changedRows.push(row);
        else if (lp && rp) identicalRows.push(row);
      }
      return {
        added: addedRows.length,
        removed: removedRows.length,
        changed: changedRows.length,
        identical: identicalRows.length,
        addedRows,
        removedRows,
        changedRows,
        identicalRows,
        mode: 'resources' as const,
      };
    } catch {
      return null;
    }
  }, [leftText, rightText, showDiff]);

  // Line-diff fallback (used when buildMatrix can't run, e.g. invalid YAML mid-edit).
  const leftLines = normLeft.split("\n");
  const rightLines = normRight.split("\n");
  let added = 0;
  let removed = 0;
  let changed = 0;
  if (matrixStats) {
    added = matrixStats.added;
    removed = matrixStats.removed;
    changed = matrixStats.changed;
  } else if (showDiff) {
    const max = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < max; i++) {
      const l = i < leftLines.length ? leftLines[i] : null;
      const r = i < rightLines.length ? rightLines[i] : null;
      if (l === null) added++;
      else if (r === null) removed++;
      else if (l !== r) changed++;
    }
  }
  const statsUnit = matrixStats ? 'resources' : 'lines';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('page.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('page.description')}
        </p>
      </div>

      {pageError && (
        <MessageBar intent="error">
          <MessageBarBody>
            <button
              type="button"
              onClick={() => setPageError(null)}
              className="float-right text-xs underline"
              title={t('pageError.dismissTitle')}
            >
              {t('pageError.dismiss')}
            </button>
            {pageError}
          </MessageBarBody>
        </MessageBar>
      )}

      {/* v0.3.0 (#8b): explain the "one registered manifest" case.
          With zero manifests the page auto-switches to paste mode; with
          one, both dropdowns are populated with the same manifest and
          the user hits an impasse with no guidance. */}
      {!loadingManifests && manifests.length === 1 && activeTab === 'pairwise' && (
        <MessageBar intent="info">
          <MessageBarBody>
            <Trans i18nKey="info.oneManifest" ns="diff" components={{ strong: <strong /> }} />
          </MessageBarBody>
        </MessageBar>
      )}

      {/* Tab nav */}
      <div
        role="tablist"
        aria-label={t("page.title")}
        className="flex gap-1 border-b border-slate-200 dark:border-slate-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pairwise"}
          onClick={() => setActiveTab("pairwise")}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "pairwise"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <ArrowSwapRegular className="h-4 w-4" />
          {t('tabs.pairwise')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "matrix"}
          onClick={() => setActiveTab("matrix")}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "matrix"
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <GridRegular className="h-4 w-4" />
          {t('tabs.matrix')}
        </button>
        {cisAvailable && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "cis-diff"}
            onClick={() => setActiveTab("cis-diff")}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "cis-diff"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <ShieldCheckmarkRegular className="h-4 w-4" />
            {t('tabs.cisDiff')}
          </button>
        )}
      </div>

      {activeTab === "matrix" && (
        <MatrixTab
          manifests={manifests}
          selected={matrixSelected}
          toggleSelection={toggleMatrixSelection}
          onCompare={handleMatrixCompare}
          onDownloadXlsx={downloadMatrixXlsx}
          loading={matrixLoading}
          data={matrixData}
          error={matrixError}
        />
      )}

      {activeTab === "cis-diff" && cisAvailable && (
        <CisDiffTab manifests={manifests} />
      )}

      {activeTab === "pairwise" && (
      <>
      {/* Editors */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left side */}
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('pairwise.before')}</h3>
            <div className="flex items-center gap-2">
              <select
                value={leftMode}
                onChange={(e) => {
                  invalidateSideLoad("left");
                  setLeftMode(e.target.value as InputMode);
                  setLeftText("");
                  setLeftManifest("");
                }}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
              >
                <option value="paste">{t('pairwise.modes.pasteUpload')}</option>
                <option value="manifest">{t('pairwise.modes.fromManifest')}</option>
              </select>
            </div>
          </div>

          <div className="p-4">
            {leftMode === "manifest" ? (
              <div className="space-y-3">
                <select
                  value={leftManifest}
                  onChange={(e) => {
                    invalidateSideLoad("left");
                    setLeftManifest(e.target.value);
                    if (e.target.value) {
                      loadManifestContent(e.target.value, "left");
                    }
                  }}
                  // v0.3.53: do NOT gate on `loadingManifests`. The
                  // previous `disabled={loadingManifests}` could leave
                  // the dropdown permanently uninteractive if the
                  // underlying IPC ever hung or the loading state
                  // never reset, which is exactly the reported "click
                  // doesn't open the dropdown, persists until restart"
                  // failure mode. Loading is now indicated via the
                  // placeholder option text only.
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">
                    {loadingManifests ? t('pairwise.select.loading') : manifests.length === 0 ? t('pairwise.select.noManifests') : t('pairwise.select.selectManifest')}
                  </option>
                  {manifests.map((m) => (
                    <option key={m.Name} value={m.Name}>
                      {m.Name}
                    </option>
                  ))}
                </select>
                {loadingLeft && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Spinner size="tiny" />
                    {t('pairwise.loadingManifest')}
                  </div>
                )}
                {/* H2 fix — empty Monaco editor was a black void with
                    just "1" in the gutter; users mistook it for a
                    crashed component. Overlay a dashed-border hint
                    when value === '' so the empty state is clearly
                    "waiting for input" rather than "broken". */}
                <div className="relative h-[350px]">
                  <ManifestEditor
                    height="100%"
                    value={leftText}
                    onChange={(value) => handleManualTextChange(value, "left")}
                  />
                  {leftText === "" && !loadingLeft && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/60 px-6 py-4 text-center text-sm text-slate-400 dark:bg-slate-900/60">
                        <DocumentRegular className="mx-auto mb-2 h-6 w-6" />
                        {t('pairwise.empty.selectManifest')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 transition-colors hover:border-blue-400 hover:text-blue-500 dark:border-slate-700 dark:text-slate-400 dark:hover:border-blue-600">
                  <ArrowUploadRegular className="h-4 w-4" />
                  {t('pairwise.uploadFile')}
                  <input
                    type="file"
                    accept=".yaml,.yml,.json,.mof"
                    onChange={(e) => handleFileUpload(e, "left")}
                    className="hidden"
                  />
                </label>
                <div className="relative h-[350px]">
                  <ManifestEditor
                    height="100%"
                    value={leftText}
                    onChange={(value) => handleManualTextChange(value, "left")}
                  />
                  {leftText === "" && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/60 px-6 py-4 text-center text-sm text-slate-400">
                        <DocumentRegular className="mx-auto mb-2 h-6 w-6" />
                        {t('pairwise.empty.uploadOrPaste')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('pairwise.after')}</h3>
            <div className="flex items-center gap-2">
              <select
                value={rightMode}
                onChange={(e) => {
                  invalidateSideLoad("right");
                  setRightMode(e.target.value as InputMode);
                  setRightText("");
                  setRightManifest("");
                }}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
              >
                <option value="paste">{t('pairwise.modes.pasteUpload')}</option>
                <option value="manifest">{t('pairwise.modes.fromManifest')}</option>
              </select>
            </div>
          </div>

          <div className="p-4">
            {rightMode === "manifest" ? (
              <div className="space-y-3">
                <select
                  value={rightManifest}
                  onChange={(e) => {
                    invalidateSideLoad("right");
                    setRightManifest(e.target.value);
                    if (e.target.value) {
                      loadManifestContent(e.target.value, "right");
                    }
                  }}
                  // v0.3.53: see left-side select above — gating on
                  // `loadingManifests` here had the same dropdown-
                  // stuck-on-restart failure mode.
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">
                    {loadingManifests ? t('pairwise.select.loading') : manifests.length === 0 ? t('pairwise.select.noManifests') : t('pairwise.select.selectManifest')}
                  </option>
                  {manifests.map((m) => (
                    <option key={m.Name} value={m.Name}>
                      {m.Name}
                    </option>
                  ))}
                </select>
                {loadingRight && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Spinner size="tiny" />
                    {t('pairwise.loadingManifest')}
                  </div>
                )}
                <div className="relative h-[350px]">
                  <ManifestEditor
                    height="100%"
                    value={rightText}
                    onChange={(value) => handleManualTextChange(value, "right")}
                  />
                  {rightText === "" && !loadingRight && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/60 px-6 py-4 text-center text-sm text-slate-400">
                        <DocumentRegular className="mx-auto mb-2 h-6 w-6" />
                        {t('pairwise.empty.selectManifest')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 transition-colors hover:border-blue-400 hover:text-blue-500 dark:border-slate-700 dark:text-slate-400 dark:hover:border-blue-600">
                  <ArrowUploadRegular className="h-4 w-4" />
                  {t('pairwise.uploadFile')}
                  <input
                    type="file"
                    accept=".yaml,.yml,.json,.mof"
                    onChange={(e) => handleFileUpload(e, "right")}
                    className="hidden"
                  />
                </label>
                <div className="relative h-[350px]">
                  <ManifestEditor
                    height="100%"
                    value={rightText}
                    onChange={(value) => handleManualTextChange(value, "right")}
                  />
                  {rightText === "" && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/60 px-6 py-4 text-center text-sm text-slate-400">
                        <DocumentRegular className="mx-auto mb-2 h-6 w-6" />
                        {t('pairwise.empty.uploadOrPaste')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compare button */}
      <div className="flex justify-center">
        <Button
          appearance="primary"
          size="large"
          onClick={handleCompare}
          disabled={!leftText.trim() || !rightText.trim()}
          icon={<ArrowSwapRegular />}
          title={
            !leftText.trim() || !rightText.trim()
              ? t('pairwise.compareDisabledTitle')
              : undefined
          }
        >
          {t('pairwise.compareButton')}
        </Button>
      </div>

      {/* Diff output */}
      {showDiff && leftText && rightText && (
        <div ref={diffResultsRef} className="space-y-4">
          {/* Stats */}
          <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('stats.title')}
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">{t('stats.added', { count: added, unit: t(`stats.units.${statsUnit}`) })}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-red-600 dark:text-red-400">{t('stats.removed', { count: removed, unit: t(`stats.units.${statsUnit}`) })}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span className="text-amber-600 dark:text-amber-400">{t('stats.changed', { count: changed, unit: t(`stats.units.${statsUnit}`) })}</span>
            </span>
          </div>

          <DiffViewer left={normLeft} right={normRight} leftTitle={t("viewer.beforeNormalized")} rightTitle={t("viewer.afterNormalized")} />

          {/* AI Analysis Panel — short insights (summary + risk + sources).
              Override the summary with matrix-derived counts so the numbers
              shown here exactly match the Resource Changes panel below.
              Without override, the analyzer's per-name diff produces
              different counts than buildMatrix's cross-baseline merge,
              which would confuse users. */}
          <AiAnalysisPanel
            analysis={analysis}
            isLoading={analysisLoading}
            overrideSummary={
              matrixStats
                ? [
                    t('matrixSummary.totalChanges', {
                      count: matrixStats.added + matrixStats.removed + matrixStats.changed,
                      changeWord: t('matrixSummary.change', {
                        count: matrixStats.added + matrixStats.removed + matrixStats.changed,
                      }),
                    }),
                    matrixStats.added > 0 ? t('matrixSummary.added', { count: matrixStats.added }) : '',
                    matrixStats.removed > 0 ? t('matrixSummary.removed', { count: matrixStats.removed }) : '',
                    matrixStats.changed > 0 ? t('matrixSummary.changed', { count: matrixStats.changed }) : '',
                  ].filter(Boolean).join(' · ') + '.'
                : undefined
            }
          />

          {/* Resource Changes panel — grouped lists by status from buildMatrix.
              Renders below the AI insights so users see narrative first, then
              the precise structured list. Only shown when both manifests
              parse cleanly. */}
          {matrixStats && (
            <ResourceChangesPanel stats={matrixStats} />
          )}

          {/* Download Changelog as Markdown */}
          {analysis && (
            <div className="flex justify-end">
              <button
                onClick={handleDownloadChangelog}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title={t('changelog.downloadTitle')}
              >
                <ArrowDownloadRegular className="h-4 w-4" />
                Download Changelog (.md)
              </button>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ── ResourceChangesPanel — grouped resource list by status ──────────────────

interface MatrixRowLike {
  key: string;
  type: string;
  name: string;
  valueName?: string;
  keyPath?: string;
  values: Record<string, { value: unknown; status: string } | undefined>;
}

interface ResourceChangesProps {
  stats: {
    added: number; removed: number; changed: number; identical: number;
    addedRows: MatrixRowLike[]; removedRows: MatrixRowLike[];
    changedRows: MatrixRowLike[]; identicalRows: MatrixRowLike[];
  };
}

function ResourceChangesPanel({ stats }: ResourceChangesProps): JSX.Element {
  const { t } = useTranslation("diff");
  // Default: expand the action-worthy sections (changed first), keep
  // identical collapsed since it's just noise.
  const [showAdded, setShowAdded] = useState(true);
  const [showRemoved, setShowRemoved] = useState(true);
  const [showChanged, setShowChanged] = useState(true);
  const [showIdentical, setShowIdentical] = useState(false);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('resourceChanges.sectionTitle')}</h3>
      <ResourceChangesSection title={t('resourceChanges.changed')} count={stats.changed} color="bg-amber-500"
        rows={stats.changedRows} open={showChanged} setOpen={setShowChanged} showValues="both" />
      <ResourceChangesSection title={t('resourceChanges.added')} count={stats.added} color="bg-emerald-500"
        rows={stats.addedRows} open={showAdded} setOpen={setShowAdded} showValues="right" />
      <ResourceChangesSection title={t('resourceChanges.removed')} count={stats.removed} color="bg-red-500"
        rows={stats.removedRows} open={showRemoved} setOpen={setShowRemoved} showValues="left" />
      <ResourceChangesSection title={t('resourceChanges.identical')} count={stats.identical} color="bg-slate-400"
        rows={stats.identicalRows} open={showIdentical} setOpen={setShowIdentical} showValues="both" />
    </div>
  );
}

// Hoisted to module scope so its component identity is STABLE across
// ResourceChangesPanel re-renders. Previously this lived as a nested
// function inside ResourceChangesPanel, which meant React saw a new
// component type on every state update — causing unmount + remount of
// each section (and a scroll-to-top jump when expanding e.g. the
// Identical bucket with 160+ rows).
function shortType(t: string): string {
  return t.replace(/^Microsoft\.Windows\//, '').replace(/^Microsoft\./, '');
}
function valuePreview(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '…' : v;
  try {
    const s = stringifyLosslessJson(v) ?? String(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  } catch { return String(v); }
}

function ResourceChangesSection({
  title, count, color, rows, open, setOpen, showValues,
}: {
  title: string; count: number; color: string; rows: MatrixRowLike[];
  open: boolean; setOpen: (b: boolean) => void;
  showValues: 'left' | 'right' | 'both' | null;
}): JSX.Element | null {
  const { t } = useTranslation("diff");
  if (count === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen(!open); }}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${color}`} />
          <span className="text-slate-700 dark:text-slate-300">{title}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {count}
          </span>
        </span>
        <span className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="max-h-[400px] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {rows.map((r) => {
            const left = r.values['left'];
            const right = r.values['right'];
            return (
              <div key={r.key} className="px-4 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-slate-900 dark:text-slate-100" title={r.name || r.key}>
                    {r.name || r.valueName || r.keyPath || r.key}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {shortType(r.type)}
                  </span>
                </div>
                {showValues === 'both' && left && right && (
                  <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded bg-red-50 px-2 py-1 text-red-700 dark:bg-red-900/20 dark:text-red-300" title={String(left.value)}>
                      <span className="text-[9px] uppercase opacity-60">{t('resourceChanges.beforeLabel')}</span>{' '}{valuePreview(left.value)}
                    </div>
                    <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" title={String(right.value)}>
                      <span className="text-[9px] uppercase opacity-60">{t('resourceChanges.afterLabel')}</span>{' '}{valuePreview(right.value)}
                    </div>
                  </div>
                )}
                {showValues === 'left' && left && (
                  <div className="mt-1 text-[11px] text-slate-500" title={String(left.value)}>= {valuePreview(left.value)}</div>
                )}
                {showValues === 'right' && right && (
                  <div className="mt-1 text-[11px] text-slate-500" title={String(right.value)}>= {valuePreview(right.value)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MatrixTab component (PR23) ───────────────────────────────────────────

interface MatrixTabProps {
  manifests: OscManifest[];
  selected: Set<string>;
  toggleSelection: (name: string) => void;
  onCompare: () => void;
  onDownloadXlsx: () => void;
  loading: boolean;
  data: MatrixApiResponse | null;
  error: string | null;
}

function MatrixTab({
  manifests,
  selected,
  toggleSelection,
  onCompare,
  onDownloadXlsx,
  loading,
  data,
  error,
}: MatrixTabProps) {
  const { t } = useTranslation(["diff", "common", "manifests"]);
  const [baselineSearchQuery, setBaselineSearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "identical" | "differs" | "partial">("all");

  const filteredManifests = useMemo(() => {
    const tokens = baselineSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return manifests;
    return manifests.filter((manifest) => {
      const searchable = `${manifest.Name} ${manifest.Source ?? ""}`.toLowerCase();
      return tokens.every((token) => searchable.includes(token));
    });
  }, [baselineSearchQuery, manifests]);

  const filteredMatrix = useMemo(() => {
    if (!data) return [];
    let rows = data.matrix;

    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.status === statusFilter);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const name = (r.name || "").toLowerCase();
        const type = (r.type || "").toLowerCase();
        const valueName = (r.valueName || "").toLowerCase();
        const keyPath = (r.keyPath || "").toLowerCase();
        return name.includes(q) || type.includes(q) || valueName.includes(q) || keyPath.includes(q);
      });
    }

    return rows;
  }, [data, searchQuery, statusFilter]);

  const filteredStats = useMemo(() => {
    if (!filteredMatrix.length) return null;
    const identical = filteredMatrix.filter((r) => r.status === "identical").length;
    const differs = filteredMatrix.filter((r) => r.status === "differs").length;
    const partial = filteredMatrix.filter((r) => r.status === "partial").length;
    return { identical, differs, partial, totalRows: filteredMatrix.length };
  }, [filteredMatrix]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {t('matrix.sectionTitle')}
        </h3>
        <p className="mb-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t('matrix.sectionDescription')}
        </p>
        {manifests.length === 0 ? (
          <p className="text-sm text-slate-400">{t('matrix.noManifests')}</p>
        ) : (
          <>
            <div className="relative mb-3 max-w-sm">
              <label htmlFor="matrix-baseline-search" className="sr-only">
                {t('manifests:administration.search.label')}
              </label>
              <SearchRegular
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="matrix-baseline-search"
                type="search"
                value={baselineSearchQuery}
                onChange={(event) => setBaselineSearchQuery(event.target.value)}
                placeholder={t('manifests:administration.search.placeholder')}
                className="w-full rounded border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500"
              />
            </div>
            {filteredManifests.length === 0 ? (
              <p className="rounded border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('manifests:administration.table.noMatches')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {filteredManifests.map((m) => {
                  const isSelected = selected.has(m.Name);
                  const disabled = !isSelected && selected.size >= 10;
                  return (
                    <label
                      key={m.Name}
                      className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                        isSelected
                          ? "border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-200"
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-blue-300"}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggleSelection(m.Name)}
                        className="h-4 w-4"
                      />
                      <span className="truncate">{m.Name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button
            appearance="primary"
            onClick={onCompare}
            disabled={selected.size < 2 || loading}
            icon={loading ? <Spinner size="tiny" /> : <GridRegular />}
          >
            {t('matrix.compareButton', { count: selected.size })}
          </Button>
          <Button
            appearance="secondary"
            onClick={onDownloadXlsx}
            disabled={selected.size < 2}
            icon={<ArrowDownloadRegular />}
          >
            {t('matrix.downloadExcel')}
          </Button>
        </div>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {data && (
        <div className="space-y-3">
          {/* ── Filter bar ── */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
            <div className="relative">
              <SearchRegular className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={t('matrix.filterPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:placeholder:text-slate-500 w-64"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <FilterRegular className="h-4 w-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <option value="all">{t('matrix.statusFilter.all')}</option>
                <option value="identical">{t('matrix.statusFilter.identical')}</option>
                <option value="differs">{t('matrix.statusFilter.differs')}</option>
                <option value="partial">{t('matrix.statusFilter.partial')}</option>
              </select>
            </div>

            <div className="ml-auto flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
              {(searchQuery || statusFilter !== "all") && filteredStats ? (
                <span>
                  <Trans i18nKey="matrix.showing" ns="diff" values={{ filtered: filteredStats.totalRows, total: data.stats.totalRows }} components={{ strong: <strong className="text-slate-700 dark:text-slate-200" /> }} />
                </span>
              ) : null}
            </div>
          </div>

          {/* ── Stats bar ── */}
          <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('matrix.stats.rows', { count: (filteredStats ?? data.stats).totalRows })}
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">{t('matrix.stats.identical', { count: (filteredStats ?? data.stats).identical })}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-red-600 dark:text-red-400">{t('matrix.stats.differs', { count: (filteredStats ?? data.stats).differs })}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span className="text-amber-600 dark:text-amber-400">{t('matrix.stats.partial', { count: (filteredStats ?? data.stats).partial })}</span>
            </span>
          </div>

          <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800" style={{ maxHeight: "70vh" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">{t('matrix.table.setting')}</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">{t('matrix.table.type')}</th>
                  {data.baselines.map((b) => (
                    <th key={b} className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMatrix.length === 0 ? (
                  <tr>
                    <td colSpan={2 + data.baselines.length} className="px-3 py-8 text-center text-sm text-slate-400">
                      {t('matrix.table.noSettings')}
                    </td>
                  </tr>
                ) : (
                  filteredMatrix.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="border-b border-slate-100 px-3 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-800 dark:text-slate-200">
                        {row.name || row.valueName || row.key}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        {row.type.replace("Microsoft.", "")}
                      </td>
                      {data.baselines.map((b) => {
                        const cell = row.values[b];
                        const cls =
                          cell?.status === "identical"
                            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
                            : cell?.status === "differs"
                              ? "bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-200"
                              : "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200";
                        return (
                          <td key={b} className={`border-b border-slate-100 px-3 py-1.5 font-mono text-xs dark:border-slate-800 ${cls}`}>
                            {cell?.status === "missing" ? "-" : formatMatrixValue(cell?.value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatMatrixValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return stringifyLosslessJson(v) ?? String(v);
}
