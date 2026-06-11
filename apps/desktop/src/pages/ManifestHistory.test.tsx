// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getI18n } from '../locales';

vi.mock('../components/manifest-editor', () => ({
  ManifestEditor: () => <div data-testid="mock-manifest-editor" />,
}));

vi.mock('../components/diff-viewer', () => ({
  DiffViewer: () => <div data-testid="mock-diff-viewer" />,
}));

import { ManifestHistoryPage } from './ManifestHistory';

function renderHistory() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/manifests/demo/history']}>
        <Routes>
          <Route path="/manifests/:id/history" element={<ManifestHistoryPage />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe('ManifestHistoryPage localization', () => {
  beforeEach(async () => {
    await getI18n().changeLanguage('en');
    Object.assign(window.cfs!, {
      history: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
      manifests: {
        status: vi.fn().mockResolvedValue({ data: 'resources: []' }),
      },
    });
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
  });

  it('survives language switching with English fallback keys', async () => {
    const i18n = getI18n();
    const { rerender } = renderHistory();
    expect(screen.getByRole('heading', { name: 'Version History' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/manifests/demo/history']}>
          <Routes>
            <Route path="/manifests/:id/history" element={<ManifestHistoryPage />} />
          </Routes>
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Version History' })).toBeInTheDocument();
  });

  it('formats snapshot timestamps and sizes with the active locale', async () => {
    const i18n = getI18n();
    Object.assign(window.cfs!, {
      history: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: 'snap-1', manifestName: 'demo', timestamp: '2026-05-28T12:00:00Z', size: 1536 }],
        }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    const { rerender } = renderHistory();
    await waitFor(() => expect(screen.getByText(/May 28, 2026/)).toBeInTheDocument());
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();

    await i18n.changeLanguage('de');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/manifests/demo/history']}>
          <Routes>
            <Route path="/manifests/:id/history" element={<ManifestHistoryPage />} />
          </Routes>
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByText(/28\. Mai 2026/)).toBeInTheDocument();
    expect(screen.getByText('1,5 KB')).toBeInTheDocument();
  });
});
