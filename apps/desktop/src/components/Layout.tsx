// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './Sidebar';
import { HealthIndicator } from './HealthIndicator';
import { UpdateBanner } from './UpdateBanner';
import { CliRequiredModal } from './CliRequiredModal';
import { useCliPresence } from '../hooks/useCliPresence';
import { HAS_HEALTH } from '../lib/flavor';
// v0.1.11 fix — wire the footer version label to the actual installed
// version. Previously a hardcoded `v0.1.0` literal that lied through
// every release since (v0.1.1 → v0.1.10). resolveJsonModule is already
// on in tsconfig so this is a no-cost, no-config import.
import pkg from '../../package.json';

/**
 * Application chrome — sidebar + scrollable main + footer.
 *
 * v0.1.0 hot-fix: dropped the Phase 6 `<TitleBar>` from the layout
 * because the frameless Win11 titlebar approach had reliability
 * problems with resize/minimize/restore. We now use the native OS
 * frame on every platform — Win11 still gets the Mica backdrop
 * underneath, just with the OS-drawn title bar on top instead of
 * a custom one. See main.ts for the full rationale.
 *
 * The `<TitleBar>` component is still imported and built as a
 * no-op stub elsewhere so re-enabling the custom approach in
 * Phase 12+ is a one-line change here + restoring its body.
 *
 * v0.2.0 (bring-your-own-CLI): the footer HealthIndicator's amber
 * "Editor mode — CLI not installed" pill is now clickable and opens
 * the shared CliRequiredModal so the user gets a consistent install
 * affordance whether they reached it via Deploy, Audit, or the
 * footer indicator.
 */
export function Layout() {
  const { t } = useTranslation('common');

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <UpdateBanner />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex flex-col flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6 lg:p-8">
            <Outlet />
          </main>

          <footer
            className={`flex items-center border-t border-slate-200 dark:border-slate-800 px-6 py-3 text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 ${
              HAS_HEALTH ? 'justify-between' : 'justify-end'
            }`}
          >
            {/*
             * Full flavor always shows the HealthIndicator on the right
             * (oscfg version + admin status), so the footer is laid
             * out justify-between with the version label on the left.
             *
             * The mac-author sibling branch has a `HAS_HEALTH ?
             * 'justify-between' : 'justify-end'` variant (hidden
             * behind a flavor flag) because it doesn't ship the
             * HealthIndicator. Keeping that flavor logic on the
             * full flavor branch would require adding
             * `apps/desktop/src/lib/flavor.ts` (mac-only), so the
             * full flavor sticks with the simpler unconditional
             * layout — the alignment difference is invisible here
             * because the indicator always renders.
             */}
            <span>{t('footer.app-version', { version: pkg.version })}</span>
            {HAS_HEALTH && <FooterHealth />}
          </footer>
        </div>
      </div>
    </div>
  );
}

function FooterHealth() {
  const [cliGateOpen, setCliGateOpen] = useState(false);
  const presence = useCliPresence();

  return (
    <>
      <CliRequiredModal
        open={cliGateOpen}
        feature="OSConfig CLI"
        onDismiss={() => setCliGateOpen(false)}
        presence={presence}
      />
      <HealthIndicator onInstallClick={() => setCliGateOpen(true)} />
    </>
  );
}
