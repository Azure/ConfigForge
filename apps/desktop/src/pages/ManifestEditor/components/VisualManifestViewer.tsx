// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AddRegular,
  ArrowDownRegular,
  ArrowUpRegular,
  ChevronDownRegular,
  DeleteRegular,
} from "@fluentui/react-icons";
import {
  DESIRED_VALUE_COLUMN,
  SETTING_NAME_COLUMN,
  addVisualSettingSource,
  formatVisualValue,
  groupVisualSettings,
  nextVisualSort,
  parseVisualCellInput,
  parseVisualManifest,
  removeVisualSettingsSource,
  sortVisualSettings,
  updateVisualCellSource,
  validateVisualSettings,
  visualResourceTemplatesForPlatform,
  type VisualEditError,
  type VisualSetting,
  type VisualSettingGroup,
  type VisualSortState,
} from "../visual-viewer";

export interface VisualManifestViewerProps {
  source: string;
  editable?: boolean;
  platform?: "windows" | "linux";
  onSourceChange?: (source: string) => void;
  onDraftValidityChange?: (valid: boolean) => void;
}

type ParsedGroups =
  | { kind: "ready"; groups: VisualSettingGroup[] }
  | { kind: "error" };

interface ActiveCell {
  settingId: string;
  column: string;
}

