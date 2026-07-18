// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React from "react";
import { useTranslation } from "react-i18next";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { ArrowUndoRegular, CodeRegular, TableRegular } from "@fluentui/react-icons";
import { ManifestEditor } from "../../../components/manifest-editor";
import { FORMAT_TABS, EDITOR_LANGUAGE } from "../helpers";
import { dumpVisualManifest } from "../visual-viewer";
import type { ManifestEditorState } from "../state/useManifestEditorState";
import { VisualManifestViewer } from "./VisualManifestViewer";

export type ManifestViewerMode = "code" | "visual";

export interface ManifestContentProps {
  editorState: ManifestEditorState;
  editorPlatform: "windows" | "linux" | undefined;
  cisAvailable: boolean | undefined;
  manifestName: string;
  viewerMode: ManifestViewerMode;
  onViewerModeChange: (mode: ManifestViewerMode) => void;
  onVisualDraftValidityChange?: (valid: boolean) => void;
}

export const ManifestContent = React.memo(function ManifestContent({
  editorState,
  editorPlatform,
  cisAvailable,
  manifestName,
  viewerMode,
  onViewerModeChange,
  onVisualDraftValidityChange,
}: ManifestContentProps) {
  const {
    editing,
    editedContent,
    setEditedContent,
    savedContent,
    editView,
    setEditView,
    activeFormat,
    setActiveFormat,
    formatLoading,
    formatCache,
    handleFormatChange,
    isEditable,
    isReadOnly,
    currentDisplayContent,
    setError,
  } = editorState;
  const { t } = useTranslation("manifest-editor");
  const contentRef = React.useRef(editedContent);
  const lastCodeEditAtRef = React.useRef(0);
  const previousEditingRef = React.useRef(editing);
  const [undoStack, setUndoStack] = React.useState<string[]>([]);

  React.useEffect(() => {
    contentRef.current = editedContent;
  }, [editedContent]);

  React.useEffect(() => {
    if (editing !== previousEditingRef.current) {
      setUndoStack([]);
      lastCodeEditAtRef.current = 0;
      contentRef.current = editedContent;
      previousEditingRef.current = editing;
    }
  }, [editedContent, editing]);

  const applyEditedContent = (next: string, checkpoint: boolean) => {
    const current = contentRef.current;
    if (next === current) return;
    const now = Date.now();
    setUndoStack((stack) => {
      if (!checkpoint && stack.length > 0 && now - lastCodeEditAtRef.current < 750) {
        return stack;
      }
      return [...stack, current].slice(-50);
    });
    lastCodeEditAtRef.current = checkpoint ? 0 : now;
    contentRef.current = next;
    setEditedContent(next);
  };

  const handleUndo = () => {
    const previous = undoStack.at(-1);
    if (previous === undefined) return;
    setUndoStack((stack) => stack.slice(0, -1));
    lastCodeEditAtRef.current = 0;
    contentRef.current = previous;
    formatCache.current[activeFormat] = previous;
    setEditedContent(previous);
  };

  const switchToVisualEdit = () => {
    if (activeFormat === "json") {
      try {
        const previousYaml = formatCache.current.yaml ?? savedContent;
        const yamlSource = dumpVisualManifest(JSON.parse(editedContent));
        formatCache.current.yaml = yamlSource;
        contentRef.current = yamlSource;
        setUndoStack(
          previousYaml && previousYaml !== yamlSource ? [previousYaml] : [],
        );
        lastCodeEditAtRef.current = 0;
        setEditedContent(yamlSource);
        setActiveFormat("yaml");
      } catch {
        setError(t("visual.errors.invalidJson"));
        return;
      }
    }
    setEditView("visual");
  };

  const handleVisualSourceChange = (source: string) => {
    formatCache.current.yaml = source;
    applyEditedContent(source, true);
  };

  const visualActive = editing ? editView === "visual" : viewerMode === "visual";
  const codeActive = !visualActive;
  const visualSource = editing ? editedContent : formatCache.current.yaml ?? "";

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t("content.sectionTitle")}
          </h2>
          {activeFormat === "mof" && editing && (
            <span className="text-xs text-slate-400">{t("content.mofReadOnly")}</span>
          )}
        </div>

        {editing && editedContent !== currentDisplayContent && isEditable && codeActive && (
          <div className="mt-3">
            <MessageBar intent="info">
              <MessageBarBody>
                {t("content.unsavedFormatChanges", { format: activeFormat.toUpperCase() })}
              </MessageBarBody>
            </MessageBar>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label={t(editing ? "viewer.editModeLabel" : "viewer.modeLabel")}
              className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-950"
            >
              <button
                type="button"
                onClick={() => {
                  if (editing) setEditView("editor");
                  else onViewerModeChange("code");
                }}
                aria-pressed={codeActive}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  codeActive
                    ? "bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300"
                    : "text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                <CodeRegular className="h-4 w-4" aria-hidden="true" />
                {t("viewer.code")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editing) switchToVisualEdit();
                  else onViewerModeChange("visual");
                }}
                aria-pressed={visualActive}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  visualActive
                    ? "bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300"
                    : "text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                <TableRegular className="h-4 w-4" aria-hidden="true" />
                {t("viewer.visual")}
              </button>
            </div>
            {editing && (
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowUndoRegular />}
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                title={t("actions.undoEditTitle")}
              >
                {t("actions.undoEdit")}
              </Button>
            )}
          </div>

          {codeActive && (
            <div
              role="tablist"
              aria-label={t("viewer.formatLabel")}
              className="flex gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800"
            >
              {FORMAT_TABS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeFormat === key}
                  onClick={() => void handleFormatChange(key)}
                  disabled={formatLoading || editing}
                  title={
                    editing
                      ? t("content.unsavedFormatChanges", {
                          format: activeFormat.toUpperCase(),
                        })
                      : undefined
                  }
                  className={`rounded px-3 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    activeFormat === key
                      ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  } disabled:opacity-50`}
                >
                  {t(`tabs.${key}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!editing && (
        <div className="border-b border-slate-200 px-6 py-2 dark:border-slate-800">
          <MessageBar intent="info">
            <MessageBarBody>{t("content.readOnlyHint")}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      {visualActive ? (
        <VisualManifestViewer
          source={visualSource}
          editable={editing}
          platform={editorPlatform}
          onSourceChange={editing ? handleVisualSourceChange : undefined}
          onDraftValidityChange={
            editing ? onVisualDraftValidityChange : undefined
          }
        />
      ) : (
        <div className="relative h-[min(62vh,48rem)] min-h-[32rem] p-4">
          {formatLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-slate-900/60">
              <Spinner size="medium" />
            </div>
          )}
          <ManifestEditor
            value={editing ? editedContent : currentDisplayContent}
            onChange={
              editing && isEditable
                ? (next) => applyEditedContent(next, false)
                : undefined
            }
            readOnly={isReadOnly}
            readOnlyMessage={t("content.readOnlyHint")}
            language={EDITOR_LANGUAGE[activeFormat]}
            height="100%"
            platform={editorPlatform}
            showCisCrossref={cisAvailable === true}
            manifestId={manifestName}
            showResourceExplorer
          />
        </div>
      )}
    </div>
  );
});
