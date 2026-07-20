// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getI18n } from '../../locales';

const refreshWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock('../../components/BaselineWorkspace', () => ({
  useBaselineWorkspace: () => ({ refresh: refreshWorkspaceMock }),
}));
vi.mock('../../components/manifest-editor', () => ({
  ManifestEditor: ({ value }: { value: string }) => (
    <div data-testid="manifest-editor">{value}</div>
  ),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fileWithSize(name: string, size: number, type = 'text/yaml') {
  const file = new File(['content'], name, { type });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
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
      fetchUri: vi.fn().mockResolvedValue({
        content: 'resources: []\n',
      }),
    },
    library: {
      get: vi.fn().mockResolvedValue({
        content: 'resources: []\n',
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

async function startCustomBaseline(name = 'baseline') {
  fireEvent.click(screen.getByRole('radio', { name: /Create my own baseline/i }));
  fireEvent.change(screen.getByLabelText('Baseline Name'), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create baseline' }));
  await screen.findByRole('button', { name: 'Visual' });
}

describe('ManifestNewPage post-registration refresh', () => {
  it('offers every Loop creation method before opening the editor', () => {
    renderPage();

    for (const method of [
      'Import existing baseline file',
      'Import existing baseline from URL',
      'Import baseline from Excel',
      'Choose a template from the baseline library',
      'Create my own baseline',
    ]) {
      expect(screen.getByRole('radio', { name: new RegExp(method, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Create baseline' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Visual' })).not.toBeInTheDocument();
  });

  it('uses the editable spreadsheet for Visual authoring', async () => {
    renderPage();
    await startCustomBaseline();

    fireEvent.click(screen.getByRole('button', { name: 'Visual' }));

    expect(
      await screen.findByRole('region', { name: 'Visual baseline settings' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add setting' }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('button', { name: /Edit Setting Name/ })).toBeInTheDocument();
    expect(screen.queryByTestId('resource-picker')).not.toBeInTheDocument();
  });

  it('blocks registration until an added spreadsheet row is complete', async () => {
    renderPage();
    await startCustomBaseline();
    fireEvent.click(screen.getByRole('button', { name: 'Visual' }));
    const registrySection = (await screen.findByRole('heading', { name: 'Registry' })).closest(
      'section',
    );
    expect(registrySection).not.toBeNull();

    fireEvent.click(
      within(registrySection!).getAllByRole('button', { name: 'Add setting' }).at(-1)!,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Complete 3 required cells before saving.',
    );
    const register = screen.getByRole('button', { name: 'Register Baseline' });
    expect(register).toBeDisabled();
    expect(register).toHaveAttribute(
      'title',
      'Complete or correct the highlighted Visual cells before registering.',
    );
  });

  it('navigates after successful registration even when workspace refresh never settles', async () => {
    renderPage();
    await startCustomBaseline();
    fireEvent.click(screen.getByRole('button', { name: 'Register Baseline' }));

    expect(await screen.findByText('Baselines route')).toBeInTheDocument();
    expect(window.cfs!.manifests.register).toHaveBeenCalledTimes(1);
    expect(refreshWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it('completes batch import and schedules navigation when workspace refresh never settles', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
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

  it('drops running batch completion effects after a newer setup operation', async () => {
    const importGate = deferred<void>();
    vi.mocked(window.cfs!.importChannel.fromContent).mockImplementation(async (request) => {
      await importGate.promise;
      return {
        type: 'manifest',
        filename: request.filename,
        yaml: 'resources: []\n',
        data: { resourceCount: 0 },
      };
    });

    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    const files = [
      new File(['first'], 'first.yaml', { type: 'text/yaml' }),
      new File(['second'], 'second.yaml', { type: 'text/yaml' }),
    ];
    fireEvent.change(input!, { target: { files } });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    fireEvent.click(await screen.findByRole('button', { name: 'Register All' }));
    await waitFor(() =>
      expect(window.cfs!.importChannel.fromContent).toHaveBeenCalledTimes(2),
    );

    fireEvent.click(screen.getByRole('radio', { name: /Create my own baseline/i }));
    await act(async () => {
      importGate.resolve();
      await importGate.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(window.cfs!.manifests.register).not.toHaveBeenCalled();
    expect(refreshWorkspaceMock).not.toHaveBeenCalled();
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 1500)).toBe(false);
    setTimeoutSpy.mockRestore();
  });

  it('cancels delayed batch navigation when the page unmounts', async () => {
    const { container, unmount } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    const files = [
      new File(['first'], 'first.yaml', { type: 'text/yaml' }),
      new File(['second'], 'second.yaml', { type: 'text/yaml' }),
    ];
    fireEvent.change(input!, { target: { files } });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    fireEvent.click(await screen.findByRole('button', { name: 'Register All' }));
    await waitFor(() => expect(refreshWorkspaceMock).toHaveBeenCalledTimes(1));
    const navigationTimerIndex = setTimeoutSpy.mock.calls.reduce(
      (found, [, delay], index) => (delay === 1500 ? index : found),
      -1,
    );
    expect(navigationTimerIndex).toBeGreaterThanOrEqual(0);
    const navigationTimer = setTimeoutSpy.mock.results[navigationTimerIndex].value;

    try {
      unmount();
      expect(
        clearTimeoutSpy.mock.calls.some(([timer]) => timer === navigationTimer),
      ).toBe(true);
    } finally {
      globalThis.clearTimeout(navigationTimer);
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it('rejects an oversized single file before reading it', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    expect(input).not.toBeNull();
    const oversized = fileWithSize('oversized.yaml', 10 * 1024 * 1024 + 1);
    const textSpy = vi.spyOn(oversized, 'text');

    fireEvent.change(input!, { target: { files: [oversized] } });

    expect(
      await screen.findByText('oversized.yaml: The baseline is larger than the 10 MB import limit.'),
    ).toBeInTheDocument();
    expect(textSpy).not.toHaveBeenCalled();
    expect(window.cfs!.importChannel.fromContent).not.toHaveBeenCalled();
  });

  it('rejects a batch that exceeds the file-count cap', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    const files = Array.from({ length: 21 }, (_, index) =>
      fileWithSize(`baseline-${index}.yaml`, 1),
    );

    fireEvent.change(input!, { target: { files } });

    expect(await screen.findByText(/Batch Import: 21 files selected.*20/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register All' })).not.toBeInTheDocument();
  });

  it('rejects a batch that exceeds the aggregate byte cap', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    const files = Array.from({ length: 6 }, (_, index) =>
      fileWithSize(`baseline-${index}.yaml`, 9 * 1024 * 1024),
    );

    fireEvent.change(input!, { target: { files } });

    expect(await screen.findByText(/Batch Import: 54\.0 MB > 50 MB/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register All' })).not.toBeInTheDocument();
  });

  it('bounds batch import concurrency', async () => {
    const releases: Array<() => void> = [];
    let activeImports = 0;
    let maxActiveImports = 0;
    vi.mocked(window.cfs!.importChannel.fromContent).mockImplementation(async (request) => {
      activeImports += 1;
      maxActiveImports = Math.max(maxActiveImports, activeImports);
      await new Promise<void>((resolve) => releases.push(resolve));
      activeImports -= 1;
      return {
        type: 'manifest',
        filename: request.filename,
        yaml: 'resources: []\n',
        data: { resourceCount: 0 },
      };
    });
    vi.mocked(window.cfs!.manifests.register).mockRejectedValue(
      new Error('Expected test failure'),
    );

    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    const files = Array.from({ length: 6 }, (_, index) =>
      fileWithSize(`baseline-${index}.yaml`, 1),
    );
    fireEvent.change(input!, { target: { files } });
    fireEvent.click(await screen.findByRole('button', { name: 'Register All' }));

    await waitFor(() =>
      expect(window.cfs!.importChannel.fromContent).toHaveBeenCalledTimes(4),
    );
    expect(maxActiveImports).toBe(4);

    await act(async () => {
      releases.splice(0).forEach((release) => release());
    });
    await waitFor(() =>
      expect(window.cfs!.importChannel.fromContent).toHaveBeenCalledTimes(6),
    );
    await act(async () => {
      releases.splice(0).forEach((release) => release());
    });
    await waitFor(() => expect(window.cfs!.manifests.register).toHaveBeenCalledTimes(6));
    expect(maxActiveImports).toBe(4);
  });

  it('keeps normal XLSX imports working within the size limit', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import baseline from Excel/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".xlsx"]');
    expect(input).not.toBeNull();
    const workbook = fileWithSize(
      'baseline.xlsx',
      1024,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const bytes = new Uint8Array([1, 2, 3]);
    const arrayBufferSpy = vi
      .spyOn(workbook, 'arrayBuffer')
      .mockResolvedValue(bytes.buffer);

    fireEvent.change(input!, { target: { files: [workbook] } });

    await waitFor(() =>
      expect(window.cfs!.importChannel.fromContent).toHaveBeenCalledWith({
        filename: 'baseline.xlsx',
        bytes,
      }),
    );
    expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('baseline.yaml')).toBeInTheDocument();
  });

  it('fetches a URL before opening the editor', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline from URL/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Baseline URL/i }), {
      target: { value: 'https://example.test/baseline.yaml' },
    });
    fireEvent.change(screen.getByLabelText('Baseline Name'), {
      target: { value: 'remote-baseline' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create baseline' }));

    expect(await screen.findByRole('button', { name: 'Visual' })).toBeInTheDocument();
    expect(window.cfs!.manifests.fetchUri).toHaveBeenCalledWith(
      'https://example.test/baseline.yaml',
    );
  });

  it('ignores a pending URL fetch after the creation method changes', async () => {
    const pendingFetch = deferred<{ content: string }>();
    vi.mocked(window.cfs!.manifests.fetchUri).mockReturnValueOnce(pendingFetch.promise);

    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline from URL/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Baseline URL/i }), {
      target: { value: 'https://example.test/stale.yaml' },
    });
    fireEvent.change(screen.getByLabelText('Baseline Name'), {
      target: { value: 'remote-baseline' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create baseline' }));
    await waitFor(() => expect(window.cfs!.manifests.fetchUri).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('radio', { name: /Create my own baseline/i }));

    await act(async () => {
      pendingFetch.resolve({ content: 'resources:\n  - name: stale\n' });
      await pendingFetch.promise;
    });

    expect(
      screen.getByRole('radio', { name: /Create my own baseline/i }),
    ).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Visual' })).not.toBeInTheDocument();
  });

  it('ignores a pending URL fetch after the URL is edited', async () => {
    const staleFetch = deferred<{ content: string }>();
    vi.mocked(window.cfs!.manifests.fetchUri)
      .mockReturnValueOnce(staleFetch.promise)
      .mockResolvedValueOnce({ content: 'resources: []\n# fresh URL\n' });

    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline from URL/i }));
    const urlInput = screen.getByRole('textbox', { name: /Baseline URL/i });
    fireEvent.change(urlInput, {
      target: { value: 'https://example.test/stale.yaml' },
    });
    fireEvent.change(screen.getByLabelText('Baseline Name'), {
      target: { value: 'remote-baseline' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create baseline' }));
    await waitFor(() => expect(window.cfs!.manifests.fetchUri).toHaveBeenCalledTimes(1));

    fireEvent.change(urlInput, {
      target: { value: 'https://example.test/fresh.yaml' },
    });
    await act(async () => {
      staleFetch.resolve({ content: 'resources: []\n# stale URL\n' });
      await staleFetch.promise;
    });

    expect(screen.queryByRole('button', { name: 'Visual' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create baseline' }));

    expect(await screen.findByTestId('manifest-editor')).toHaveTextContent('fresh URL');
    expect(screen.getByTestId('manifest-editor')).not.toHaveTextContent('stale URL');
  });

  it('ignores a stale file import after a newer file selection completes', async () => {
    const firstImport = deferred<{
      type: 'manifest';
      filename: string;
      yaml: string;
      data: { resourceCount: number };
    }>();
    const secondImport = deferred<{
      type: 'manifest';
      filename: string;
      yaml: string;
      data: { resourceCount: number };
    }>();
    vi.mocked(window.cfs!.importChannel.fromContent)
      .mockReturnValueOnce(firstImport.promise)
      .mockReturnValueOnce(secondImport.promise);

    const { container } = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Import existing baseline file/i }));
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: { files: [new File(['first'], 'first.yaml', { type: 'text/yaml' })] },
    });
    await waitFor(() => expect(window.cfs!.importChannel.fromContent).toHaveBeenCalledTimes(1));
    fireEvent.change(input!, {
      target: { files: [new File(['second'], 'second.yaml', { type: 'text/yaml' })] },
    });
    await waitFor(() => expect(window.cfs!.importChannel.fromContent).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondImport.resolve({
        type: 'manifest',
        filename: 'second.yaml',
        yaml: 'resources: []\n# second import\n',
        data: { resourceCount: 0 },
      });
      await secondImport.promise;
    });
    expect(await screen.findByText('second.yaml')).toBeInTheDocument();

    await act(async () => {
      firstImport.resolve({
        type: 'manifest',
        filename: 'first.yaml',
        yaml: 'resources: []\n# first import\n',
        data: { resourceCount: 0 },
      });
      await firstImport.promise;
    });

    expect(screen.queryByText('first.yaml')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Baseline Name')).toHaveValue('second');
    fireEvent.click(screen.getByRole('button', { name: 'Create baseline' }));
    expect(await screen.findByTestId('manifest-editor')).toHaveTextContent('second import');
    expect(screen.getByTestId('manifest-editor')).not.toHaveTextContent('first import');
  });

  it('ignores a stale template load after a newer file selection completes', async () => {
    const staleTemplate = deferred<{ content: string }>();
    vi.mocked(window.cfs!.library.get).mockReturnValueOnce(staleTemplate.promise);
    vi.mocked(window.cfs!.importChannel.fromContent).mockResolvedValueOnce({
      type: 'manifest',
      filename: 'newer.yaml',
      yaml: 'resources: []\n# newer file\n',
      data: { resourceCount: 0 },
    });

    const { container } = renderPage();
    fireEvent.click(
      screen.getByRole('radio', {
        name: /Choose a template from the baseline library/i,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Browse baseline templates' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Use as template' }))[0]);
    await waitFor(() => expect(window.cfs!.library.get).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole('radio', {
        name: /Import existing baseline file/i,
        hidden: true,
      }),
    );
    const input = container.querySelector<HTMLInputElement>('input[accept*=".osc.yaml"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: { files: [new File(['newer'], 'newer.yaml', { type: 'text/yaml' })] },
    });
    expect(await screen.findByText('newer.yaml')).toBeInTheDocument();

    await act(async () => {
      staleTemplate.resolve({ content: 'resources: []\n# stale template\n' });
      await staleTemplate.promise;
    });

    expect(screen.getByText('newer.yaml')).toBeInTheDocument();
    expect(screen.getByLabelText('Baseline Name')).toHaveValue('newer');
  });

  it('selects a Microsoft template in place and opens it in the editor', async () => {
    renderPage();
    fireEvent.click(
      screen.getByRole('radio', {
        name: /Choose a template from the baseline library/i,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Browse baseline templates' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Use as template' }))[0]);

    await screen.findByRole('button', { name: 'Change' });
    expect(screen.getByText('Windows Server 2025 - Member Server')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create baseline' }));
    expect(await screen.findByRole('button', { name: 'Visual' })).toBeInTheDocument();
    expect(window.cfs!.library.get).toHaveBeenCalledWith({
      id: 'ws2025-member-server',
      content: true,
    });
  });
});
