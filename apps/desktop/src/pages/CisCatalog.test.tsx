// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { CisStatus } from '@configforge/core/handlers';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetCisAvailableCacheForTests } from '../components/use-cis-available';
import { CisCatalogPage } from './CisCatalog';

vi.mock('../components/use-cis-available', () => ({
  _resetCisAvailableCacheForTests: vi.fn(),
}));

const DATA_DIR = 'C:\\Users\\Example User\\ConfigForge Data\\cis\\_data';

const unavailableStatus: CisStatus = {
  available: false,
  dataDir: DATA_DIR,
  source: undefined,
  schemaError: null,
  unexpectedFiles: [],
  xccdfFiles: [],
  azurePolicyCisFiles: [],
};

const azureCatalog = {
  filename: 'azure-policy-cis-windows.json',
  platform: 'windows' as const,
  benchmarkName: 'CIS Windows Server 2025',
  benchmarkVersion: '3.0.0',
  ruleCount: 42,
};

const xccdfCatalog = {
  filename: 'CIS_Ubuntu_Linux_24.04_Benchmark-xccdf.xml',
  platform: 'linux' as const,
  product: 'Ubuntu Linux',
  version: '1.0.0',
  title: 'CIS Ubuntu Linux 24.04 Benchmark',
  hasOval: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <CisCatalogPage />
      </MemoryRouter>
    </FluentProvider>,
  );
}

