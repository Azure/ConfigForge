// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AddRegular,
  ArrowDownRegular,
  ArrowUpRegular,
  DeleteRegular,
  InfoRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Tooltip,
} from "@fluentui/react-components";
import {
  DESIRED_VALUE_COLUMN,
  SETTING_NAME_COLUMN,
  addVisualSettingSource,
  appendVisualArrayItemSource,
  formatVisualValue,
  groupVisualSettings,
  nextVisualSort,
  parseVisualArrayItemInput,
  parseVisualCellInput,
  parseVisualManifest,
  removeVisualSettingsSource,
  sortVisualSettings,
  updateVisualArrayItemSource,
  updateVisualCellSource,
  validateVisualSettings,
  visualResourceTemplatesForPlatform,
  type VisualEditError,
  type VisualSetting,
  type VisualSettingGroup,
  type VisualSortState,
} from "../visual-viewer";
import { AddSettingsPane } from "./AddSettingsPane";

export interface VisualManifestViewerProps {
  source: string;
  editable?: boolean;
  platform?: "windows" | "linux";
  onSourceChange?: (source: string) => void;
  onDraftValidityChange?: (valid: boolean) => void;
  autoFocusFirstCell?: boolean;
}

type ParsedGroups = { kind: "ready"; groups: VisualSettingGroup[] } | { kind: "error" };

interface ActiveCell {
  settingId: string;
  column: string;
  arrayIndex?: number;
}

interface NavigationCell extends ActiveCell {
  groupType: string;
  columns: readonly string[];
  rowIndex: number;
  rowCount: number;
}

interface ReadOnlyNotice {
  left: number;
  top: number;
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

function isVisualCellEditable(setting: VisualSetting, column: string): boolean {
  return column !== DESIRED_VALUE_COLUMN || setting.location.desiredBinding !== undefined;
}

function isStructuredValue(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

function visualColumnMinimumWidth(column: string): number {
  if (column === SETTING_NAME_COLUMN) return 400;
  if (column === DESIRED_VALUE_COLUMN || column === "value") return 128;
  if (["keyPath", "path", "omaUri"].includes(column)) return 260;
  if (["valueName", "subcategory", "find", "replace"].includes(column)) return 156;
  if (["valueType", "type", "mode", "owner", "group", "gid"].includes(column)) return 112;
  if (["content", "details", "description"].includes(column)) return 220;
  return 148;
}

function visualTableMinimumWidth(columns: readonly string[], canEdit: boolean): number {
  return (
    (canEdit ? 44 : 0) +
    columns.reduce((total, column) => total + visualColumnMinimumWidth(column), 0)
  );
}

function visualColumnWidth(columns: readonly string[], column: string, canEdit: boolean): string {
  const total =
    (canEdit ? 44 : 0) +
    columns.reduce((sum, candidate) => sum + visualColumnMinimumWidth(candidate), 0);
  const ratio = (visualColumnMinimumWidth(column) / total) * 100;
  return `${ratio}%`;
}

function visualSelectionColumnWidth(columns: readonly string[]): string {
  const total =
    44 + columns.reduce((sum, candidate) => sum + visualColumnMinimumWidth(candidate), 0);
  return `${(44 / total) * 100}%`;
}

const VISUAL_COLUMN_LABEL_KEYS: Record<string, string> = {
  append: "viewer.columns.append",
  content: "viewer.columns.content",
  exists: "viewer.columns.exists",
  find: "viewer.columns.find",
  gid: "viewer.columns.gid",
  group: "viewer.columns.group",
  ignoreCase: "viewer.columns.ignoreCase",
  keyPath: "viewer.columns.registryPath",
  loaded: "viewer.columns.loaded",
  mode: "viewer.columns.mode",
  name: "viewer.columns.name",
  owner: "viewer.columns.owner",
  path: "viewer.columns.path",
  replace: "viewer.columns.replace",
  subcategory: "viewer.columns.subcategory",
  type: "viewer.columns.valueType",
  valueName: "viewer.columns.valueName",
  valueType: "viewer.columns.valueType",
};

function visualColumnLabelKey(
  _resourceType: string,
  columns: readonly string[],
  column: string,
): string | null {
  if (column === DESIRED_VALUE_COLUMN) return "viewer.columns.expectedValue";
  if (column === "value") {
    return columns.includes(DESIRED_VALUE_COLUMN)
      ? "viewer.columns.appliedValue"
      : "viewer.columns.expectedValue";
  }
  return VISUAL_COLUMN_LABEL_KEYS[column] ?? null;
}

function CategoryAddSettingButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation("manifest-editor");
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300 dark:hover:bg-blue-950/30"
    >
      <AddRegular className="h-3.5 w-3.5" aria-hidden="true" />
      {t("visual.addSetting")}
    </button>
  );
}

