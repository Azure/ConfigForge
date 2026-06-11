// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PulseRegular,
  ShieldCheckmarkRegular,
  DocumentRegular,
  AddRegular,
  LibraryRegular,
  ServerRegular,
  PersonSettingsRegular,
  DesktopRegular,
  PlayRegular,
  ArrowCounterclockwiseRegular,
  EditRegular,
  BranchCompareRegular,
} from "@fluentui/react-icons";
import { Button } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { cfs } from '../lib/cfs';
import { useCliPresence } from '../hooks/useCliPresence';
import { ExternalLink } from '../components/ExternalLink';
import { OSCONFIG_INSTALL_URL } from '../components/CliRequiredModal';
import { useDateFormatter, useRelativeTimeFormatter } from '../lib/format';
import { HAS_ACTIVITY_FEED, HAS_HEALTH } from '../lib/flavor';

interface ActivityItem {
  type: 'registered' | 'deployed' | 'deployed-audit' | 'deployed-enforce' | 'reverted';
  name: string;
  timestamp: string;
  message?: string;
}

/**
 * Dashboard / home page.
 *
 * Replaces 4 fetch sites with cfs.health.check / cfs.manifests.list /
 * cfs.activity.recent. The "Drift" panel from v1 is intentionally
 * still commented out per the original page.
 */
