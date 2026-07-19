// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ManifestEditor } from "../../components/manifest-editor";
import { useCisAvailable } from "../../components/use-cis-available";
import { useNavigationGuard } from "../../lib/use-navigation-guard";
import { VisualManifestViewer } from "../ManifestEditor/components/VisualManifestViewer";
import {
  flattenVisualSettings,
  parseVisualManifest,
  validateVisualSettings,
} from "../ManifestEditor/visual-viewer";
import {
  ArrowLeftRegular,
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
  Spinner,
} from "@fluentui/react-components";
import { Link } from "react-router-dom";
import { cfs } from "../../lib/cfs";
import {
  LINUX_DEFAULT_YAML,
  WINDOWS_DEFAULT_YAML,
  type ImportResult,
  useNewManifestForm,
} from "./state/useNewManifestForm";
import { useTranslation } from "react-i18next";
import { useNumberFormatter } from "../../lib/format";
import { useBaselineWorkspace } from "../../components/BaselineWorkspace";
import type { BaselineEntry } from "../../data/baseline-catalog";
import {
  BaselineCreationSetup,
  type BaselineCreationMethod,
} from "./components/BaselineCreationSetup";
import { BaselineTemplatePickerDialog } from "./components/BaselineTemplatePickerDialog";

const MAX_WIZARD_IMPORT_BYTES = 10 * 1024 * 1024; // Matches core MAX_IMPORT_BYTES.
const MAX_BATCH_FILE_COUNT = 20;
const MAX_BATCH_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_BATCH_IMPORT_CONCURRENCY = 4;

type ImportRequest = Parameters<typeof cfs.importChannel.fromContent>[0];

async function createImportRequest(
  file: File,
  tooLargeMessage: string,
): Promise<ImportRequest> {
  if (file.size > MAX_WIZARD_IMPORT_BYTES) {
    throw new Error(tooLargeMessage);
  }
  return file.name.toLowerCase().endsWith(".xlsx")
    ? {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }
    : {
        filename: file.name,
        content: await file.text(),
      };
}

