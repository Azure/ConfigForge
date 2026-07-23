// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  BASELINE_WORKSPACE_STORAGE_KEY,
  BaselineWorkspaceProvider,
} from './BaselineWorkspace';
import {
  BASELINE_CLOSE_REQUEST_EVENT,
  BASELINE_NAVIGATION_REQUEST_EVENT,
  BaselineWorkspaceTabs,
  type BaselineNavigationRequestDetail,
} from './BaselineWorkspaceTabs';

function CurrentPath() {
  return <output aria-label="current-path">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BaselineWorkspaceProvider>
        <BaselineWorkspaceTabs />
        <Routes>
          <Route path="/manifests" element={<CurrentPath />} />
          <Route path="/manifests/:id/*" element={<CurrentPath />} />
        </Routes>
      </BaselineWorkspaceProvider>
    </MemoryRouter>,
  );
}

describe('BaselineWorkspaceTabs', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(window.cfs!, {
      manifests: {
        list: vi.fn().mockResolvedValue({
          data: [
            { Name: 'alpha', Platform: 'windows' },
            { Name: 'beta', Platform: 'linux' },
          ],
        }),
      },
    });
  });

  it('opens a directly visited baseline and keeps All Baselines constant', async () => {
    renderAt('/manifests/alpha');

    const allBaselines = screen.getByRole('tab', { name: 'All Baselines' });
    expect(allBaselines).toHaveClass(
      'rounded-full',
      'bg-white',
      'hover:bg-[#E4E9F0]',
    );
    const alpha = await screen.findByRole('tab', { name: 'alpha' });
    expect(alpha).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(alpha.parentElement).toHaveClass(
      'rounded-full',
      'bg-blue-600',
      'hover:bg-blue-700',
    );
    await waitFor(() => {
      expect(alpha.querySelector('[data-platform="windows"]')).toBeInTheDocument();
    });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(BASELINE_WORKSPACE_STORAGE_KEY) ?? '[]')).toEqual([
        'alpha',
      ]),
    );

    fireEvent.click(allBaselines);
    expect(screen.getByLabelText('current-path')).toHaveTextContent('/manifests');
  });

  it('renders selected and unselected tabs as pill states', async () => {
    localStorage.setItem(BASELINE_WORKSPACE_STORAGE_KEY, JSON.stringify(['alpha']));
    renderAt('/manifests');
    const allBaselines = screen.getByRole('tab', { name: 'All Baselines' });
    const alpha = await screen.findByRole('tab', { name: 'alpha' });

    expect(allBaselines).toHaveAttribute('aria-selected', 'true');
    expect(allBaselines).toHaveClass(
      'rounded-full',
      'bg-blue-600',
      'hover:bg-blue-700',
    );
    expect(alpha.parentElement).toHaveClass(
      'rounded-full',
      'bg-white',
      'hover:bg-[#E4E9F0]',
    );
  });

  it('routes an open tab to its latest detail state and closes the active tab to the list', async () => {
    localStorage.setItem(
      BASELINE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(['alpha', 'beta']),
    );
    renderAt('/manifests/alpha/history');
    const beta = await screen.findByRole('tab', { name: 'beta' });
    await waitFor(() => {
      expect(beta.querySelector('[data-platform="linux"]')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'beta' }));
    expect(screen.getByLabelText('current-path')).toHaveTextContent('/manifests/beta');

    fireEvent.click(screen.getByRole('button', { name: 'Close beta' }));
    expect(screen.getByLabelText('current-path')).toHaveTextContent('/manifests');
    expect(screen.queryByRole('tab', { name: 'beta' })).not.toBeInTheDocument();
  });

  it('offers every open baseline through an accessible More menu', async () => {
    localStorage.setItem(
      BASELINE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(['alpha', 'beta']),
    );
    renderAt('/manifests');
    await screen.findByRole('tab', { name: 'beta' });

    fireEvent.click(screen.getByRole('button', { name: 'More open baselines' }));

    expect(await screen.findByRole('menuitem', { name: 'alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'beta' }));
    expect(screen.getByLabelText('current-path')).toHaveTextContent('/manifests/beta');
  });

  it.each([
    {
      surface: 'All Baselines',
      destination: '/manifests',
      click: async () => {
        fireEvent.click(screen.getByRole('tab', { name: 'All Baselines' }));
      },
    },
    {
      surface: 'another open baseline tab',
      destination: '/manifests/beta',
      click: async () => {
        fireEvent.click(screen.getByRole('tab', { name: 'beta' }));
      },
    },
    {
      surface: 'a More-menu baseline',
      destination: '/manifests/beta',
      click: async () => {
        fireEvent.click(screen.getByRole('button', { name: 'More open baselines' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'beta' }));
      },
    },
  ])(
    'lets the active editor intercept navigation from $surface with its destination',
    async ({ destination, click }) => {
      localStorage.setItem(
        BASELINE_WORKSPACE_STORAGE_KEY,
        JSON.stringify(['alpha', 'beta']),
      );
      const listener = vi.fn((event: Event) => event.preventDefault());
      window.addEventListener(BASELINE_NAVIGATION_REQUEST_EVENT, listener);
      renderAt('/manifests/alpha');
      await screen.findByRole('tab', { name: 'beta' });

      await click();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(
        (listener.mock.calls[0][0] as CustomEvent<BaselineNavigationRequestDetail>).detail,
      ).toEqual({
        name: 'alpha',
        destination,
      });
      expect(screen.getByLabelText('current-path')).toHaveTextContent('/manifests/alpha');
      window.removeEventListener(BASELINE_NAVIGATION_REQUEST_EVENT, listener);
    },
  );

  it('lets the active editor intercept a tab close for unsaved changes', async () => {
    localStorage.setItem(BASELINE_WORKSPACE_STORAGE_KEY, JSON.stringify(['alpha']));
    const listener = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener(BASELINE_CLOSE_REQUEST_EVENT, listener);
    renderAt('/manifests/alpha');
    await screen.findByRole('tab', { name: 'alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('current-path')).toHaveTextContent('/manifests/alpha');
    expect(screen.getByRole('tab', { name: 'alpha' })).toBeInTheDocument();
    window.removeEventListener(BASELINE_CLOSE_REQUEST_EVENT, listener);
  });
});
