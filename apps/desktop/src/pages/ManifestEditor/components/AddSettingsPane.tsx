// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AddRegular, DismissRegular, SearchRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { VISUAL_RESOURCE_TEMPLATES, type VisualResourceTemplate } from "../visual-viewer";

type PlatformFilter = "all" | VisualResourceTemplate["platform"];

export interface AddSettingsPaneProps {
  open: boolean;
  platform?: "windows" | "linux";
  onClose: () => void;
  onAdd: (types: string[]) => void;
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

function platformRank(
  candidate: VisualResourceTemplate["platform"],
  active: AddSettingsPaneProps["platform"],
): number {
  if (candidate === active) return 0;
  if (candidate === "cross-platform") return 1;
  return 2;
}

export function AddSettingsPane({ open, platform, onClose, onAdd }: AddSettingsPaneProps) {
  const { t } = useTranslation("manifest-editor");
  const [query, setQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const paneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPlatformFilter("all");
    setTypeFilter("all");
    setSelected(new Set());
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const pane = paneRef.current;
      if (!pane) return;
      const focusable = Array.from(
        pane.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !pane.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !pane.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  const typeOptions = useMemo(
    () =>
      [
        ...new Set(
          VISUAL_RESOURCE_TEMPLATES.map((template) => humanize(categoryName(template.type))),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [],
  );

  const visibleTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...VISUAL_RESOURCE_TEMPLATES]
      .filter((template) => {
        const settingType = humanize(categoryName(template.type));
        const description = t(template.descriptionKey);
        return (
          (platformFilter === "all" || template.platform === platformFilter) &&
          (typeFilter === "all" || settingType === typeFilter) &&
          (!normalizedQuery ||
            [settingType, template.platform, template.type, description].some((value) =>
              value.toLowerCase().includes(normalizedQuery),
            ))
        );
      })
      .sort((left, right) => {
        const platformComparison =
          platformRank(left.platform, platform) - platformRank(right.platform, platform);
        if (platformComparison !== 0) return platformComparison;
        const typeComparison = categoryName(left.type).localeCompare(
          categoryName(right.type),
          undefined,
          { sensitivity: "base" },
        );
        return typeComparison !== 0
          ? typeComparison
          : left.type.localeCompare(right.type, undefined, {
              sensitivity: "base",
            });
      });
  }, [platform, platformFilter, query, t, typeFilter]);

  if (!open) return null;

  const platformLabel = (candidate: VisualResourceTemplate["platform"]) =>
    candidate === "cross-platform" ? t("platform.crossPlatform") : t(`platform.${candidate}`);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-end bg-slate-950/40 p-3 sm:p-6">
      <div
        data-testid="add-settings-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        ref={paneRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-settings-pane-title"
        className="relative flex h-[min(54rem,calc(100vh-1.5rem))] w-[min(78rem,calc(100vw-1.5rem))] flex-col overflow-hidden border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-[min(54rem,calc(100vh-3rem))] sm:w-[min(78rem,calc(100vw-3rem))]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-7">
          <div>
            <h2
              id="add-settings-pane-title"
              className="text-xl font-semibold text-slate-950 dark:text-white"
            >
              {t("visual.addSettingsPane.title")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              {t("visual.addSettingsPane.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("visual.addSettingsPane.close")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <DismissRegular aria-hidden="true" />
          </button>
        </header>

        <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-950/60 sm:grid-cols-[minmax(18rem,1fr)_12rem_14rem] sm:px-7">
          <label className="relative block">
            <span className="sr-only">{t("visual.addSettingsPane.searchLabel")}</span>
            <SearchRegular
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("visual.addSettingsPane.searchPlaceholder")}
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-950"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("visual.addSettingsPane.osFilter")}
            <select
              value={platformFilter}
              onChange={(event) => setPlatformFilter(event.target.value as PlatformFilter)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="all">{t("visual.addSettingsPane.allOperatingSystems")}</option>
              <option value="windows">{t("platform.windows")}</option>
              <option value="linux">{t("platform.linux")}</option>
              <option value="cross-platform">{t("platform.crossPlatform")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("visual.addSettingsPane.typeFilter")}
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="all">{t("visual.addSettingsPane.allSettingTypes")}</option>
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div
            role="table"
            aria-label={t("visual.addSettingsPane.tableLabel")}
            className="min-w-[58rem]"
          >
            <div
              role="row"
              className="sticky top-0 z-10 grid grid-cols-[3rem_11rem_10rem_minmax(18rem,1fr)_minmax(20rem,1.4fr)] border-b border-slate-200 bg-slate-100 px-5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 sm:px-7"
            >
              <span role="columnheader" className="py-3">
                <span className="sr-only">{t("visual.addSettingsPane.select")}</span>
              </span>
              <span role="columnheader" className="py-3">
                {t("visual.addSettingsPane.settingType")}
              </span>
              <span role="columnheader" className="py-3">
                {t("visual.addSettingsPane.operatingSystem")}
              </span>
              <span role="columnheader" className="py-3">
                {t("visual.addSettingsPane.settingName")}
              </span>
              <span role="columnheader" className="py-3">
                {t("visual.addSettingsPane.settingDescription")}
              </span>
            </div>
            {visibleTemplates.length === 0 ? (
              <div className="px-7 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                {t("visual.addSettingsPane.noMatches")}
              </div>
            ) : (
              visibleTemplates.map((template) => {
                const checked = selected.has(template.type);
                return (
                  <label
                    key={template.type}
                    role="row"
                    className={`grid cursor-pointer grid-cols-[3rem_11rem_10rem_minmax(18rem,1fr)_minmax(20rem,1.4fr)] items-start border-b border-slate-100 px-5 text-sm transition-colors hover:bg-blue-50/70 dark:border-slate-800 dark:hover:bg-blue-950/20 sm:px-7 ${
                      checked ? "bg-blue-50 dark:bg-blue-950/30" : ""
                    }`}
                  >
                    <span role="cell" className="py-4">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(template.type)) {
                              next.delete(template.type);
                            } else {
                              next.add(template.type);
                            }
                            return next;
                          })
                        }
                        aria-label={t("visual.addSettingsPane.selectSetting", {
                          name: template.type,
                        })}
                        className="h-4 w-4 accent-blue-600"
                      />
                    </span>
                    <span
                      role="cell"
                      className="py-4 font-medium text-slate-900 dark:text-slate-100"
                    >
                      {humanize(categoryName(template.type))}
                    </span>
                    <span role="cell" className="py-4 text-slate-600 dark:text-slate-300">
                      {platformLabel(template.platform)}
                    </span>
                    <code
                      role="cell"
                      className="break-words py-4 pr-5 text-xs text-slate-700 dark:text-slate-300"
                    >
                      {template.type}
                    </code>
                    <span role="cell" className="py-4 text-slate-600 dark:text-slate-300">
                      {t(template.descriptionKey)}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-7">
          <span aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">
            {t("visual.addSettingsPane.selectedCount", {
              count: selected.size,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t("visual.addSettingsPane.cancel")}
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => onAdd([...selected])}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white outline-none hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <AddRegular className="h-4 w-4" aria-hidden="true" />
              {t("visual.addSettingsPane.addSelected")}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
