// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Manifest content panel for the ManifestEditor page.
 *
 * Owns the format-tab strip, the Editor / Visual Builder switcher,
 * the Monaco-based source editor, and the visual resource-picker
 * grid. All wired through the `useManifestEditorState` hook (passed
 * in as `editorState`) — this component has no state of its own.
 *
 * Phase C.2 of the page-split refactor — the plan refers to this as
 * `<FormatTabs>` but the scope is the full content card, since the
 * tab strip + view switcher + editor all share the same hook
 * surface and live inside one bordered panel.
 */
import React from "react";
import yaml from "js-yaml";
import { useTranslation } from "react-i18next";
import { Spinner, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { ManifestEditor } from "../../../components/manifest-editor";
import { ResourcePicker } from "../../../components/resource-picker";
import { ResourceEditDialog } from "./ResourceEditDialog";
import { FORMAT_TABS, EDITOR_LANGUAGE } from "../helpers";
import type { ManifestEditorState } from "../state/useManifestEditorState";

export interface ManifestContentProps {
  editorState: ManifestEditorState;
  /** Narrow platform for the resource picker / editor decorations.
   * Undefined for cross-platform / mixed (means "show everything"). */
  editorPlatform: "windows" | "linux" | undefined;
  cisAvailable: boolean | undefined;
  manifestName: string;
  onResourceAdd: (resource: {
    name: string;
    type: string;
    properties: Record<string, unknown>;
    compliance?: { equals: unknown };
  }) => void;
}

export const ManifestContent = React.memo(function ManifestContent({
  editorState,
  editorPlatform,
  cisAvailable,
  manifestName,
  onResourceAdd,
}: ManifestContentProps) {
  const {
    editing,
    editedContent,
    setEditedContent,
    editView,
    setEditView,
    activeFormat,
    formatLoading,
    formatCache,
    handleFormatChange,
    isEditable,
    isReadOnly,
    currentDisplayContent,
  } = editorState;
  const { t } = useTranslation("manifest-editor");

  // Visual-builder per-resource edit dialog state.
  // Path: [i] = top-level resource at index i.
  //       [i, j] = nested resource j inside Group at top-level index i.
  // This lets Group resources expand inline and edit their nested resources
  // through the same dialog flow.
  const [editingResourcePath, setEditingResourcePath] = React.useState<number[] | null>(null);
  const [editingResource, setEditingResource] = React.useState<Record<string, unknown> | null>(null);

  // Walk into a resources tree along the given path. Returns the nested
  // resource OR null if any segment doesn't exist.
  const resolveAtPath = React.useCallback((doc: Record<string, unknown>, path: number[]): Record<string, unknown> | null => {
    let arr = Array.isArray(doc.resources) ? (doc.resources as Record<string, unknown>[]) : [];
    let current: Record<string, unknown> | null = null;
    for (let depth = 0; depth < path.length; depth++) {
      const idx = path[depth];
      if (idx < 0 || idx >= arr.length) return null;
      current = arr[idx] ?? null;
      if (depth < path.length - 1) {
        const props = (current?.properties ?? {}) as Record<string, unknown>;
        arr = Array.isArray(props.resources) ? (props.resources as Record<string, unknown>[]) : [];
      }
    }
    return current;
  }, []);

  const handleResourceEdit = React.useCallback(
    (path: number[]) => {
      try {
        const parsed = yaml.load(editedContent) as Record<string, unknown> | null;
        if (!parsed) return;
        const r = resolveAtPath(parsed, path);
        if (!r) return;
        setEditingResourcePath(path);
        setEditingResource(r);
      } catch {
        /* ignore parse errors — user can fix in source view */
      }
    },
    [editedContent, resolveAtPath],
  );

  // Splice `updated` into the resources tree at `path`, returning the new
  // tree. Mutates a CLONE so React state remains immutable across calls.
  const setAtPath = React.useCallback(
    (doc: Record<string, unknown>, path: number[], updated: Record<string, unknown>): void => {
      let arr = Array.isArray(doc.resources) ? (doc.resources as Record<string, unknown>[]) : [];
      for (let depth = 0; depth < path.length - 1; depth++) {
        const idx = path[depth];
        const parent = arr[idx];
        if (!parent) return;
        const parentProps = (parent.properties ?? {}) as Record<string, unknown>;
        arr = Array.isArray(parentProps.resources) ? [...(parentProps.resources as Record<string, unknown>[])] : [];
        parentProps.resources = arr;
        parent.properties = parentProps;
      }
      const last = path[path.length - 1];
      arr[last] = updated;
    },
    [],
  );

  const handleResourceEditSave = React.useCallback(
    (updated: Record<string, unknown>) => {
      if (!editingResourcePath) return;
      try {
        const doc = yaml.load(editedContent) as Record<string, unknown>;
        setAtPath(doc, editingResourcePath, updated);
        const newYaml = yaml.dump(doc, {
          indent: 2,
          lineWidth: 120,
          noRefs: true,
          sortKeys: false,
        });
        setEditedContent(newYaml);
        formatCache.current = { yaml: newYaml };
      } catch {
        /* should not happen — we just parsed it above */
      }
      setEditingResourcePath(null);
      setEditingResource(null);
    },
    [editingResourcePath, editedContent, setEditedContent, formatCache, setAtPath],
  );

  // Remove a resource at the given path (top-level or nested inside Group).
  const handleResourceRemove = React.useCallback(
    (path: number[]) => {
      try {
        const doc = yaml.load(editedContent) as Record<string, unknown>;
        let arr = Array.isArray(doc.resources) ? (doc.resources as Record<string, unknown>[]) : [];
        for (let depth = 0; depth < path.length - 1; depth++) {
          const idx = path[depth];
          const parent = arr[idx];
          if (!parent) return;
          const parentProps = (parent.properties ?? {}) as Record<string, unknown>;
          arr = Array.isArray(parentProps.resources) ? [...(parentProps.resources as Record<string, unknown>[])] : [];
          parentProps.resources = arr;
          parent.properties = parentProps;
        }
        arr.splice(path[path.length - 1], 1);
        if (path.length === 1) {
          doc.resources = arr;
        }
        const newYaml = yaml.dump(doc, {
          indent: 2,
          lineWidth: 120,
          noRefs: true,
          sortKeys: false,
        });
        setEditedContent(newYaml);
        formatCache.current = { yaml: newYaml };
      } catch {
        /* ignore */
      }
    },
    [editedContent, setEditedContent, formatCache],
  );

  const handleResourceEditCancel = React.useCallback(() => {
    setEditingResourcePath(null);
    setEditingResource(null);
  }, []);

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t("content.sectionTitle")}</h2>
          {activeFormat === "mof" && editing && (
            <span className="text-xs text-slate-400">{t("content.mofReadOnly")}</span>
          )}
        </div>
        {/* v0.3.0 (#14): warn the user when they have unsaved YAML/JSON
            edits and click a different format tab. The buffer is
            preserved in `formatCache.current[activeFormat]`, but the
            visible editor will switch to the other format's content —
            without this notice the user can't tell their edits are
            still around. */}
        {editing && editedContent !== currentDisplayContent && isEditable && (
          <div className="mt-3">
            <MessageBar intent="info">
              <MessageBarBody>
                {t("content.unsavedFormatChanges", { format: activeFormat.toUpperCase() })}
              </MessageBarBody>
            </MessageBar>
          </div>
        )}
        {/* Edit View Toggle + Format Tabs */}
        <div className="mt-3 flex items-center justify-between">
          {editing && (
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              <button
                onClick={() => setEditView("editor")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  editView === "editor"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                }`}
              >
                {t("content.editorView")}
              </button>
              <button
                onClick={() => setEditView("visual")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  editView === "visual"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                }`}
              >
                {t("content.visualBuilderView")}
              </button>
            </div>
          )}
          {!editing && <div />}
          <div className="flex gap-1">
            {FORMAT_TABS.map(({ key }) => (
              <button
                key={key}
                onClick={() => {
                  handleFormatChange(key);
                  setEditView("editor");
                }}
                disabled={formatLoading || editing}
                title={editing ? t("content.unsavedFormatChanges", { format: activeFormat.toUpperCase() }) : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeFormat === key && editView === "editor"
                    ? "bg-blue-600 text-white"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                } disabled:opacity-50`}
              >
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {editing && editView === "visual" ? (
        <div className="p-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Add resource */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t("visual.addResource")}
              </h3>
              <ResourcePicker onSelect={onResourceAdd} platform={editorPlatform} />
            </div>

            {/* Current resources */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t("visual.currentResources", {
                  count: (() => {
                    try {
                      const parsed = yaml.load(editedContent) as Record<string, unknown> | null;
                      return Array.isArray(parsed?.resources)
                        ? (parsed.resources as unknown[]).length
                        : 0;
                    } catch {
                      return 0;
                    }
                  })(),
                })}
              </h3>
              {(() => {
                try {
                  const parsed = yaml.load(editedContent) as Record<string, unknown> | null;
                  const resources = Array.isArray(parsed?.resources)
                    ? (parsed.resources as Record<string, unknown>[])
                    : [];
                  if (resources.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 py-12 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                        {t("visual.noResources")}
                        <br />
                        {t("visual.usePicker")}
                      </div>
                    );
                  }
                  return (
                    <div className="max-h-[400px] space-y-2 overflow-y-auto">
                      {resources.map((r, i) => {
                        const isGroup = (r.type ?? r.Type) === "Microsoft.OSConfig/Group";
                        const groupResources = isGroup
                          ? (((r.properties ?? {}) as Record<string, unknown>).resources as Record<string, unknown>[] | undefined) ?? []
                          : [];
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                                  {String(r.name ?? r.Name ?? t("visual.resourceFallback", { index: i + 1 }))}
                                  {isGroup && (
                                    <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                      {t("visual.groupCount", { count: groupResources.length })}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {String(r.type ?? r.Type ?? t("visual.unknown"))}
                                </p>
                              </div>
                              <div className="ml-3 flex shrink-0 items-center gap-3">
                                {!isGroup && (
                                  <button
                                    type="button"
                                    onClick={() => handleResourceEdit([i])}
                                    className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                  >
                                    {t("actions.edit")}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleResourceRemove([i])}
                                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                                >
                                  {t("actions.remove")}
                                </button>
                              </div>
                            </div>
                            {isGroup && groupResources.length > 0 && (
                              <div className="ml-4 mt-1 space-y-1 border-l-2 border-purple-200 pl-3 dark:border-purple-900/40">
                                {groupResources.map((nested, j) => (
                                  <div
                                    key={j}
                                    className="flex items-center justify-between rounded-md border border-slate-200/70 bg-white px-3 py-2 dark:border-slate-700/70 dark:bg-slate-800/50"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                        {String(nested.type ?? nested.Type ?? t("visual.unknown"))}
                                      </p>
                                      <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                                        {(() => {
                                          const p = (nested.properties ?? {}) as Record<string, unknown>;
                                          return String(p.path ?? p.name ?? p.find ?? p.keyPath ?? "");
                                        })()}
                                      </p>
                                    </div>
                                    <div className="ml-3 flex shrink-0 items-center gap-3">
                                      <button
                                        type="button"
                                        onClick={() => handleResourceEdit([i, j])}
                                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                      >
                                        {t("actions.edit")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleResourceRemove([i, j])}
                                        className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                                      >
                                        {t("actions.remove")}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                } catch {
                  return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
                      {t("visual.parseError")}
                    </div>
                  );
                }
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative h-[calc(100vh-340px)] min-h-[520px] p-4">
          {formatLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-slate-900/60">
              <Spinner size="medium" />
            </div>
          )}
          <ManifestEditor
            value={editing ? editedContent : currentDisplayContent}
            onChange={editing && isEditable ? setEditedContent : undefined}
            readOnly={isReadOnly}
            language={EDITOR_LANGUAGE[activeFormat]}
            height="100%"
            platform={editorPlatform}
            showCisCrossref={cisAvailable === true}
            manifestId={manifestName}
            showResourceExplorer
          />
        </div>
      )}

      <ResourceEditDialog
        open={editingResourcePath !== null}
        resource={editingResource}
        platform={editorPlatform}
        otherResourceNames={(() => {
          if (!editingResourcePath) return [];
          try {
            const parsed = yaml.load(editedContent) as Record<string, unknown> | null;
            if (!parsed) return [];
            // Collect names from siblings of the editing resource's parent array.
            // For top-level path [i], siblings = top-level resources except i.
            // For nested path [i, j], siblings = top-level resources at any index OTHER than i
            // (the renamed nested resource doesn't collide with top-level names; we
            // only enforce uniqueness within the visual builder's top-level list).
            const top = Array.isArray(parsed.resources)
              ? (parsed.resources as Record<string, unknown>[])
              : [];
            const skipTop = editingResourcePath[0];
            return top
              .map((r, idx) => (idx === skipTop ? null : (r.name ?? r.Name)))
              .filter((n): n is string => typeof n === "string");
          } catch {
            return [];
          }
        })()}
        onCancel={handleResourceEditCancel}
        onSave={handleResourceEditSave}
      />
    </div>
  );
});
