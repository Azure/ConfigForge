// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Regression test for the v0.3.53 Diff dropdown stability fix.
 *
 * Bug: clicking the "Select manifest" dropdown on the Diff page
 * sometimes did nothing — no popup, no error — and the failure
 * persisted across page navigation until app restart. Root-cause
 * candidates included a wedged `cfs.manifests.list({})` IPC leaving
 * `loadingManifests` stuck at `true` (which then propagated via
 * `disabled={loadingManifests}` and made the select uninteractive).
 *
 * Fix: drop the `disabled={loadingManifests}` gate from both Pairwise
 * selects so loading is communicated via the placeholder option text
 * only — the dropdown stays clickable regardless of IPC state.
 *
 * This test pins that contract by mounting the Diff page with a
 * manifest IPC that never resolves (the wedged-handler simulation)
 * and asserting the selects do NOT carry the `disabled` attribute.
 */
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { getI18n } from '../../locales';

const useDiffMatrixSpy = vi.hoisted(() => vi.fn());
const reconcileMatrixSelectionSpy = vi.hoisted(() => vi.fn());

vi.mock('../../components/manifest-editor', () => ({
  ManifestEditor: () => <div data-testid="mock-manifest-editor" />,
  ConfigEditor: () => <div data-testid="mock-manifest-editor" />,
}));
vi.mock('../../components/diff-viewer', () => ({
  DiffViewer: () => <div data-testid="mock-diff-viewer" />,
}));
vi.mock('../../components/ai-analysis-panel', () => ({
  AiAnalysisPanel: () => <div data-testid="mock-ai-panel" />,
}));
vi.mock('../../components/use-cis-available', () => ({
  useCisAvailable: () => false,
}));
vi.mock('./components/CisDiffTab', () => ({
  CisDiffTab: () => <div data-testid="mock-cis-diff-tab" />,
}));
vi.mock('./state/useDiffMatrix', () => ({
  useDiffMatrix: (options?: { initialSelected?: string[] }) => {
    useDiffMatrixSpy(options);
    return {
      matrixSelected: new Set<string>(options?.initialSelected ?? []),
      matrixData: null,
      matrixLoading: false,
      matrixError: null,
      toggleMatrixSelection: vi.fn(),
      reconcileMatrixSelection: reconcileMatrixSelectionSpy,
      runMatrixCompare: vi.fn(),
      downloadMatrixXlsx: vi.fn(),
    };
  },
}));

import { DiffPage } from './index';

function LocationStateProbe() {
  const location = useLocation();
  return <output aria-label="location-state">{JSON.stringify(location.state)}</output>;
}

function renderDiff(
  entry: string | { pathname: string; state: unknown } = '/diff',
) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[entry]}>
        <DiffPage />
        <LocationStateProbe />
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(async () => {
  await getI18n().changeLanguage('en');
  useDiffMatrixSpy.mockClear();
  reconcileMatrixSelectionSpy.mockClear();
  // Replace the manifest namespace with a list() that never resolves —
  // simulates a wedged main-process IPC handler so we can assert the
  // UI does not lock up around it.
  (window as unknown as { cfs: Record<string, unknown> }).cfs.manifests = {
    list: vi.fn().mockImplementation(() => new Promise(() => {})),
  };
});

afterEach(async () => {
  await getI18n().changeLanguage('en');
});

describe('DiffPage — dropdown stability (v0.3.53)', () => {
  it('safely activates Matrix N-way and consumes route-provided preselection', async () => {
    renderDiff({
      pathname: '/diff',
      state: {
        configForgeDiff: {
          version: 1,
          tab: 'matrix',
          baselineNames: ['alpha', 'beta'],
        },
      },
    });

    expect(useDiffMatrixSpy).toHaveBeenCalledWith({
      initialSelected: ['alpha', 'beta'],
    });
    expect(screen.getByText('Pick 2–10 baselines to compare')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-manifest-editor')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('location-state')).toHaveTextContent('null'),
    );
  });

  it('reconciles route preselection against the authoritative manifest list', async () => {
    (window as unknown as { cfs: Record<string, unknown> }).cfs.manifests = {
      list: vi.fn().mockResolvedValue({
        data: [
          { Name: 'alpha', Source: 'user', Resources: [] },
          { Name: 'beta', Source: 'user', Resources: [] },
        ],
      }),
    };
    renderDiff({
      pathname: '/diff',
      state: {
        configForgeDiff: {
          version: 1,
          tab: 'matrix',
          baselineNames: [
            'alpha',
            'missing-1',
            'missing-2',
            'missing-3',
            'missing-4',
            'missing-5',
            'missing-6',
            'missing-7',
            'missing-8',
            'missing-9',
          ],
        },
      },
    });

    await waitFor(() =>
      expect(reconcileMatrixSelectionSpy).toHaveBeenCalledWith(['alpha', 'beta']),
    );
  });

  it('filters Matrix baseline choices with the Search baselines input', async () => {
    (window as unknown as { cfs: Record<string, unknown> }).cfs.manifests = {
      list: vi.fn().mockResolvedValue({
        data: [
          { Name: 'Alpha Baseline', Source: 'user', Resources: [] },
          { Name: 'Windows Production', Source: 'user', Resources: [] },
          { Name: 'Linux Test', Source: 'user', Resources: [] },
        ],
      }),
    };
    renderDiff();
    fireEvent.click(screen.getByRole('tab', { name: 'Matrix (N-way)' }));

    const search = await screen.findByRole('searchbox', { name: /Search Baselines/i });
    expect(screen.getByText('Alpha Baseline')).toBeInTheDocument();
    expect(screen.getByText('Windows Production')).toBeInTheDocument();
    expect(screen.getByText('Linux Test')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'windows prod' } });
    expect(screen.getByText('Windows Production')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Baseline')).not.toBeInTheDocument();
    expect(screen.queryByText('Linux Test')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'missing' } });
    expect(
      screen.getByText('No baselines match the current search and filters.'),
    ).toBeInTheDocument();
  });
  it('Pairwise "Before" select stays interactive while manifest list IPC is pending', () => {
    renderDiff();
    // Two manifest pickers render on the Pairwise tab (Before + After).
    // Neither should be disabled even while loadingManifests=true.
    const selects = screen
      .getAllByRole('combobox')
      .filter((el) => el.querySelector('option[value=""]'));
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const select of selects) {
      // jsdom drops `disabled` from the attribute map when it's false,
      // and the `HTMLSelectElement.disabled` property reflects state
      // regardless. Check both to make the contract explicit.
      expect(select).not.toHaveAttribute('disabled');
      expect((select as HTMLSelectElement).disabled).toBe(false);
    }
  });

  it('placeholder communicates loading state via the option text, not disable', () => {
    renderDiff();
    // While loading, the first option of each manifest select shows
    // "Loading…" — that's the user-visible signal. The select itself
    // must remain enabled so a user can still pop the dropdown.
    const loadingOptions = screen.getAllByRole('option', { name: 'Loading…' });
    expect(loadingOptions.length).toBeGreaterThanOrEqual(2);
    for (const option of loadingOptions) {
      const parent = option.parentElement as HTMLSelectElement | null;
      expect(parent).not.toBeNull();
      expect(parent?.disabled).toBe(false);
    }
  });

  it('survives language switching with translated keys', async () => {
    const i18n = getI18n();
    const { rerender } = renderDiff();
    expect(screen.getByRole('heading', { name: 'Compare Baselines' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <DiffPage />
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Comparez Baselines' })).toBeInTheDocument();
  });
});
