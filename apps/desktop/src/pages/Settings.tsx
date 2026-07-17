// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect, useState } from 'react';
import {
  SettingsRegular,
  ArrowSyncRegular,
  CheckmarkCircleRegular,
  DismissCircleRegular,
  DesktopRegular,
  HardDriveRegular,
  ShieldKeyholeRegular,
  WrenchRegular,
} from "@fluentui/react-icons";
import { Button, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { cfs, safeCfs } from '../lib/cfs';
import { ExternalLink } from '../components/ExternalLink';
import { OSCONFIG_INSTALL_URL } from '../components/CliRequiredModal';
import { useThemePreference, type ThemePreference } from '../lib/platform';
import { useLocalePreference, type LocalePreference } from '../lib/locale';
import { HAS_DEPLOY, HAS_ELEVATION } from '../lib/flavor';
import { useTranslation } from 'react-i18next';

interface HealthData {
  installed: boolean;
  version: string;
  isAdmin: boolean;
  serverType: string;
  osVersion: string;
}

/* Drift control commented out for V1 — re-enable when ready
interface DriftData {
  IsEnabled: boolean;
  RefreshPeriod: number | string | Record<string, unknown>;
}
*/

export function SettingsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [elevating, setElevating] = useState(false);
  // v0.2.0, Recheck button state for the OSConfig CLI panel.
  // `rechecking` shows a spinner; the "Reset first-run experience"
  // button writes to localStorage directly so we don't need a
  // separate state flag.
  const [rechecking, setRechecking] = useState(false);
  const { t } = useTranslation(['settings', 'common', 'dialogs']);

  const fetchData = async () => {
    setLoading(true);
    const healthApi = HAS_DEPLOY ? safeCfs('health') : undefined;
    if (!healthApi) {
      setHealth(null);
      setLoading(false);
      return;
    }
    try {
      const data = await healthApi.check();
      setHealth(data as unknown as HealthData);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  /**
   * v0.2.0 - bring-your-own-CLI: explicit user-driven recheck so the
   * Settings page mirrors the modal recheck affordance. Calls the
   * cfs.health.recheck IPC (Phase B) which clears the in-process
   * 60s cache before reprobing.
   */
  const handleRecheck = async () => {
    setRechecking(true);
    setMessage(null);
    const healthApi = HAS_DEPLOY ? safeCfs('health') : undefined;
    if (!healthApi) {
      setRechecking(false);
      return;
    }
    try {
      const data = await healthApi.recheck();
      setHealth(data as unknown as HealthData);
      if (data.installed) {
        setMessage({ text: t('messages.osconfigDetected', { version: data.version }), ok: true });
      } else {
        setMessage({
          text: t('messages.osconfigStillMissing'),
          ok: false,
        });
      }
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : t('messages.recheckFailed'),
        ok: false,
      });
    } finally {
      setRechecking(false);
    }
  };

  const handleResetWelcome = () => {
    try {
      window.localStorage.removeItem('cfs.welcome.dismissedAt');
      setMessage({
        text: t('messages.welcomeReset'),
        ok: true,
      });
    } catch {
      setMessage({ text: t('messages.welcomeResetFailed'), ok: false });
    }
  };

  /**
   * v0.1.3 → v0.1.4 — relaunch the app with admin / root privileges.
   *
   * v0.1.4: the IPC handler now waits for the UAC / polkit dialog to
   * be answered before resolving. On Accept → status 'launching' and
   * the main process schedules its own quit. On Cancel → status
   * 'unsupported' and the unprivileged window stays alive (the user
   * can click again to retry without relaunching the app). v0.1.3
   * had two bugs: PowerShell `-NonInteractive` silently suppressed
   * UAC, and the 2s unconditional quit closed the window even on
   * cancel.
   */
  const handleElevate = async () => {
    setMessage(null);
    setElevating(true);
    try {
      const result = await cfs.system.elevate();
      switch (result.status) {
        case 'launching':
          setMessage({
            text: result.message ?? t('messages.elevationLaunching'),
            ok: true,
          });
          // Don't reset elevating — main process is about to quit us.
          return;
        case 'already-elevated':
          setMessage({ text: result.message ?? t('messages.alreadyElevated'), ok: true });
          fetchData();
          break;
        case 'missing-prerequisite':
        case 'unsupported':
          setMessage({ text: result.message ?? t('messages.elevationUnavailable'), ok: false });
          break;
      }
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : t('messages.elevationFailed'),
        ok: false,
      });
    } finally {
      setElevating(false);
    }
  };

  /* Drift control disabled for V1
  const toggleDrift = async (action: "enable" | "disable") => {
    setDriftAction(action);
    setMessage(null);
    try {
      const res = await fetch("/api/drift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setMessage({ text: `Drift control ${action}d`, ok: true });
      fetchData();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed", ok: false });
    } finally {
      setDriftAction(null);
    }
  };

  const updateRefreshPeriod = async () => {
    setMessage(null);
    try {
      const res = await fetch("/api/drift", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshPeriod }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setMessage({ text: `Refresh period set to ${refreshPeriod} minutes`, ok: true });
      fetchData();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed", ok: false });
    }
  };

  const formatRP = (rp: DriftData["RefreshPeriod"]): string => {
    if (typeof rp === "number") return `${rp} min`;
    if (typeof rp === "string") return rp;
    if (typeof rp === "object" && rp !== null) {
      const m = (rp as Record<string, number>).TotalMinutes ?? (rp as Record<string, number>).Minutes;
      if (typeof m === "number") return `${m} min`;
    }
    return String(rp);
  };
  */

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('page.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {HAS_DEPLOY ? t('page.description') : t('page.descriptionAuthor')}
          </p>
        </div>
        {HAS_DEPLOY && (
          <Button
            appearance="secondary"
            onClick={fetchData}
            disabled={loading}
            icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
          >
            {t('common:buttons.refresh')}
          </Button>
        )}
      </div>

      {message && (
        <MessageBar intent={message.ok ? 'success' : 'error'}>
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}

      {/* v0.3.54 (#localization): language preference. Same pattern as ThemeSection. */}
      <LanguageSection />

      {/* v0.3.0 (#9): theme toggle. The renderer's machinery is in
          lib/platform.ts (useThemePreference + applyThemeClass);
          this is just the UI affordance the audit asked for. */}
      <ThemeSection />

      {/* v0.3.1 (#23): user-configurable history retention */}
      <HistoryRetentionSection />

      {/* System Health */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <DesktopRegular className="h-5 w-5 text-blue-500" /> {HAS_DEPLOY ? t('systemHealth.sectionTitle') : t('systemHealth.informationTitle')}
          </h2>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {HAS_DEPLOY && (
          <SettingRow label={t('systemHealth.labels.osconfigModule')} value={health?.installed ? health.version : t('systemHealth.values.notInstalled')} icon={health?.installed ? <CheckmarkCircleRegular className="h-4 w-4 text-emerald-500" /> : <DismissCircleRegular className="h-4 w-4 text-red-500" />} />
          )}
          {/* v0.3.0 (#10): show resolved binary path under the OSConfig
              Module row when installed. The resolution order (env →
              PATH → bundled → installed → MSIX) is opaque to the
              user without this; we found it in BINARYSOURCE on the
              HealthStatus, so just surface it. */}
          {HAS_DEPLOY && health?.installed && health.binaryPath && (
            <div className="px-6 pb-4 -mt-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('systemHealth.resolvedAt')} <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">{health.binaryPath}</code>
                {health.binarySource ? ` (${health.binarySource})` : ''}
              </p>
            </div>
          )}
          {/*
           * v0.2.0, bring-your-own-CLI controls. Shows when OSConfig
           * is missing: explanation + Install link (opens upstream
           * docs in the default browser) + Recheck button (clears the
           * 60s health-cache and re-probes). Identical wording to
           * the CliRequiredModal so the user sees the same affordance
           * whether they reach it from Deploy, Audit, Revert, the
           * footer pill, or Settings.
           */}
          {HAS_DEPLOY && health && !health.installed && (
            <div className="space-y-3 px-6 py-4">
              <div className="flex items-start gap-3">
                <WrenchRegular className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t('systemHealth.install.title')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t('systemHealth.install.description')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ExternalLink
                  href={OSCONFIG_INSTALL_URL}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  aria-label={t('dialogs:cli-required.install-link-aria')}
                >
                  {t('dialogs:cli-required.install-link-label')}
                </ExternalLink>
                <Button
                  appearance="secondary"
                  onClick={handleRecheck}
                  disabled={rechecking}
                  icon={rechecking ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                >
                  {rechecking ? t('common:status.rechecking') : t('systemHealth.install.recheckButton')}
                </Button>
              </div>
            </div>
          )}
          {HAS_ELEVATION && (
          <SettingRow label={t('systemHealth.labels.administratorPrivileges')} value={health?.isAdmin ? t('systemHealth.values.runningAsAdmin') : t('systemHealth.values.notElevated')} icon={health?.isAdmin ? <CheckmarkCircleRegular className="h-4 w-4 text-emerald-500" /> : <DismissCircleRegular className="h-4 w-4 text-amber-500" />} />
          )}
          {HAS_ELEVATION && health && !health.isAdmin && (
            // v0.1.3: in-app elevation. Triggers a UAC prompt on
            // Windows or polkit auth on Linux; macOS surfaces an
            // "unsupported" message. We deliberately keep the
            // explanatory copy in the UI (not buried in a tooltip)
            // because dismissing the OS prompt closes this window.
            <div className="space-y-3 px-6 py-4">
              <div className="flex items-start gap-3">
                <ShieldKeyholeRegular className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t('systemHealth.elevation.title')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t('systemHealth.elevation.description')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  appearance="primary"
                  onClick={handleElevate}
                  disabled={elevating}
                  icon={elevating ? <Spinner size="tiny" /> : <ShieldKeyholeRegular />}
                >
                  {elevating ? t('common:status.starting') : t('systemHealth.elevation.restartAsAdministrator')}
                </Button>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent)
                    ? t('systemHealth.elevation.promptPolkit')
                    : t('systemHealth.elevation.promptUac')}
                </p>
              </div>
            </div>
          )}
          <SettingRow label={t('systemHealth.labels.serverType')} value={health?.serverType || t('systemHealth.values.unknown')} icon={<HardDriveRegular className="h-4 w-4 text-slate-400" />} />
          <SettingRow label={t('systemHealth.labels.osVersion')} value={health?.osVersion || t('systemHealth.values.unknown')} icon={<DesktopRegular className="h-4 w-4 text-slate-400" />} />
        </div>
      </div>

      {/* Drift Control — disabled for V1, uncomment to re-enable
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <Shield className="h-5 w-5 text-blue-500" /> Drift Control
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Drift control sustains desired configuration state by periodically re-applying settings.
          </p>
        </div>
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900 dark:text-white">Status</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {drift ? (drift.IsEnabled ? `Enabled, refreshes every ${formatRP(drift.RefreshPeriod)}` : "Disabled") : "Unknown"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => toggleDrift("enable")}
                disabled={driftAction !== null}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {driftAction === "enable" ? <Spinner size="tiny" /> : "Enable"}
              </button>
              <button
                onClick={() => toggleDrift("disable")}
                disabled={driftAction !== null}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                {driftAction === "disable" ? <Spinner size="tiny" /> : "Disable"}
              </button>
            </div>
          </div>
          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-2 font-medium text-slate-900 dark:text-white">Refresh Period</p>
            <div className="flex items-center gap-3">
              <input type="number" min={30} value={refreshPeriod} onChange={(e) => setRefreshPeriod(Number(e.target.value))} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              <span className="text-sm text-slate-500 dark:text-slate-400">minutes (minimum 30)</span>
              <button onClick={updateRefreshPeriod} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
            </div>
          </div>
        </div>
      </div>
      */}

      {/* About */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          <SettingsRegular className="h-5 w-5 text-blue-500" /> {t('about.sectionTitle')}
        </h2>
        <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-400">
          <p>{t('about.sectionDescription')}</p>
          {HAS_DEPLOY && (
          <p>
            {health?.installed && health.version
              ? t('about.backendCliInstalled', { version: health.version })
              : t('about.backendCliMissing')}
          </p>
          )}
          {!HAS_DEPLOY && <p>{t('about.authorFlavor')}</p>}
          <p>
            {t('about.docsLabel')}{' '}
            <ExternalLink href="https://learn.microsoft.com/en-us/azure/osconfig/concept-osc-vnext-redux" className="text-blue-600 hover:underline dark:text-blue-400">
              {t('about.docsLinkLabel')}
            </ExternalLink>
          </p>
        </div>
        {/*
         * v0.2.0, small "Reset first-run experience" action so a
         * tester / docs author / curious user can see the Welcome
         * dialog again without wiping their userData dir. Clears
         * only the welcome key; manifests/history/rationale untouched.
         */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button appearance="subtle" onClick={handleResetWelcome}>
            {t('about.resetWelcomeButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 py-3">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
        {icon} {value}
      </span>
    </div>
  );
}

function LanguageSection() {
  const [pref, setPref] = useLocalePreference();
  const { t } = useTranslation('settings');
  const choices: { value: LocalePreference; label: string }[] = [
    { value: 'system', label: t('language.options.system') },
    { value: 'en', label: t('language.options.en') },
    { value: 'fr', label: t('language.options.fr') },
    { value: 'de', label: t('language.options.de') },
    { value: 'es', label: t('language.options.es') },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          {t('language.sectionTitle')}
        </h2>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400 sm:max-w-md">
          {t('language.sectionDescription')}
        </p>
        <div
          role="radiogroup"
          aria-label={t('language.sectionTitle')}
          className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800"
        >
          {choices.map((c) => (
            <button
              key={c.value}
              role="radio"
              aria-checked={pref === c.value}
              onClick={() => setPref(c.value)}
              className={
                pref === c.value
                  ? 'rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeSection() {
  const [pref, setPref] = useThemePreference();
  const { t } = useTranslation('settings');
  const choices: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('theme.options.light') },
    { value: 'system', label: t('theme.options.system') },
    { value: 'dark', label: t('theme.options.dark') },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          {t('theme.sectionTitle')}
        </h2>
      </div>
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white">{t('theme.label')}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t('theme.sectionDescription')}
          </p>
        </div>
        <div role="radiogroup" aria-label={t('theme.label')} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
          {choices.map((c) => (
            <button
              key={c.value}
              role="radio"
              aria-checked={pref === c.value}
              onClick={() => setPref(c.value)}
              className={
                pref === c.value
                  ? 'rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-md px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryRetentionSection() {
  const [retention, setRetention] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const { t } = useTranslation(['settings', 'common']);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await cfs.settings.get();
        if (cancelled) return;
        setRetention(s.historyRetention);
        setDraft(String(s.historyRetention));
      } catch {
        if (!cancelled) {
          setRetention(20);
          setDraft('20');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 5 || n > 1000) {
      setSavedMsg({ text: t('history.validationRange'), ok: false });
      return;
    }
    setSaving(true);
    setSavedMsg(null);
    try {
      const next = await cfs.settings.set({ historyRetention: n });
      setRetention(next.historyRetention);
      setDraft(String(next.historyRetention));
      setSavedMsg({ text: t('common:status.saved'), ok: true });
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err) {
      setSavedMsg({ text: err instanceof Error ? err.message : t('history.saveFailed'), ok: false });
    } finally {
      setSaving(false);
    }
  };

  const dirty = retention !== null && String(retention) !== draft.trim();

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          {t('history.sectionTitle')}
        </h2>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-4">
        <div className="min-w-0 flex-1">
          <label className="text-sm font-medium text-slate-900 dark:text-white" htmlFor="cfs-history-retention">
            {t('history.retentionLabel')}
          </label>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t('history.retentionDescriptionBeforeEnv')}{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">CONFIGFORGE_HISTORY_MAX_RETENTION</code>{' '}
            {t('history.retentionDescriptionAfterEnv')}
          </p>
          {savedMsg && (
            <p className={`mt-1 text-xs ${savedMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{savedMsg.text}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            id="cfs-history-retention"
            type="number"
            min={5}
            max={1000}
            step={1}
            value={draft}
            disabled={retention === null}
            onChange={(e) => setDraft(e.target.value)}
            className="w-24 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <Button appearance="primary" size="small" disabled={!dirty || saving} onClick={handleSave}>
            {saving ? t('common:status.saving') : t('common:buttons.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
