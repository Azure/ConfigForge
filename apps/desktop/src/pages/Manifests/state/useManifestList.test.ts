// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase E.1 — unit tests for `useManifestList`.
 *
 * Locks in the v0.1.14 listTokenRef race-guard before any visual
 * refactor of the Manifests page touches the fetch flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useManifestList } from './useManifestList';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return Object.assign(p, { resolve, reject });
}

function installMocks(overrides?: { list?: ReturnType<typeof vi.fn> }) {
  const list = overrides?.list ?? vi.fn();
  if (!overrides?.list) {
    list.mockResolvedValue({
      data: [
        { Name: 'a', Source: 'user', Platform: 'windows', Resources: [] },
        { Name: 'b', Source: 'user', Platform: 'linux', Resources: [] },
      ],
    });
  }
  Object.assign(window.cfs as Record<string, unknown>, {
    manifests: { list },
  });
  return { list };
}

beforeEach(() => {
  delete (window.cfs as Record<string, unknown>).manifests;
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  delete (window.cfs as Record<string, unknown>).manifests;
});

describe('useManifestList — happy path', () => {
  it('fetches and populates manifests on mount', async () => {
    installMocks();
    const { result } = renderHook(() => useManifestList());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.manifests).toHaveLength(2);
    expect(result.current.manifests[0]?.Name).toBe('a');
    expect(result.current.error).toBeNull();
  });

  it('memoised platformByName has correct entries', async () => {
    installMocks();
    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.platformByName.get('a')).toBe('windows');
    expect(result.current.platformByName.get('b')).toBe('linux');
  });

  it('preserves deployment metadata used to enable Revert', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          Name: 'deployed',
          Source: 'user',
          Platform: 'windows',
          Resources: [],
          Deployed: true,
          LastAppliedAt: '2026-07-09T12:00:00.000Z',
        },
        {
          Name: 'never-deployed',
          Source: 'user',
          Platform: 'windows',
          Resources: [],
          Deployed: false,
          LastAppliedAt: null,
        },
      ],
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.manifests[0]).toMatchObject({
      Name: 'deployed',
      Deployed: true,
      LastAppliedAt: '2026-07-09T12:00:00.000Z',
    });
    expect(result.current.manifests[1]).toMatchObject({
      Name: 'never-deployed',
      Deployed: false,
      LastAppliedAt: null,
    });
  });

  it('normalizes LastModifiedAt, Validation, Compliance, and display metadata', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          Name: 'normalized',
          DisplayName: 'Normalized Baseline',
          Source: 'user',
          Platform: 'windows',
          ResourceCount: 12,
          Resources: [],
          RegisteredAt: '2026-07-14T10:00:00.000Z',
          LastModifiedAt: '2026-07-15T10:00:00.000Z',
          Validation: {
            hasSchema: true,
            hasEnforcementValues: true,
            hasComplianceCriteria: true,
            issues: ['Missing description'],
          },
          Compliance: {
            auditedAt: '2026-07-15T11:00:00.000Z',
            total: 12,
            compliant: 9,
            nonCompliant: 2,
            indeterminate: 1,
            errors: 0,
          },
        },
      ],
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.manifests[0]).toMatchObject({
      Name: 'normalized',
      DisplayName: 'Normalized Baseline',
      ResourceCount: 12,
      RegisteredAt: '2026-07-14T10:00:00.000Z',
      LastModifiedAt: '2026-07-15T10:00:00.000Z',
      Validation: { issues: ['Missing description'] },
      Compliance: { total: 12, compliant: 9 },
    });
  });

  it('uses the supported force option for an explicit refresh', async () => {
    const { list } = installMocks();
    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchManifests({ force: true });
    });

    expect(list).toHaveBeenNthCalledWith(1, {});
    expect(list).toHaveBeenNthCalledWith(2, { force: true });
  });
});

