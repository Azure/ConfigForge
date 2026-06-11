// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Generated-docs modal for the ManifestEditor page.
 *
 * Pure presentational component — reads + dispatches through
 * `useDocsModal` (from `state/useDocsModal.ts`). Extracted from
 * `index.tsx` in Phase C.1 of the page-split refactor.
 *
 * Rendered at the page root so the fixed-position backdrop stacks
 * correctly relative to other modals (CliRequiredModal, etc.).
 */
import React from "react";
import {
  DocumentRegular,
  CheckmarkRegular,
  CopyRegular,
  ArrowDownloadRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { Spinner } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { DocsModal as DocsModalState } from "../state/useDocsModal";

export interface DocsModalProps {
  docs: DocsModalState;
}

export const DocsModal = React.memo(function DocsModal({ docs }: DocsModalProps) {
  const {
    docsOpen,
    setDocsOpen,
    docsMarkdown,
    docsLoading,
    docsCopied,
    handleDocsCopy,
    handleDocsDownload,
  } = docs;
  const { t } = useTranslation("manifest-editor");

  if (!docsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <DocumentRegular className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {t("docs.title")}
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
              {docsCopied ? t("docs.copied") : t("docs.copy")}
            </button>
            <button
              onClick={handleDocsDownload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
            >
              <ArrowDownloadRegular className="h-3.5 w-3.5" />
              {t("docs.downloadMarkdown")}
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
  );
});
