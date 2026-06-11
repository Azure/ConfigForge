// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CIS Diff tab.
 *
 * Primary metric: **compliance percent** — how much of the chosen CIS
 * benchmark is covered by the manifest. NOT the inverse.
 *
 * If a customer authors a 200-resource manifest where every resource
 * matches CIS, they're NOT 100% compliant if the benchmark has 364
 * rules — they're 200/364 = 55% compliant.
 *
 * UI:
 *   - Manifest dropdown
 *   - Benchmark dropdown (auto-picked by platform, user-overridable)
 *   - Big compliance metric: X / Y rules covered (Z%) with progress bar
 *   - Secondary metric: M of N manifest resources matched
 *   - Filter buttons: All / Covered in manifest / Missing from CIS
 *   - Results table — switches between manifest resources or missing CIS rules
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  ShieldCheckmarkRegular,
  CheckmarkCircleFilled,
  DismissCircleFilled,
  SearchRegular,
  ArrowSortRegular,
  ArrowSortUpRegular,
  ArrowSortDownRegular,
} from '@fluentui/react-icons';
import { Button, Spinner } from '@fluentui/react-components';
import { cfs } from '../../../lib/cfs';
import { useNumberFormatter } from '../../../lib/format';

interface ManifestInfo {
  Name: string;
  DisplayName?: string;
}

interface BenchmarkInfo {
  filename: string;
  platform: 'windows' | 'linux' | 'unknown';
  benchmarkName: string;
  benchmarkVersion: string;
  ruleCount: number;
  source: 'azure-policy' | 'xccdf';
}

type FilterMode = 'all' | 'covered' | 'missing';

interface BulkResult {
  resourceName: string;
  resourceType: string;
  innerType: string;
  registryKeyPath: string | null;
  registryValueName: string | null;
  cisMatch: {
    ruleId: string;
    title: string;
    description?: string;
    severity?: string;
    source?: string;
    benchmark?: string;
  } | null;
}

interface UnmatchedRule {
  ruleId: string;
  sectionNumber: string;
  title: string;
  value: string;
}

interface BulkResponse {
  namespace: string;
  manifestResourceTotal: number;
  manifestResourcesWithMatch: number;
  benchmark: {
    filename: string;
    name: string;
    version: string;
    platform: 'windows' | 'linux' | 'unknown';
    totalRules: number;
    source: 'azure-policy' | 'xccdf';
  } | null;
  cisRulesCovered: number;
  cisRulesUnmatched: UnmatchedRule[];
  compliancePercent: number | null;
  results: BulkResult[];
}

interface CisDiffTabProps {
  manifests: ManifestInfo[];
}

