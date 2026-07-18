// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogBody,
  Button,
} from '@fluentui/react-components';
import {
  EditRegular,
  ServerRegular,
} from '@fluentui/react-icons';
import { CliRequiredModal } from './CliRequiredModal';
import { useCliPresence } from '../hooks/useCliPresence';
import { hasCfsNamespace } from '../lib/cfs';

/**
 * localStorage key for first-run dismissal. Stores an ISO timestamp.
 * Cleared on a fresh install (per-app-userData-dir scope), so a
 * reinstall intentionally re-shows the welcome.
 */
const WELCOME_DISMISSED_KEY = 'cfs.welcome.dismissedAt';

export function hasDismissedWelcome(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage.getItem(WELCOME_DISMISSED_KEY);
  } catch {
    // localStorage access can throw under jsdom + sandbox configs;
    // default to "not dismissed" so the test renders the dialog.
    return false;
  }
}

export function markWelcomeDismissed(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WELCOME_DISMISSED_KEY, new Date().toISOString());
    }
  } catch {
    // localStorage write can fail (private mode, sandboxed, quota);
    // tolerable, worst case is the user sees the welcome twice.
  }
}

/**
 * First-run Welcome dialog.
 *
 * Shown once per browser-profile-equivalent (electron userData dir)
 * when the user first opens ConfigForge on v0.2.0+. Explains
 * the two operating modes the bring-your-own-CLI release introduces:
 *
 *   - "Author baselines anywhere", works on any OS, no CLI required.
 *     CTA dismisses + lands them on /library so the first impression
 *     is content, not a "CLI not installed" warning.
 *
 *   - "Author + deploy on this machine", Win/Linux only, needs
 *     OSConfig installed locally. CTA opens the same CliRequiredModal
 *     the page-level Deploy actions open in C4, so the install flow
 *     is consistent everywhere.
 *
 * Persistence: localStorage key `cfs.welcome.dismissedAt`. We do NOT
 * use a userData JSON file because (a) it'd require new IPC plumbing
 * and (b) localStorage already lives inside userData, so reinstalls
 * correctly re-show the welcome.
 */
export interface WelcomeDialogProps {
  /**
   * Override the dismissed-state lookup. Tests use this to force the
   * dialog open even when localStorage says it was dismissed.
   */
  forceShow?: boolean;
}

export function WelcomeDialog({ forceShow }: WelcomeDialogProps = {}) {
  /*
   * Lazy state initializer prevents the "welcome blip": with a plain
   * useState(false) + useEffect flip, React paints the underlying
   * Dashboard for one frame before the dialog appears. Reading the
   * dismissal state synchronously on the very first render means the
   * Dialog is open before the dashboard ever paints.
   */
  const [open, setOpen] = useState<boolean>(() => {
    if (forceShow) return true;
    return !hasDismissedWelcome();
  });
  const [cliModalOpen, setCliModalOpen] = useState(false);
  const presence = useCliPresence();
  const navigate = useNavigate();
  const { t } = useTranslation(['welcome', 'common']);

  /*
   * Respond to forceShow flipping mid-mount (used by Settings'
   * "Reset first-run experience" + tests). The synchronous initializer
   * above handles the initial paint; this effect handles later changes.
   */
  useEffect(() => {
    if (forceShow) {
      setOpen(true);
    }
  }, [forceShow]);

  const dismiss = useCallback(() => {
    markWelcomeDismissed();
    setOpen(false);
  }, []);

  const handleEditorMode = useCallback(() => {
    dismiss();
    navigate('/library');
  }, [dismiss, navigate]);

  const handleDeployMode = useCallback(() => {
    // Don't dismiss yet, let the user see the install modal first.
    // The user can still skip OSConfig install via "Continue in
    // editor mode" inside the install modal, at which point the
    // welcome is implicitly dismissed too.
    if (presence.installed) {
      // CLI already there, no install modal needed; just close
      // the welcome and stay on the dashboard so they can see the
      // full surface area.
      dismiss();
    } else {
      setCliModalOpen(true);
    }
  }, [dismiss, presence.installed]);

  const handleCliModalDismiss = useCallback(() => {
    setCliModalOpen(false);
    dismiss();
  }, [dismiss]);

  if (!open) {
    return cliModalOpen ? (
      <CliRequiredModal
        open
        feature={t('common:features.deploy')}
        onDismiss={handleCliModalDismiss}
        presence={presence}
      />
    ) : null;
  }

  return (
    <>
      <Dialog open={!cliModalOpen} modalType="alert">
        <DialogSurface style={{ maxWidth: '640px' }}>
          <DialogBody>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogContent>
              <p>{t('intro')}</p>

              {/*
               * Tailwind grid with the same visual rhythm as the rest of
               * the renderer. focus-visible:ring-inset is the fix for the
               * "first card left edge clipped" bug: the ring renders as
               * an inset box-shadow inside the border-box, so it cannot
               * be sliced by DialogSurface's overflow:hidden.
               */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleEditorMode}
                  className="group flex w-full cursor-pointer flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/50"
                >
                  <EditRegular fontSize={20} />
                  <strong>{t('cards.author.title')}</strong>
                  <span className="text-sm opacity-80">
                    {t('cards.author.body')}
                  </span>
                </button>

                {/*
                 * v0.2.21: the deploy card is hidden on flavors that
                 * intentionally omit the `health` preload namespace
                 * (mac-author, editor-only builds). Showing it on
                 * those flavors would invite the user to install
                 * OSConfig on a platform where the deploy IPC path
                 * doesn't exist — they'd hit the CliRequiredModal
                 * forever with no path forward.
                 */}
                {hasCfsNamespace('health') && (
                  <button
                    type="button"
                    onClick={handleDeployMode}
                    className="group flex w-full cursor-pointer flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/50"
                  >
                    <ServerRegular fontSize={20} />
                    <strong>{t('cards.deploy.title')}</strong>
                    <span className="text-sm opacity-80">
                      {t('cards.deploy.body')}
                    </span>
                  </button>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="subtle" onClick={dismiss}>
                {t('actions.skip')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <CliRequiredModal
        open={cliModalOpen}
        feature={t('common:features.deploy')}
        onDismiss={handleCliModalDismiss}
        presence={presence}
      />
    </>
  );
}
