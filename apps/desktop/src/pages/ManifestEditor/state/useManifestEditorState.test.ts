// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase B.1 — unit tests for `useManifestEditorState`.
 *
 * These tests are the SAFETY NET we add before any visual extraction
 * touches the gnarly state-management contract. The hook owns three
 * race / lifecycle invariants that previous regressions have ALREADY
 * paid for — they are NOT theoretical:
 *
 *   1. `fetchToken` race-guard (v0.1.13). Rapid manifest URL switches
 *      must NOT let a slow earlier fetch write into the new manifest's
 *      state. Without the guard, the renderer would briefly show the
 *      wrong manifest's resources.
 *
 *   2. Per-fetch rejection logging (v0.1.11). Each of the three
 *      Promise.allSettled branches must emit a console.error if it
 *      rejects, so the user-visible "empty compliance table" symptom
 *      is always traceable in DevTools.
 *
 *   3. Format-cache seeding. The YAML fetch result must populate
 *      `formatCache.current.yaml`, set `editedContent`, AND set
 *      `savedContent` so the unsaved-changes guard doesn't fire on
 *      a fresh load.
 *
 * Any future refactor that breaks one of these MUST fail the
 * matching test, not the user.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useManifestEditorState } from './useManifestEditorState';

// ── window.cfs stub helpers ─────────────────────────────────────────
//
// `vitest.setup.ts` installs a baseline stub with platform/update/etc.
// but does NOT include manifests/exportChannel. We extend per-suite
// because each test wants to control resolve order / rejection.

type Resolver<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };

function deferred<T>(): Promise<T> & Resolver<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return Object.assign(promise, { resolve, reject });
}

function installCfsMocks(overrides?: Partial<{
  get: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  exportGet: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
}>) {
  const get = overrides?.get ?? vi.fn();
  const getSource = overrides?.getSource ?? vi.fn();
  const exportGet = overrides?.exportGet ?? vi.fn();
  const status = overrides?.status ?? vi.fn();

  // Default happy path — concrete manifests / yaml / status responses.
  if (!overrides?.get) {
    get.mockResolvedValue({
      data: {
        Name: 'sample',
        Source: 'user',
        Resources: [
          {
            name: 'PasswordPolicy',
            type: 'Microsoft.Windows/Registry',
            properties: {},
          },
        ],
      },
    });
  }
  if (!overrides?.getSource) {
    getSource.mockResolvedValue({ data: 'resources: []\n' });
  }
  if (!overrides?.exportGet) {
    exportGet.mockResolvedValue({ body: 'resources: []\n' });
  }
  if (!overrides?.status) {
    status.mockResolvedValue({
      data: { name: 'sample', resources: [] },
    });
  }

  Object.assign(window.cfs as Record<string, unknown>, {
    manifests: {
      get,
      getSource,
      status,
    },
    exportChannel: { get: exportGet },
  });

  return { get, getSource, exportGet, status };
}

beforeEach(() => {
  // Clear any prior namespace pollution between tests.
  delete (window.cfs as Record<string, unknown>).manifests;
  delete (window.cfs as Record<string, unknown>).exportChannel;
  // Also clear the sessionStorage cache the hook touches.
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  delete (window.cfs as Record<string, unknown>).manifests;
  delete (window.cfs as Record<string, unknown>).exportChannel;
});

// ── Happy-path load ─────────────────────────────────────────────────

