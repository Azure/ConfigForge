// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Spinner,
} from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { CATEGORIES, type BaselineEntry } from "../../../data/baseline-catalog";
import { useLibraryFilters, type PlatformFilter } from "../../Library/state/useLibraryFilters";

interface BaselineTemplatePickerDialogProps {
  open: boolean;
  loadingId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: BaselineEntry) => void;
}

const PLATFORM_FILTERS: PlatformFilter[] = ["all", "windows", "linux"];

export function BaselineTemplatePickerDialog({
  open,
  loadingId,
  onOpenChange,
  onSelect,
}: BaselineTemplatePickerDialogProps) {
  const { t } = useTranslation("manifests");
  const { search, setSearch, category, setCategory, platformFilter, setPlatformFilter, filtered } =
    useLibraryFilters();

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface style={{ maxWidth: "1040px", width: "min(1040px, 94vw)" }}>
        <DialogBody>
          <DialogTitle>{t("new.setup.templatePicker.title")}</DialogTitle>
          <DialogContent>
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  className="flex-1"
                  value={search}
                  onChange={(_, data) => setSearch(data.value)}
                  contentBefore={<SearchRegular />}
                  placeholder={t("new.setup.templatePicker.search")}
                  aria-label={t("new.setup.templatePicker.search")}
                />
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                  {PLATFORM_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setPlatformFilter(filter)}
                      aria-pressed={platformFilter === filter}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        platformFilter === filter
                          ? "bg-blue-600 text-white"
                          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      {t(`new.setup.templatePicker.platforms.${filter}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCategory(item.id)}
                    aria-pressed={category === item.id}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      category === item.id
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="max-h-[62vh] overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <div className="py-14 text-center text-sm text-slate-500 dark:text-slate-400">
                    {t("new.setup.templatePicker.noMatches")}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((entry) => {
                      const loading = loadingId === entry.id;
                      return (
                        <article
                          key={entry.id}
                          className="flex min-h-52 flex-col border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="capitalize">{entry.platform}</span>
                            <span>v{entry.version}</span>
                          </div>
                          <h3 className="mt-3 text-sm font-semibold leading-5 text-slate-950 dark:text-white">
                            {entry.name}
                          </h3>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {entry.description}
                          </p>
                          <div className="mt-auto pt-4">
                            <button
                              type="button"
                              disabled={!entry.manifestUrl || loadingId !== null}
                              onClick={() => onSelect(entry)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {loading && <Spinner size="tiny" />}
                              {t("new.setup.templatePicker.useTemplate")}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
