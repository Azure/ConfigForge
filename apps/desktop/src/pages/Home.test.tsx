// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter } from 'react-router-dom';
import { getI18n } from '../locales';

vi.mock('../hooks/useCliPresence', () => ({
  useCliPresence: () => ({ loading: false, installed: true, version: '1.3.9-preview11' }),
}));

import { HomePage } from './Home';

function renderHome() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe('HomePage localization', () => {
  beforeEach(async () => {
    await getI18n().changeLanguage('en');
    window.localStorage.clear();
    Object.assign(window.cfs!, {
      health: {
        check: vi.fn().mockResolvedValue({
          installed: true,
          version: 'oscfg 1.3.9-preview11',
          isAdmin: true,
          serverType: 'Azure Local',
          osVersion: 'Microsoft Windows NT 10.0.26100',
        }),
      },
      manifests: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      activity: {
        recent: vi.fn().mockResolvedValue({ data: [] }),
      },
      deployRecovery: {
        listInterrupted: vi.fn().mockResolvedValue({ data: [] }),
        dismiss: vi.fn().mockResolvedValue({ ok: true }),
      },
    });
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
  });

  it('survives language switching with translated keys', async () => {
    const i18n = getI18n();
    const { rerender } = renderHome();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument();
  });

  it('formats interrupted deploy timestamps with the active locale', async () => {
    const i18n = getI18n();
    Object.assign(window.cfs!, {
      deployRecovery: {
        listInterrupted: vi.fn().mockResolvedValue({
          data: [{ namespace: 'demo', displayName: 'Demo manifest', startedAt: '2026-05-28T12:00:00Z' }],
        }),
        dismiss: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    const { rerender } = renderHome();
    await waitFor(() => expect(screen.getByText(/May 28, 2026/)).toBeInTheDocument());

    await i18n.changeLanguage('de');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByText(/28\. Mai 2026/)).toBeInTheDocument();
  });
});