export function HomePage() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof cfs.health.check>> | null>(null);
  const [manifestCount, setManifestCount] = useState<number | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  // v0.2.0, bring-your-own-CLI. When OSConfig is absent we replace
  // the "OSConfig: Not installed" prominent red dot with a friendly
  // "Editor mode" hero card pointing users at /library + the install
  // affordance. Dismissable per session via local state, we don't
  // persist this one (unlike the Welcome dialog) because the user
  // already explicitly opted into "no CLI" via the dialog or the
  // Settings page.
  const presence = useCliPresence();
  const { t } = useTranslation(['home', 'common']);
  const interruptedDateFormatter = useDateFormatter({
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [heroDismissed, setHeroDismissed] = useState(false);
  // v0.3.0 (#7): persistent "Get started" card on a Dashboard with 0
  // manifests. Pointed out by the UX audit as the biggest first-run
  // gap — a customer who clicks Skip on the WelcomeDialog and has a
  // working CLI lands here with no guidance whatsoever. The card is
  // dismissable; localStorage so it stays gone across sessions.
  const FIRST_RUN_KEY = 'cfs.dashboard.firstrun.dismissedAt';
  const [firstRunDismissed, setFirstRunDismissed] = useState<boolean>(() => {
    try {
      return !!window.localStorage.getItem(FIRST_RUN_KEY);
    } catch {
      return false;
    }
  });
  const dismissFirstRun = useCallback(() => {
    try {
      window.localStorage.setItem(FIRST_RUN_KEY, new Date().toISOString());
    } catch {
      // localStorage write failure shouldn't break the UI
    }
    setFirstRunDismissed(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      const [healthRes, manifestRes, activityRes] = await Promise.allSettled([
        HAS_HEALTH
          ? cfs.health.check()
          : Promise.resolve(null as unknown as Awaited<ReturnType<typeof cfs.health.check>>),
        // perf W2 / H6: dashboard tile only consumes `arr.length`, so
        // explicitly opt into the lite (Resources-stripped) payload.
        // Saves ~5-10 MB of serialized Resources[] for a 50-manifest
        // tenant on every Home mount.
        cfs.manifests.list({ lite: true }),
        HAS_ACTIVITY_FEED
          ? cfs.activity.recent()
          : Promise.resolve({ data: [] as ActivityItem[] }),
      ]);

      if (cancelled) return;

      // v0.1.11 fix — log any rejected branches so silent IPC failures
      // are debuggable. Previously rejections fell through to the
      // `setLoading(false)` at the bottom with no breadcrumb in
      // main.log, so a broken health/manifests/activity channel just
      // produced an empty dashboard tile.
      if (healthRes.status === 'rejected') {
        console.error('[Home] cfs.health.check failed:', healthRes.reason);
      }
      if (manifestRes.status === 'rejected') {
        console.error('[Home] cfs.manifests.list failed:', manifestRes.reason);
      }
      if (activityRes.status === 'rejected') {
        console.error('[Home] cfs.activity.recent failed:', activityRes.reason);
      }

      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);

      if (manifestRes.status === 'fulfilled') {
        const d = (manifestRes.value as { data?: unknown }).data;
        if (d == null) {
          setManifestCount(0);
        } else {
          const arr = Array.isArray(d) ? d : [d];
          setManifestCount(arr.filter((m) => m != null).length);
        }
      }

      if (activityRes.status === 'fulfilled') {
        const v = activityRes.value as { data?: ActivityItem[] } | ActivityItem[];
        const items = Array.isArray(v) ? v : (v.data ?? []);
        setActivities(items);
      }

      setLoading(false);
    }

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const [interrupted, setInterrupted] = useState<{ namespace: string; displayName: string; startedAt: string }[]>([]);
  useEffect(() => {
    // v0.3.1 (#4): on Dashboard mount, check for orphaned deploy-in-
    // progress sentinels. If any exist, the app died mid-enforce and
    // the user's device may be partially-applied. Surface a banner
    // with audit/revert CTAs.
    let cancelled = false;
    (async () => {
      try {
        const api = (window as unknown as {
          cfs?: { deployRecovery?: { listInterrupted: () => Promise<{ data: { namespace: string; displayName: string; startedAt: string }[] }> } };
        }).cfs?.deployRecovery;
        if (!api) return;
        const res = await api.listInterrupted();
        if (cancelled) return;
        setInterrupted(res.data ?? []);
      } catch {
        // namespace may not be exposed on the mac-author flavor
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismissInterrupted = useCallback(async (namespace: string) => {
    try {
      const api = (window as unknown as {
        cfs?: { deployRecovery?: { dismiss: (n: string) => Promise<{ ok: true }> } };
      }).cfs?.deployRecovery;
      await api?.dismiss(namespace);
    } catch {
      /* best-effort */
    }
    setInterrupted((cur) => cur.filter((e) => e.namespace !== namespace));
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {t('page.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('page.description')}
        </p>
      </div>

      {/* v0.3.1 (#4): mid-deploy interruption recovery. Banner appears
          on Dashboard when a `.deploy-in-progress` sentinel was left
          behind by a process killed mid-enforce. The customer is
          prompted to audit or revert the affected manifest. */}
      {interrupted.length > 0 && (
        <div className="space-y-3">
          {interrupted.map((e) => (
            <div
              key={e.namespace}
              role="alert"
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-800/60 dark:bg-amber-900/15"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                       {t('interrupted.title', { name: e.displayName })}
                  </h2>
                  <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-100/80">
                    {t('interrupted.description', {
                      startedAt: e.startedAt
                        ? t('interrupted.startedAt', { time: interruptedDateFormatter.format(new Date(e.startedAt)) })
                        : '',
                    })}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      to={`/manifests/${encodeURIComponent(e.namespace)}/compliance`}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800"
                    >
                      {t('interrupted.actions.auditCompliance')}
                    </Link>
                    <Link
                      to={`/manifests/${encodeURIComponent(e.namespace)}`}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/20"
                    >
                      {t('interrupted.actions.openManifest')}
                    </Link>
                    <Button appearance="subtle" size="small" onClick={() => dismissInterrupted(e.namespace)}>
                      {t('interrupted.actions.handled')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
       * v0.2.0, Editor-mode hero card. Renders only when OSConfig
       * is missing (presence.installed=false), the probe has settled
       * (presence.loading=false), and the user hasn't tucked it
       * away this session. Points users at /library so the first
       * impression after the Welcome dialog is content, not a sea
       * of red "Not installed" tiles.
       *
       * The page-level health card below still shows the same
       * underlying state, this is a Mei high-density summary above
       * it that gives the user explicit "you're in editor mode and
       * here's where to go" framing.
       */}
      {HAS_HEALTH && !presence.loading && !presence.installed && !heroDismissed && (
        <div
          role="region"
          aria-label={t('editorMode.aria')}
          className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10 p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
              <EditRegular className="w-5 h-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-amber-900 dark:text-amber-100">
                {t('editorMode.sectionTitle')}
              </h2>
              <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">
                {t('editorMode.sectionDescription')}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  to="/library"
                  className="inline-flex items-center gap-1 rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
                >
                  <LibraryRegular className="w-4 h-4" />
                  {t('editorMode.actions.browseLibrary')}
                </Link>
                <ExternalLink
                  href={OSCONFIG_INSTALL_URL}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/20"
                  aria-label={t('editorMode.installAria')}
                >
                  {t('editorMode.actions.installOsconfig')}
                </ExternalLink>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => setHeroDismissed(true)}
                >
                  {t('editorMode.actions.hide')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
       * v0.3.0 (#7): persistent "Get started" card for any first-run
       * user on a Dashboard with zero registered manifests. The
       * Editor-mode hero above only shows when OSConfig is missing —
       * a customer with a working CLI but no manifests yet would
       * otherwise see no guidance at all.
       */}
      {!loading && (manifestCount ?? 0) === 0 && !firstRunDismissed && (
        <div
          role="region"
          aria-label={t('firstRun.aria')}
          className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/10 p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 shrink-0">
              <DocumentRegular className="w-5 h-5 text-blue-700 dark:text-blue-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-blue-900 dark:text-blue-100">
                {t('firstRun.sectionTitle')}
              </h2>
              <p className="mt-1 text-sm text-blue-900/80 dark:text-blue-100/80">
                {t('firstRun.sectionDescription')}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  to="/library"
                  className="inline-flex items-center gap-1 rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
                >
                  <LibraryRegular className="w-4 h-4" />
                  {t('firstRun.actions.browseLibrary')}
                </Link>
                <Link
                  to="/manifests?action=new"
                  className="inline-flex items-center gap-1 rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-100 dark:hover:bg-blue-900/20"
                >
                  <AddRegular className="w-4 h-4" />
                  {t('firstRun.actions.registerOwn')}
                </Link>
                <Button appearance="subtle" size="small" onClick={dismissFirstRun}>
                  {t('common:buttons.dismiss')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {HAS_HEALTH && (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-azure-500/10">
            <PulseRegular className="w-5 h-5 text-azure-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('systemHealth.sectionTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('systemHealth.sectionDescription')}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <HealthStat
              icon={<ShieldCheckmarkRegular className="w-4 h-4" />}
              label={t('systemHealth.labels.osconfig')}
              // health.version already self-identifies as "oscfg <ver>",
              // so prepending another "v" produced "voscfg 1.3.9-..." in
              // the dashboard tile. Display the version string as-is.
              value={health?.installed ? (health.version ?? t('systemHealth.values.oscfgUnknown')) : t('systemHealth.values.notInstalled')}
              status={health?.installed ? 'green' : 'red'}
            />
            <HealthStat
              icon={<PersonSettingsRegular className="w-4 h-4" />}
              label={t('systemHealth.labels.admin')}
              value={(health as { isAdmin?: boolean })?.isAdmin ? t('systemHealth.values.elevated') : t('systemHealth.values.standard')}
              status={(health as { isAdmin?: boolean })?.isAdmin ? 'green' : 'yellow'}
            />
            <HealthStat
              icon={<ServerRegular className="w-4 h-4" />}
              label={t('systemHealth.labels.serverType')}
              value={(health as { serverType?: string })?.serverType ?? t('systemHealth.values.unknown')}
              status="neutral"
            />
            <HealthStat
              icon={<DesktopRegular className="w-4 h-4" />}
              label={t('systemHealth.labels.osVersion')}
              value={
                (health as { osVersion?: string })?.osVersion?.replace(
                  'Microsoft Windows NT ',
                  'Win ',
                ) ?? t('systemHealth.values.unknown')
              }
              status="neutral"
            />
          </div>
        )}
      </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <StatCard
          icon={<DocumentRegular className="w-5 h-5 text-azure-500" />}
          label={t('stats.registeredManifests')}
          value={loading ? '-' : String(manifestCount ?? 0)}
          to="/manifests"
        />
        <ComplianceCtaCard
          icon={<ShieldCheckmarkRegular className="w-5 h-5 text-azure-500" />}
          label={t('validation.label')}
          subtitle={t('validation.subtitle')}
          ctaLabel={t('validation.cta')}
          to="/compliance"
        />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
          {t('quickActions.sectionTitle')}
        </h2>
        <div className="flex flex-wrap gap-3">
          <ActionButton
            icon={<AddRegular className="w-4 h-4" />}
            label={t('quickActions.newManifest')}
            to="/manifests?action=new"
          />
          <ActionButton
            icon={<LibraryRegular className="w-4 h-4" />}
            label={t('quickActions.browseLibrary')}
            to="/library"
          />
          <ActionButton
            icon={<BranchCompareRegular className="w-4 h-4" />}
            label={t('quickActions.compareManifests')}
            to="/diff"
          />
        </div>
      </div>

      {HAS_ACTIVITY_FEED && (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
          {t('recentActivity.sectionTitle')}
        </h2>
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500">
            <PulseRegular className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-sm">{t('recentActivity.emptyTitle')}</p>
            <p className="text-xs mt-1">
              {t('recentActivity.emptyDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {activities.map((activity, idx) => (
              <ActivityRow key={idx} activity={activity} />
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function HealthStat({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: 'green' | 'yellow' | 'red' | 'neutral';
}) {
  const borderColor = {
    green: 'border-emerald-400 dark:border-emerald-600',
    yellow: 'border-amber-400 dark:border-amber-600',
    red: 'border-red-400 dark:border-red-600',
    neutral: 'border-slate-200 dark:border-slate-700',
  }[status];

  return (
    <div
      className={`rounded-lg border-l-4 ${borderColor} bg-slate-50 dark:bg-slate-800/50 px-4 py-3`}
    >
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
        {value}
      </p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:border-azure-400 dark:hover:border-azure-600 transition-colors"
    >
      <div className="flex items-center gap-3 mb-3">{icon}</div>
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 group-hover:text-azure-500 transition-colors">
        {label}
      </p>
    </Link>
  );
}

/**
 * UI H7: distinct from StatCard — a CTA card, not a metric.
 *
 * The compliance tile previously reused StatCard with value="Run check →",
 * which rendered an arrow gimmick at the same text-2xl font-bold weight as
 * the "Registered Manifests = 4" number next to it. Visually misaligned
 * (left = number+label, right = arrow), and semantically wrong (a CTA in
 * the metric slot). This component shares StatCard's visual frame so the
 * grid still feels symmetric, but the value slot becomes a button-styled
 * affordance with an explicit subtitle clarifying that this is an action.
 */
function ComplianceCtaCard({
  icon,
  label,
  subtitle,
  ctaLabel,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  ctaLabel: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:border-azure-400 dark:hover:border-azure-600 transition-colors"
    >
      <div className="flex items-center gap-3 mb-3">{icon}</div>
      <span className="inline-flex items-center gap-2 rounded-lg bg-azure-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors group-hover:bg-azure-600">
        {ctaLabel}
      </span>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-3 group-hover:text-azure-500 transition-colors">
        {label}
        <span className="block text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          {subtitle}
        </span>
      </p>
    </Link>
  );
}

function ActionButton({
  icon,
  label,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-azure-500 text-white hover:bg-azure-600 transition-colors shadow-sm"
    >
      {icon}
      {label}
    </Link>
  );
}

function relativeTime(timestamp: string): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return { value: 0, unit: 'second' };
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return { value: -diffMin, unit: 'minute' };
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return { value: -diffHr, unit: 'hour' };
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return { value: -diffDay, unit: 'day' };
  const diffMonth = Math.floor(diffDay / 30);
  return { value: -diffMonth, unit: 'month' };
}

const ACTIVITY_ICON: Record<ActivityItem['type'], React.ReactNode> = {
  registered: <DocumentRegular className="w-4 h-4 text-azure-500" />,
  deployed: <PlayRegular className="w-4 h-4 text-emerald-500" />,
  'deployed-audit': <ShieldCheckmarkRegular className="w-4 h-4 text-blue-500" />,
  'deployed-enforce': <PlayRegular className="w-4 h-4 text-emerald-500" />,
  reverted: <ArrowCounterclockwiseRegular className="w-4 h-4 text-amber-500" />,
};

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const { t } = useTranslation('home');
  const relativeTimeFormatter = useRelativeTimeFormatter();
  const relative = relativeTime(activity.timestamp);

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <div className="mt-0.5 flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0">
        {ACTIVITY_ICON[activity.type]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 dark:text-slate-100 truncate">
          {activity.message ??
            t('recentActivity.fallback', {
              type: t(`recentActivity.types.${activity.type}`),
              name: activity.name,
            })}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          {relativeTimeFormatter.format(relative.value, relative.unit)}
        </p>
      </div>
    </div>
  );
}
