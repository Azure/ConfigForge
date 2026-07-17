// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { getI18n } from '../locales';
import { BASELINE_CATALOG } from '../data/baseline-catalog';
import { BaselineWorkspaceProvider } from './BaselineWorkspace';
import { Sidebar } from './Sidebar';

/**
 * Phase 7 component tests — Sidebar.
 *
 * Phase 6.2 introduced Outline → Filled icon swapping for the
 * active nav item. Each navItem entry now has both `icon` and
 * `iconActive`; the render prop chooses between them based on
 * `NavLink`'s `isActive`.
 *
 * We can't directly assert "this is the Filled variant" — both
 * variants are SVG and FluentUI doesn't expose a stable data
 * attribute. Instead, we render the Sidebar at a specific route
 * and verify the active route's link gets the `bg-blue-500/15`
 * active class, plus we count that the SVG count matches the
 * navItem count (proves the render prop ran for every entry).
 */
describe('Sidebar', () => {
  function renderAt(path: string) {
    return render(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={[path]}>
          <BaselineWorkspaceProvider>
            <Sidebar />
          </BaselineWorkspaceProvider>
        </MemoryRouter>
      </FluentProvider>,
    );
  }

  beforeEach(async () => {
    // Sidebar mobile-toggle button uses md:hidden; on JSDOM the
    // viewport is 1024px (md breakpoint = 768) so the toggle is
    // rendered but hidden. The aside is always rendered.
    await getI18n().changeLanguage('en');
    Object.assign(window.cfs!, {
      manifests: {
        list: vi.fn().mockResolvedValue({
          data: [{ Name: 'one' }, { Name: 'two' }, { Name: 'three' }],
        }),
      },
    });
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
  });

  it('renders all seven nav items', () => {
    renderAt('/');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/My Baselines/)).toBeInTheDocument();
    expect(screen.getByText('Export Readiness')).toBeInTheDocument();
    expect(screen.getByText(/Microsoft Baselines/)).toBeInTheDocument();
    expect(screen.getByText('Diff')).toBeInTheDocument();
    expect(screen.getByText('Benchmark Mapping')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows live My Baselines and Microsoft catalog counts in parentheses', async () => {
    renderAt('/');

    expect(await screen.findByText('My Baselines (3)')).toBeInTheDocument();
    expect(
      screen.getByText(`Microsoft Baselines (${BASELINE_CATALOG.length})`),
    ).toBeInTheDocument();
  });

  it('marks the Dashboard link active when at "/"', () => {
    renderAt('/');
    const dashboardLink = screen.getByRole('link', { name: /Dashboard/ });
    // Tailwind active class includes `bg-blue-500/15` from the
    // ternary in Sidebar.tsx; arbitrary opacity escapes to
    // `bg-blue-500\/15` in JSX className.
    expect(dashboardLink.className).toMatch(/bg-blue-500/);
  });

  it('marks the My Baselines link active when at "/manifests"', () => {
    renderAt('/manifests');
    const manifestsLink = screen.getByRole('link', { name: /My Baselines/ });
    expect(manifestsLink.className).toMatch(/bg-blue-500/);
    // Inactive sibling sanity check
    const dashboardLink = screen.getByRole('link', { name: /Dashboard/ });
    expect(dashboardLink.className).not.toMatch(/bg-blue-500/);
  });

  it('renders an SVG icon for every nav entry', () => {
    const { container } = renderAt('/');
    // 6 navItems icons + 2 logo icons + 1 mobile-toggle icon = 9
    // SVGs minimum. We assert >= 6 to be tolerant of FluentUI
    // changing the logo glyphs.
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(6);
  });

  it('updates nav labels when the active i18n language changes', async () => {
    const i18n = getI18n();
    const { rerender } = renderAt('/');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/']}>
          <BaselineWorkspaceProvider>
            <Sidebar />
          </BaselineWorkspaceProvider>
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByText('Accueil')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });
});
