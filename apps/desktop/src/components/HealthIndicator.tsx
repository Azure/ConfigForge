// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCliPresence } from '../hooks/useCliPresence';

/**
 * Footer health indicator.
 *
 * v0.2.0+ (bring-your-own-CLI): drives off `useCliPresence()`. Three
 * states:
 *   🟢 healthy:  OSConfig CLI v… (installed, no admin block)
 *   🟠 degraded: Editor mode, CLI not installed (or admin required)
 *   🔴 error:    Cannot reach IPC
 *   ⚪ loading:  Verifying…
 *
 * The amber "editor mode" pill is clickable: when `onInstallClick` is
 * provided it fires that handler so the host can open `<CliRequiredModal />`.
 * Without a handler the pill is non-interactive but still informative.
 */
export interface HealthIndicatorProps {
  /** Optional click handler for the amber CLI-missing state. */
  onInstallClick?: () => void;
}

export function HealthIndicator({ onInstallClick }: HealthIndicatorProps = {}) {
  const { installed, version, loading, error, health } = useCliPresence();
  const { t } = useTranslation('common');

  const adminBlocked = (health as { adminBlocked?: boolean } | null)?.adminBlocked === true;
  const adminMessage =
    (health as { adminMessage?: string } | null)?.adminMessage ?? t('health.admin-default-hint');
  // v0.3.0 (#5): CLI version mismatch surfaces as an amber state with
  // a distinct "wrong version" detail string. installed but mismatched
  // is more dangerous than not installed at all (because the deploy
  // pipeline will start and then fail mid-flight with cryptic errors),
  // so we override the green state when versionMismatch is true.
  const versionMismatch = (health as { versionMismatch?: boolean } | null)?.versionMismatch === true;
  const expectedVersion =
    (health as { expectedVersion?: string } | null)?.expectedVersion ?? '';

  // State derivation:
  let dotColor: string;
  let detail: string;
  let hint: string | null = null;
  let clickable = false;

  if (loading) {
    dotColor = 'bg-slate-400 animate-pulse';
    detail = t('status.verifying');
  } else if (error) {
    dotColor = 'bg-red-500';
    detail = t('health.cannot-reach-ipc');
  } else if (!installed) {
    dotColor = 'bg-amber-500';
    detail = t('health.editor-mode-cli-not-installed');
    hint = t('health.install-hint');
    clickable = Boolean(onInstallClick);
  } else if (adminBlocked) {
    dotColor = 'bg-amber-500';
    detail = t('health.admin-required', { version });
    hint = adminMessage;
  } else if (versionMismatch) {
    dotColor = 'bg-amber-500';
    detail = t('health.version-mismatch-detail', { version, expectedVersion });
    hint = t('health.version-mismatch-hint', { expectedVersion });
  } else {
    dotColor = 'bg-emerald-500';
    detail = version || t('health.cli-ready');
  }

  const handleClick = useCallback(() => {
    if (clickable) onInstallClick?.();
  }, [clickable, onInstallClick]);

  const baseClass = 'flex items-center gap-2';
  const interactiveClass = clickable
    ? `${baseClass} cursor-pointer hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded`
    : baseClass;

  // Render as a <button> only when clickable so accessibility tools
  // don't announce a static row as interactive.
  if (clickable) {
    return (
      <button
        type="button"
        className={interactiveClass}
        title={hint ?? undefined}
        onClick={handleClick}
        aria-label={t('a11y.cli-not-installed-install')}
      >
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} aria-hidden />
        <span>{detail}</span>
      </button>
    );
  }

  return (
    <div className={baseClass} title={hint ?? undefined}>
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} aria-hidden />
      <span>{detail}</span>
    </div>
  );
}