describe('useManifestList — listTokenRef race-guard (v0.1.14)', () => {
  it('drops stale fetch results when fetchManifests is called twice with slow + fast resolves', async () => {
    const first = deferred<{ data: unknown[] }>();
    const second = deferred<{ data: unknown[] }>();
    const list = vi.fn();
    let call = 0;
    list.mockImplementation(() => {
      call += 1;
      return call === 1 ? first : second;
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    // First fetch is in flight from the mount-effect.
    // Trigger a second fetch (e.g. a Refresh click).
    act(() => {
      void result.current.fetchManifests();
    });

    // Resolve the SECOND fetch first.
    await act(async () => {
      second.resolve({
        data: [{ Name: 'fresh', Source: 'user', Platform: 'windows', Resources: [] }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.manifests.map((m) => m.Name)).toEqual(['fresh']);

    // Now resolve the FIRST (stale) fetch. The race-guard must drop
    // these results — fresh must NOT be clobbered.
    await act(async () => {
      first.resolve({
        data: [{ Name: 'stale', Source: 'user', Platform: 'linux', Resources: [] }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.manifests.map((m) => m.Name)).toEqual(['fresh']);
    expect(result.current.loading).toBe(false);
  });

  it('drops stale errors from earlier fetches too', async () => {
    const first = deferred<{ data: unknown[] }>();
    const second = deferred<{ data: unknown[] }>();
    const list = vi.fn();
    let call = 0;
    list.mockImplementation(() => {
      call += 1;
      return call === 1 ? first : second;
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    act(() => {
      void result.current.fetchManifests();
    });

    // Second resolves OK.
    await act(async () => {
      second.resolve({ data: [{ Name: 'ok', Source: 'user', Platform: 'windows', Resources: [] }] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();

    // First rejects late. Must NOT surface an error.
    await act(async () => {
      first.reject(new Error('stale failure'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.manifests.map((m) => m.Name)).toEqual(['ok']);
  });
});

describe('useManifestList — search filter', () => {
  it('filters by name + resource type + resource name', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          Name: 'cis-baseline',
          Source: 'user',
          Platform: 'windows',
          Resources: [{ name: 'PasswordPolicy', type: 'Microsoft.Windows/Registry' }],
        },
        {
          Name: 'azure-config',
          Source: 'user',
          Platform: 'linux',
          Resources: [{ name: 'Sshd', type: 'Linux/Sshd' }],
        },
      ],
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Initial: both manifests visible
    expect(result.current.filteredManifests).toHaveLength(2);

    // Match by manifest name
    act(() => {
      result.current.setSearchQuery('cis');
    });
    await waitFor(() => {
      expect(result.current.filteredManifests).toHaveLength(1);
      expect(result.current.filteredManifests[0]?.Name).toBe('cis-baseline');
    });

    // Match by resource type (debounce is 200ms — waitFor needs to
    // keep polling until the debounced value flips and the filter
    // result is the EXPECTED manifest, not just any length-1 result).
    act(() => {
      result.current.setSearchQuery('Sshd');
    });
    await waitFor(() => {
      expect(result.current.filteredManifests[0]?.Name).toBe('azure-config');
    });

    // Empty query restores both
    act(() => {
      result.current.setSearchQuery('');
    });
    await waitFor(() => expect(result.current.filteredManifests).toHaveLength(2));
  });

  it('combines functional OS, issues, compliance, and last-modified filters', async () => {
    const now = Date.now();
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          Name: 'windows-clean',
          Source: 'user',
          Platform: 'windows',
          Resources: [],
          LastModifiedAt: new Date(now).toISOString(),
          Validation: { issues: [] },
          Compliance: { auditedAt: new Date(now).toISOString(), total: 10, compliant: 10, nonCompliant: 0, indeterminate: 0, errors: 0 },
        },
        {
          Name: 'linux-issues',
          Source: 'user',
          Platform: 'linux',
          Resources: [],
          LastModifiedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
          Validation: { issues: ['Schema warning', 'Missing value'] },
          Compliance: { auditedAt: new Date(now).toISOString(), total: 10, compliant: 7, nonCompliant: 2, indeterminate: 1, errors: 0 },
        },
        {
          Name: 'old-unaudited',
          Source: 'user',
          Platform: 'cross-platform',
          Resources: [],
          LastModifiedAt: new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString(),
          Validation: { issues: [] },
          Compliance: null,
        },
      ],
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setOperatingSystemFilter('linux'));
    expect(result.current.filteredManifests.map((m) => m.Name)).toEqual(['linux-issues']);

    act(() => {
      result.current.setOperatingSystemFilter('all');
      result.current.setIssuesFilter('has-issues');
    });
    expect(result.current.filteredManifests.map((m) => m.Name)).toEqual(['linux-issues']);

    act(() => {
      result.current.setIssuesFilter('all');
      result.current.setComplianceFilter('not-audited');
    });
    expect(result.current.filteredManifests.map((m) => m.Name)).toEqual(['old-unaudited']);

    act(() => {
      result.current.setComplianceFilter('all');
      result.current.setLastModifiedFilter('older-than-30-days');
    });
    expect(result.current.filteredManifests.map((m) => m.Name)).toEqual(['old-unaudited']);

    expect(result.current.filterOptions.operatingSystems).toEqual([
      'cross-platform',
      'linux',
      'windows',
    ]);
    expect(result.current.filterOptions.issues).toEqual(['no-issues', 'has-issues']);
    expect(result.current.filterOptions.compliance).toEqual([
      'all-compliant',
      'partially-compliant',
      'not-audited',
    ]);
  });

  it('classifies malformed legacy LastModifiedAt metadata as unavailable', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          Name: 'legacy',
          Source: 'user',
          Platform: 'windows',
          Resources: [],
          LastModifiedAt: 'not-a-real-timestamp',
        },
        {
          Name: 'current',
          Source: 'user',
          Platform: 'windows',
          Resources: [],
          LastModifiedAt: new Date().toISOString(),
        },
      ],
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.filterOptions.lastModified).toContain('unknown');
    act(() => result.current.setLastModifiedFilter('unknown'));
    expect(result.current.filteredManifests.map((manifest) => manifest.Name)).toEqual([
      'legacy',
    ]);
  });
});

describe('useManifestList — error path', () => {
  it('surfaces IPC errors', async () => {
    const list = vi.fn().mockRejectedValue(new Error('IPC down'));
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('IPC down');
    expect(result.current.manifests).toEqual([]);
  });
});