export function CisDiffTab({ manifests }: CisDiffTabProps) {
  const { t } = useTranslation(['diff', 'common']);
  const percentFormatter = useNumberFormatter({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const [selectedManifest, setSelectedManifest] = useState<string>('');
  const [selectedBenchmark, setSelectedBenchmark] = useState<string>('');
  const [availableBenchmarks, setAvailableBenchmarks] = useState<BenchmarkInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BulkResponse | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  // null = natural order, 'mapped-first' = green up, 'unmapped-first' = red up
  const [statusSort, setStatusSort] = useState<null | 'mapped-first' | 'unmapped-first'>(null);

  // v0.3.47: Compare button sits at the top of the form but results
  // render hundreds of pixels below; on smaller windows the score
  // appears below the fold so users think the click did nothing.
  // Auto-scroll to the results once they arrive.
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (data && !loading) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [data, loading]);

  const cycleStatusSort = useCallback(() => {
    setStatusSort((prev) =>
      prev === null ? 'unmapped-first' : prev === 'unmapped-first' ? 'mapped-first' : null,
    );
  }, []);

  // Load available benchmarks on mount: XCCDF (full standard) + Azure Policy (Microsoft subset)
  useEffect(() => {
    let cancelled = false;
    cfs.cis.status().then((s) => {
      if (cancelled) return;
      const benchmarks: BenchmarkInfo[] = [];
      // XCCDF files first — these are the full CIS standards (~500 rules)
      for (const xf of (s.xccdfFiles ?? [])) {
        if (!xf.hasOval) continue; // need OVAL companion for registry matching
        benchmarks.push({
          filename: xf.filename,
          platform: xf.platform,
          benchmarkName: xf.title || xf.filename,
          benchmarkVersion: xf.version || '',
          ruleCount: 0, // unknown until parsed
          source: 'xccdf',
        });
      }
      // Azure Policy (Microsoft-curated subset, ~364 rules)
      for (const ap of (s.azurePolicyCisFiles ?? [])) {
        if (ap.ruleCount === 0) continue;
        benchmarks.push({
          filename: ap.filename,
          platform: ap.platform,
          benchmarkName: ap.benchmarkName,
          benchmarkVersion: ap.benchmarkVersion,
          ruleCount: ap.ruleCount,
          source: 'azure-policy',
        });
      }
      setAvailableBenchmarks(benchmarks);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleCompare = useCallback(async () => {
    if (!selectedManifest) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await cfs.cis.bulkLookup(selectedManifest, selectedBenchmark || undefined);
      setData(result);
      // Sync benchmark dropdown to the one actually used (in case of auto-pick)
      if (result.benchmark && !selectedBenchmark) {
        setSelectedBenchmark(result.benchmark.filename);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.loadManifestsFailed'));
    } finally {
      setLoading(false);
    }
  }, [selectedManifest, selectedBenchmark]);

  const filteredResources = useMemo(() => {
    if (!data) return [];
    let r = data.results;
    if (filter === 'covered') r = r.filter((x) => x.cisMatch !== null);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (x) =>
          x.resourceName.toLowerCase().includes(q) ||
          (x.cisMatch?.title ?? '').toLowerCase().includes(q),
      );
    }
    if (statusSort === null) return r;
    // Stable sort: preserve natural order within each group
    return [...r].sort((a, b) => {
      const aMapped = a.cisMatch !== null ? 1 : 0;
      const bMapped = b.cisMatch !== null ? 1 : 0;
      if (aMapped === bMapped) return 0;
      return statusSort === 'mapped-first' ? bMapped - aMapped : aMapped - bMapped;
    });
  }, [data, filter, search, statusSort]);

  const filteredMissing = useMemo(() => {
    if (!data) return [];
    let r = data.cisRulesUnmatched;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (x) =>
          x.title.toLowerCase().includes(q) ||
          x.sectionNumber.toLowerCase().includes(q),
      );
    }
    return r;
  }, [data, search]);

  const covered = data?.cisRulesCovered ?? 0;
  const totalRules = data?.benchmark?.totalRules ?? 0;
  const compliancePct = data?.compliancePercent ?? null;
  const complianceColor =
    compliancePct == null
      ? 'text-slate-400'
      : compliancePct >= 80
        ? 'text-emerald-500'
        : compliancePct >= 50
          ? 'text-amber-500'
          : 'text-red-500';
  const progressColor =
    compliancePct == null
      ? 'bg-slate-300'
      : compliancePct >= 80
        ? 'bg-emerald-500'
        : compliancePct >= 50
          ? 'bg-amber-500'
          : 'bg-red-500';

  return (
    <div className="space-y-4">
      {/* Picker row */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="cis-diff-manifest" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('cis.labels.manifest')}
          </label>
          <select
            id="cis-diff-manifest"
            value={selectedManifest}
            onChange={(e) => setSelectedManifest(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="">{t('cis.options.chooseManifest')}</option>
            {manifests.map((m) => (
              <option key={m.Name} value={m.Name}>
                {m.DisplayName || m.Name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cis-diff-benchmark" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('cis.labels.benchmark')}
            <span className="ml-1 font-normal text-slate-400">{t('cis.labels.autoHint')}</span>
          </label>
          <select
            id="cis-diff-benchmark"
            value={selectedBenchmark}
            onChange={(e) => setSelectedBenchmark(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="">{t('cis.options.autoPick')}</option>
            {availableBenchmarks.map((b) => (
              <option key={b.filename} value={b.filename}>
                {b.source === 'xccdf' ? `${t('cis.options.fullCis')} ` : `${t('cis.options.azurePolicy')} `}
                {b.benchmarkName}{b.benchmarkVersion ? ` v${b.benchmarkVersion}` : ''} ({b.platform}{b.ruleCount > 0 ? `, ${t('cis.options.rules', { count: b.ruleCount })}` : ''})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Button
          appearance="primary"
          icon={<ShieldCheckmarkRegular />}
          onClick={handleCompare}
          disabled={!selectedManifest || loading}
        >
          {loading ? t('cis.compareLoading') : t('cis.compareButton')}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
          <Spinner size="small" />
          {t('cis.loading', { manifest: manifests.find((m) => m.Name === selectedManifest)?.DisplayName || selectedManifest })}
        </div>
      )}

      {data && !loading && (
        <div ref={resultsRef}>
          {/* Compliance hero */}
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {data.benchmark ? (
              <>
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('cis.complianceAgainst', { name: data.benchmark.name, version: data.benchmark.version })}
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className={`text-4xl font-bold tabular-nums ${complianceColor}`}>
                    {compliancePct == null ? '-' : percentFormatter.format(compliancePct)}%
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    ({t('cis.rulesCovered', { covered, total: totalRules })})
                  </span>
                </div>
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className={`h-full rounded-full transition-all ${progressColor}`}
                    style={{ width: `${compliancePct ?? 0}%` }}
                  />
                </div>
                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  {t('cis.secondary', { matched: data.manifestResourcesWithMatch, total: data.manifestResourceTotal })}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {t('cis.noBenchmark')}
              </div>
            )}
          </div>

          {/* Filters + search */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
              {(['all', 'covered', 'missing'] as FilterMode[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    filter === f
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {f === 'all'
                    ? t('cis.filters.all', { count: data.manifestResourceTotal })
                    : f === 'covered'
                      ? t('cis.filters.covered', { count: data.manifestResourcesWithMatch })
                      : t('cis.filters.missing', { count: data.cisRulesUnmatched.length })}
                </button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              <SearchRegular className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={filter === 'missing' ? t('cis.placeholders.missing') : t('cis.placeholders.resources')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            {filter === 'missing' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">{t('cis.table.section')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">{t('cis.table.missingRule')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">{t('cis.table.recommendedValue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredMissing.map((r) => (
                    <tr key={r.ruleId} className="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{r.sectionNumber}</td>
                      <td className="px-4 py-2 text-xs text-slate-700 dark:text-slate-300">{r.title}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.value || t('cis.table.notSpecified')}</td>
                    </tr>
                  ))}
                  {filteredMissing.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                        {search
                          ? t('cis.empty.noMissingMatch')
                          : data.cisRulesUnmatched.length === 0
                            ? t('cis.empty.nothingMissing')
                            : t('cis.empty.noResults')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
                      <button
                        type="button"
                        onClick={cycleStatusSort}
                        className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-slate-200/60 dark:hover:bg-slate-700/40"
                        title={
                          statusSort === null
                            ? t('cis.sort.unmappedFirst')
                            : statusSort === 'unmapped-first'
                              ? t('cis.sort.mappedFirst')
                              : t('cis.sort.clear')
                        }
                        aria-label={t('cis.sort.aria')}
                      >
                        {t('cis.table.status')}
                        {statusSort === null ? (
                          <ArrowSortRegular className="h-3 w-3 text-slate-400" />
                        ) : statusSort === 'unmapped-first' ? (
                          <ArrowSortDownRegular className="h-3 w-3 text-blue-500" />
                        ) : (
                          <ArrowSortUpRegular className="h-3 w-3 text-blue-500" />
                        )}
                      </button>
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">{t('cis.table.resource')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">{t('cis.table.type')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">{t('cis.table.cisRule')}</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">{t('cis.table.source')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredResources.map((r) => (
                    <tr key={r.resourceName} className="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2">
                        {r.cisMatch ? (
                          <CheckmarkCircleFilled
                            className="h-4 w-4 text-emerald-500"
                            aria-label={t('cis.aria.mapped')}
                          />
                        ) : (
                          <DismissCircleFilled
                            className="h-4 w-4 text-red-500"
                            aria-label={t('cis.aria.notMapped')}
                          />
                        )}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2 font-mono text-xs text-slate-900 dark:text-white" title={r.resourceName}>
                        {r.resourceName}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {r.innerType ? r.innerType.replace('Microsoft.Windows/', '') : r.resourceType.replace('Microsoft.OSConfig/', '')}
                      </td>
                      <td className="max-w-[300px] truncate px-4 py-2 text-xs text-slate-700 dark:text-slate-300" title={r.cisMatch?.title ?? ''}>
                        {r.cisMatch?.title || <span className="text-slate-400 dark:text-slate-600">{t('cis.noCisRule')}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {r.cisMatch?.source && (
                          <span
                            className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${
                              r.cisMatch.source === 'azure-policy'
                                ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                                : r.cisMatch.source === 'xccdf'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                                  : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {r.cisMatch.source === 'azure-policy' ? 'Azure Policy' : r.cisMatch.source === 'xccdf' ? 'XCCDF' : 'JSON'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredResources.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                        {search ? t('cis.empty.noResourceMatch') : t('cis.empty.noResults')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 py-16 dark:border-slate-700">
          <ShieldCheckmarkRegular className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            <Trans i18nKey="cis.empty.pickManifest" ns="diff" components={{ strong: <strong /> }} />
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {t('cis.empty.description')}
          </p>
        </div>
      )}
    </div>
  );
}
