// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getI18n } from '../../locales';

const sampleYaml = `resources:\n  - name: PasswordPolicy\n    type: Microsoft.Windows/Registry\n    properties:\n      keyPath: HKLM:\\Software\\Example\n`;

vi.mock('../../components/manifest-editor', () => ({
  ManifestEditor: ({ value }: { value: string }) => (
    <pre data-testid="mock-monaco-model">{value}</pre>
  ),
}));

vi.mock('../../components/use-cis-available', () => ({
  useCisAvailable: () => false,
}));

vi.mock('../../hooks/useCliPresence', () => ({
  useCliPresence: () => ({ installed: true, loading: false, version: '1.3.9-preview11' }),
}));

vi.mock('../../components/use-rationale-prompt', () => ({
  useRationalePrompt: () => ({
    state: { open: false, busy: false },
    requestSave: vi.fn(),
    submitReason: vi.fn(),
    skip: vi.fn(),
    cancel: vi.fn(),
  }),
  RationalePromptModal: () => null,
}));

vi.mock('./state/useManifestEditorState', () => ({
  useManifestEditorState: () => ({
    manifest: {
      Name: 'sample',
      Source: 'Local',
      Platform: 'windows',
      Resources: [
        { name: 'PasswordPolicy', type: 'Microsoft.Windows/Registry', properties: {} },
      ],
    },
    setManifest: vi.fn(),
    status: { name: 'sample', resources: [] },
    setStatus: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
    error: null,
    setError: vi.fn(),
    manifestNameRef: { current: 'sample' },
    fetchData: vi.fn().mockResolvedValue(undefined),
    editing: false,
    setEditing: vi.fn(),
    beginEditing: vi.fn(),
    cancelEditing: vi.fn(),
    editedContent: sampleYaml,
    setEditedContent: vi.fn(),
    savedContent: sampleYaml,
    setSavedContent: vi.fn(),
    editView: 'editor',
    setEditView: vi.fn(),
    saving: false,
    setSaving: vi.fn(),
    activeFormat: 'yaml',
    setActiveFormat: vi.fn(),
    formatLoading: false,
    setFormatLoading: vi.fn(),
    formatCache: { current: { yaml: sampleYaml } },
    fetchFormatContent: vi.fn().mockResolvedValue(sampleYaml),
    handleFormatChange: vi.fn().mockResolvedValue(undefined),
    isEditable: true,
    isReadOnly: true,
    currentDisplayContent: sampleYaml,
    hasUnsavedChanges: false,
  }),
}));

vi.mock('./state/useDeployFlow', () => ({
  useDeployFlow: () => ({
    deploying: false,
    deployProgress: null,
    deployResult: null,
    setDeployResult: vi.fn(),
    deployMenuOpen: false,
    setDeployMenuOpen: vi.fn(),
    reverting: false,
    cliGateFeature: null,
    setCliGateFeature: vi.fn(),
    deployJobIdRef: { current: null },
    handleDeploy: vi.fn(),
    handleRevert: vi.fn(),
  }),
}));

import { ManifestDetailPage } from './index';

function renderEditor() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/manifests/sample']}>
        <Routes>
          <Route path="/manifests/:id" element={<ManifestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe('ManifestDetailPage localization', () => {
  beforeEach(async () => {
    await getI18n().changeLanguage('en');
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('renders the editor chrome after a language switch without crashing', async () => {
    const i18n = getI18n();
    const { rerender } = renderEditor();

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/manifests/sample']}>
          <Routes>
            <Route path="/manifests/:id" element={<ManifestDetailPage />} />
          </Routes>
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déployer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Baseline Contenu' })).toBeInTheDocument();
  });

  it('keeps the Monaco model content stable while app chrome re-renders on language switch', async () => {
    const i18n = getI18n();
    const { rerender } = renderEditor();

    expect(screen.getByTestId('mock-monaco-model')).toHaveTextContent('PasswordPolicy');
    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument();

    await i18n.changeLanguage('fr');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/manifests/sample']}>
          <Routes>
            <Route path="/manifests/:id" element={<ManifestDetailPage />} />
          </Routes>
        </MemoryRouter>
      </FluentProvider>,
    );

    expect(screen.getByTestId('mock-monaco-model')).toHaveTextContent('PasswordPolicy');
    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MOF' })).toBeInTheDocument();
  });
});