export const VisualManifestViewer = React.memo(function VisualManifestViewer({
  source,
  editable = false,
  platform,
  onSourceChange,
  onDraftValidityChange,
  autoFocusFirstCell = true,
}: VisualManifestViewerProps) {
  const { t } = useTranslation("manifest-editor");
  const canEdit = editable && onSourceChange !== undefined;
  const regionRef = useRef<HTMLDivElement>(null);
  const ignoredBlurTargetsRef = useRef(new WeakSet<HTMLElement>());
  const wasEditableRef = useRef(false);
  const activeCellRef = useRef<ActiveCell | null>(null);
  const navigationCellsRef = useRef<NavigationCell[]>([]);
  const allSettingsRef = useRef<VisualSetting[]>([]);
  const pendingNavigationRef = useRef<ActiveCell | null>(null);
  const commitAndNavigateRef = useRef<
    | ((
        setting: VisualSetting,
        column: string,
        element: HTMLInputElement | HTMLTextAreaElement,
        nextCell: ActiveCell | null,
        appendRow?: { type: string; columns: readonly string[] } | null,
      ) => void)
    | null
  >(null);
  const [sortByType, setSortByType] = useState<Record<string, VisualSortState | null>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<VisualEditError | null>(null);
  const [cellError, setCellError] = useState<VisualEditError | null>(null);
  const [pageError, setPageError] = useState<VisualEditError | null>(null);
  const [pendingEditCell, setPendingEditCell] = useState<ActiveCell | null>(null);
  const [readOnlyNotice, setReadOnlyNotice] = useState<ReadOnlyNotice | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [addSettingsOpen, setAddSettingsOpen] = useState(false);
  const [duplicateTypes, setDuplicateTypes] = useState<string[]>([]);

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
  const visibleGroups = useMemo(() => {
    if (parsed.kind !== "ready") return [];
    const query = filterQuery.trim().toLowerCase();
    if (!query) return parsed.groups;
    return parsed.groups.flatMap((group) => {
      const settings = group.settings.filter((setting) => {
        const propertyText = Object.entries(setting.properties)
          .flatMap(([key, value]) => [key, formatVisualValue(value)])
          .join(" ");
        return [setting.settingName, setting.resourceType, propertyText].some((value) =>
          value.toLowerCase().includes(query),
        );
      });
      return settings.length > 0 ? [{ ...group, settings }] : [];
    });
  }, [filterQuery, parsed]);
  const navigationCells = useMemo<NavigationCell[]>(
    () =>
      visibleGroups.flatMap((group) => {
        const rows = sortVisualSettings(group.settings, sortByType[group.resourceType] ?? null);
        return rows.flatMap((setting, rowIndex) =>
          group.columns
            .filter((column) => isVisualCellEditable(setting, column))
            .map((column) => ({
              settingId: setting.id,
              column,
              groupType: group.resourceType,
              columns: group.columns,
              rowIndex,
              rowCount: rows.length,
            })),
        );
      }),
    [sortByType, visibleGroups],
  );
  activeCellRef.current = activeCell;
  navigationCellsRef.current = navigationCells;
  allSettingsRef.current = allSettings;
  const validationIssues = useMemo(() => validateVisualSettings(allSettings), [allSettings]);
  const validationIssueKeys = useMemo(
    () => new Set(validationIssues.map((issue) => `${issue.settingId}:${issue.column}`)),
    [validationIssues],
  );

  useEffect(() => {
    setSelected(new Set());
    setPageError(null);
    setDraftError(null);
    setCellError(null);
    setReadOnlyNotice(null);
    if (pendingNavigationRef.current) {
      setPendingEditCell(pendingNavigationRef.current);
      pendingNavigationRef.current = null;
    }
  }, [source]);

  useEffect(() => {
    if (!canEdit) return;
    onDraftValidityChange?.(draftError === null && cellError === null);
    return () => onDraftValidityChange?.(true);
  }, [canEdit, cellError, draftError, onDraftValidityChange]);

  useEffect(() => {
    if (!readOnlyNotice) return;
    const dismiss = () => setReadOnlyNotice(null);
    window.addEventListener("pointermove", dismiss, { once: true });
    return () => window.removeEventListener("pointermove", dismiss);
  }, [readOnlyNotice]);

  useEffect(() => {
    if (!pendingEditCell || parsed.kind !== "ready") return;
    const setting = allSettings.find((candidate) => candidate.id === pendingEditCell.settingId);
    if (!setting) return;
    const rawValue = valueForColumn(setting, pendingEditCell.column);
    const value =
      pendingEditCell.arrayIndex !== undefined && Array.isArray(rawValue)
        ? rawValue[pendingEditCell.arrayIndex]
        : rawValue;
    setDraft(formatVisualValue(value));
    setCellError(null);
    setActiveCell(pendingEditCell);
    regionRef.current
      ?.querySelector<HTMLElement>(`[data-setting-id="${setting.id}"]`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setPendingEditCell(null);
  }, [allSettings, parsed.kind, pendingEditCell]);

  useEffect(() => {
    const enteringEdit = canEdit && !wasEditableRef.current;
    wasEditableRef.current = canEdit;
    if (enteringEdit && autoFocusFirstCell && allSettings[0]) {
      setPendingEditCell({
        settingId: allSettings[0].id,
        column: SETTING_NAME_COLUMN,
      });
    }
    if (!canEdit) setActiveCell(null);
  }, [allSettings, autoFocusFirstCell, canEdit]);

  const errorText = (error: VisualEditError): string => t(`visual.errors.${error}`);

  const beginEdit = (setting: VisualSetting, column: string, arrayIndex?: number) => {
    const rawValue = valueForColumn(setting, column);
    const resolvedArrayIndex =
      arrayIndex ?? (Array.isArray(rawValue) && rawValue.length > 0 ? 0 : undefined);
    setDraft(
      formatVisualValue(
        resolvedArrayIndex !== undefined && Array.isArray(rawValue)
          ? rawValue[resolvedArrayIndex]
          : rawValue,
      ),
    );
    setDraftError(null);
    setCellError(null);
    onDraftValidityChange?.(true);
    setActiveCell({
      settingId: setting.id,
      column,
      ...(resolvedArrayIndex !== undefined ? { arrayIndex: resolvedArrayIndex } : {}),
    });
  };

  const cancelEdit = (element?: HTMLElement) => {
    if (element) ignoredBlurTargetsRef.current.add(element);
    setActiveCell(null);
    setDraftError(null);
    setCellError(null);
    onDraftValidityChange?.(true);
  };

  const commitEdit = (
    setting: VisualSetting,
    column: string,
    emitChange = true,
    blurTarget?: HTMLElement,
  ): string | null => {
    if (blurTarget && ignoredBlurTargetsRef.current.has(blurTarget)) {
      ignoredBlurTargetsRef.current.delete(blurTarget);
      return null;
    }
    const result = updateVisualCellSource(source, setting, column, draft);
    if (!result.ok) {
      setDraftError(result.error);
      setCellError(result.error);
      onDraftValidityChange?.(false);
      return null;
    }
    setActiveCell(null);
    setDraftError(null);
    setCellError(null);
    onDraftValidityChange?.(true);
    if (emitChange) onSourceChange?.(result.source);
    return result.source;
  };

  const updateDraft = (setting: VisualSetting, column: string, value: string) => {
    setDraft(value);
    const result = parseVisualCellInput(value, valueForColumn(setting, column), setting, column);
    setDraftError(result.ok ? null : result.error);
    setCellError(null);
    onDraftValidityChange?.(result.ok);
  };

  const updateArrayDraft = (existing: unknown, value: string) => {
    setDraft(value);
    const result = parseVisualArrayItemInput(value, existing);
    setDraftError(result.ok ? null : result.error);
    setCellError(null);
    onDraftValidityChange?.(result.ok);
  };

  const commitArrayItem = (
    setting: VisualSetting,
    column: string,
    index: number,
    blurTarget?: HTMLElement,
  ): string | null => {
    if (blurTarget && ignoredBlurTargetsRef.current.has(blurTarget)) {
      ignoredBlurTargetsRef.current.delete(blurTarget);
      return null;
    }
    const result = updateVisualArrayItemSource(source, setting, column, index, draft);
    if (!result.ok) {
      setDraftError(result.error);
      setCellError(result.error);
      onDraftValidityChange?.(false);
      return null;
    }
    setActiveCell(null);
    setDraftError(null);
    setCellError(null);
    onDraftValidityChange?.(true);
    onSourceChange?.(result.source);
    return result.source;
  };

  const queueNavigationAfterSourceChange = (cell: ActiveCell | null) => {
    pendingNavigationRef.current = cell;
    if (!cell) return;
    let attempts = 0;
    const activate = () => {
      if (
        activeCellRef.current?.settingId === cell.settingId &&
        activeCellRef.current.column === cell.column &&
        activeCellRef.current.arrayIndex === cell.arrayIndex
      ) {
        pendingNavigationRef.current = null;
        return;
      }
      const editButton = Array.from(
        regionRef.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-edit-setting-id][data-edit-column]",
        ) ?? [],
      ).find(
        (button) =>
          button.dataset.editSettingId === cell.settingId &&
          button.dataset.editColumn === cell.column &&
          (cell.arrayIndex === undefined ||
            button.dataset.editArrayIndex === String(cell.arrayIndex)),
      );
      if (editButton) {
        pendingNavigationRef.current = null;
        editButton.click();
        return;
      }
      const setting = allSettingsRef.current.find((candidate) => candidate.id === cell.settingId);
      if (setting) {
        pendingNavigationRef.current = null;
        beginEdit(setting, cell.column, cell.arrayIndex);
        return;
      }
      attempts += 1;
      if (attempts < 5) window.setTimeout(activate, 50);
    };
    window.setTimeout(activate, 50);
  };

  const handleAdd = (
    type: string,
    columns: readonly string[] = [],
    baseSource = source,
    focusColumn = SETTING_NAME_COLUMN,
  ) => {
    const result = addVisualSettingSource(baseSource, type, columns);
    if (!result.ok) {
      setPageError(result.error);
      return;
    }
    setPageError(null);
    queueNavigationAfterSourceChange({
      settingId: result.settingId,
      column: focusColumn,
    });
    onSourceChange?.(result.source);
  };

  const handleAddTypes = (types: string[]) => {
    const knownTypes = new Set(
      visualResourceTemplatesForPlatform().map((template) => template.type),
    );
    const incompleteTypes = new Set(
      allSettings
        .filter((setting) => !setting.settingName.trim())
        .map((setting) => setting.resourceType),
    );
    const duplicates: string[] = [];
    let nextSource = source;
    let firstSettingId: string | null = null;

    for (const type of types) {
      if (!knownTypes.has(type)) continue;
      if (incompleteTypes.has(type)) {
        duplicates.push(type);
        continue;
      }
      const result = addVisualSettingSource(nextSource, type);
      if (!result.ok) {
        setPageError(result.error);
        return;
      }
      nextSource = result.source;
      firstSettingId ??= result.settingId;
      incompleteTypes.add(type);
    }

    setAddSettingsOpen(false);
    setDuplicateTypes(duplicates);
    if (nextSource !== source) {
      setPageError(null);
      if (firstSettingId) {
        queueNavigationAfterSourceChange({
          settingId: firstSettingId,
          column: SETTING_NAME_COLUMN,
        });
      }
      onSourceChange?.(nextSource);
    }
  };

  const handleAppendArrayItem = (setting: VisualSetting, column: string, currentLength: number) => {
    const result = appendVisualArrayItemSource(source, setting, column);
    if (!result.ok) {
      setPageError(result.error);
      return;
    }
    setPageError(null);
    queueNavigationAfterSourceChange({
      settingId: setting.id,
      column,
      arrayIndex: currentLength,
    });
    onSourceChange?.(result.source);
  };

  const commitAndNavigate = (
    setting: VisualSetting,
    column: string,
    element: HTMLInputElement | HTMLTextAreaElement,
    nextCell: ActiveCell | null,
    appendRow: { type: string; columns: readonly string[] } | null = null,
  ) => {
    ignoredBlurTargetsRef.current.add(element);
    const committed = commitEdit(setting, column, false);
    if (!committed) {
      ignoredBlurTargetsRef.current.delete(element);
      return;
    }
    if (appendRow) {
      handleAdd(appendRow.type, appendRow.columns, committed, column);
    } else {
      if (nextCell) {
        const nextSetting = allSettingsRef.current.find(
          (candidate) => candidate.id === nextCell.settingId,
        );
        if (nextSetting) {
          beginEdit(nextSetting, nextCell.column, nextCell.arrayIndex);
        }
      }
      if (committed === source) {
        if (nextCell) setPendingEditCell(nextCell);
      } else {
        queueNavigationAfterSourceChange(nextCell);
        if (nextCell) {
          window.setTimeout(() => onSourceChange?.(committed), 0);
        } else {
          onSourceChange?.(committed);
        }
      }
    }
  };
  commitAndNavigateRef.current = commitAndNavigate;

  useEffect(() => {
    if (!canEdit) return;
    const handleNavigationKey = (event: KeyboardEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
        return;
      }
      if (!regionRef.current?.contains(element)) return;
      const currentActiveCell = activeCellRef.current;
      if (!currentActiveCell) return;
      if (currentActiveCell.arrayIndex !== undefined) {
        if (event.key === "Enter" && !(element instanceof HTMLTextAreaElement && event.shiftKey)) {
          event.preventDefault();
          element.blur();
        }
        return;
      }
      if (
        event.key !== "Tab" &&
        !(event.key === "Enter" && !(element instanceof HTMLTextAreaElement && event.shiftKey))
      ) {
        return;
      }
      const currentNavigationCells = navigationCellsRef.current;
      const currentIndex = currentNavigationCells.findIndex(
        (cell) =>
          cell.settingId === currentActiveCell.settingId &&
          cell.column === currentActiveCell.column,
      );
      if (currentIndex < 0) return;
      const current = currentNavigationCells[currentIndex];
      const setting = allSettingsRef.current.find(
        (candidate) => candidate.id === current.settingId,
      );
      const commitAndNavigateCurrent = commitAndNavigateRef.current;
      if (!setting || !commitAndNavigateCurrent) return;

      event.preventDefault();
      if (event.key === "Tab") {
        commitAndNavigateCurrent(
          setting,
          current.column,
          element,
          currentNavigationCells[currentIndex + 1] ?? null,
        );
        return;
      }

      const nextRow = currentNavigationCells.find(
        (cell) =>
          cell.groupType === current.groupType &&
          cell.column === current.column &&
          cell.rowIndex === current.rowIndex + 1,
      );
      commitAndNavigateCurrent(
        setting,
        current.column,
        element,
        nextRow ?? null,
        current.rowIndex === current.rowCount - 1
          ? { type: current.groupType, columns: current.columns }
          : null,
      );
    };

    document.addEventListener("keydown", handleNavigationKey, true);
    return () => document.removeEventListener("keydown", handleNavigationKey, true);
  }, [canEdit]);

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

  const handleReadOnlyClick = (event: React.MouseEvent<HTMLElement>) => {
    if (canEdit) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, select, textarea")) return;
    const bounds = regionRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const horizontalPadding = 112;
    setReadOnlyNotice({
      left: Math.min(
        Math.max(event.clientX - bounds.left, horizontalPadding),
        Math.max(horizontalPadding, bounds.width - horizontalPadding),
      ),
      top: Math.max(48, event.clientY - bounds.top),
    });
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
      onScroll={() => setReadOnlyNotice(null)}
      className="relative max-h-[min(62vh,48rem)] min-h-[28rem] overflow-y-auto [scrollbar-gutter:stable]"
    >
      {readOnlyNotice && (
        <div
          role="status"
          data-testid="visual-readonly-tooltip"
          className="pointer-events-none absolute z-30 max-w-56 -translate-x-1/2 rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold leading-4 text-white shadow-lg"
          style={{
            left: readOnlyNotice.left,
            top: readOnlyNotice.top,
            transform: "translate(-50%, calc(-100% - 10px))",
          }}
        >
          {t("visual.cannotEditViewOnly")}
        </div>
      )}

      {canEdit && (
        <div
          role="toolbar"
          aria-label={t("visual.editToolbar")}
          className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-6"
        >
          <div className="flex min-w-[16rem] flex-1 items-center gap-2">
            <label className="relative block min-w-[14rem] max-w-xl flex-1">
              <span className="sr-only">{t("visual.searchLabel")}</span>
              <SearchRegular
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder={t("visual.searchPlaceholder")}
                className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
              />
            </label>
            <Tooltip content={t("visual.editInstructionsText")} relationship="description">
              <button
                type="button"
                aria-label={t("visual.editInstructions")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300 dark:hover:bg-blue-950/30"
              >
                <InfoRegular aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
              className="inline-flex min-h-8 items-center rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t("visual.unselectAll")}
            </button>
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
            <button
              type="button"
              onClick={() => setAddSettingsOpen(true)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white outline-none hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <AddRegular className="h-4 w-4" aria-hidden="true" />
              {t("visual.addSettings")}
            </button>
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
      ) : visibleGroups.length === 0 ? (
        <div className="flex min-h-72 items-center justify-center p-8 text-sm text-slate-500 dark:text-slate-400">
          {t("visual.noSearchMatches")}
        </div>
      ) : (
        <div className="space-y-7 px-5 py-5 sm:px-6">
          {visibleGroups.map((group) => {
            const sort = sortByType[group.resourceType] ?? null;
            const rows = sortVisualSettings(group.settings, sort);
            const shortName = categoryName(group.resourceType);
            const groupId = group.resourceType.replace(/[^a-zA-Z0-9_-]/g, "-");
            const tableMinimumWidth = visualTableMinimumWidth(group.columns, canEdit);
            const selectedInGroup = group.settings.filter((setting) =>
              selected.has(setting.id),
            ).length;
            const allSelected =
              group.settings.length > 0 && selectedInGroup === group.settings.length;

            return (
              <section key={group.resourceType} aria-labelledby={`visual-group-${groupId}`}>
                <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <h3
                    id={`visual-group-${groupId}`}
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
                    <CategoryAddSettingButton
                      onClick={() => handleAdd(group.resourceType, group.columns)}
                    />
                  )}
                </div>

                <div
                  data-testid="visual-table-scroll"
                  role="region"
                  aria-label={t("viewer.horizontalScrollLabel", { category: shortName })}
                  tabIndex={0}
                  onClickCapture={handleReadOnlyClick}
                  className="isolate overflow-x-auto overscroll-x-contain rounded-md border border-slate-200 [scrollbar-color:theme(colors.slate.400)_transparent] [scrollbar-width:thin] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:[scrollbar-color:theme(colors.slate.600)_transparent]"
                >
                  <table
                    aria-label={t("viewer.categoryTableLabel", { category: shortName })}
                    className="w-full table-fixed border-collapse text-left text-sm"
                    style={{ minWidth: `${tableMinimumWidth}px` }}
                  >
                    <colgroup>
                      {canEdit && (
                        <col
                          style={{
                            width: visualSelectionColumnWidth(group.columns),
                          }}
                        />
                      )}
                      {group.columns.map((column) => (
                        <col
                          key={column}
                          style={{
                            width: visualColumnWidth(group.columns, column, canEdit),
                          }}
                        />
                      ))}
                    </colgroup>
                    <thead className="bg-slate-100 dark:bg-slate-800">
                      <tr>
                        {canEdit && (
                          <th
                            scope="col"
                            className="w-11 border-b border-r border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
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
                              : (() => {
                                  const key = visualColumnLabelKey(
                                    group.resourceType,
                                    group.columns,
                                    column,
                                  );
                                  return key ? t(key) : humanize(column);
                                })();
                          return (
                            <th
                              key={column}
                              scope="col"
                              aria-sort={active ? sort.direction : undefined}
                              className="border-b border-r border-slate-200 bg-slate-100 px-0 font-semibold text-slate-700 last:border-r-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
                                className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left outline-none hover:bg-slate-200/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-slate-700/70"
                              >
                                <span className="min-w-0 break-words">{label}</span>
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
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/80">
                      {rows.map((setting, rowIndex) => {
                        const isSelected = selected.has(setting.id);
                        const rowSurface = isSelected
                          ? "bg-blue-50 dark:bg-blue-950/35"
                          : rowIndex % 2 === 0
                            ? "bg-white dark:bg-slate-900"
                            : "bg-slate-50/70 dark:bg-slate-800/35";
                        return (
                          <tr
                            key={setting.id}
                            data-setting-id={setting.id}
                            className={`align-top ${rowSurface}`}
                          >
                            {canEdit && (
                              <td className="border-r border-slate-100 px-3 py-2.5 dark:border-slate-700/80">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  aria-label={t("visual.selectRow", {
                                    name: setting.settingName || t("viewer.unnamedSetting"),
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
                              const activeCellMatches =
                                canEdit &&
                                activeCell?.settingId === setting.id &&
                                activeCell.column === column;
                              const isEditing =
                                activeCellMatches && activeCell.arrayIndex === undefined;
                              const editingArrayIndex = activeCellMatches
                                ? activeCell.arrayIndex
                                : undefined;
                              const visuallyEditable =
                                canEdit && isVisualCellEditable(setting, column);
                              const cellLabel =
                                column === SETTING_NAME_COLUMN
                                  ? t("viewer.settingName")
                                  : (() => {
                                      const key = visualColumnLabelKey(
                                        group.resourceType,
                                        group.columns,
                                        column,
                                      );
                                      return key ? t(key) : humanize(column);
                                    })();
                              const editorClass =
                                "w-full rounded border border-blue-500 bg-white px-2 py-1.5 text-sm text-slate-950 outline-none ring-2 ring-blue-200 dark:bg-slate-950 dark:text-slate-100 dark:ring-blue-900";
                              const requiredMissing = validationIssueKeys.has(
                                `${setting.id}:${column}`,
                              );
                              const arrayValue = Array.isArray(rawValue) ? rawValue : null;

                              return (
                                <td
                                  key={column}
                                  title={
                                    !arrayValue && !isEditing && formatted ? formatted : undefined
                                  }
                                  className={`group relative border-r border-slate-100 p-0 text-slate-700 last:border-r-0 dark:border-slate-700/80 dark:text-slate-300 ${
                                    column === SETTING_NAME_COLUMN
                                      ? "font-medium text-slate-950 dark:text-slate-100"
                                      : ""
                                  }`}
                                >
                                  {arrayValue ? (
                                    <div className="relative min-h-10">
                                      <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
                                        {arrayValue.length === 0 && (
                                          <span className="block px-3 py-2.5 text-slate-400">
                                            {t("viewer.emptyValue")}
                                          </span>
                                        )}
                                        {arrayValue.map((item, arrayIndex) => {
                                          const itemValue =
                                            formatVisualValue(item) || t("viewer.emptyValue");
                                          const itemEditing = editingArrayIndex === arrayIndex;
                                          const itemLabel = t("visual.editArrayItem", {
                                            field: cellLabel,
                                            index: arrayIndex + 1,
                                            name: setting.settingName || t("viewer.unnamedSetting"),
                                          });
                                          return itemEditing ? (
                                            <div
                                              key={`${setting.id}:${column}:${arrayIndex}`}
                                              className="p-1.5"
                                            >
                                              {isStructuredValue(item) || draft.includes("\n") ? (
                                                <textarea
                                                  autoFocus
                                                  rows={Math.min(
                                                    6,
                                                    Math.max(2, draft.split("\n").length),
                                                  )}
                                                  value={draft}
                                                  aria-label={itemLabel}
                                                  aria-invalid={cellError ? true : undefined}
                                                  onChange={(event) =>
                                                    updateArrayDraft(item, event.target.value)
                                                  }
                                                  onBlur={(event) =>
                                                    commitArrayItem(
                                                      setting,
                                                      column,
                                                      arrayIndex,
                                                      event.currentTarget,
                                                    )
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === "Escape") {
                                                      event.preventDefault();
                                                      cancelEdit(event.currentTarget);
                                                    } else if (
                                                      event.key === "Enter" &&
                                                      !event.shiftKey
                                                    ) {
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
                                                  aria-label={itemLabel}
                                                  aria-invalid={cellError ? true : undefined}
                                                  onChange={(event) =>
                                                    updateArrayDraft(item, event.target.value)
                                                  }
                                                  onBlur={(event) =>
                                                    commitArrayItem(
                                                      setting,
                                                      column,
                                                      arrayIndex,
                                                      event.currentTarget,
                                                    )
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === "Escape") {
                                                      event.preventDefault();
                                                      cancelEdit(event.currentTarget);
                                                    } else if (event.key === "Enter") {
                                                      event.preventDefault();
                                                      event.currentTarget.blur();
                                                    }
                                                  }}
                                                  className={editorClass}
                                                />
                                              )}
                                              {cellError && (
                                                <p
                                                  role="alert"
                                                  className="mt-1 text-xs text-red-700 dark:text-red-300"
                                                >
                                                  {errorText(cellError)}
                                                </p>
                                              )}
                                            </div>
                                          ) : visuallyEditable ? (
                                            <button
                                              key={`${setting.id}:${column}:${arrayIndex}`}
                                              type="button"
                                              data-edit-setting-id={setting.id}
                                              data-edit-column={column}
                                              data-edit-array-index={arrayIndex}
                                              onClick={() => beginEdit(setting, column, arrayIndex)}
                                              aria-label={itemLabel}
                                              className="block min-h-9 w-full px-3 py-2 text-left outline-none hover:bg-blue-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-blue-950/20"
                                            >
                                              <span className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                                {itemValue}
                                              </span>
                                            </button>
                                          ) : (
                                            <span
                                              key={`${setting.id}:${column}:${arrayIndex}`}
                                              className="block px-3 py-2"
                                            >
                                              {itemValue}
                                            </span>
                                          );
                                        })}
                                      </div>
                                      {visuallyEditable && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleAppendArrayItem(
                                              setting,
                                              column,
                                              arrayValue.length,
                                            )
                                          }
                                          aria-label={t("visual.addArrayItem", {
                                            field: cellLabel,
                                            name: setting.settingName || t("viewer.unnamedSetting"),
                                          })}
                                          className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/95 text-blue-700 opacity-70 shadow-sm outline-none transition-opacity hover:bg-blue-50 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-600 dark:bg-slate-900/95 dark:text-blue-300 dark:hover:bg-blue-950/40 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                                        >
                                          <AddRegular className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                      )}
                                    </div>
                                  ) : isEditing ? (
                                    <div className="p-1.5">
                                      {isStructuredValue(rawValue) || draft.includes("\n") ? (
                                        <textarea
                                          autoFocus
                                          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                                          value={draft}
                                          aria-label={t("visual.editCell", {
                                            field: cellLabel,
                                            name: setting.settingName || t("viewer.unnamedSetting"),
                                          })}
                                          aria-invalid={cellError ? true : undefined}
                                          onChange={(event) =>
                                            updateDraft(setting, column, event.target.value)
                                          }
                                          onBlur={(event) =>
                                            commitEdit(setting, column, true, event.currentTarget)
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "Escape") {
                                              event.preventDefault();
                                              cancelEdit(event.currentTarget);
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
                                            name: setting.settingName || t("viewer.unnamedSetting"),
                                          })}
                                          aria-invalid={cellError ? true : undefined}
                                          onChange={(event) =>
                                            updateDraft(setting, column, event.target.value)
                                          }
                                          onBlur={(event) =>
                                            commitEdit(setting, column, true, event.currentTarget)
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "Escape") {
                                              event.preventDefault();
                                              cancelEdit(event.currentTarget);
                                            }
                                          }}
                                          className={editorClass}
                                        />
                                      )}
                                      {cellError && (
                                        <p
                                          role="alert"
                                          className="mt-1 text-xs text-red-700 dark:text-red-300"
                                        >
                                          {errorText(cellError)}
                                        </p>
                                      )}
                                    </div>
                                  ) : visuallyEditable ? (
                                    <button
                                      type="button"
                                      data-edit-setting-id={setting.id}
                                      data-edit-column={column}
                                      onClick={() => beginEdit(setting, column)}
                                      aria-label={t("visual.editCell", {
                                        field: cellLabel,
                                        name: setting.settingName || t("viewer.unnamedSetting"),
                                      })}
                                      aria-invalid={requiredMissing ? true : undefined}
                                      className={`block min-h-10 w-full px-3 py-2.5 text-left outline-none hover:bg-blue-50/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:bg-blue-950/20 ${
                                        requiredMissing
                                          ? "bg-amber-50 ring-1 ring-inset ring-amber-400 dark:bg-amber-950/20"
                                          : ""
                                      }`}
                                    >
                                      <span className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                        {visibleValue}
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="block whitespace-pre-wrap break-words px-3 py-2.5 [overflow-wrap:anywhere]">
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
                {canEdit && (
                  <div className="mt-2 flex justify-start">
                    <CategoryAddSettingButton
                      onClick={() => handleAdd(group.resourceType, group.columns)}
                    />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <AddSettingsPane
        open={addSettingsOpen}
        platform={platform}
        onClose={() => setAddSettingsOpen(false)}
        onAdd={handleAddTypes}
      />

      <Dialog
        open={duplicateTypes.length > 0}
        onOpenChange={(_event, data) => {
          if (!data.open) setDuplicateTypes([]);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("visual.duplicateDialog.title")}</DialogTitle>
            <DialogContent>
              {t("visual.duplicateDialog.description", {
                settings: duplicateTypes.map((type) => humanize(categoryName(type))).join(", "),
              })}
            </DialogContent>
            <DialogActions>
              <button
                type="button"
                onClick={() => setDuplicateTypes([])}
                className="inline-flex min-h-9 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white outline-none hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                {t("visual.duplicateDialog.close")}
              </button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
});