function categoryName(resourceType: string): string {
  const slash = resourceType.lastIndexOf("/");
  return slash >= 0 && slash < resourceType.length - 1
    ? resourceType.slice(slash + 1)
    : resourceType;
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function valueForColumn(setting: VisualSetting, column: string): unknown {
  if (column === SETTING_NAME_COLUMN) return setting.settingName;
  if (column === DESIRED_VALUE_COLUMN) return setting.desiredValue;
  return setting.properties[column];
}

function isStructuredValue(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

interface AddSettingMenuProps {
  platform?: "windows" | "linux";
  onAdd: (type: string) => void;
}

function AddSettingMenu({ platform, onAdd }: AddSettingMenuProps) {
  const { t } = useTranslation("manifest-editor");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const templates = visualResourceTemplatesForPlatform(platform);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white outline-none hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <AddRegular className="h-4 w-4" aria-hidden="true" />
        {t("visual.addSetting")}
        <ChevronDownRegular className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          {templates.map((template) => {
            const shortName = categoryName(template.type);
            return (
              <button
                key={template.type}
                type="button"
                role="menuitem"
                onClick={() => {
                  onAdd(template.type);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left outline-none hover:bg-slate-100 focus-visible:bg-slate-100 dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700"
              >
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                  {humanize(shortName)}
                </span>
                <code className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {template.type}
                </code>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const VisualManifestViewer = React.memo(function VisualManifestViewer({
  source,
  editable = false,
  platform,
  onSourceChange,
  onDraftValidityChange,
}: VisualManifestViewerProps) {
  const { t } = useTranslation("manifest-editor");
  const canEdit = editable && onSourceChange !== undefined;
  const regionRef = useRef<HTMLDivElement>(null);
  const cancelBlurRef = useRef(false);
  const [sortByType, setSortByType] = useState<Record<string, VisualSortState | null>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<VisualEditError | null>(null);
  const [cellError, setCellError] = useState<VisualEditError | null>(null);
  const [pageError, setPageError] = useState<VisualEditError | null>(null);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);

  const parsed = useMemo<ParsedGroups>(() => {
    try {
      return {
        kind: "ready",
        groups: groupVisualSettings(parseVisualManifest(source)),
      };
    } catch {
      return { kind: "error" };
    }
  }, [source]);

  const allSettings = useMemo(
    () => (parsed.kind === "ready" ? parsed.groups.flatMap((group) => group.settings) : []),
    [parsed],
  );
  const validationIssues = useMemo(
    () => validateVisualSettings(allSettings),
    [allSettings],
  );
  const validationIssueKeys = useMemo(
    () =>
      new Set(
        validationIssues.map((issue) => `${issue.settingId}:${issue.column}`),
      ),
    [validationIssues],
  );

  useEffect(() => {
    setSelected(new Set());
    setPageError(null);
    setDraftError(null);
    setCellError(null);
  }, [source]);

  useEffect(() => {
    if (!canEdit) return;
    onDraftValidityChange?.(draftError === null && cellError === null);
    return () => onDraftValidityChange?.(true);
  }, [canEdit, cellError, draftError, onDraftValidityChange]);

  useEffect(() => {
    if (!pendingEditId || parsed.kind !== "ready") return;
    const setting = allSettings.find((candidate) => candidate.id === pendingEditId);
    if (!setting) return;
    setDraft(setting.settingName);
    setCellError(null);
    setActiveCell({ settingId: setting.id, column: SETTING_NAME_COLUMN });
    regionRef.current
      ?.querySelector<HTMLElement>(`[data-setting-id="${setting.id}"]`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setPendingEditId(null);
  }, [allSettings, parsed.kind, pendingEditId]);

  const errorText = (error: VisualEditError): string => t(`visual.errors.${error}`);

  const beginEdit = (setting: VisualSetting, column: string) => {
    setDraft(formatVisualValue(valueForColumn(setting, column)));
    setDraftError(null);
    setCellError(null);
    onDraftValidityChange?.(true);
    setActiveCell({ settingId: setting.id, column });
  };

  const cancelEdit = () => {
    cancelBlurRef.current = true;
    setActiveCell(null);
    setDraftError(null);
    setCellError(null);
    onDraftValidityChange?.(true);
    queueMicrotask(() => {
      cancelBlurRef.current = false;
    });
  };

  const commitEdit = (setting: VisualSetting, column: string) => {
    if (cancelBlurRef.current) return;
    const result = updateVisualCellSource(source, setting, column, draft);
    if (!result.ok) {
      setDraftError(result.error);
      setCellError(result.error);
      onDraftValidityChange?.(false);
      return;
    }
    setActiveCell(null);
    setDraftError(null);
    setCellError(null);
    onDraftValidityChange?.(true);
    onSourceChange?.(result.source);
  };

  const updateDraft = (setting: VisualSetting, column: string, value: string) => {
    setDraft(value);
    const result = parseVisualCellInput(
      value,
      valueForColumn(setting, column),
      setting,
      column,
    );
    setDraftError(result.ok ? null : result.error);
    setCellError(null);
    onDraftValidityChange?.(result.ok);
  };

  const handleAdd = (type: string, columns: readonly string[] = []) => {
    const result = addVisualSettingSource(source, type, columns);
    if (!result.ok) {
      setPageError(result.error);
      return;
    }
    setPageError(null);
    setPendingEditId(result.settingId);
    onSourceChange?.(result.source);
  };

  const handleDelete = () => {
    const rows = allSettings.filter((setting) => selected.has(setting.id));
    if (rows.length === 0) return;
    const result = removeVisualSettingsSource(source, rows);
    if (!result.ok) {
      setPageError(result.error);
      return;
    }
    setPageError(null);
    setSelected(new Set());
    onSourceChange?.(result.source);
  };

  if (parsed.kind === "error") {
    return (
      <div className="flex min-h-80 items-center justify-center p-8">
        <div
          role="status"
          className="max-w-xl border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {t("viewer.visualParseError")}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label={t("viewer.visualRegionLabel")}
      className="max-h-[min(62vh,48rem)] min-h-[28rem] overflow-y-auto [scrollbar-gutter:stable]"
    >
      {canEdit && (
        <div
          role="toolbar"
          aria-label={t("visual.editToolbar")}
          className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-6"
        >
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t("visual.spreadsheetTitle")}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("visual.editHint")}</p>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <>
                <span
                  aria-live="polite"
                  className="text-xs tabular-nums text-slate-500 dark:text-slate-400"
                >
                  {t("visual.selectedCount", { count: selected.size })}
                </span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-sm font-semibold text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                  <DeleteRegular className="h-4 w-4" aria-hidden="true" />
                  {t("visual.deleteSelected", { count: selected.size })}
                </button>
              </>
            )}
            <AddSettingMenu platform={platform} onAdd={handleAdd} />
          </div>
        </div>
      )}

      {pageError && (
        <div
          role="alert"
          className="mx-5 mt-4 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200 sm:mx-6"
        >
          {errorText(pageError)}
        </div>
      )}

      {canEdit && validationIssues.length > 0 && (
        <div
          role="alert"
          className="mx-5 mt-4 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 sm:mx-6"
        >
          {t("visual.requiredCells", { count: validationIssues.length })}
        </div>
      )}

      {parsed.groups.length === 0 ? (
        <div className="flex min-h-72 items-center justify-center p-8 text-sm text-slate-500 dark:text-slate-400">
          {t("viewer.empty")}
        </div>
      ) : (
        <div className="space-y-7 px-5 py-5 sm:px-6">
          {parsed.groups.map((group) => {
            const sort = sortByType[group.resourceType] ?? null;
            const rows = sortVisualSettings(group.settings, sort);
            const shortName = categoryName(group.resourceType);
            const selectedInGroup = group.settings.filter((setting) =>
              selected.has(setting.id),
            ).length;
            const allSelected =
              group.settings.length > 0 && selectedInGroup === group.settings.length;

            return (
              <section key={group.resourceType} aria-labelledby={`visual-group-${shortName}`}>
                <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <h3
                    id={`visual-group-${shortName}`}
                    className="text-sm font-semibold text-slate-950 dark:text-slate-100"
                  >
                    {shortName}
                  </h3>
                  <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {t("viewer.settingCount", { count: group.settings.length })}
                  </span>
                  <code
                    className="min-w-0 flex-1 truncate text-[11px] text-slate-400 dark:text-slate-500"
                    title={group.resourceType}
                  >
                    {group.resourceType}
                  </code>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleAdd(group.resourceType, group.columns)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300 dark:hover:bg-blue-950/30"
                    >
                      <AddRegular className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("visual.addRow")}
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                  <table
                    aria-label={t("viewer.categoryTableLabel", { category: shortName })}
                    className="min-w-max border-collapse text-left text-sm"
                  >
                    <thead className="bg-slate-100 dark:bg-slate-800">
                      <tr>
                        {canEdit && (
                          <th
                            scope="col"
                            className="sticky left-0 z-[2] w-11 border-b border-r border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={allSelected}
                              aria-label={t("visual.selectAllInCategory", {
                                category: shortName,
                              })}
                              onChange={() => {
                                setSelected((current) => {
                                  const next = new Set(current);
                                  for (const setting of group.settings) {
                                    if (allSelected) next.delete(setting.id);
                                    else next.add(setting.id);
                                  }
                                  return next;
                                });
                              }}
                              className="h-4 w-4 accent-blue-600"
                            />
                          </th>
                        )}
                        {group.columns.map((column) => {
                          const active = sort?.column === column;
                          const label =
                            column === SETTING_NAME_COLUMN
                              ? t("viewer.settingName")
                              : column === DESIRED_VALUE_COLUMN
                                ? t("resourceDetails.desiredValue")
                                : column;
                          return (
                            <th
                              key={column}
                              scope="col"
                              aria-sort={active ? sort.direction : undefined}
                              className={`border-b border-r border-slate-200 px-0 font-semibold text-slate-700 last:border-r-0 dark:border-slate-700 dark:text-slate-200 ${
                                column === SETTING_NAME_COLUMN
                                  ? `sticky ${canEdit ? "left-11" : "left-0"} z-[1] bg-slate-100 dark:bg-slate-800`
                                  : ""
                              }`}
                            >
                              <button
                                type="button"
                                aria-label={label}
                                onClick={() => {
                                  setSortByType((current) => ({
                                    ...current,
                                    [group.resourceType]: nextVisualSort(
                                      current[group.resourceType] ?? null,
                                      column,
                                    ),
                                  }));
                                }}
                                className="flex min-h-10 w-full min-w-40 items-center justify-between gap-3 px-3 py-2 text-left outline-none hover:bg-slate-200/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-slate-700/70"
                              >
                                <span>{label}</span>
                                {active && (
                                  <span data-testid="sort-direction-icon" aria-hidden="true">
                                    {sort.direction === "ascending" ? (
                                      <ArrowUpRegular className="h-3.5 w-3.5" />
                                    ) : (
                                      <ArrowDownRegular className="h-3.5 w-3.5" />
                                    )}
                                  </span>
                                )}
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
                      {rows.map((setting) => {
                        const isSelected = selected.has(setting.id);
                        return (
                          <tr
                            key={setting.id}
                            data-setting-id={setting.id}
                            className={`align-top ${
                              isSelected ? "bg-blue-50/70 dark:bg-blue-950/20" : ""
                            }`}
                          >
                            {canEdit && (
                              <td className="sticky left-0 z-[1] border-r border-slate-100 bg-inherit px-3 py-2.5 dark:border-slate-800">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  aria-label={t("visual.selectRow", {
                                    name:
                                      setting.settingName || t("viewer.unnamedSetting"),
                                  })}
                                  onChange={() => {
                                    setSelected((current) => {
                                      const next = new Set(current);
                                      if (next.has(setting.id)) next.delete(setting.id);
                                      else next.add(setting.id);
                                      return next;
                                    });
                                  }}
                                  className="h-4 w-4 accent-blue-600"
                                />
                              </td>
                            )}
                            {group.columns.map((column) => {
                              const rawValue = valueForColumn(setting, column);
                              const formatted = formatVisualValue(rawValue);
                              const visibleValue =
                                formatted ||
                                (column === SETTING_NAME_COLUMN
                                  ? t("viewer.unnamedSetting")
                                  : t("viewer.emptyValue"));
                              const isEditing =
                                canEdit &&
                                activeCell?.settingId === setting.id &&
                                activeCell.column === column;
                              const visuallyEditable =
                                canEdit &&
                                (column !== DESIRED_VALUE_COLUMN ||
                                  setting.location.desiredBinding !== undefined);
                              const cellLabel =
                                column === SETTING_NAME_COLUMN
                                  ? t("viewer.settingName")
                                  : column === DESIRED_VALUE_COLUMN
                                    ? t("resourceDetails.desiredValue")
                                    : column;
                              const editorClass =
                                "w-full min-w-36 rounded border border-blue-500 bg-white px-2 py-1.5 text-sm text-slate-950 outline-none ring-2 ring-blue-200 dark:bg-slate-950 dark:text-slate-100 dark:ring-blue-900";
                              const requiredMissing = validationIssueKeys.has(
                                `${setting.id}:${column}`,
                              );

                              return (
                                <td
                                  key={column}
                                  title={!isEditing && formatted ? formatted : undefined}
                                  className={`max-w-[34rem] min-w-40 border-r border-slate-100 p-0 text-slate-700 last:border-r-0 dark:border-slate-800 dark:text-slate-300 ${
                                    column === SETTING_NAME_COLUMN
                                      ? `sticky ${canEdit ? "left-11" : "left-0"} bg-inherit font-medium text-slate-950 dark:text-slate-100`
                                      : ""
                                  }`}
                                >
                                  {isEditing ? (
                                    <div className="p-1.5">
                                      {isStructuredValue(rawValue) || draft.includes("\n") ? (
                                        <textarea
                                          autoFocus
                                          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                                          value={draft}
                                          aria-label={t("visual.editCell", {
                                            field: cellLabel,
                                            name:
                                              setting.settingName ||
                                              t("viewer.unnamedSetting"),
                                          })}
                                          aria-invalid={cellError ? true : undefined}
                                          onChange={(event) =>
                                            updateDraft(setting, column, event.target.value)
                                          }
                                          onBlur={() => commitEdit(setting, column)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Escape") {
                                              event.preventDefault();
                                              cancelEdit();
                                            } else if (event.key === "Enter" && !event.shiftKey) {
                                              event.preventDefault();
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          className={`${editorClass} resize-y font-mono text-xs`}
                                        />
                                      ) : (
                                        <input
                                          autoFocus
                                          type="text"
                                          value={draft}
                                          aria-label={t("visual.editCell", {
                                            field: cellLabel,
                                            name:
                                              setting.settingName ||
                                              t("viewer.unnamedSetting"),
                                          })}
                                          aria-invalid={cellError ? true : undefined}
                                          onChange={(event) =>
                                            updateDraft(setting, column, event.target.value)
                                          }
                                          onBlur={() => commitEdit(setting, column)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Escape") {
                                              event.preventDefault();
                                              cancelEdit();
                                            } else if (event.key === "Enter") {
                                              event.preventDefault();
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          className={editorClass}
                                        />
                                      )}
                                      {cellError && (
                                        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
                                          {errorText(cellError)}
                                        </p>
                                      )}
                                    </div>
                                  ) : visuallyEditable ? (
                                    <button
                                      type="button"
                                      onClick={() => beginEdit(setting, column)}
                                      aria-label={t("visual.editCell", {
                                        field: cellLabel,
                                        name:
                                          setting.settingName || t("viewer.unnamedSetting"),
                                      })}
                                      aria-invalid={requiredMissing ? true : undefined}
                                      className={`block min-h-10 w-full px-3 py-2.5 text-left outline-none hover:bg-blue-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-blue-950/20 ${
                                        requiredMissing
                                          ? "bg-amber-50 ring-1 ring-inset ring-amber-400 dark:bg-amber-950/20"
                                          : ""
                                      }`}
                                    >
                                      <span className="block whitespace-pre-wrap break-words">
                                        {visibleValue}
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="block whitespace-pre-wrap break-words px-3 py-2.5">
                                      {visibleValue}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
});
