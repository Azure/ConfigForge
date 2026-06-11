// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { getI18n } from '../locales';
import { SettingsPage } from './Settings';

describe('SettingsPage localization', () => {
  function renderSettings() {
    return render(
      <FluentProvider theme={webLightTheme}>
        <SettingsPage />
      </FluentProvider>,
    );
  }

  beforeEach(async () => {
    await getI18n().changeLanguage('en');
    window.localStorage.clear();
    Object.assign(window.cfs!, {
      health: {
        check: vi.fn().mockResolvedValue({
          installed: true,
          version: '1.3.9-preview11',
          isAdmin: true,
          serverType: 'Azure Local',
          osVersion: 'Windows Server 2025',
        }),
        recheck: vi.fn(),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ historyRetention: 20 }),
        set: vi.fn(),
      },
    });
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
  });

  it('updates the language picker label when the active language changes', async () => {
    const i18n = getI18n();
    const { rerender } = renderSettings();
    expect(screen.getByRole('heading', { name: 'Language' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <SettingsPage />
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Langue' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Language' })).not.toBeInTheDocument();
  });
});
