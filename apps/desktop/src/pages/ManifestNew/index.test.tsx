// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getI18n } from '../../locales';

const refreshWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock('../../components/BaselineWorkspace', () => ({
  useBaselineWorkspace: () => ({ refresh: refreshWorkspaceMock }),
}));
vi.mock('../../components/manifest-editor', () => ({
  ManifestEditor: () => <div data-testid="manifest-editor" />,
}));
vi.mock('../../components/resource-picker', () => ({
  ResourcePicker: () => <div data-testid="resource-picker" />,
}));
vi.mock('../../components/use-cis-available', () => ({
  useCisAvailable: () => false,
}));
vi.mock('../../lib/use-navigation-guard', () => ({
  useNavigationGuard: vi.fn(),
}));

import { ManifestNewPage } from './index';

function renderPage() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/manifests/new']}>
        <Routes>
          <Route path="/manifests/new" element={<ManifestNewPage />} />
          <Route path="/manifests" element={<div>Baselines route</div>} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(async () => {
  await getI18n().changeLanguage('en');
  sessionStorage.clear();
  refreshWorkspaceMock.mockReset();
  refreshWorkspaceMock.mockImplementation(() => new Promise(() => {}));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.assign(window.cfs!, {
    manifests: {
      register: vi.fn().mockResolvedValue({
        message: 'registered',
        data: { namespace: 'baseline', platform: 'windows' },
        warnings: [],
      }),
    },
    importChannel: {
      fromContent: vi.fn().mockResolvedValue({
        type: 'manifest',
        filename: 'baseline.yaml',
        yaml: 'resources: []\n',
        data: { resourceCount: 0 },
      }),
    },
  });
});

describe('ManifestNewPage post-registration refresh', () => {
  it('navigates after successful registration even when workspace refresh never settles', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Baseline Name'), {
      target: { value: 'baseline' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register Baseline' }));

    expect(await screen.findByText('Baselines route')).toBeInTheDocument();
    expect(window.cfs!.manifests.register).toHaveBeenCalledTimes(1);
    expect(refreshWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it('completes batch import and schedules navigation when workspace refresh never settles', async () => {
    const { container } = renderPage();
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const first = new File(['resources: []'], 'first.yaml', {
      type: 'text/yaml',
    });
    const second = new File(['resources: []'], 'second.yaml', {
      type: 'text/yaml',
    });

    fireEvent.change(input!, { target: { files: [first, second] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Register All' }));

    await waitFor(() => expect(window.cfs!.manifests.register).toHaveBeenCalledTimes(2));
    expect(refreshWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Baselines route', {}, { timeout: 3_000 })).toBeInTheDocument();
  });
});