describe('useManifestEditorState — happy-path load', () => {
  it('populates manifest, yaml content, status, and clears loading', async () => {
    installCfsMocks();

    const { result } = renderHook(() => useManifestEditorState('sample'));

    // Initial: loading=true, nothing else set
    expect(result.current.loading).toBe(true);
    expect(result.current.manifest).toBeNull();
    expect(result.current.editedContent).toBe('');

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // After fetch: manifest + status set, yaml seeded into both
    // `editedContent` and `savedContent` so the unsaved-changes guard
    // doesn't fire on fresh load.
    expect(result.current.manifest?.Name).toBe('sample');
    expect(result.current.status?.resources).toEqual([]);
    expect(result.current.editedContent).toBe('resources: []\n');
    expect(result.current.savedContent).toBe('resources: []\n');
    expect(result.current.formatCache.current.yaml).toBe('resources: []\n');
    expect(result.current.activeFormat).toBe('yaml');
    expect(result.current.error).toBeNull();
  });

  it('starts in non-editing read-only mode with isEditable=true for yaml', async () => {
    installCfsMocks();
    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.editing).toBe(false);
    expect(result.current.isEditable).toBe(true); // yaml is editable
    expect(result.current.isReadOnly).toBe(true); // but editing is false
    expect(result.current.hasUnsavedChanges).toBe(false);
  });
});

// ── fetchToken race-guard (v0.1.13) ────────────────────────────────