async function runWithBoundedConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await operation(items[index], index);
      }
    }),
  );
}

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
  const { refresh: refreshWorkspace } = useBaselineWorkspace();
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
    platformWarning,
    setPlatformWarning,
    error,
    setError,
    handleTabSwitch,
    handleJsonChange,
    handlePlatformSwitch,
    applyTemplate,
    hydrateFromLibraryTemplate,
    hasUserContent,
  } = useNewManifestForm();

  const [creationMethod, setCreationMethod] = useState<BaselineCreationMethod | null>(null);
  const [editorStarted, setEditorStarted] = useState(false);
  const [preparingEditor, setPreparingEditor] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateLoadingId, setTemplateLoadingId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<BaselineEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [visualDraftValid, setVisualDraftValid] = useState(true);
  const [postWarnings, setPostWarnings] = useState<string[]>([]);
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const visualSourceValid = useMemo(() => {
    try {
      return (
        validateVisualSettings(
          flattenVisualSettings(parseVisualManifest(yamlContent)),
        ).length === 0
      );
    } catch {
      return false;
    }
  }, [yamlContent]);

  // v0.2.15: URL fetch-and-edit. The "From URL" mode used to defer all
  // network I/O to register-time, which forced users to register
  // *before* they could review/edit the fetched manifest. This pair of
  // state vars drives a "Fetch & Edit" button that previews the URL,
  // loads it into the YAML buffer, and switches to content mode so the
  // editor can render.
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlFetchError, setUrlFetchError] = useState<string | null>(null);
  const setupOperationGenerationRef = useRef(0);
  const batchNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batch import state.
  const [setupImporting, setSetupImporting] = useState(false);
  const [setupImportResult, setSetupImportResult] = useState<ImportResult | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
    errors: string[];
  } | null>(null);

  const beginSetupOperation = () => {
    const generation = ++setupOperationGenerationRef.current;
    if (batchNavigationTimerRef.current !== null) {
      clearTimeout(batchNavigationTimerRef.current);
      batchNavigationTimerRef.current = null;
    }
    setPreparingEditor(false);
    setUrlFetching(false);
    setSetupImporting(false);
    setTemplateLoadingId(null);
    return generation;
  };

  const isCurrentSetupOperation = (generation: number) =>
    generation === setupOperationGenerationRef.current;

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
      setupOperationGenerationRef.current += 1;
      if (batchNavigationTimerRef.current !== null) {
        clearTimeout(batchNavigationTimerRef.current);
        batchNavigationTimerRef.current = null;
      }
      if (docsCopiedTimerRef.current !== null) {
        clearTimeout(docsCopiedTimerRef.current);
        docsCopiedTimerRef.current = null;
      }
    };
  }, []);

  // Hydrate from library template (sessionStorage) when navigated from Baseline Library
  useEffect(() => {
    if (searchParams.get("fromLibrary") !== "true") return;
    if (hydrateFromLibraryTemplate()) {
      setCreationMethod("template");
      setEditorStarted(true);
    }
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

  const fetchUrlIntoEditor = async (
    generation: number,
    requestedUri: string,
  ): Promise<boolean> => {
    if (!requestedUri) {
      setError(t("new.setup.urlRequired"));
      return false;
    }
    setUrlFetchError(null);
    setUrlFetching(true);
    try {
      const response = (await cfs.manifests.fetchUri(requestedUri)) as
        | { content: string }
        | { ok?: false; error?: string };
      if (!isCurrentSetupOperation(generation)) return false;
      const errorResponse = response as { ok?: boolean; error?: string };
      if (errorResponse.ok === false) {
        throw new Error(errorResponse.error ?? "Fetch failed");
      }
      setYamlContent((response as { content: string }).content);
      setSourceType("content");
      handleTabSwitch("yaml");
      return true;
    } catch (err) {
      if (!isCurrentSetupOperation(generation)) return false;
      const raw = err instanceof Error ? err.message : String(err);
      let friendly: string;
      if (/HTTP 404/i.test(raw) || /not found/i.test(raw)) {
        friendly = t("new.setup.urlErrors.notFound");
      } else if (/HTTP 40[13]/i.test(raw) || /forbidden|unauthor/i.test(raw)) {
        friendly = t("new.setup.urlErrors.authentication");
      } else if (/HTTP 5\d\d/i.test(raw) || /server error/i.test(raw)) {
        friendly = t("new.setup.urlErrors.server");
      } else if (/abort|timeout/i.test(raw) || /signal/i.test(raw)) {
        friendly = t("new.setup.urlErrors.timeout");
      } else if (/fetch failed|enotfound|getaddrinfo|network/i.test(raw)) {
        friendly = t("new.setup.urlErrors.network");
      } else if (/private\/loopback|private\/?internal/i.test(raw)) {
        friendly = t("new.setup.urlErrors.privateAddress");
      } else if (/scheme|unsupported uri|invalid uri/i.test(raw)) {
        friendly = t("new.setup.urlErrors.invalid");
      } else if (/too large/i.test(raw)) {
        friendly = t("new.setup.urlErrors.tooLarge");
      } else {
        friendly = t("new.setup.urlErrors.generic", { error: raw });
      }
      setUrlFetchError(friendly);
      setError(friendly);
      return false;
    } finally {
      if (isCurrentSetupOperation(generation)) {
        setUrlFetching(false);
      }
    }
  };

  const handleSetupFiles = async (files: File[]) => {
    const generation = beginSetupOperation();
    setError(null);
    setUrlFetchError(null);
    setSetupImportResult(null);
    setSelectedTemplate(null);
    setBatchFiles([]);
    setBatchProgress(null);
    if (files.length === 0) return;

    const tooLargeMessage = t("new.setup.urlErrors.tooLarge");
    const oversizedFile = files.find((file) => file.size > MAX_WIZARD_IMPORT_BYTES);
    if (oversizedFile) {
      setError(`${oversizedFile.name}: ${tooLargeMessage}`);
      return;
    }
    if (files.length > MAX_BATCH_FILE_COUNT) {
      setError(
        `${t("new.extracted.text14")} ${files.length} ${t("new.extracted.text15")} (> ${MAX_BATCH_FILE_COUNT}).`,
      );
      return;
    }
    const aggregateBytes = files.reduce((total, file) => total + file.size, 0);
    if (aggregateBytes > MAX_BATCH_IMPORT_BYTES) {
      setError(
        `${t("new.extracted.text14")} ${fileSizeFormatter.format(
          aggregateBytes / (1024 * 1024),
        )} MB > ${MAX_BATCH_IMPORT_BYTES / (1024 * 1024)} MB.`,
      );
      return;
    }

    if (files.length > 1) {
      setBatchFiles(files);
      return;
    }
    const file = files[0];
    setSetupImporting(true);
    try {
      const request = await createImportRequest(file, tooLargeMessage);
      if (!isCurrentSetupOperation(generation)) return;

      const result = await cfs.importChannel.fromContent(request);
      if (!isCurrentSetupOperation(generation)) return;

      if (result.yaml) {
        setYamlContent(result.yaml);
        setSourceType("content");
        handleTabSwitch("yaml");
      }
      setSetupImportResult({
        type: result.type,
        filename: result.filename,
        data: (result as { data?: unknown }).data as Record<string, unknown>,
      });
      if (!name.trim()) {
        setName(
          file.name
            .replace(/\.(osc\.ya?ml|ya?ml|json|csv|tsv|xlsx)$/i, "")
            .replace(/[^a-zA-Z0-9_-]/g, "-")
            .slice(0, 64),
        );
      }
    } catch (err) {
      if (!isCurrentSetupOperation(generation)) return;
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      if (isCurrentSetupOperation(generation)) {
        setSetupImporting(false);
      }
    }
  };

  const handleTemplateSelect = async (entry: BaselineEntry) => {
    const generation = beginSetupOperation();
    if (!entry.manifestUrl) return;
    setTemplateLoadingId(entry.id);
    setError(null);
    setSelectedTemplate(null);
    setSetupImportResult(null);
    try {
      const result = await cfs.library.get({ id: entry.id, content: true });
      if (!isCurrentSetupOperation(generation)) return;
      if (!result.content) {
        throw new Error(result.note ?? t("new.setup.templatePicker.loadFailed"));
      }
      applyTemplate(result.content, entry.name, entry.platform);
      setSelectedTemplate(entry);
      setTemplatePickerOpen(false);
    } catch (err) {
      if (!isCurrentSetupOperation(generation)) return;
      setError(err instanceof Error ? err.message : t("new.setup.templatePicker.loadFailed"));
    } finally {
      if (isCurrentSetupOperation(generation)) {
        setTemplateLoadingId(null);
      }
    }
  };

  const canPrepareEditor =
    name.trim().length > 0 &&
    creationMethod !== null &&
    (creationMethod === "custom" ||
      (creationMethod === "url" && uri.trim().length > 0) ||
      (creationMethod === "template" && selectedTemplate !== null) ||
      ((creationMethod === "file" || creationMethod === "excel") &&
        setupImportResult !== null &&
        batchFiles.length === 0));

  const handlePrepareEditor = async () => {
    if (!canPrepareEditor || !creationMethod) return;
    const generation = beginSetupOperation();
    setPreparingEditor(true);
    setError(null);
    try {
      if (
        creationMethod === "url" &&
        !(await fetchUrlIntoEditor(generation, uri.trim()))
      ) {
        return;
      }
      if (!isCurrentSetupOperation(generation)) return;
      if (creationMethod === "custom") {
        setYamlContent(platform === "linux" ? LINUX_DEFAULT_YAML : WINDOWS_DEFAULT_YAML);
        setPlatformWarning(null);
        handleTabSwitch("visual");
      }
      setSourceType("content");
      setEditorStarted(true);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    } finally {
      if (isCurrentSetupOperation(generation)) {
        setPreparingEditor(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Baseline name is required.");
      return;
    }
    if (sourceType === "content" && (!visualSourceValid || !visualDraftValid)) {
      setError(t("new.visualValidationError"));
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
      void refreshWorkspace().catch(() => {
        // Registration already succeeded. Never turn a transient shared-count
        // refresh failure into a duplicate-registration retry; route entry
        // performs the same refresh again.
      });

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
  // changed any resources in the visual spreadsheet, or typed a URI in
  // URL-source mode, then tries to navigate away without registering.
  // `justRegistered` is the post-success bypass.
  const [justRegistered, setJustRegistered] = useState(false);
  const hasUnsavedChanges = !justRegistered && hasUserContent();
  useNavigationGuard(
    hasUnsavedChanges,
    `You haven't registered this baseline yet. Leave anyway and discard your work?`,
  );

  const importSummary = setupImportResult
    ? {
        filename: setupImportResult.filename,
        detail: t("new.setup.importReady"),
      }
    : null;

  const batchContent =
    batchFiles.length > 0 ? (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-blue-950 dark:text-blue-100">
            {t("new.extracted.text14")} {batchFiles.length} {t("new.extracted.text15")}
          </h3>
          <div className="flex gap-2">
            <Button
              appearance="primary"
              size="small"
              disabled={!!batchProgress && batchProgress.done < batchProgress.total}
              onClick={async () => {
                const generation = beginSetupOperation();
                const filesToImport = batchFiles;
                const total = filesToImport.length;
                const errors: string[] = [];
                setBatchProgress({ done: 0, total, errors });
                let doneCount = 0;
                const tooLargeMessage = t("new.setup.urlErrors.tooLarge");
                await runWithBoundedConcurrency(
                  filesToImport,
                  MAX_BATCH_IMPORT_CONCURRENCY,
                  async (file) => {
                    if (!isCurrentSetupOperation(generation)) return;
                    try {
                      const request = await createImportRequest(file, tooLargeMessage);
                      if (!isCurrentSetupOperation(generation)) return;
                      const result = await cfs.importChannel.fromContent(request);
                      if (!isCurrentSetupOperation(generation)) return;
                      if (result.yaml) {
                        const derivedName = file.name
                          .replace(/\.(osc\.yaml|yaml|yml|json|csv|tsv|xlsx)$/i, "")
                          .replace(/[^a-zA-Z0-9_-]/g, "-");
                        await cfs.manifests.register({
                          name: derivedName,
                          content: result.yaml,
                          source: "import",
                        });
                        if (!isCurrentSetupOperation(generation)) return;
                      }
                    } catch (err) {
                      if (isCurrentSetupOperation(generation)) {
                        errors.push(
                          `${file.name}: ${
                            err instanceof Error
                              ? err.message
                              : t("administration.messages.unknownError")
                          }`,
                        );
                      }
                    } finally {
                      if (isCurrentSetupOperation(generation)) {
                        doneCount += 1;
                        setBatchProgress({
                          done: doneCount,
                          total,
                          errors: [...errors],
                        });
                      }
                    }
                  },
                );

                if (!isCurrentSetupOperation(generation)) return;
                void refreshWorkspace().catch(() => {
                  // Route entry retries a transient workspace refresh.
                });
                if (errors.length === 0) {
                  batchNavigationTimerRef.current = setTimeout(() => {
                    batchNavigationTimerRef.current = null;
                    if (isCurrentSetupOperation(generation)) {
                      navigate("/manifests");
                    }
                  }, 1500);
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
                beginSetupOperation();
                setBatchFiles([]);
                setBatchProgress(null);
              }}
            >
              {t("new.extracted.text17")}
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          {batchFiles.map((file, index) => {
            const completed = batchProgress ? index < batchProgress.done : false;
            const errorMessage = batchProgress?.errors.find((entry) =>
              entry.startsWith(`${file.name}:`),
            );
            return (
              <div
                key={`${file.name}-${index}`}
                className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm ${
                  errorMessage
                    ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                    : completed
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                {errorMessage ? (
                  <DismissRegular className="h-4 w-4 shrink-0" />
                ) : completed ? (
                  <CheckmarkRegular className="h-4 w-4 shrink-0" />
                ) : (
                  <DocumentRegular className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                <span className="truncate">{file.name}</span>
                <span className="ml-auto shrink-0 text-xs opacity-70">
                  {fileSizeFormatter.format(file.size / 1024)} {t("new.extracted.text18")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  if (!editorStarted) {
    return (
      <>
        <BaselineCreationSetup
          method={creationMethod}
          onMethodChange={(nextMethod) => {
            beginSetupOperation();
            setCreationMethod(nextMethod);
            setError(null);
            setUrlFetchError(null);
            setSetupImportResult(null);
            setSelectedTemplate(null);
            setBatchFiles([]);
            setBatchProgress(null);
          }}
          name={name}
          onNameChange={setName}
          platform={platform}
          onPlatformChange={handlePlatformSwitch}
          uri={uri}
          onUriChange={(nextUri) => {
            beginSetupOperation();
            setUri(nextUri);
            setError(null);
            setUrlFetchError(null);
          }}
          importSummary={importSummary}
          importing={setupImporting}
          error={error ?? urlFetchError}
          selectedTemplateName={selectedTemplate?.name ?? null}
          onBrowseTemplates={() => setTemplatePickerOpen(true)}
          onFilesSelected={(files) => void handleSetupFiles(files)}
          canContinue={canPrepareEditor}
          continuing={preparingEditor || urlFetching}
          onContinue={() => void handlePrepareEditor()}
          onCancel={() => navigate("/manifests")}
          batchContent={batchContent}
        />
        <BaselineTemplatePickerDialog
          open={templatePickerOpen}
          loadingId={templateLoadingId}
          onOpenChange={setTemplatePickerOpen}
          onSelect={(entry) => void handleTemplateSelect(entry)}
        />
      </>
    );
  }

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

        <div className="max-w-xl">
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
        </div>
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
              <VisualManifestViewer
                source={yamlContent}
                editable
                platform={platform}
                onSourceChange={setYamlContent}
                onDraftValidityChange={setVisualDraftValid}
              />
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
          disabled={
            submitting ||
            !name.trim() ||
            (sourceType === "content" && (!visualSourceValid || !visualDraftValid))
          }
          icon={submitting ? <Spinner size="tiny" /> : undefined}
          title={
            sourceType === "content" && (!visualSourceValid || !visualDraftValid)
              ? t("new.visualValidationError")
              : undefined
          }
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
