// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { BaselineWorkspaceProvider } from './BaselineWorkspace';

vi.mock('../hooks/useCliPresence', () => ({
  useCliPresence: () => ({ loading: false, installed: true, version: 'test' }),
}));
vi.mock('./HealthIndicator', () => ({
  HealthIndicator: () => <div>Health</div>,
}));
vi.mock('./UpdateBanner', () => ({
  UpdateBanner: () => null,
}));
vi.mock('./CliRequiredModal', () => ({
  CliRequiredModal: () => null,
}));
vi.mock('./Sidebar', () => ({
  Sidebar: () => <aside>Sidebar</aside>,
}));

import { Layout } from './Layout';

function renderLayout(path: string) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[path]}>
        <BaselineWorkspaceProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/manifests" element={<div>Baseline list</div>} />
              <Route path="/manifests/new" element={<div>New baseline</div>} />
              <Route path="/manifests/:id/*" element={<div>Baseline detail</div>} />
              <Route path="/settings" element={<div>Settings page</div>} />
            </Route>
          </Routes>
        </BaselineWorkspaceProvider>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe('Layout baseline workspace shell', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(window.cfs!, {
      manifests: {
        list: vi.fn().mockResolvedValue({ data: [{ Name: 'alpha' }] }),
      },
    });
  });

  it('shows workspace tabs and removes the app footer on the baseline list', async () => {
    renderLayout('/manifests');

    expect(await screen.findByRole('tab', { name: 'All Baselines' })).toBeInTheDocument();
    expect(screen.getByText('Baseline list')).toBeInTheDocument();
    expect(screen.queryByText('Health')).not.toBeInTheDocument();
  });

  it('shares the shell with baseline detail routes and opens a direct tab', async () => {
    renderLayout('/manifests/alpha/history');

    expect(await screen.findByRole('tab', { name: 'alpha' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Baseline detail')).toBeInTheDocument();
    expect(screen.queryByText('Health')).not.toBeInTheDocument();
  });

  it('excludes create and preserves the app footer outside workspace pages', async () => {
    renderLayout('/manifests/new');

    await waitFor(() => expect(window.cfs!.manifests.list).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'All Baselines' })).not.toBeInTheDocument();
    expect(screen.getByText('New baseline')).toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
  });
});
