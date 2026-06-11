// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Real 404 page for the renderer's HashRouter wildcard.
 *
 * Replaces the earlier `ComingSoonPage` placeholder that used to render
 * for unmatched routes, which surfaced internal phase numbers and
 * referenced `window.cfs` with zero recovery action. Surfaced by the
 * v0.1.0 UI audit; the placeholder was removed in v0.3.15.
 */
import { Link } from "react-router-dom";
import { ArrowLeftRegular, HomeRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

export function NotFoundPage() {
  const { t } = useTranslation("dialogs");
  // location.hash includes the leading '#'; strip for display.
  const path =
    typeof window !== "undefined" && window.location?.hash
      ? window.location.hash.replace(/^#/, "")
      : "";

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 py-16">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t("notFound.extracted.text1")}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {t("notFound.extracted.text2")}
        </h1>
        {path && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {t("notFound.extracted.text3")}{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {path}
            </code>{" "}
            {t("notFound.extracted.text4")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <HomeRegular className="h-4 w-4" />
          {t("notFound.extracted.text5")}
        </Link>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeftRegular className="h-4 w-4" />
          {t("notFound.extracted.text6")}
        </button>
      </div>
    </div>
  );
}
