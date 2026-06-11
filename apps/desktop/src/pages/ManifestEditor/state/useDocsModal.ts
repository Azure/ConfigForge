// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Docs modal flow for the ManifestEditor page.
 *
 * Extracted from `index.tsx` in Phase B.3 of the page-split refactor.
 * Owns the docs modal state plus the v0.1.11 copy-timer cleanup
 * (without which a navigation away within 2 s of clicking Copy fires
 * `setDocsCopied(false)` on a torn-down component — React 18 warns;
 * in strict mode it produces real bugs).
 *
 * Decoupled from the editor state: callers pass the current YAML
 * content to `handleGenerateDocs(content)` directly. That keeps the
 * hook usable from any future location without dragging the load
 * lifecycle along.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cfs } from "../../../lib/cfs";

export interface DocsModal {
  docsOpen: boolean;
  setDocsOpen: (open: boolean) => void;
  docsMarkdown: string;
  docsFilename: string;
  docsLoading: boolean;
  docsCopied: boolean;
  docsCopiedTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  /** Generate docs for `manifestName` with `content` as the source.
   * Opens the modal and writes markdown / filename / loading state. */
  handleGenerateDocs: (content: string) => Promise<void>;
  /** Browser download of the generated markdown via an in-page <a>. */
  handleDocsDownload: () => void;
  /** Copy-to-clipboard with a 2-second "copied" toast that survives
   * unmount safely (timer is cleared in the cleanup effect). */
  handleDocsCopy: () => Promise<void>;
}

export function useDocsModal(manifestName: string): DocsModal {
  const { t } = useTranslation("manifest-editor");
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsMarkdown, setDocsMarkdown] = useState("");
  const [docsFilename, setDocsFilename] = useState("");
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsCopied, setDocsCopied] = useState(false);
  // v0.1.11 fix — track the docs-copied reset timer so we clear it on
  // unmount. Without this, navigating away within 2s of clicking
  // Copy fires `setDocsCopied(false)` on a torn-down component
  // (React 18 warns; in strict mode it produces real bugs because
  // the *next* mount can see the stale closure).
  const docsCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup any pending docs-copied reset on unmount.
  useEffect(() => {
    return () => {
      if (docsCopiedTimerRef.current !== null) {
        clearTimeout(docsCopiedTimerRef.current);
        docsCopiedTimerRef.current = null;
      }
    };
  }, []);

  const handleGenerateDocs = useCallback(
    async (content: string) => {
      setDocsLoading(true);
      setDocsOpen(true);
      setDocsCopied(false);
      try {
        const json = await cfs.docs.generate({ name: manifestName, content });
        setDocsMarkdown(json.markdown);
        setDocsFilename(json.filename);
      } catch (err) {
        setDocsMarkdown(
          t("docs.errorMarkdown", {
            message: err instanceof Error ? err.message : t("errors.generateDocsFailed"),
          }),
        );
        setDocsFilename(`${manifestName}.md`);
      } finally {
        setDocsLoading(false);
      }
    },
    [manifestName, t],
  );

  const handleDocsDownload = useCallback(() => {
    const blob = new Blob([docsMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = docsFilename;
    a.click();
    URL.revokeObjectURL(url);
  }, [docsMarkdown, docsFilename]);

  const handleDocsCopy = useCallback(async () => {
    await navigator.clipboard.writeText(docsMarkdown);
    setDocsCopied(true);
    if (docsCopiedTimerRef.current !== null) {
      clearTimeout(docsCopiedTimerRef.current);
    }
    docsCopiedTimerRef.current = setTimeout(() => {
      setDocsCopied(false);
      docsCopiedTimerRef.current = null;
    }, 2000);
  }, [docsMarkdown]);

  return useMemo<DocsModal>(
    () => ({
      docsOpen,
      setDocsOpen,
      docsMarkdown,
      docsFilename,
      docsLoading,
      docsCopied,
      docsCopiedTimerRef,
      handleGenerateDocs,
      handleDocsDownload,
      handleDocsCopy,
    }),
    [
      docsOpen,
      docsMarkdown,
      docsFilename,
      docsLoading,
      docsCopied,
      handleGenerateDocs,
      handleDocsDownload,
      handleDocsCopy,
    ],
  );
}
