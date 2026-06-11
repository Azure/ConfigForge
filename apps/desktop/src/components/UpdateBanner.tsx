// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  MessageBarActions,
  Button,
  Spinner,
  ProgressBar,
} from '@fluentui/react-components';
import { ArrowDownloadRegular, ArrowSyncRegular, DismissRegular } from '@fluentui/react-icons';
import { useNumberFormatter } from '../lib/format';

/**
 * Phase 11 — Auto-update banner.
 *
 * Sits between the (optional) Windows TitleBar and the main app
 * shell. Hidden by default. When the autoUpdater state machine
 * progresses from `idle` → `available` → `downloading` →
 * `downloaded`, the banner pops in with a contextual call to
 * action.
 *
 * States we render (others render null):
 *   - 'available'    info MessageBar with Download button
 *   - 'downloading'  info MessageBar with progress bar
 *   - 'downloaded'   success MessageBar with Restart button
 *   - 'error'        error MessageBar with Retry button
 *
 * Hidden states: 'idle' / 'checking' / 'not-available' /
 * 'unsupported'. The user doesn't need to know that we checked
 * and there's nothing new — that's a notification antipattern.
 *
 * The dismiss (×) button toggles a session-local `dismissed`
 * flag so the banner doesn't keep popping back. Refreshing the
 * window resets the flag (not persisted intentionally — if
 * there's a security update you should see it again on next
 * launch).
 */

// Mirrors apps/desktop/electron/auto-updater.ts UpdateStatus.
// Re-declared here rather than imported because the renderer
// bundle doesn't include preload types; preload re-exports the
// type but the renderer Vite build doesn't resolve `electron-*`
// packages.
type UpdateInfo = { version: string; releaseDate?: string };
type ProgressInfo = { percent: number; transferred: number; total: number; bytesPerSecond: number };
type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: string }
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'not-available'; info: UpdateInfo }
  | { state: 'downloading'; progress: ProgressInfo }
  | { state: 'downloaded'; info: UpdateInfo }
  | { state: 'error'; message: string };

interface CfsUpdateChannel {
  getStatus(): Promise<UpdateStatus>;
  onStatus(cb: (s: UpdateStatus) => void): () => void;
  check(): Promise<UpdateStatus>;
  download(): Promise<{ ok: boolean; error?: string }>;
  quitAndInstall(): Promise<{ ok: true }>;
}

function getUpdateChannel(): CfsUpdateChannel | null {
  const cfs = (window as { cfs?: { update?: CfsUpdateChannel } }).cfs;
  return cfs?.update ?? null;
}

export function UpdateBanner() {
  const { t } = useTranslation('common');
  const percentFormatter = useNumberFormatter({ maximumFractionDigits: 0 });
  const speedFormatter = useNumberFormatter({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const channel = getUpdateChannel();
    if (!channel) return;

    let cancelled = false;

    // Snapshot the current state in case events fired before mount.
    channel.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });

    const unsubscribe = channel.onStatus((s) => {
      if (cancelled) return;
      setStatus(s);
      // Re-show the banner when the state advances (e.g. from
      // 'available' → 'downloaded'); the user explicitly wanted
      // to see the next step.
      setDismissed(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (dismissed) return null;

  const channel = getUpdateChannel();
  if (!channel) return null;

  // States we don't surface
  if (status.state === 'idle') return null;
  if (status.state === 'checking') return null;
  if (status.state === 'not-available') return null;
  if (status.state === 'unsupported') return null;

  const handleDownload = async () => {
    setBusy(true);
    try {
      await channel.download();
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    setBusy(true);
    try {
      await channel.quitAndInstall();
    } finally {
      // Process is about to quit — no need to clear busy
    }
  };

  const handleRetry = async () => {
    setBusy(true);
    try {
      await channel.check();
    } finally {
      setBusy(false);
    }
  };

  if (status.state === 'available') {
    return (
      <MessageBar intent="info" layout="auto">
        <MessageBarBody>
          <MessageBarTitle>{t('update.available-title')}</MessageBarTitle>
          {t('update.available-body', { version: status.info.version })}
        </MessageBarBody>
        <MessageBarActions
          containerAction={
            <Button
              appearance="transparent"
              icon={<DismissRegular />}
              aria-label={t('a11y.dismiss')}
              onClick={() => setDismissed(true)}
            />
          }
        >
          <Button
            appearance="primary"
            icon={busy ? <Spinner size="tiny" /> : <ArrowDownloadRegular />}
            disabled={busy}
            onClick={handleDownload}
          >
            {busy ? t('status.starting') : t('buttons.download')}
          </Button>
        </MessageBarActions>
      </MessageBar>
    );
  }

  if (status.state === 'downloading') {
    const pct = Math.max(0, Math.min(1, status.progress.percent / 100));
    return (
      <MessageBar intent="info" layout="auto">
        <MessageBarBody>
          <MessageBarTitle>{t('update.downloading-title')}</MessageBarTitle>
          <div style={{ width: 240, marginTop: 4 }}>
            <ProgressBar value={pct} />
          </div>
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            {percentFormatter.format(status.progress.percent)}% · {speedFormatter.format(status.progress.bytesPerSecond / 1024 / 1024)} MB/s
          </span>
        </MessageBarBody>
      </MessageBar>
    );
  }

  if (status.state === 'downloaded') {
    return (
      <MessageBar intent="success" layout="auto">
        <MessageBarBody>
          <MessageBarTitle>{t('update.ready-title')}</MessageBarTitle>
          {t('update.ready-body', { version: status.info.version })}
        </MessageBarBody>
        <MessageBarActions
          containerAction={
            <Button
              appearance="transparent"
              icon={<DismissRegular />}
              aria-label={t('a11y.dismiss')}
              onClick={() => setDismissed(true)}
            />
          }
        >
          <Button appearance="primary" disabled={busy} onClick={handleInstall}>
            {busy ? t('status.restarting') : t('buttons.restart-to-install')}
          </Button>
        </MessageBarActions>
      </MessageBar>
    );
  }

  if (status.state === 'error') {
    // Cap the body to a single visible line + ellipsis as a
    // backstop: even if `auto-updater.ts#sanitizeUpdateError` lets
    // something long through, the banner stays compact instead of
    // shoving the dashboard below the fold.
    return (
      <MessageBar intent="error" layout="auto">
        <MessageBarBody style={{ minWidth: 0 }}>
          <MessageBarTitle>{t('update.check-failed-title')}</MessageBarTitle>
          <span
            title={status.message}
            style={{
              display: 'inline-block',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'bottom',
            }}
          >
            {status.message}
          </span>
        </MessageBarBody>
        <MessageBarActions
          containerAction={
            <Button
              appearance="transparent"
              icon={<DismissRegular />}
              aria-label={t('a11y.dismiss')}
              onClick={() => setDismissed(true)}
            />
          }
        >
          <Button
            appearance="secondary"
            icon={busy ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
            disabled={busy}
            onClick={handleRetry}
          >
            {t('buttons.retry')}
          </Button>
        </MessageBarActions>
      </MessageBar>
    );
  }

  return null;
}
