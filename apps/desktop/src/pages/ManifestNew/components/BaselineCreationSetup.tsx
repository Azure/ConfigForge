// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useRef, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import type { Platform } from "@configforge/core/platform";
import {
  ArrowUploadRegular,
  DocumentArrowUpRegular,
  EditRegular,
  LibraryRegular,
  LinkRegular,
  TableRegular,
} from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { WindowsLogo } from "../../../components/WindowsLogo";

export type BaselineCreationMethod = "file" | "url" | "excel" | "template" | "custom";

interface ImportSummary {
  filename: string;
  detail: string;
}

interface BaselineCreationSetupProps {
  method: BaselineCreationMethod | null;
  onMethodChange: (method: BaselineCreationMethod) => void;
  name: string;
  onNameChange: (name: string) => void;
  platform: Platform;
  onPlatformChange: (platform: Platform) => void;
  uri: string;
  onUriChange: (uri: string) => void;
  importSummary: ImportSummary | null;
  importing: boolean;
  error: string | null;
  selectedTemplateName: string | null;
  onBrowseTemplates: () => void;
  onFilesSelected: (files: File[]) => void;
  canContinue: boolean;
  continuing: boolean;
  onContinue: () => void;
  onCancel: () => void;
  batchContent?: ReactNode;
}

const METHODS: Array<{
  id: BaselineCreationMethod;
  icon: typeof DocumentArrowUpRegular;
}> = [
  { id: "file", icon: DocumentArrowUpRegular },
  { id: "url", icon: LinkRegular },
  { id: "excel", icon: TableRegular },
  { id: "template", icon: LibraryRegular },
  { id: "custom", icon: EditRegular },
];

