// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogBody,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { ExternalLink } from './ExternalLink';
import type { CliPresence } from '../hooks/useCliPresence';

/**
 * Canonical upstream install URL for OSConfig. Centralized so C2,
 * the WelcomeDialog (C3), and the Settings panel (C5) all link to
 * the same place. If this changes, also update INSTALL.md (Phase E).
 */
export const OSCONFIG_INSTALL_URL = 'https://github.com/microsoft/osconfig/tree/main/docs/cli';

/**
 * The CLI-required dialog.
 *
 * v0.2.0+ separates "the editor works without OSConfig" from "you need
 * OSConfig to deploy/audit/apply on this device". When a user clicks
 * a CLI-gated action while the CLI is missing, callers open this
 * dialog instead of bubbling a raw spawn-failure toast.
 *
 * It also auto-dismisses if the user installs OSConfig and clicks
 * "I've already installed it, recheck", so the in-app flow is:
 *
 *   click Deploy -> dialog opens -> click Install (browser opens) ->
 *   install OSConfig in another window -> back to ConfigForge ->
 *   click Recheck -> dialog closes -> click Deploy again -> works.
 *
 * Without auto-dismiss the user would have to manually close the
 * dialog and re-click Deploy.
 *
 * Props:
 *   open:        whether the dialog is currently shown
 *   feature:     short label naming what triggered the gate
 *                (e.g. "Deploy", "Audit on this device", "Revert")
 *   onDismiss:   called when the user dismisses without resolving
 *   presence:    the live useCliPresence() result. The dialog calls
 *                presence.recheck() on the recheck CTA and auto-
 *                dismisses if the recheck reports installed:true.
 */
export interface CliRequiredModalProps {
  open: boolean;
  feature: string;
  onDismiss: () => void;
  presence: CliPresence;
}

export function CliRequiredModal({
  open,
  feature,
  onDismiss,
  presence,
}: CliRequiredModalProps) {
  const { t } = useTranslation(['dialogs', 'common']);
  const [rechecking, setRechecking] = useState(false);
  const [rechecked, setRechecked] = useState(false);
  const [recheckMissing, setRecheckMissing] = useState(false);

  // Reset the "still missing" feedback when the dialog reopens.
  // (We don't auto-reset on every render so the user can see the
  // banner after a failed recheck.)
  const handleClose = () => {
    setRechecking(false);
    setRechecked(false);
    setRecheckMissing(false);
    onDismiss();
  };

  const handleRecheck = async () => {
    setRechecking(true);
    setRecheckMissing(false);
    try {
      const next = await presence.recheck();
      setRechecked(true);
      if (next.installed) {
        // User installed it between the gate firing and clicking
        // recheck, close the dialog so they can immediately retry
        // the action that opened it.
        handleClose();
      } else {
        setRecheckMissing(true);
      }
    } finally {
      setRechecking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(_e, data) => {
        if (!data.open) handleClose();
      }}
      modalType="alert"
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('cli-required.title')}</DialogTitle>
          <DialogContent>
            <p>
              <Trans
                i18nKey="cli-required.body"
                ns="dialogs"
                values={{ feature }}
                components={{ feature: <strong /> }}
              />
            </p>
            <p className="mt-3">
              <ExternalLink
                href={OSCONFIG_INSTALL_URL}
                className="text-blue-600 hover:underline"
                aria-label={t('cli-required.install-link-aria')}
              >
                {t('cli-required.install-link-label')}
              </ExternalLink>
              {t('cli-required.install-link-suffix')}
            </p>
            {recheckMissing && rechecked && (
              <MessageBar intent="warning" className="mt-3">
                <MessageBarBody>
                  {t('cli-required.still-missing')}
                </MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={handleClose}
              disabled={rechecking}
            >
              {t('cli-required.continue-editor')}
            </Button>
            <Button
              appearance="primary"
              onClick={handleRecheck}
              disabled={rechecking}
              icon={rechecking ? <Spinner size="tiny" /> : undefined}
            >
              {rechecking ? t('common:status.rechecking') : t('cli-required.installed-recheck')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