function stepHeadings(): string[] {
  const workflow = screen.getByRole('list', { name: 'CIS catalog setup' });
  return within(workflow)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

describe('CisCatalogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.assign(window.cfs!, {
      cis: {
        status: vi.fn().mockResolvedValue(unavailableStatus),
        recheck: vi.fn().mockResolvedValue(unavailableStatus),
        revealDataDir: vi.fn().mockResolvedValue({ ok: true, path: DATA_DIR }),
      },
    });
  });

  it('shows an informational loading banner while preserving the three-step workflow', () => {
    const pending = deferred<CisStatus>();
    vi.mocked(window.cfs!.cis.status).mockReturnValue(pending.promise);

    renderPage();

    const banner = screen.getByRole('status', { name: 'CIS catalog status' });
    expect(within(banner).getByText('Checking CIS catalog')).toBeInTheDocument();
    expect(stepHeadings()).toEqual([
      'Step 1: Download CIS baselines',
      'Step 2: Import the CIS baseline files',
      'Step 3: Re-check catalog',
    ]);
  });

  it('shows the unavailable banner with supported file guidance', async () => {
    renderPage();

    const banner = await screen.findByRole('alert', { name: 'CIS catalog status' });
    expect(within(banner).getByText('No CIS data found')).toBeInTheDocument();
    expect(banner).toHaveTextContent('Azure Policy CIS baseline JSON');
    expect(banner).toHaveTextContent('XCCDF + OVAL XML');
    expect(banner).toHaveTextContent('Re-check catalog');
    expect(screen.getByRole('button', { name: 'Re-check catalog' })).toBeEnabled();
  });

  it('renders schema details as text in the banner and Step 3 diagnostics', async () => {
    const schemaError = '<script>alert("not executable")</script> is not a recognized schema.';
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      schemaError,
    });

    renderPage();

    expect(await screen.findAllByText(schemaError)).toHaveLength(2);
    expect(document.querySelector('script')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Catalog diagnostics' })).toBeInTheDocument();
  });

  it('lists a loaded Azure Policy catalog using reported metadata', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: true,
      source: 'xccdf',
      azurePolicyCisFiles: [azureCatalog],
    });

    renderPage();

    const banner = await screen.findByRole('status', { name: 'CIS catalog status' });
    expect(within(banner).getByText('CIS data found')).toBeInTheDocument();
    const detected = screen.getByRole('region', { name: 'Detected CIS catalogs' });
    expect(detected).toHaveTextContent('Azure Policy');
    expect(detected).toHaveTextContent('CIS Windows Server 2025');
    expect(detected).toHaveTextContent('Version 3.0.0');
    expect(detected).toHaveTextContent('42 rules');
    expect(detected).toHaveTextContent('Windows');
  });

  it('identifies an XCCDF catalog without an OVAL companion', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: true,
      source: 'xccdf',
      xccdfFiles: [xccdfCatalog],
    });

    renderPage();

    const banner = await screen.findByRole('status', { name: 'CIS catalog status' });
    expect(banner).toHaveTextContent('CIS files detected — setup incomplete');
    expect(banner).not.toHaveTextContent('CIS data found');
    const detected = await screen.findByRole('region', { name: 'Detected CIS catalogs' });
    expect(detected).toHaveTextContent('XCCDF');
    expect(detected).toHaveTextContent('CIS Ubuntu Linux 24.04 Benchmark');
    expect(detected).toHaveTextContent('Version 1.0.0');
    expect(detected).toHaveTextContent('Linux');
    expect(detected).toHaveTextContent('OVAL companion not found');
    expect(detected).toHaveTextContent(
      'not yet usable for editor cross-references or Diff',
    );
  });

  it('keeps a zero-rule Azure catalog visible without claiming it is usable', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: true,
      source: 'xccdf',
      azurePolicyCisFiles: [{ ...azureCatalog, ruleCount: 0 }],
    });

    renderPage();

    expect(
      await screen.findByText('CIS files detected — setup incomplete'),
    ).toBeInTheDocument();
    const detected = screen.getByRole('region', { name: 'Detected CIS catalogs' });
    expect(detected).toHaveTextContent('No usable rules detected');
    expect(detected).toHaveTextContent('0 rules');
  });

  it('lists every Azure Policy and XCCDF catalog in a mixed loaded state', async () => {
    const secondAzure = {
      ...azureCatalog,
      filename: 'azure-policy-cis-linux.json',
      platform: 'linux' as const,
      benchmarkName: 'CIS Ubuntu Linux 24.04',
      benchmarkVersion: '2.0.0',
      ruleCount: 75,
    };
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: true,
      source: 'xccdf',
      azurePolicyCisFiles: [azureCatalog, secondAzure],
      xccdfFiles: [{ ...xccdfCatalog, hasOval: true }],
    });

    renderPage();

    expect(await screen.findByText('CIS data found')).toBeInTheDocument();
    const detected = await screen.findByRole('region', { name: 'Detected CIS catalogs' });
    expect(within(detected).getAllByRole('listitem')).toHaveLength(3);
    expect(detected).toHaveTextContent('CIS Windows Server 2025');
    expect(detected).toHaveTextContent('CIS Ubuntu Linux 24.04');
    expect(detected).toHaveTextContent('CIS Ubuntu Linux 24.04 Benchmark');
    expect(detected).toHaveTextContent('OVAL companion found');
  });

  it('reports a mixed usable and unusable catalog set as partially ready', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: true,
      source: 'xccdf',
      azurePolicyCisFiles: [azureCatalog],
      xccdfFiles: [xccdfCatalog],
    });

    renderPage();

    expect(await screen.findByText('CIS data partially ready')).toBeInTheDocument();
    const detected = screen.getByRole('region', { name: 'Detected CIS catalogs' });
    expect(detected).toHaveTextContent('Some detected catalogs are ready');
    expect(detected).toHaveTextContent('OVAL companion not found');
  });

  it('does not treat legacy mappings without a rule catalog as fully usable', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: true,
      source: 'json',
      legacyMappingsLoaded: true,
      legacyRuleCatalogCount: 0,
      files: [
        {
          name: 'cis-mappings.json',
          present: true,
          required: true,
          description: 'Global mappings',
        },
        {
          name: 'cis-ws2025-rules.json',
          present: false,
          required: false,
          description: 'Rules',
        },
      ],
    });

    renderPage();

    expect(
      await screen.findByText('CIS files detected — setup incomplete'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detected CIS catalogs' })).toHaveTextContent(
      'add at least one valid per-OS rule catalog',
    );
  });

  it('shows that mappings are missing when only legacy rule catalogs are valid', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: false,
      legacyMappingsLoaded: false,
      legacyRuleCatalogCount: 1,
    });

    renderPage();

    expect(
      await screen.findByText('CIS files detected — setup incomplete'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'CIS catalog status' })).toHaveTextContent(
      'requires a valid cis-mappings.json',
    );
    expect(screen.getByRole('region', { name: 'Detected CIS catalogs' })).toHaveTextContent(
      'cis-mappings.json is missing or invalid',
    );
  });

  it('treats a present legacy rule catalog as usable', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      available: true,
      source: 'json',
      legacyMappingsLoaded: true,
      legacyRuleCatalogCount: 1,
      files: [
        {
          name: 'cis-mappings.json',
          present: true,
          required: true,
          description: 'Global mappings',
        },
        {
          name: 'cis-ws2025-rules.json',
          present: true,
          required: false,
          description: 'Rules',
        },
      ],
    });

    renderPage();

    expect(await screen.findByText('CIS data found')).toBeInTheDocument();
  });

  it('rechecks in place, invalidates the availability cache, and preserves step order', async () => {
    const user = userEvent.setup();
    const nextStatus = deferred<CisStatus>();
    vi.mocked(window.cfs!.cis.recheck).mockReturnValue(nextStatus.promise);
    renderPage();

    await screen.findByText('No CIS data found');
    const before = stepHeadings();
    await user.click(screen.getByRole('button', { name: 'Re-check catalog' }));

    expect(screen.getByRole('button', { name: 'Re-checking catalog…' })).toBeDisabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await act(async () => {
      nextStatus.resolve({
        ...unavailableStatus,
        available: true,
        source: 'xccdf',
        azurePolicyCisFiles: [azureCatalog],
      });
      await nextStatus.promise;
    });

    expect(await screen.findByText('CIS data found')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detected CIS catalogs' })).toHaveTextContent(
      'CIS Windows Server 2025',
    );
    expect(_resetCisAvailableCacheForTests).toHaveBeenCalledTimes(1);
    expect(stepHeadings()).toEqual(before);
  });

  it('keeps recovery actions visible when the status API fails without a data directory', async () => {
    vi.mocked(window.cfs!.cis.status).mockRejectedValue(new Error('Status service unavailable'));

    renderPage();

    expect(await screen.findByText('No CIS data found')).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Catalog action failed' })).toHaveTextContent(
      'Status service unavailable',
    );
    expect(screen.getByText('The data folder path is unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Re-check catalog' })).toBeEnabled();
  });

  it('copies the full path and opens the data folder through IPC', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const nextPath = 'C:\\A very long folder name\\ConfigForge\\cis\\_data';
    vi.mocked(window.cfs!.cis.revealDataDir).mockResolvedValue({ ok: true, path: nextPath });
    renderPage();

    await screen.findByText(DATA_DIR);
    fireEvent.click(screen.getByRole('button', { name: 'Copy data folder path' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(DATA_DIR);
    });
    expect(await screen.findByRole('button', { name: 'Path copied' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(window.cfs!.cis.revealDataDir).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(`Opened data folder: ${nextPath}`)).toBeInTheDocument();
    expect(screen.getByText(nextPath)).toBeInTheDocument();
  });

  it('keeps unexpected-file and did-you-mean guidance inside Step 3', async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      ...unavailableStatus,
      unexpectedFiles: [
        {
          name: 'cis-mapping.json',
          didYouMean: 'cis-mappings.json',
        },
      ],
    });

    renderPage();

    const stepThree = await screen.findByRole('region', { name: 'Step 3: Re-check catalog' });
    expect(stepThree).toHaveTextContent('Unrecognized files');
    expect(stepThree).toHaveTextContent('cis-mapping.json');
    expect(stepThree).toHaveTextContent('Did you mean cis-mappings.json?');
  });
});
