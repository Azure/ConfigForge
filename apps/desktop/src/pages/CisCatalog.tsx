// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Benchmark Mapping page.
 *
 * CIS data remains user-supplied. This page keeps one stable, three-step
 * workflow in place while status moves between loading, unavailable, and
 * loaded states.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowSyncRegular,
  BookmarkRegular,
  CheckmarkCircleRegular,
  CopyRegular,
  FolderOpenRegular,
  InfoRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { Button, Spinner } from '@fluentui/react-components';
import type { CisStatus } from '@configforge/core/handlers';
import { getCisReadiness } from '@configforge/core/cis/readiness';
import { useTranslation } from 'react-i18next';
import { _resetCisAvailableCacheForTests } from '../components/use-cis-available';
import { ExternalLink } from '../components/ExternalLink';
import { cfs } from '../lib/cfs';
import { useNumberFormatter } from '../lib/format';

const AZURE_PORTAL_URL = 'https://portal.azure.com/';
const CIS_WORKBENCH_URL = 'https://workbench.cisecurity.org/';

type ActionNotice = {
  intent: 'error' | 'success';
  text: string;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function StatusBanner({ status }: { status: CisStatus | null }) {
  const { t } = useTranslation('cis-catalog');
  const available = status?.available ?? null;
  const readiness = getCisReadiness(status);
  const legacyMappingsMissing =
    (status?.legacyRuleCatalogCount ?? 0) > 0 && status?.legacyMappingsLoaded !== true;

  if (available === null) {
    return (
      <section
        role="status"
        aria-label={t('status.ariaLabel')}
        aria-live="polite"
        aria-busy="true"
        className="w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100 sm:px-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <Spinner size="tiny" className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 whitespace-normal break-words">
            <h2 className="text-sm font-semibold">{t('status.loading.title')}</h2>
            <p className="mt-0.5 text-sm text-blue-900 dark:text-blue-200">
              {t('status.loading.description')}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (readiness.usable && !readiness.partial) {
    return (
      <section
        role="status"
        aria-label={t('status.ariaLabel')}
        aria-live="polite"
        className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100 sm:px-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <CheckmarkCircleRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1 whitespace-normal break-words">
            <h2 className="text-sm font-semibold">{t('status.loaded.title')}</h2>
            <p className="mt-0.5 text-sm text-emerald-900 dark:text-emerald-200">
              {t('status.loaded.description')}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (readiness.partial) {
    return (
      <section
        role="status"
        aria-label={t("status.ariaLabel")}
        aria-live="polite"
        className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 sm:px-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <WarningRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1 whitespace-normal break-words">
            <h2 className="text-sm font-semibold">{t("status.partial.title")}</h2>
            <p className="mt-0.5 text-sm text-amber-900 dark:text-amber-200">
              {t(
                legacyMappingsMissing
                  ? "status.partial.legacyMappingsDescription"
                  : "status.partial.description",
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (readiness.detected) {
    return (
      <section
        role="status"
        aria-label={t("status.ariaLabel")}
        aria-live="polite"
        className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 sm:px-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <WarningRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1 whitespace-normal break-words">
            <h2 className="text-sm font-semibold">{t("status.detected.title")}</h2>
            <p className="mt-0.5 text-sm text-amber-900 dark:text-amber-200">
              {t(
                legacyMappingsMissing
                  ? "status.detected.legacyMappingsDescription"
                  : "status.detected.description",
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      role="alert"
      aria-label={t('status.ariaLabel')}
      className="w-full rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 sm:px-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <WarningRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1 whitespace-normal break-words">
          <h2 className="text-sm font-semibold">{t('status.unavailable.title')}</h2>
          <p className="mt-0.5 text-sm text-red-900 dark:text-red-200">
            {t('status.unavailable.description')}
          </p>
          <p className="mt-1 text-xs text-red-800 dark:text-red-300">
            {t('status.unavailable.optional')}
          </p>
          {status?.schemaError && (
            <p className="mt-2 break-all rounded-md bg-red-100 px-2.5 py-2 text-xs text-red-950 dark:bg-red-900/50 dark:text-red-100">
              <span className="font-semibold">{t('status.schemaDetails')} </span>
              {status.schemaError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

interface StepHeadingProps {
  description: string;
  id: string;
  number: number;
  title: string;
}

function StepHeading({ description, id, number, title }: StepHeadingProps) {
  const { t } = useTranslation('cis-catalog');
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white dark:bg-blue-500 dark:text-slate-950"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <h2
          id={id}
          aria-label={t('workflow.stepHeading', { number, title })}
          className="text-lg font-semibold text-slate-950 dark:text-white"
        >
          <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            {t('workflow.stepLabel', { number })}
          </span>{' '}
          <span>{title}</span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{description}</p>
      </div>
    </div>
  );
}

function PlatformBadge({ platform }: { platform: 'windows' | 'linux' | 'unknown' }) {
  const { t } = useTranslation('cis-catalog');
  const color =
    platform === 'windows'
      ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100'
      : platform === 'linux'
        ? 'bg-amber-100 text-amber-950 dark:bg-amber-900/50 dark:text-amber-100'
        : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100';

  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${color}`}>
      {t(`detected.platform.${platform}`)}
    </span>
  );
}

function DetectedCatalogs({ status }: { status: CisStatus }) {
  const { t } = useTranslation('cis-catalog');
  const numberFormatter = useNumberFormatter();
  const xccdfFiles = status.xccdfFiles ?? [];
  const azurePolicyFiles = status.azurePolicyCisFiles ?? [];
  const hasLegacyJson =
    status.legacyMappingsLoaded === true ||
    (status.legacyRuleCatalogCount ?? 0) > 0 ||
    status.source === 'json' ||
    status.source === 'both';
  const readiness = getCisReadiness(status);
  const hasCatalogMetadata = xccdfFiles.length > 0 || azurePolicyFiles.length > 0 || hasLegacyJson;

  return (
    <section
      role="region"
      aria-label={t('detected.ariaLabel')}
      className={`mt-5 rounded-lg border px-4 py-4 ${
        readiness.usable && !readiness.partial
          ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
          : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
      }`}
    >
      <div className="flex items-start gap-2">
        {readiness.usable && !readiness.partial ? (
          <CheckmarkCircleRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        ) : (
          <WarningRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('detected.title')}</h3>
          <p className="mt-0.5 text-xs">
            {t(
              readiness.usable && !readiness.partial
                ? "detected.description"
                : readiness.partial
                  ? "detected.partialDescription"
                  : "detected.limitedDescription",
            )}
          </p>
        </div>
      </div>

      {hasCatalogMetadata ? (
        <ul className="mt-3 divide-y divide-emerald-200 border-y border-emerald-200 dark:divide-emerald-900 dark:border-emerald-900">
          {azurePolicyFiles.map((catalog) => (
            <li key={`azure-${catalog.filename}`} className="py-3">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-blue-700 px-2 py-0.5 text-xs font-semibold text-white dark:bg-blue-400 dark:text-blue-950">
                      {t('detected.azurePolicy')}
                    </span>
                    <span className="break-words text-sm font-semibold">
                      {catalog.benchmarkName || catalog.filename}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-emerald-800 dark:text-emerald-300">
                    {catalog.filename}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-900 dark:text-emerald-200">
                  <span>
                    {t('detected.version', {
                      version: catalog.benchmarkVersion || t('detected.notReported'),
                    })}
                  </span>
                  <span>
                    {t('detected.ruleCount', {
                      count: catalog.ruleCount,
                      formattedCount: numberFormatter.format(catalog.ruleCount),
                    })}
                  </span>
                  {catalog.ruleCount === 0 && (
                    <span className="font-medium text-amber-800 dark:text-amber-200">
                      {t("detected.noUsableRules")}
                    </span>
                  )}
                  <PlatformBadge platform={catalog.platform} />
                </div>
              </div>
            </li>
          ))}

          {xccdfFiles.map((catalog) => (
            <li key={`xccdf-${catalog.filename}`} className="py-3">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white dark:bg-emerald-400 dark:text-emerald-950">
                      {t('detected.xccdf')}
                    </span>
                    <span className="break-words text-sm font-semibold">
                      {catalog.title || catalog.filename}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-emerald-800 dark:text-emerald-300">
                    {catalog.filename}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-900 dark:text-emerald-200">
                  <span>
                    {t('detected.version', {
                      version: catalog.version || t('detected.notReported'),
                    })}
                  </span>
                  <PlatformBadge platform={catalog.platform} />
                  <span className="inline-flex items-center gap-1 font-medium">
                    {catalog.hasOval ? (
                      <CheckmarkCircleRegular aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <WarningRegular aria-hidden="true" className="h-4 w-4" />
                    )}
                    {catalog.hasOval ? t('detected.ovalFound') : t('detected.ovalMissing')}
                  </span>
                </div>
              </div>
            </li>
          ))}

          {hasLegacyJson && (
            <li className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-700 px-2 py-0.5 text-xs font-semibold text-white dark:bg-slate-300 dark:text-slate-950">
                  {t('detected.json')}
                </span>
                <span className="text-sm font-semibold">{t('detected.legacyTitle')}</span>
                <span className="text-xs text-emerald-900 dark:text-emerald-200">
                  {status.legacyMappingsLoaded && (status.legacyRuleCatalogCount ?? 0) > 0
                    ? t("detected.legacyReady", {
                        count: status.legacyRuleCatalogCount,
                      })
                    : status.legacyMappingsLoaded
                      ? t("detected.legacyRulesMissing")
                      : t("detected.legacyMappingsMissing")}
                </span>
              </div>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-emerald-900 dark:text-emerald-200">
          {t('detected.noMetadata')}
        </p>
      )}
    </section>
  );
}

function Diagnostics({ status }: { status: CisStatus }) {
  const { t } = useTranslation('cis-catalog');
  const unexpectedFiles = status.unexpectedFiles ?? [];
  if (!status.schemaError && unexpectedFiles.length === 0) return null;

  return (
    <section aria-labelledby="cis-diagnostics-heading" className="mt-5">
      <h3
        id="cis-diagnostics-heading"
        className="text-sm font-semibold text-slate-950 dark:text-white"
      >
        {t('diagnostics.title')}
      </h3>

      {status.schemaError && (
        <div
          role="alert"
          className="mt-2 flex min-w-0 items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
        >
          <WarningRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('diagnostics.schemaTitle')}</p>
            <p className="mt-1 break-all text-xs">{status.schemaError}</p>
          </div>
        </div>
      )}

      {unexpectedFiles.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <WarningRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t('diagnostics.unexpectedTitle')}</p>
              <p className="mt-0.5 text-xs">{t('diagnostics.unexpectedDescription')}</p>
            </div>
          </div>
          <ul className="mt-2 space-y-2">
            {unexpectedFiles.map((file) => (
              <li
                key={file.name}
                className="flex min-w-0 flex-col gap-1 border-t border-amber-200 pt-2 text-xs dark:border-amber-900 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2"
              >
                <code className="break-all font-semibold">{file.name}</code>
                {file.didYouMean && (
                  <span className="break-words">
                    {t('diagnostics.didYouMean', { suggestion: file.didYouMean })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function InlineNotice({
  errorLabel,
  notice,
  successLabel,
}: {
  errorLabel: string;
  notice: ActionNotice | null;
  successLabel: string;
}) {
  if (!notice) return null;
  const isError = notice.intent === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-label={isError ? errorLabel : successLabel}
      className={`mt-3 flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-xs ${
        isError
          ? 'bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100'
          : 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100'
      }`}
    >
      {isError ? (
        <WarningRegular aria-hidden="true" className="h-4 w-4 shrink-0" />
      ) : (
        <CheckmarkCircleRegular aria-hidden="true" className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 break-words">{notice.text}</span>
    </div>
  );
}

export function CisCatalogPage() {
  const { t } = useTranslation('cis-catalog');
  const [status, setStatus] = useState<CisStatus | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState<ActionNotice | null>(null);
  const [folderNotice, setFolderNotice] = useState<ActionNotice | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (recheck: boolean) => {
      setRefreshing(true);
      setCatalogNotice(null);
      try {
        const nextStatus = recheck ? await cfs.cis.recheck() : await cfs.cis.status();
        setStatus(nextStatus);
        if (recheck) {
          // Re-check clears main-process caches. Invalidate the renderer cache
          // as well so Diff and the editor see newly imported data immediately.
          _resetCisAvailableCacheForTests();
          const readiness = getCisReadiness(nextStatus);
          const legacyMappingsMissing =
            (nextStatus.legacyRuleCatalogCount ?? 0) > 0 &&
            nextStatus.legacyMappingsLoaded !== true;
          setCatalogNotice({
            intent: 'success',
            text: readiness.partial
              ? t(
                  legacyMappingsMissing
                    ? "actions.recheckPartialMappingsMissing"
                    : "actions.recheckPartial",
                )
              : readiness.usable
              ? t('actions.recheckLoaded')
              : readiness.detected
                ? t(
                    legacyMappingsMissing
                      ? "actions.recheckMappingsMissing"
                      : "actions.recheckDetected",
                  )
                : t('actions.recheckUnavailable'),
          });
        }
      } catch (error) {
        if (!recheck) setStatus({ available: false });
        setCatalogNotice({
          intent: 'error',
          text: errorMessage(error, t('actions.statusError')),
        });
      } finally {
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const openFolder = useCallback(async () => {
    setOpening(true);
    setFolderNotice(null);
    try {
      const result = await cfs.cis.revealDataDir();
      setStatus((current) =>
        current
          ? { ...current, dataDir: result.path }
          : { available: false, dataDir: result.path },
      );
      setFolderNotice({
        intent: 'success',
        text: t('actions.openedFolder', { path: result.path }),
      });
    } catch (error) {
      setFolderNotice({
        intent: 'error',
        text: errorMessage(error, t('actions.openFolderError')),
      });
    } finally {
      setOpening(false);
    }
  }, [t]);

  const copyPath = useCallback(async () => {
    if (!status?.dataDir) return;
    setFolderNotice(null);
    try {
      await navigator.clipboard.writeText(status.dataDir);
      setCopied(true);
      setFolderNotice({ intent: 'success', text: t('actions.copiedPath') });
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      setFolderNotice({
        intent: 'error',
        text: errorMessage(error, t('actions.copyPathError')),
      });
    }
  }, [status?.dataDir, t]);

  const dataDir = status?.dataDir;
  const readiness = getCisReadiness(status);

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-white">
          <BookmarkRegular aria-hidden="true" className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          {t('header.title')}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          {t('header.description')}
        </p>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          {t('header.capabilities')}
        </p>
      </header>

      <StatusBanner status={status} />

      <ol
        aria-label={t('workflow.ariaLabel')}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:divide-slate-800"
      >
        <li>
          <section
            aria-labelledby="cis-step-download"
            className="px-4 py-5 sm:px-6 sm:py-6"
          >
            <StepHeading
              id="cis-step-download"
              number={1}
              title={t('steps.download.title')}
              description={t('steps.download.description')}
            />

            <div className="mt-5 border-y border-slate-200 divide-y divide-slate-200 dark:border-slate-700 dark:divide-slate-700">
              <article className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                      {t('steps.download.azure.title')}
                    </h3>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900 dark:bg-blue-900/50 dark:text-blue-100">
                      {t('steps.download.recommended')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {t('steps.download.azure.description')}
                  </p>
                </div>
                <ExternalLink
                  href={AZURE_PORTAL_URL}
                  className="inline-flex min-h-9 items-center justify-center self-start rounded-md px-3 py-2 text-sm font-semibold text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:text-blue-100"
                >
                  {t('steps.download.azure.link')}
                </ExternalLink>
              </article>

              <article className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                      {t('steps.download.xccdf.title')}
                    </h3>
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      {t('steps.download.alternate')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {t('steps.download.xccdf.description')}
                  </p>
                </div>
                <ExternalLink
                  href={CIS_WORKBENCH_URL}
                  className="inline-flex min-h-9 items-center justify-center self-start rounded-md px-3 py-2 text-sm font-semibold text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:text-blue-100"
                >
                  {t('steps.download.xccdf.link')}
                </ExternalLink>
              </article>
            </div>

            <aside
              role="note"
              aria-label={t('steps.download.license.ariaLabel')}
              className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <InfoRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="min-w-0 break-words text-xs">
                <span className="font-semibold">{t('steps.download.license.title')} </span>
                {t('steps.download.license.description')}
              </p>
            </aside>
          </section>
        </li>

        <li>
          <section aria-labelledby="cis-step-import" className="px-4 py-5 sm:px-6 sm:py-6">
            <StepHeading
              id="cis-step-import"
              number={2}
              title={t('steps.import.title')}
              description={t('steps.import.description')}
            />

            <aside
              role="note"
              aria-label={t('steps.import.guidance.ariaLabel')}
              className="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100"
            >
              <div className="flex items-start gap-2">
                <InfoRegular aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{t('steps.import.guidance.title')}</h3>
                  <ul className="mt-2 space-y-2 text-sm text-blue-900 dark:text-blue-200">
                    <li className="break-words">
                      <span className="font-semibold">
                        {t('steps.import.guidance.azureLabel')}{' '}
                      </span>
                      {t('steps.import.guidance.azureDescription')}
                    </li>
                    <li className="break-words">
                      <span className="font-semibold">
                        {t('steps.import.guidance.xccdfLabel')}{' '}
                      </span>
                      {t('steps.import.guidance.xccdfDescription')}
                    </li>
                  </ul>
                </div>
              </div>
            </aside>

            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('steps.import.pathLabel')}
              </p>
              {dataDir ? (
                <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                  <code
                    aria-label={t('steps.import.pathAriaLabel')}
                    title={dataDir}
                    className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 [overflow-wrap:anywhere] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {dataDir}
                  </code>
                  <Button
                    appearance="subtle"
                    icon={<CopyRegular />}
                    onClick={copyPath}
                    aria-label={copied ? t('actions.pathCopiedAria') : t('actions.copyPathAria')}
                  >
                    {copied ? t('actions.copied') : t('actions.copyPath')}
                  </Button>
                </div>
              ) : (
                <div
                  role="status"
                  className="mt-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  <p>{t('steps.import.pathUnavailable')}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {t('steps.import.pathUnavailableHint')}
                  </p>
                </div>
              )}

              <div className="mt-3">
                <Button
                  appearance="primary"
                  icon={
                    opening ? (
                      <Spinner size="tiny" aria-hidden="true" />
                    ) : (
                      <FolderOpenRegular />
                    )
                  }
                  onClick={openFolder}
                  disabled={opening}
                >
                  {opening ? t('actions.openingFolder') : t('actions.openFolder')}
                </Button>
              </div>

              <InlineNotice
                notice={folderNotice}
                errorLabel={t('actions.folderActionFailed')}
                successLabel={t('actions.folderActionComplete')}
              />
            </div>
          </section>
        </li>

        <li>
          <section aria-labelledby="cis-step-recheck" className="px-4 py-5 sm:px-6 sm:py-6">
            <StepHeading
              id="cis-step-recheck"
              number={3}
              title={t('steps.recheck.title')}
              description={t('steps.recheck.description')}
            />

            <div className="mt-5">
              <Button
                appearance="secondary"
                icon={
                  refreshing ? (
                    <Spinner size="tiny" aria-hidden="true" />
                  ) : (
                    <ArrowSyncRegular />
                  )
                }
                onClick={() => void load(true)}
                disabled={refreshing}
              >
                {refreshing ? t('actions.rechecking') : t('actions.recheck')}
              </Button>
              <InlineNotice
                notice={catalogNotice}
                errorLabel={t('actions.catalogActionFailed')}
                successLabel={t('actions.catalogActionComplete')}
              />
            </div>

            {readiness.detected && status && <DetectedCatalogs status={status} />}
            {status && <Diagnostics status={status} />}
          </section>
        </li>
      </ol>
    </div>
  );
}
