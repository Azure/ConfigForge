// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useState, useRef, useEffect, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ManifestEditor } from "../../components/manifest-editor";
import { ResourcePicker } from "../../components/resource-picker";
import { useCisAvailable } from "../../components/use-cis-available";
import { useNavigationGuard } from "../../lib/use-navigation-guard";
import {
  ArrowLeftRegular,
  ArrowUploadRegular,
  LinkRegular as LinkIcon,
  DocumentArrowUpRegular,
  WarningRegular,
  DesktopRegular,
  WindowConsoleRegular,
  DocumentRegular,
  DismissRegular,
  ArrowDownloadRegular,
  CopyRegular,
  CheckmarkRegular,
} from "@fluentui/react-icons";
import {
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
} from "@fluentui/react-components";
import { Link } from "react-router-dom";
import { cfs } from "../../lib/cfs";
import { useNewManifestForm } from "./state/useNewManifestForm";
import { useTranslation } from "react-i18next";
import { useNumberFormatter } from "../../lib/format";

export function ManifestNewPage() {
  const { t } = useTranslation("manifests");
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Spinner size="medium" label={t("new.extracted.text1")} />
        </div>
      }
    >
      <NewManifestPage />
    </Suspense>
  );
}

function NewManifestPage() {
  const { t } = useTranslation("manifests");
  const fileSizeFormatter = useNumberFormatter({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cisAvailable = useCisAvailable();

  // Scroll to top on mount. SPA route transitions don't auto-reset
  // scroll position, so navigating here from the Library page (where
  // the user may have scrolled to a card near the bottom) inherits
  // that scroll offset and lands the user at the middle or bottom of
  // the registration form instead of the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const {
    name,
    setName,
    platform,
    yamlContent,
    setYamlContent,
    jsonContent,
    uri,
    setUri,
    sourceType,
    setSourceType,
    activeTab,
    visualResources,
    platformWarning,
    fileInputRef,
    importing,
    importResult,
    error,
    setError,
    handleTabSwitch,
    handleJsonChange,
    handleResourceAdd,
    handleResourceRemove,
    handlePlatformSwitch,
    handleImport,
    hydrateFromLibraryTemplate,
    hasUserContent,
  } = useNewManifestForm();

  const [submitting, setSubmitting] = useState(false);
  const [postWarnings, setPostWarnings] = useState<string[]>([]);
  const [registeredName, setRegisteredName] = useState<string | null>(null);

  // v0.2.15: URL fetch-and-edit. The "From URL" mode used to defer all
  // network I/O to register-time, which forced users to register
  // *before* they could review/edit the fetched manifest. This pair of
  // state vars drives a "Fetch & Edit" button that previews the URL,
  // loads it into the YAML buffer, and switches to content mode so the
  // editor can render.
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlFetchError, setUrlFetchError] = useState<string | null>(null);

  // Batch import state.
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
    errors: string[];
  } | null>(null);

  // Docs modal state — kept at page level for now; consolidating with
  // ManifestEditor's identical useDocsModal hook is a queued follow-up.
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsMarkdown, setDocsMarkdown] = useState("");
  const [docsFilename, setDocsFilename] = useState("");
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsCopied, setDocsCopied] = useState(false);
  // v0.1.13 fix — cleanup ref for the docsCopied 2-second reset
  // setTimeout. Without this, navigating away from the page while
  // the copied toast was visible left the timer scheduled, firing
  // setDocsCopied(false) on an unmounted component. Same pattern
  // already used in ManifestEditor.handleDocsCopy.
  const docsCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (docsCopiedTimerRef.current !== null) {
        clearTimeout(docsCopiedTimerRef.current);
        docsCopiedTimerRef.current = null;
      }
    };
  }, []);

  // Hydrate from library template (sessionStorage) when navigated from Baseline Library
  useEffect(() => {
    if (searchParams.get("fromLibrary") !== "true") return;
    hydrateFromLibraryTemplate();
  }, [searchParams, hydrateFromLibraryTemplate]);

  const handleGenerateDocs = async () => {
    setDocsLoading(true);
    setDocsOpen(true);
    setDocsCopied(false);
    try {
      const docName = name.trim() || "Untitled-Baseline";
      const json = await cfs.docs.generate({ name: docName, content: yamlContent });
      setDocsMarkdown(json.markdown);
      setDocsFilename(json.filename);
    } catch (err) {
      setDocsMarkdown(
        `# Error\n\n${err instanceof Error ? err.message : "Failed to generate documentation"}`,
      );
      setDocsFilename(`${name.trim() || "baseline"}.md`);
    } finally {
      setDocsLoading(false);
    }
  };

  const handleDocsDownload = () => {
    const blob = new Blob([docsMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = docsFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDocsCopy = async () => {
    await navigator.clipboard.writeText(docsMarkdown);
    setDocsCopied(true);
    if (docsCopiedTimerRef.current !== null) {
      clearTimeout(docsCopiedTimerRef.current);
    }
    docsCopiedTimerRef.current = setTimeout(() => {
      setDocsCopied(false);
      docsCopiedTimerRef.current = null;
    }, 2000);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Baseline name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body: { name: string; content?: string; uri?: string } = { name: name.trim() };

      if (sourceType === "content") {
        body.content = yamlContent;
      } else {
        if (!uri.trim()) {
          setError("URI is required when source is URL.");
          setSubmitting(false);
          return;
        }
        body.uri = uri.trim();
      }

      const json = await cfs.manifests.register(body);

      const warnings: string[] = Array.isArray((json as { warnings?: string[] }).warnings)
        ? (json as { warnings: string[] }).warnings
        : [];
      if (warnings.length > 0) {
        // Keep the user on this page so they can read the warning before
        // navigating away. Registration is still successful.
        setPostWarnings(warnings);
        setRegisteredName(name.trim());
        setError(null);
        // v0.1.14: successful registration with warnings — clear the
        // unsaved-changes flag so the useBlocker below doesn't prompt
        // if the user clicks away after reading the warning.
        setJustRegistered(true);
      } else {
        sessionStorage.setItem(
          "configforge-flash",
          `Baseline "${name.trim()}" registered successfully`,
        );
        // v0.1.14: clear the unsaved-changes guard before navigating.
        // Otherwise useBlocker would intercept this programmatic
        // navigate() call and prompt the user to discard the
        // manifest they just successfully saved.
        setJustRegistered(true);
        navigate("/manifests");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  // v0.1.15: unsaved-changes guard. See use-navigation-guard.ts for why
  // useBlocker doesn't work with our legacy <HashRouter>. Triggers
  // if the user has typed a name, replaced the default YAML scaffold,
  // added any resources via the visual builder, or typed a URI in
  // URL-source mode, then tries to navigate away without registering.
  // `justRegistered` is the post-success bypass.
  const [justRegistered, setJustRegistered] = useState(false);
  const hasUnsavedChanges = !justRegistered && hasUserContent();
  useNavigationGuard(
    hasUnsavedChanges,
    `You haven't registered this baseline yet. Leave anyway and discard your work?`,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/manifests"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <ArrowLeftRegular className="h-4 w-4" />
          {t("new.extracted.text2")}
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t("new.extracted.text3")}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("new.extracted.text4")}
          </p>
        </div>
      </div>

      {/* Import File */}
      <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-6 transition-colors hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-500">
        <input
          ref={fileInputRef}
          type="file"
          accept=".osc.yaml,.yaml,.yml,.json,.csv,.tsv"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            if (files.length === 1) {
              handleImport(files[0]);
            } else {
              setBatchFiles(Array.from(files));
              setBatchProgress(null);
            }
          }}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
              <DocumentArrowUpRegular className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {t("new.extracted.text5")}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("new.extracted.text6")}
              </p>
            </div>
          </div>
          <Button
            appearance="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            icon={importing ? <Spinner size="tiny" /> : <ArrowUploadRegular />}
          >
            {importing ? t("new.extracted.text7") : t("new.extracted.text8")}
          </Button>
        </div>
        {importResult && (
          <MessageBar intent="success" style={{ marginTop: 16 }}>
            <MessageBarBody>
              <MessageBarTitle>
                {t("new.extracted.text9")}
                {importResult.filename} ({importResult.type})
              </MessageBarTitle>
              {importResult.type === "manifest" &&
                `${(importResult.data as { resourceCount?: number }).resourceCount ?? 0} settings loaded`}
              {importResult.type === "security-definition" &&
                `${(importResult.data as { settingCount?: number }).settingCount ?? 0} settings converted to baseline`}
              {importResult.type === "baseline-spreadsheet" &&
                `${(importResult.data as { settingCount?: number }).settingCount ?? 0} baseline settings converted`}{" "}
              {t("new.extracted.text13")}
            </MessageBarBody>
          </MessageBar>
        )}
      </div>

      {/* Batch Import Panel */}
      {batchFiles.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
              {t("new.extracted.text14")}
              {batchFiles.length}
              {t("new.extracted.text15")}
            </h3>
            <div className="flex gap-2">
              <Button
                appearance="primary"
                size="small"
                disabled={!!batchProgress && batchProgress.done < batchProgress.total}
                onClick={async () => {
                  const total = batchFiles.length;
                  const errors: string[] = [];
                  setBatchProgress({ done: 0, total, errors });

                  // Parallel import. Each file does file.text() + 2 IPCs.
                  // Sequential was ~150ms per file (10 files = 1.5s).
                  // Parallel collapses that to roughly the slowest file's
                  // time. We update progress as each settles, not by
                  // input order, so the counter reflects actual completions.
                  let doneCount = 0;
                  await Promise.allSettled(
                    batchFiles.map(async (file) => {
                      try {
                        const text = await file.text();
                        const result = await cfs.importChannel.fromContent({
                          filename: file.name,
                          content: text,
                        });
                        if (result.yaml) {
                          const derivedName = file.name
                            .replace(/\.(osc\.yaml|yaml|yml|json|csv|tsv)$/i, "")
                            .replace(/[^a-zA-Z0-9_-]/g, "-");
                          await cfs.manifests.register({
                            name: derivedName,
                            content: result.yaml,
                            source: "import",
                          });
                        }
                      } catch (err) {
                        errors.push(
                          `${file.name}: ${err instanceof Error ? err.message : "failed"}`,
                        );
                      } finally {
                        doneCount += 1;
                        setBatchProgress({ done: doneCount, total, errors: [...errors] });
                      }
                    }),
                  );

                  if (errors.length === 0) {
                    setTimeout(() => navigate("/manifests"), 1500);
                  }
                }}
              >
                {batchProgress && batchProgress.done < batchProgress.total
                  ? `Importing ${batchProgress.done + 1}/${batchProgress.total}…`
                  : t("new.extracted.text16")}
              </Button>
              <Button
                appearance="secondary"
                size="small"
                onClick={() => {
                  setBatchFiles([]);
                  setBatchProgress(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                {t("new.extracted.text17")}
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            {batchFiles.map((file, idx) => {
              const done = batchProgress ? idx < batchProgress.done : false;
              const errMsg = batchProgress?.errors.find((e) => e.startsWith(file.name + ":"));
              return (
                <div
                  key={file.name + idx}
                  className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm ${
                    errMsg
                      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                      : done
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {errMsg ? (
                    <DismissRegular className="h-4 w-4 shrink-0 text-red-500" />
                  ) : done ? (
                    <CheckmarkRegular className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <DocumentRegular className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <span className="truncate">{file.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">
                    {fileSizeFormatter.format(file.size / 1024)}
                    {t("new.extracted.text18")}
                  </span>
                </div>
              );
            })}
          </div>

          {batchProgress && batchProgress.done === batchProgress.total && (
            <div className="mt-3">
              {batchProgress.errors.length === 0 ? (
                <MessageBar intent="success">
                  <MessageBarBody>
                    {t("new.extracted.text19")}
                    {batchProgress.total}
                    {t("new.extracted.text20")}
                  </MessageBarBody>
                </MessageBar>
              ) : (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    {batchProgress.total - batchProgress.errors.length}
                    {t("new.extracted.text21")}
                    {batchProgress.total}
                    {t("new.extracted.text22")} {batchProgress.errors.length}
                    {t("new.extracted.text23")}
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* Post-register warning: unregistered resource types */}
      {registeredName && postWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <WarningRegular className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {t("new.extracted.text24")}
                {registeredName}
                {t("new.extracted.text25")}
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                {t("new.extracted.text26")}
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-700 dark:text-amber-400">
                {postWarnings.map((w, i) => (
                  <li key={i} className="break-words">
                    {w}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    sessionStorage.setItem(
                      "configforge-flash",
                      `Baseline "${registeredName}" registered successfully`,
                    );
                    navigate("/manifests");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
                >
                  {t("new.extracted.text27")}
                </button>
                <button
                  onClick={() => {
                    setPostWarnings([]);
                    setRegisteredName(null);
                    // v0.1.14: re-arm the unsaved-changes guard. The
                    // user dismissed the post-register banner and is
                    // editing again — if they make more changes and
                    // try to leave, the blocker should fire.
                    setJustRegistered(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-400 dark:hover:bg-slate-800"
                >
                  {t("new.extracted.text28")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSP Troubleshooting */}
      {error &&
        (error.includes(t("new.extracted.text29")) ||
          error.includes(t("new.extracted.text30")) ||
          error.includes(t("new.extracted.text31"))) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <WarningRegular className="h-4 w-4" />
              {t("new.extracted.text32")}
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-400">
              <li>{t("new.extracted.text33")}</li>
              <li>{t("new.extracted.text34")}</li>
              <li>{t("new.extracted.text35")}</li>
              <li>
                {t("new.extracted.text36")}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">
                  Get-OSConfigMetadata
                </code>
                {t("new.extracted.text37")}
              </li>
            </ul>
          </div>
        )}
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {/* Platform Selector */}
        <div className="mb-4">
          <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("new.extracted.text38")}
          </span>
          <div
            className="flex rounded-lg border border-slate-200 dark:border-slate-700"
            style={{ maxWidth: 320 }}
          >
            <button
              onClick={() => handlePlatformSwitch("windows")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${
                platform === "windows"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              <DesktopRegular className="h-4 w-4" />
              {t("new.extracted.text39")}
            </button>
            <button
              onClick={() => handlePlatformSwitch("linux")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors ${
                platform === "linux"
                  ? "bg-orange-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              <WindowConsoleRegular className="h-4 w-4" />
              {t("new.extracted.text40")}
            </button>
          </div>
        </div>

        {/* Platform switch warning */}
        {platformWarning && (
          <div className="mb-4">
            <MessageBar intent="warning">
              <MessageBarBody>{platformWarning}</MessageBarBody>
            </MessageBar>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("new.extracted.text41")}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("new.extracted.text42")}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("new.extracted.text43")}
            </span>
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setSourceType("content")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${
                  sourceType === "content"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                <ArrowUploadRegular className="h-4 w-4" />
                {t("new.extracted.text44")}
              </button>
              <button
                onClick={() => setSourceType("uri")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors ${
                  sourceType === "uri"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                <LinkIcon className="h-4 w-4" />
                {t("new.extracted.text45")}
              </button>
            </div>
          </label>
        </div>

        {sourceType === "uri" && (
          <div className="mt-4 space-y-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("new.extracted.text47")}
              </span>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder={t("new.extracted.text48")}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
                />

                <Button
                  type="button"
                  appearance="secondary"
                  disabled={!uri.trim() || urlFetching}
                  onClick={async () => {
                    setUrlFetchError(null);
                    setUrlFetching(true);
                    try {
                      const res = (await cfs.manifests.fetchUri(uri.trim())) as
                        | { content: string }
                        | { ok?: false; error?: string };
                      const errObj = res as { ok?: boolean; error?: string };
                      if (errObj && errObj.ok === false) {
                        throw new Error(errObj.error ?? "Fetch failed");
                      }
                      const content = (res as { content: string }).content;
                      setYamlContent(content);
                      setSourceType("content");
                      // Default to the YAML tab — fetched content is typically YAML.
                      handleTabSwitch("yaml");
                    } catch (err) {
                      // v0.3.0 (#16): classify the raw error into a
                      // friendly message. The backend `fetchManifestFromUri`
                      // throws `Failed to fetch manifest from URI: HTTP 404`
                      // or `…: fetch failed`; we surface those as
                      // actionable copy instead of raw HTTP status lines.
                      const raw = err instanceof Error ? err.message : String(err);
                      let friendly: string;
                      if (/HTTP 404/i.test(raw) || /not found/i.test(raw)) {
                        friendly = `The URL returned 404. The file may have been moved or deleted. Verify the link and try again.`;
                      } else if (/HTTP 40[13]/i.test(raw) || /forbidden|unauthor/i.test(raw)) {
                        friendly = `The URL requires authentication or is forbidden. ConfigForge fetches anonymously; use a public link or download + upload.`;
                      } else if (/HTTP 5\d\d/i.test(raw) || /server error/i.test(raw)) {
                        friendly = `Remote server returned an error. The host may be temporarily unavailable.`;
                      } else if (/abort|timeout/i.test(raw) || /signal/i.test(raw)) {
                        friendly = `The fetch timed out (limit 30s). Check your network connection or try a smaller baseline.`;
                      } else if (/fetch failed|enotfound|getaddrinfo|network/i.test(raw)) {
                        friendly = `Could not reach the host. Check your internet connection and that the URL is reachable.`;
                      } else if (/private\/loopback|private\/?internal/i.test(raw)) {
                        friendly = `URLs pointing to private or loopback addresses are not allowed. Use a public baseline URL.`;
                      } else if (/scheme|unsupported uri|invalid uri/i.test(raw)) {
                        friendly = `The URL is invalid. Make sure it starts with http:// or https:// and points to a YAML or JSON baseline.`;
                      } else if (/too large/i.test(raw)) {
                        friendly = `The baseline is too large (>10 MB). Trim it before importing.`;
                      } else {
                        friendly = `Fetch failed: ${raw}`;
                      }
                      setUrlFetchError(friendly);
                    } finally {
                      setUrlFetching(false);
                    }
                  }}
                  icon={urlFetching ? <Spinner size="tiny" /> : <ArrowDownloadRegular />}
                >
                  {urlFetching ? t("new.extracted.text49") : t("new.extracted.text50")}
                </Button>
              </div>
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("new.extracted.text51")}
              <span className="font-medium">{t("new.extracted.text52")}</span>
              {t("new.extracted.text53")}{" "}
              <span className="font-medium">{t("new.extracted.text54")}</span>
              {t("new.extracted.text55")}
            </p>
            {urlFetchError && (
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>{t("new.extracted.text56")}</MessageBarTitle>
                  {urlFetchError}
                </MessageBarBody>
              </MessageBar>
            )}
          </div>
        )}
      </div>

      {/* Editor / Builder Tabs (only for content source) */}
      {sourceType === "content" && (
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {/* Tab bar */}
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => handleTabSwitch("yaml")}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "yaml"
                  ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              {t("new.extracted.text58")}
            </button>
            <button
              onClick={() => handleTabSwitch("json")}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "json"
                  ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              {t("new.extracted.text59")}
            </button>
            <button
              onClick={() => handleTabSwitch("visual")}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === "visual"
                  ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              {t("new.extracted.text60")}
            </button>
          </div>

          {/* Tab content */}
          <div className="p-6">
            {activeTab === "yaml" ? (
              <div className="h-[calc(100vh-360px)] min-h-[520px]">
                <ManifestEditor
                  value={yamlContent}
                  onChange={setYamlContent}
                  height="100%"
                  platform={platform}
                  showCisCrossref={cisAvailable === true}
                />
              </div>
            ) : activeTab === "json" ? (
              <div className="h-[calc(100vh-360px)] min-h-[520px]">
                <ManifestEditor
                  value={jsonContent}
                  onChange={handleJsonChange}
                  height="100%"
                  platform={platform}
                  language="json"
                  showCisCrossref={false}
                />
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Resource picker */}
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {t("new.extracted.text63")}
                  </h3>
                  <ResourcePicker onSelect={handleResourceAdd} platform={platform} />
                </div>

                {/* Added resources preview */}
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {t("new.extracted.text64")}
                    {visualResources.length})
                  </h3>
                  {visualResources.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 py-12 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                      {t("new.extracted.text65")}

                      <br />
                      {t("new.extracted.text66")}
                    </div>
                  ) : (
                    <div className="max-h-[400px] space-y-2 overflow-y-auto">
                      {visualResources.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-sm font-medium text-slate-900 dark:text-white"
                              title={r.name}
                            >
                              {r.name}
                            </p>
                            <p className="break-all text-xs text-slate-500 dark:text-slate-400">
                              {r.type}
                            </p>
                          </div>
                          <button
                            onClick={() => handleResourceRemove(i)}
                            className="shrink-0 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                          >
                            {t("new.extracted.text67")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Submit */}
      <div className="flex items-center justify-end gap-3">
        <Button
          appearance="secondary"
          onClick={handleGenerateDocs}
          disabled={sourceType !== "content"}
          icon={<DocumentRegular />}
          title={sourceType !== "content" ? t("new.extracted.text69") : t("new.extracted.text70")}
        >
          {t("new.extracted.text71")}
        </Button>
        <Button
          appearance="primary"
          onClick={handleSubmit}
          disabled={submitting || !name.trim()}
          icon={submitting ? <Spinner size="tiny" /> : undefined}
        >
          {t("new.extracted.text72")}
        </Button>
      </div>

      {/* Documentation Modal */}
      {docsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <DocumentRegular className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {t("new.extracted.text73")}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDocsCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  {docsCopied ? (
                    <CheckmarkRegular className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <CopyRegular className="h-3.5 w-3.5" />
                  )}
                  {docsCopied ? t("new.extracted.text74") : t("new.extracted.text75")}
                </button>
                <button
                  onClick={handleDocsDownload}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
                >
                  <ArrowDownloadRegular className="h-3.5 w-3.5" />
                  {t("new.extracted.text76")}
                </button>
                <button
                  onClick={() => setDocsOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                >
                  <DismissRegular className="h-5 w-5" />
                </button>
              </div>
            </div>
            {/* Modal body */}
            <div className="flex-1 overflow-auto p-6">
              {docsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Spinner size="medium" />
                </div>
              ) : (
                <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-6 font-mono text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {docsMarkdown}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
