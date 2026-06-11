// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter } from 'react-router-dom';
import { getI18n } from '../../locales';

vi.mock('../../hooks/useCliPresence', () => ({
  useCliPresence: () => ({ loading: false, installed: true, version: '1.3.9-preview11' }),
}));

vi.mock('../../components/CliRequiredModal', () => ({
  CliRequiredModal: () => null,
}));

import { ManifestsPage } from './index';

function renderManifests() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <ManifestsPage />
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe('ManifestsPage localization', () => {
  beforeEach(async () => {
    await getI18n().changeLanguage('en');
    sessionStorage.clear();
    Object.assign(window.cfs!, {
      manifests: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
      deploy: {
        run: vi.fn().mockResolvedValue({ message: 'ok', data: {} }),
      },
      revert: {
        apply: vi.fn().mockResolvedValue({ message: 'ok' }),
      },
    });
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
  });

  it('survives language switching with translated keys', async () => {
    const i18n = getI18n();
    const { rerender } = renderManifests();
    expect(screen.getByRole('heading', { name: 'Manifests' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <ManifestsPage />
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Manifestes' })).toBeInTheDocument();
  });

  it('shows a "Could not read" count for indeterminate/error resources on the card', async () => {
    (window.cfs!.manifests.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          Name: 'ws2019-ms-test',
          Source: 'oscfg',
          Resources: [
            { type: 'Microsoft.Windows/Registry', compliance: { status: 'Compliant' } },
            { type: 'Microsoft.Windows/Registry', compliance: { status: 'Compliant' } },
            { type: 'Microsoft.Windows/Registry', compliance: { status: 'NonCompliant' } },
            { type: 'Microsoft.Windows/Registry', compliance: { status: 'Could not read' } },
            { type: 'Microsoft.Windows/Registry', compliance: { status: 'Indeterminate' } },
            { type: 'Microsoft.Windows/Registry', compliance: { status: 'Error' } },
          ],
        },
      ],
    });

    renderManifests();

    expect(await screen.findByRole('heading', { name: 'ws2019-ms-test' })).toBeInTheDocument();
    // The amber bucket the list card previously dropped: "Could not read" +
    // Indeterminate + Error = 3 (compliant 2, issues 1, resources 6), so the
    // four stats add up to the resource total instead of silently losing 3.
    const cnrBox = screen.getByText('Could not read').closest('div');
    expect(cnrBox).not.toBeNull();
    expect(cnrBox!).toHaveTextContent('3');
  });

  it('does not count never-audited resources as "Could not read"', async () => {
    (window.cfs!.manifests.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          Name: 'unaudited-test',
          Source: 'oscfg',
          Resources: [
            { type: 'Microsoft.Windows/Registry' },
            { type: 'Microsoft.Windows/Registry' },
          ],
        },
      ],
    });

    renderManifests();

    expect(await screen.findByRole('heading', { name: 'unaudited-test' })).toBeInTheDocument();
    // No compliance data at all → the bucket is 0, not "everything is unreadable".
    const cnrBox = screen.getByText('Could not read').closest('div');
    expect(cnrBox!).toHaveTextContent('0');
  });
});
