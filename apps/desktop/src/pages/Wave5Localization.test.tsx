// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getI18n } from '../locales';
import { LibraryPage } from './Library';
import { CisCatalogPage } from './CisCatalog';
import { AuditPackPage } from './ManifestAuditPack';

function withShell(ui: React.ReactElement, initialEntries = ['/']) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </FluentProvider>,
  );
}

describe('Wave 5 localization coverage', () => {
  beforeEach(async () => {
    await getI18n().changeLanguage('en');
    Object.assign(window.cfs!, {
      cis: {
        status: vi.fn().mockResolvedValue({
          available: true,
          source: 'xccdf',
          dataDir: 'C:\\repo\\public\\_baselines\\cis\\_data',
          xccdfFiles: [
            {
              filename: 'CIS_Microsoft_Windows_Server_2025_Benchmark-xccdf.xml',
              platform: 'windows',
              product: 'Windows Server',
              version: '3.0.0',
              title: 'CIS Microsoft Windows Server 2025 Benchmark',
              hasOval: true,
            },
          ],
          azurePolicyCisFiles: [
            {
              filename: 'azure-policy-cis-windows.json',
              platform: 'windows',
              benchmarkName: 'CIS Windows Server 2025',
              benchmarkVersion: '3.0.0',
              ruleCount: 42,
            },
          ],
          unexpectedFiles: [],
        }),
        recheck: vi.fn(),
        revealDataDir: vi.fn().mockResolvedValue({ path: 'C:\\repo\\public\\_baselines\\cis\\_data' }),
      },
      manifests: {
        get: vi.fn().mockResolvedValue({
          data: {
            Name: 'secure-baseline',
            DisplayName: 'Secure Baseline',
            Platform: 'windows',
          },
        }),
      },
      history: { list: vi.fn().mockResolvedValue({ data: [{}] }) },
      rationale: { list: vi.fn().mockResolvedValue({ entries: [] }) },
      auditResults: { get: vi.fn().mockResolvedValue({ snapshot: null }) },
      auditPack: { save: vi.fn().mockResolvedValue({ ok: true }) },
    });
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('renders the baseline library and survives a language switch', async () => {
    const i18n = getI18n();
    const { rerender } = withShell(<LibraryPage />);

    expect(screen.getByRole('heading', { name: 'Microsoft Baselines' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <LibraryPage />
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Microsoft Baselines' })).toBeInTheDocument();
  });

  it('keeps CIS benchmark data verbatim when the UI language changes', async () => {
    const i18n = getI18n();
    const { rerender } = withShell(<CisCatalogPage />);

    expect(await screen.findByText('CIS Microsoft Windows Server 2025 Benchmark')).toBeInTheDocument();
    expect(screen.getByText(/CIS Windows Server 2025/)).toBeInTheDocument();

    await i18n.changeLanguage('de');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <CisCatalogPage />
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(await screen.findByText('CIS Microsoft Windows Server 2025 Benchmark')).toBeInTheDocument();
    expect(screen.getByText(/CIS Windows Server 2025/)).toBeInTheDocument();
  });

  it('keeps "a CIS tab" / "the Diff page" as separate words in the CIS Mapping intro', async () => {
    // The intro sentence is split across <span> wrappers for the "CIS" and
    // "Diff" emphasis; JSX previously dropped the whitespace at those joins so
    // it rendered as "aCIStab" / "theDiffpage". Pin the spacing.
    withShell(<CisCatalogPage />);
    const intro = await screen.findByText(
      (_content, el) => el?.tagName === 'P' && /Once CIS data is loaded/.test(el.textContent ?? ''),
    );
    expect(intro).toHaveTextContent('a CIS tab will also be available on the Diff page');
  });

  it('keeps the detailed CIS import guidance spaced across emphasized labels', async () => {
    withShell(<CisCatalogPage />);
    const guidance = await screen.findByRole('note', { name: 'CIS file import guidance' });
    expect(guidance).toHaveTextContent(
      'Azure Policy JSON: Keep downloaded JSON files as-is.',
    );
    expect(guidance).toHaveTextContent(
      'XCCDF + OVAL: Keep each *-xccdf.xml beside its matching *-oval.xml companion.',
    );
  });

  it('keeps the audit-pack PDF preview identity English across language switches', async () => {
    const i18n = getI18n();
    const { rerender } = withShell(
      <Routes>
        <Route path="/manifests/:id/audit-pack" element={<AuditPackPage />} />
      </Routes>,
      ['/manifests/secure-baseline/audit-pack?against=cis-ws2025-ms'],
    );

    await waitFor(() => expect(screen.getByTitle('Audit pack PDF preview for Secure Baseline')).toBeInTheDocument());

    await i18n.changeLanguage('es');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/manifests/secure-baseline/audit-pack?against=cis-ws2025-ms']}>
          <Routes>
            <Route path="/manifests/:id/audit-pack" element={<AuditPackPage />} />
          </Routes>
        </MemoryRouter>
      </FluentProvider>,
    );

    const preview = await screen.findByTitle('Audit pack PDF preview for Secure Baseline');
    expect(preview).toHaveAttribute('src', expect.stringContaining('format=pdf'));
    expect(preview).toHaveAttribute('src', expect.stringContaining('against=cis-ws2025-ms'));
  });
});