describe('useManifestEditorState — fetchToken race-guard (v0.1.13)', () => {
  it('drops stale fetch results when the manifest URL switches mid-flight', async () => {
    // Set up the FIRST manifest's fetch to be SLOW (held by a deferred).
    const slowGet = deferred<{ data: { Name: string; Source: string; Resources: never[] } }>();
    const slowYaml = deferred<{ body: string }>();
    const slowStatus = deferred<{ data: { name: string; resources: never[] } }>();

    const get = vi.fn();
    const exportGet = vi.fn();
    const status = vi.fn();

    // Track which manifest each call is for so we can resolve in
    // a specific order.
    let callIndex = 0;
    get.mockImplementation((name: string) => {
      callIndex++;
      if (name === 'first') return slowGet;
      // Fast path for "second" — resolves immediately.
      return Promise.resolve({
        data: { Name: 'second', Source: 'user', Resources: [] },
      });
    });
    exportGet.mockImplementation(({ name }: { name: string }) => {
      if (name === 'first') return slowYaml;
      return Promise.resolve({ body: 'second-yaml\n' });
    });
    status.mockImplementation((name: string) => {
      if (name === 'first') return slowStatus;
      return Promise.resolve({ data: { name: 'second', resources: [] } });
    });

    installCfsMocks({ get, exportGet, status });

    // Render with 'first', then immediately rerender with 'second'.
    const { result, rerender } = renderHook(
      ({ name }) => useManifestEditorState(name),
      { initialProps: { name: 'first' } },
    );

    // Switch to second BEFORE the slow fetch resolves.
    rerender({ name: 'second' });

    // Wait for the fast 'second' fetch to settle.
    await waitFor(() => {
      expect(result.current.manifest?.Name).toBe('second');
    });
    expect(result.current.editedContent).toBe('second-yaml\n');

    // Now resolve the slow 'first' fetch. The race-guard MUST drop
    // these results — they should NOT overwrite 'second' state.
    await act(async () => {
      slowGet.resolve({
        data: { Name: 'first', Source: 'user', Resources: [] },
      });
      slowYaml.resolve({ body: 'first-yaml\n' });
      slowStatus.resolve({ data: { name: 'first', resources: [] } });
      // Give microtasks a tick to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    // CRITICAL invariant: state is still 'second', not 'first'.
    expect(result.current.manifest?.Name).toBe('second');
    expect(result.current.editedContent).toBe('second-yaml\n');
    expect(result.current.loading).toBe(false);
    void callIndex;
  });

  it('clears manifest A immediately when manifest B YAML fails to load', async () => {
    const exportGet = vi.fn(({ name }: { name: string }) =>
      name === 'first'
        ? Promise.resolve({ body: 'first-yaml\n' })
        : Promise.reject(new Error('second YAML unavailable')),
    );
    const get = vi.fn((name: string) =>
      Promise.resolve({ data: { Name: name, Source: 'user', Resources: [] } }),
    );
    const status = vi.fn((name: string) =>
      Promise.resolve({ data: { name, resources: [] } }),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    installCfsMocks({ get, exportGet, status });

    const { result, rerender } = renderHook(
      ({ name }) => useManifestEditorState(name),
      { initialProps: { name: 'first' } },
    );
    await waitFor(() => expect(result.current.editedContent).toBe('first-yaml\n'));

    rerender({ name: 'second' });
    await waitFor(() => expect(result.current.error).toContain('second YAML unavailable'));

    expect(result.current.loading).toBe(false);
    expect(result.current.manifest?.Name).toBe('second');
    expect(result.current.editedContent).toBe('');
    expect(result.current.savedContent).toBe('');
    expect(result.current.formatCache.current).toEqual({});
    expect(result.current.isEditable).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('uses a monotonic generation guard for A → B → A navigation', async () => {
    const oldA = deferred<{ body: string }>();
    const slowB = deferred<{ body: string }>();
    let aCalls = 0;
    const exportGet = vi.fn(({ name }: { name: string }) => {
      if (name === 'first') {
        aCalls += 1;
        return aCalls === 1 ? oldA : Promise.resolve({ body: 'new-a-yaml\n' });
      }
      return slowB;
    });
    const get = vi.fn((name: string) =>
      Promise.resolve({ data: { Name: name, Source: 'user', Resources: [] } }),
    );
    const status = vi.fn((name: string) =>
      Promise.resolve({ data: { name, resources: [] } }),
    );
    installCfsMocks({ get, exportGet, status });

    const { result, rerender } = renderHook(
      ({ name }) => useManifestEditorState(name),
      { initialProps: { name: 'first' } },
    );
    rerender({ name: 'second' });
    rerender({ name: 'first' });

    await waitFor(() => expect(result.current.editedContent).toBe('new-a-yaml\n'));

    await act(async () => {
      oldA.resolve({ body: 'stale-a-yaml\n' });
      slowB.resolve({ body: 'stale-b-yaml\n' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.manifest?.Name).toBe('first');
    expect(result.current.editedContent).toBe('new-a-yaml\n');
    expect(result.current.savedContent).toBe('new-a-yaml\n');
  });

  it('ignores a stale A refresh callback after navigation to B', async () => {
    const get = vi.fn((name: string) =>
      Promise.resolve({ data: { Name: name, Source: 'user', Resources: [] } }),
    );
    const exportGet = vi.fn(({ name }: { name: string }) =>
      Promise.resolve({ body: `${name}-yaml\n` }),
    );
    const status = vi.fn((name: string) =>
      Promise.resolve({ data: { name, resources: [] } }),
    );
    installCfsMocks({ get, exportGet, status });

    const { result, rerender } = renderHook(
      ({ name }) => useManifestEditorState(name),
      { initialProps: { name: 'first' } },
    );
    await waitFor(() => expect(result.current.editedContent).toBe('first-yaml\n'));
    const staleFirstRefresh = result.current.fetchData;

    rerender({ name: 'second' });
    await act(async () => {
      await staleFirstRefresh();
    });
    await waitFor(() => expect(result.current.editedContent).toBe('second-yaml\n'));

    expect(result.current.manifest?.Name).toBe('second');
    expect(result.current.loading).toBe(false);
  });
});

// ── Rejection-path logging (v0.1.11) ───────────────────────────────

describe('useManifestEditorState — rejection logging (v0.1.11)', () => {
  it('console.errors when cfs.manifests.get rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const get = vi.fn().mockRejectedValue(new Error('IPC down'));
    installCfsMocks({ get });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('cfs.manifests.get failed'),
      expect.anything(),
    );
    // Manifest stays null but the load completes — partial failure is
    // intentional; the YAML/status branches may still succeed.
    expect(result.current.manifest).toBeNull();
  });

  it('console.errors when cfs.exportChannel.get rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exportGet = vi.fn().mockRejectedValue(new Error('yaml read failed'));
    installCfsMocks({ exportGet });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('cfs.exportChannel.get(yaml) failed'),
      expect.anything(),
    );
    expect(result.current.editedContent).toBe('');
  });

  it('console.errors when cfs.manifests.status rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const status = vi.fn().mockRejectedValue(new Error('status down'));
    installCfsMocks({ status });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('cfs.manifests.status failed'),
      expect.anything(),
    );
  });

  it('falls back to sessionStorage compliance cache when status rejects', async () => {
    const cached = {
      name: 'sample',
      resources: [
        { name: 'CachedRule', type: 'Microsoft.Windows/Registry', properties: {} },
      ],
    };
    sessionStorage.setItem('configforge-compliance-sample', JSON.stringify(cached));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const status = vi.fn().mockRejectedValue(new Error('status down'));
    installCfsMocks({ status });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status?.resources?.[0]?.name).toBe('CachedRule');
    expect(errSpy).toHaveBeenCalled();
  });
});

// ── Edit lifecycle ─────────────────────────────────────────────────

describe('useManifestEditorState — edit lifecycle', () => {
  it('hasUnsavedChanges flips when editedContent diverges from the edit baseline', async () => {
    installCfsMocks();
    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Fresh load: editedContent equals the persisted format baseline.
    expect(result.current.hasUnsavedChanges).toBe(false);

    // Enter edit mode but don't change anything yet.
    act(() => {
      result.current.beginEditing();
    });
    expect(result.current.hasUnsavedChanges).toBe(false);

    // Modify edited content.
    act(() => {
      result.current.setEditedContent('resources:\n  - name: new\n');
    });
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it('beginEditing establishes a per-format baseline and Cancel restores it', async () => {
    installCfsMocks();
    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.beginEditing();
      result.current.setEditedContent('resources:\n  - name: changed\n');
    });
    expect(result.current.hasUnsavedChanges).toBe(true);

    act(() => {
      result.current.cancelEditing();
    });
    expect(result.current.editing).toBe(false);
    expect(result.current.editedContent).toBe('resources: []\n');
    expect(result.current.formatCache.current.yaml).toBe('resources: []\n');
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('does NOT flag unsaved changes when not editing, even if editedContent differs', async () => {
    installCfsMocks();
    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEditedContent('different');
    });
    // editing is still false (read-only view) — no nag on navigation
    expect(result.current.hasUnsavedChanges).toBe(false);
  });
});

// ── Format tabs ────────────────────────────────────────────────────

describe('useManifestEditorState — format tabs', () => {
  it('switching to a new format calls cfs.exportChannel.get and caches the result', async () => {
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: 'resources: []\n' }); // initial yaml
    exportGet.mockResolvedValueOnce({ body: '{"resources":[]}' }); // json
    installCfsMocks({ exportGet });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeFormat).toBe('yaml');
    expect(exportGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.handleFormatChange('json');
    });

    expect(result.current.activeFormat).toBe('json');
    expect(result.current.editedContent).toBe('{"resources":[]}');
    expect(exportGet).toHaveBeenCalledTimes(2);
  });

  it('switching back to a cached format does not re-fetch', async () => {
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: 'resources: []\n' });
    exportGet.mockResolvedValueOnce({ body: '{"resources":[]}' });
    installCfsMocks({ exportGet });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleFormatChange('json');
    });
    expect(exportGet).toHaveBeenCalledTimes(2);

    // Switch back to yaml — already cached.
    await act(async () => {
      await result.current.handleFormatChange('yaml');
    });

    expect(result.current.activeFormat).toBe('yaml');
    expect(exportGet).toHaveBeenCalledTimes(2); // no new call
  });

  it('isEditable is false on the MOF tab', async () => {
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: 'resources: []\n' });
    exportGet.mockResolvedValueOnce({ body: 'instance of MyClass {}' });
    installCfsMocks({ exportGet });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleFormatChange('mof');
    });

    expect(result.current.activeFormat).toBe('mof');
    expect(result.current.isEditable).toBe(false);
  });

  it('enters Visual editing from MOF using authoritative cached YAML without dropping other caches', async () => {
    const yamlSource = 'resources:\n  - name: Canonical YAML\n';
    const jsonSource = '{"resources":[{"name":"Canonical YAML"}]}';
    const mofSource = 'instance of Canonical_YAML {}';
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: yamlSource });
    exportGet.mockResolvedValueOnce({ body: jsonSource });
    exportGet.mockResolvedValueOnce({ body: mofSource });
    installCfsMocks({ exportGet });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.handleFormatChange('json');
    });
    await act(async () => {
      await result.current.handleFormatChange('mof');
    });

    expect(result.current.activeFormat).toBe('mof');
    expect(result.current.isEditable).toBe(false);

    act(() => {
      result.current.beginEditing('visual');
    });

    expect(result.current.editing).toBe(true);
    expect(result.current.editView).toBe('visual');
    expect(result.current.activeFormat).toBe('yaml');
    expect(result.current.editedContent).toBe(yamlSource);
    expect(result.current.savedContent).toBe(yamlSource);
    expect(result.current.formatCache.current).toEqual({
      yaml: yamlSource,
      json: jsonSource,
      mof: mofSource,
    });
    expect(result.current.isEditable).toBe(true);
    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('does not let an in-flight MOF fetch overwrite a Visual edit session', async () => {
    const yamlSource = 'resources:\n  - name: Canonical YAML\n';
    const mofSource = 'instance of Late_Mof {}';
    const pendingMof = deferred<{ body: string }>();
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: yamlSource });
    exportGet.mockReturnValueOnce(pendingMof);
    installCfsMocks({ exportGet });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let formatChange!: Promise<void>;
    act(() => {
      formatChange = result.current.handleFormatChange('mof');
    });
    await waitFor(() => expect(result.current.formatLoading).toBe(true));

    act(() => {
      result.current.beginEditing('visual');
    });
    expect(result.current.editing).toBe(true);
    expect(result.current.editView).toBe('visual');
    expect(result.current.activeFormat).toBe('yaml');
    expect(result.current.editedContent).toBe(yamlSource);

    await act(async () => {
      pendingMof.resolve({ body: mofSource });
      await formatChange;
    });

    expect(result.current.editing).toBe(true);
    expect(result.current.editView).toBe('visual');
    expect(result.current.activeFormat).toBe('yaml');
    expect(result.current.editedContent).toBe(yamlSource);
    expect(result.current.formatCache.current).toEqual({
      yaml: yamlSource,
      mof: mofSource,
    });
    expect(result.current.formatLoading).toBe(false);
    expect(result.current.isEditable).toBe(true);
    expect(result.current.isReadOnly).toBe(false);
  });

  it('does not switch to a persisted derived format during an edit session', async () => {
    const exportGet = vi.fn().mockResolvedValue({ body: 'resources: []\n' });
    installCfsMocks({ exportGet });
    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.beginEditing();
      result.current.setEditedContent('resources:\n  - name: dirty\n');
    });
    await act(async () => {
      await result.current.handleFormatChange('json');
    });

    expect(result.current.activeFormat).toBe('yaml');
    expect(result.current.editedContent).toContain('dirty');
    expect(exportGet).toHaveBeenCalledTimes(1);
  });

  it('keeps the current tab active when a derived-format load fails', async () => {
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: 'resources: []\n' });
    exportGet.mockRejectedValueOnce(new Error('JSON export failed'));
    installCfsMocks({ exportGet });
    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleFormatChange('json');
    });

    expect(result.current.activeFormat).toBe('yaml');
    expect(result.current.editedContent).toBe('resources: []\n');
    expect(result.current.formatCache.current.json).toBeUndefined();
    expect(result.current.error).toContain('JSON export failed');
  });

  it('does not mark an untouched JSON edit session dirty', async () => {
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: 'resources: []\n' });
    exportGet.mockResolvedValueOnce({ body: '{"resources":[]}' });
    installCfsMocks({ exportGet });
    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleFormatChange('json');
    });
    act(() => {
      result.current.beginEditing();
    });

    expect(result.current.editing).toBe(true);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });
});