export function BaselineCreationSetup({
  method,
  onMethodChange,
  name,
  onNameChange,
  platform,
  onPlatformChange,
  uri,
  onUriChange,
  importSummary,
  importing,
  error,
  selectedTemplateName,
  onBrowseTemplates,
  onFilesSelected,
  canContinue,
  continuing,
  onContinue,
  onCancel,
  batchContent,
}: BaselineCreationSetupProps) {
  const { t } = useTranslation("manifests");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const chooseFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onFilesSelected(Array.from(files));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    event.currentTarget.value = "";
    onFilesSelected(selectedFiles);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    chooseFiles(event.dataTransfer.files);
  };

  const activeInput = method === "excel" ? excelInputRef : fileInputRef;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white">
          {t("new.setup.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {t("new.setup.description")}
        </p>
      </header>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid lg:grid-cols-[minmax(290px,0.8fr)_minmax(0,1.2fr)]">
          <fieldset className="border-b border-slate-200 p-6 dark:border-slate-800 lg:border-b-0 lg:border-r">
            <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              {t("new.setup.methodLabel")}
            </legend>
            <div className="space-y-1">
              {METHODS.map(({ id, icon: Icon }) => {
                const selected = method === id;
                return (
                  <label
                    key={id}
                    className={`flex cursor-pointer gap-3 rounded-lg px-3 py-3 transition-colors ${
                      selected
                        ? "bg-blue-50 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <input
                      type="radio"
                      name="baseline-creation-method"
                      value={id}
                      checked={selected}
                      onChange={() => onMethodChange(id)}
                      className="mt-1 h-4 w-4 accent-blue-600"
                    />
                    <Icon
                      className={`mt-0.5 h-5 w-5 shrink-0 ${
                        selected
                          ? "text-blue-700 dark:text-blue-300"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {t(`new.setup.methods.${id}.title`)}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {t(`new.setup.methods.${id}.description`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="min-h-[360px] p-6">
            {!method ? (
              <div className="flex h-full min-h-[310px] items-center justify-center text-center">
                <div className="max-w-sm">
                  <DocumentArrowUpRegular
                    className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("new.setup.emptyTitle")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {t("new.setup.emptyDescription")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {(method === "file" || method === "excel") && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".osc.yaml,.osc.yml,.yaml,.yml,.json"
                      multiple={method === "file"}
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".csv,.tsv,.xlsx"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <div
                      className="flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center dark:border-slate-700 dark:bg-slate-950/40"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={handleDrop}
                    >
                      {importing ? (
                        <Spinner size="small" label={t("new.setup.importing")} />
                      ) : (
                        <>
                          <ArrowUploadRegular
                            className="h-7 w-7 text-blue-600 dark:text-blue-400"
                            aria-hidden="true"
                          />
                          <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                            {t(
                              method === "excel"
                                ? "new.setup.excelDropTitle"
                                : "new.setup.fileDropTitle",
                            )}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {t(
                              method === "excel"
                                ? "new.setup.excelFormats"
                                : "new.setup.fileFormats",
                            )}
                          </p>
                          <Button
                            appearance="secondary"
                            className="mt-4"
                            onClick={() => activeInput.current?.click()}
                          >
                            {t("new.setup.browseFiles")}
                          </Button>
                        </>
                      )}
                    </div>
                    {importSummary && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                        <p className="truncate text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                          {importSummary.filename}
                        </p>
                        <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                          {importSummary.detail}
                        </p>
                      </div>
                    )}
                    {batchContent}
                  </>
                )}

                {method === "url" && (
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-900 dark:text-white">
                      {t("new.setup.urlLabel")}
                    </span>
                    <input
                      type="url"
                      value={uri}
                      onChange={(event) => onUriChange(event.target.value)}
                      placeholder={t("new.extracted.text48")}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <span className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400">
                      {t("new.setup.urlHelp")}
                    </span>
                  </label>
                )}

                {method === "template" && (
                  <div className="space-y-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                        {t("new.setup.templateTitle")}
                      </h2>
                      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {t("new.setup.templateDescription")}
                      </p>
                    </div>
                    {selectedTemplateName ? (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/30">
                        <div className="min-w-0">
                          <p className="text-xs font-medium uppercase tracking-wide text-blue-600 dark:text-blue-300">
                            {t("new.setup.selectedTemplate")}
                          </p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-blue-950 dark:text-blue-100">
                            {selectedTemplateName}
                          </p>
                        </div>
                        <Button appearance="secondary" onClick={onBrowseTemplates}>
                          {t("new.setup.changeTemplate")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        appearance="primary"
                        icon={<LibraryRegular />}
                        onClick={onBrowseTemplates}
                      >
                        {t("new.setup.browseTemplates")}
                      </Button>
                    )}
                  </div>
                )}

                {method === "custom" && (
                  <div>
                    <span className="mb-2 block text-sm font-semibold text-slate-900 dark:text-white">
                      {t("new.setup.platformLabel")}
                    </span>
                    <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => onPlatformChange("windows")}
                        aria-pressed={platform === "windows"}
                        aria-label={t("administration.filters.operatingSystem.options.windows")}
                        className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${
                          platform === "windows"
                            ? "bg-blue-600 text-white"
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span aria-hidden="true">
                          <WindowsLogo className="h-4 w-4" />
                        </span>
                        {t("administration.filters.operatingSystem.options.windows")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onPlatformChange("linux")}
                        aria-pressed={platform === "linux"}
                        aria-label={t("administration.filters.operatingSystem.options.linux")}
                        className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${
                          platform === "linux"
                            ? "bg-blue-600 text-white"
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span aria-hidden="true">🐧</span>
                        {t("administration.filters.operatingSystem.options.linux")}
                      </button>
                    </div>
                  </div>
                )}

                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-900 dark:text-white">
                    {t("new.extracted.text41")}
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => onNameChange(event.target.value)}
                    placeholder={t("new.extracted.text42")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/50">
          <Button appearance="secondary" onClick={onCancel}>
            {t("new.setup.cancel")}
          </Button>
          <Button
            appearance="primary"
            disabled={!canContinue || continuing}
            onClick={onContinue}
            icon={continuing ? <Spinner size="tiny" /> : undefined}
          >
            {continuing ? t("new.setup.creating") : t("new.setup.create")}
          </Button>
        </footer>
      </section>
    </div>
  );
}
