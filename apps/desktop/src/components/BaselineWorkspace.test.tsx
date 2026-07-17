// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BASELINE_CATALOG } from '../data/baseline-catalog';
import {
  BASELINE_WORKSPACE_STORAGE_KEY,
  BaselineWorkspaceProvider,
  useBaselineWorkspace,
} from './BaselineWorkspace';

function WorkspaceProbe() {
  const workspace = useBaselineWorkspace();
  return (
    <div>
      <output aria-label="tabs">{workspace.openBaselines.join('|')}</output>
      <output aria-label="alpha-platform">{workspace.baselinePlatforms.alpha ?? ''}</output>
      <output aria-label="my-count">{workspace.myBaselineCount}</output>
      <output aria-label="microsoft-count">{workspace.microsoftBaselineCount}</output>
      <button type="button" onClick={() => workspace.openBaseline('beta')}>
        Open beta
      </button>
      <button type="button" onClick={() => workspace.closeBaseline('alpha')}>
        Close alpha
      </button>
      <button type="button" onClick={() => void workspace.refresh()}>
        Refresh workspace
      </button>
    </div>
  );
}

function renderWorkspace() {
  return render(
    <BaselineWorkspaceProvider>
      <WorkspaceProbe />
    </BaselineWorkspaceProvider>,
  );
}

describe('BaselineWorkspaceProvider', () => {
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

  it('loads persisted tabs, prunes missing baselines, and refreshes live counts', async () => {
    localStorage.setItem(
      BASELINE_WORKSPACE_STORAGE_KEY,
      JSON.stringify(['alpha', 'deleted', 'alpha']),
    );

    renderWorkspace();

    await waitFor(() => expect(screen.getByLabelText('tabs')).toHaveTextContent('alpha'));
    expect(screen.getByLabelText('tabs')).not.toHaveTextContent('deleted');
    expect(screen.getByLabelText('my-count')).toHaveTextContent('2');
    expect(screen.getByLabelText('alpha-platform')).toHaveTextContent('windows');
    expect(screen.getByLabelText('microsoft-count')).toHaveTextContent(
      String(BASELINE_CATALOG.length),
    );
    expect(window.cfs!.manifests.list).toHaveBeenCalledWith({ lite: true });
  });

  it('opens without duplicates, closes, and persists tabs across remounts', async () => {
    localStorage.setItem(BASELINE_WORKSPACE_STORAGE_KEY, JSON.stringify(['alpha']));
    const first = renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('tabs')).toHaveTextContent('alpha'));

    fireEvent.click(screen.getByRole('button', { name: 'Open beta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open beta' }));
    await waitFor(() => expect(screen.getByLabelText('tabs')).toHaveTextContent('alpha|beta'));

    fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
    await waitFor(() => expect(screen.getByLabelText('tabs')).toHaveTextContent('beta'));
    expect(JSON.parse(localStorage.getItem(BASELINE_WORKSPACE_STORAGE_KEY) ?? '[]')).toEqual([
      'beta',
    ]);

    first.unmount();
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('tabs')).toHaveTextContent('beta'));
  });

  it('prunes a tab when a later refresh no longer returns it', async () => {
    localStorage.setItem(BASELINE_WORKSPACE_STORAGE_KEY, JSON.stringify(['alpha', 'beta']));
    const list = window.cfs!.manifests.list as ReturnType<typeof vi.fn>;
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('tabs')).toHaveTextContent('alpha|beta'));

    list.mockResolvedValueOnce({ data: [{ Name: 'beta' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));

    await waitFor(() => expect(screen.getByLabelText('tabs')).toHaveTextContent('beta'));
    expect(screen.getByLabelText('my-count')).toHaveTextContent('1');
  });
});