// ── fetchData refresh ──────────────────────────────────────────────

describe('useManifestEditorState — fetchData re-fetch', () => {
  it('exposed fetchData re-runs the load (for use after save)', async () => {
    const get = vi.fn();
    get.mockResolvedValueOnce({
      data: { Name: 'sample', Source: 'user', Resources: [] },
    });
    get.mockResolvedValueOnce({
      data: { Name: 'sample', Source: 'user', Resources: [
        { name: 'After', type: 'Microsoft.Windows/Registry', properties: {} },
      ] },
    });
    installCfsMocks({ get });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.manifest?.Resources).toEqual([]);

    await act(async () => {
      await result.current.fetchData();
    });

    expect(result.current.manifest?.Resources).toHaveLength(1);
    expect(result.current.manifest?.Resources?.[0]?.name).toBe('After');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('retains submitted same-manifest content when post-save YAML re-read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exportGet = vi.fn();
    exportGet.mockResolvedValueOnce({ body: 'resources: []\n' });
    exportGet.mockRejectedValueOnce(new Error('post-save read failed'));
    installCfsMocks({ exportGet });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.formatCache.current = { yaml: 'resources:\n  - name: submitted\n' };
      result.current.setEditedContent('resources:\n  - name: submitted\n');
      result.current.setSavedContent('resources:\n  - name: submitted\n');
      result.current.setEditing(false);
    });
    await act(async () => {
      await result.current.fetchData();
    });

    expect(result.current.error).toContain('post-save read failed');
    expect(result.current.editedContent).toContain('submitted');
    expect(result.current.currentDisplayContent).toContain('submitted');
    expect(result.current.isEditable).toBe(true);
  });

  it('replaces stale buffers only after a canonical source reload succeeds', async () => {
    const canonicalSource = deferred<{ data: string }>();
    const getSource = vi.fn().mockReturnValue(canonicalSource);
    installCfsMocks({ getSource });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.formatCache.current = { yaml: 'resources:\n  - name: stale\n' };
      result.current.setEditedContent('resources:\n  - name: stale\n');
      result.current.setSavedContent('resources:\n  - name: stale\n');
    });

    let reload!: Promise<void>;
    act(() => {
      reload = result.current.reloadCanonicalSource();
    });

    await waitFor(() => {
      expect(result.current.currentDisplayContent).toBe('');
      expect(result.current.editedContent).toBe('');
      expect(result.current.savedContent).toBe('');
      expect(result.current.isEditable).toBe(false);
    });

    await act(async () => {
      canonicalSource.resolve({ data: 'resources:\n  - name: restored\n' });
      await reload;
    });

    expect(result.current.currentDisplayContent).toContain('restored');
    expect(result.current.editedContent).toContain('restored');
    expect(result.current.savedContent).toContain('restored');
    expect(result.current.formatCache.current).toEqual({
      yaml: 'resources:\n  - name: restored\n',
    });
    expect(result.current.isEditable).toBe(true);
  });

  it('keeps stale buffers cleared when canonical source reload fails', async () => {
    const getSource = vi.fn().mockRejectedValue(new Error('canonical IPC unavailable'));
    installCfsMocks({ getSource });

    const { result } = renderHook(() => useManifestEditorState('sample'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.formatCache.current = { yaml: 'resources:\n  - name: stale\n' };
      result.current.setEditedContent('resources:\n  - name: stale\n');
      result.current.setSavedContent('resources:\n  - name: stale\n');
    });

    let reloadError: unknown;
    await act(async () => {
      try {
        await result.current.reloadCanonicalSource();
      } catch (err) {
        reloadError = err;
      }
    });

    expect(reloadError).toEqual(new Error('canonical IPC unavailable'));
    expect(result.current.currentDisplayContent).toBe('');
    expect(result.current.editedContent).toBe('');
    expect(result.current.savedContent).toBe('');
    expect(result.current.formatCache.current).toEqual({});
    expect(result.current.isEditable).toBe(false);
  });
});
