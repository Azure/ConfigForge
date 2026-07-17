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
import { getManifestCompliance, useManifestList } from './useManifestList';

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

  describe("getManifestCompliance", () => {
    it("excludes indeterminate and error reads from the compliance denominator", () => {
      const state = getManifestCompliance({
        Name: "audit",
        Source: "user",
        Compliance: {
          auditedAt: "2026-07-15T10:00:00.000Z",
          total: 6,
          compliant: 2,
          nonCompliant: 1,
          indeterminate: 2,
          errors: 1,
        },
      });

      expect(state).toMatchObject({
        audited: true,
        compliant: 2,
        unknown: 3,
        total: 3,
        category: "partially-compliant",
      });
      expect(state.ratio).toBeCloseTo(2 / 3);
    });

    it("reports no evaluated compliance when every read is indeterminate", () => {
      expect(
        getManifestCompliance({
          Name: "unknown",
          Source: "user",
          Compliance: {
            auditedAt: "2026-07-15T10:00:00.000Z",
            total: 3,
            compliant: 0,
            nonCompliant: 0,
            indeterminate: 2,
            errors: 1,
          },
        }),
      ).toMatchObject({
        audited: false,
        unknown: 3,
        ratio: null,
        category: "not-audited",
      });
    });

    it("excludes indeterminate resource statuses from the fallback denominator", () => {
      expect(
        getManifestCompliance({
          Name: "fallback",
          Source: "user",
          Resources: [
            {
              name: "A",
              type: "T",
              properties: {},
              compliance: { status: "Compliant", reason: "" },
            },
            {
              name: "B",
              type: "T",
              properties: {},
              compliance: { status: "Compliant", reason: "" },
            },
            {
              name: "C",
              type: "T",
              properties: {},
              compliance: { status: "NonCompliant", reason: "" },
            },
            {
              name: "D",
              type: "T",
              properties: {},
              compliance: { status: "Could not read", reason: "" },
            },
            {
              name: "E",
              type: "T",
              properties: {},
              compliance: { status: "Indeterminate", reason: "" },
            },
            { name: "F", type: "T", properties: {}, compliance: { status: "Error", reason: "" } },
          ],
        }),
      ).toMatchObject({
        audited: true,
        compliant: 2,
        unknown: 3,
        total: 3,
        ratio: 2 / 3,
        category: "partially-compliant",
      });
    });

    it("does not report All compliant when unknown results remain", () => {
      expect(
        getManifestCompliance({
          Name: "incomplete",
          Source: "user",
          Compliance: {
            auditedAt: "2026-07-15T10:00:00.000Z",
            total: 2,
            compliant: 1,
            nonCompliant: 0,
            indeterminate: 1,
            errors: 0,
          },
        }),
      ).toMatchObject({
        audited: true,
        ratio: 1,
        unknown: 1,
        category: "partially-compliant",
      });
    });
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

  it('uses cached compliance only when it matches the current registration revision', async () => {
    sessionStorage.setItem(
      'configforge-compliance-revisioned',
      JSON.stringify({
        name: 'revisioned',
        revision: 'old-revision',
        resources: [
          {
            name: 'Stale',
            type: 'T',
            compliance: { status: 'Compliant', reason: '' },
          },
        ],
      }),
    );
    installMocks({
      list: vi.fn().mockResolvedValue({
        data: [
          {
            Name: 'revisioned',
            Source: 'user',
            Revision: 'new-revision',
            Resources: [],
            Compliance: null,
          },
        ],
      }),
    });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.manifests[0]?.Resources).toEqual([]);
    expect(getManifestCompliance(result.current.manifests[0])).toMatchObject({
      audited: false,
      category: 'not-audited',
    });

    sessionStorage.setItem(
      'configforge-compliance-revisioned',
      JSON.stringify({
        name: 'revisioned',
        revision: 'new-revision',
        resources: [
          {
            name: 'Current',
            type: 'T',
            compliance: { status: 'Compliant', reason: '' },
          },
        ],
      }),
    );
    await act(async () => {
      await result.current.fetchManifests({ force: true });
    });
    expect(result.current.manifests[0]?.Resources?.[0]?.name).toBe('Current');
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
      second.resolve({
        data: [{ Name: 'ok', Source: 'user', Platform: 'windows', Resources: [] }],
      });
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
  it('filters by namespace and display name without matching hidden resource fields', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          Name: 'Blankmanifest',
          DisplayName: 'Blank baseline',
          Source: 'user',
          Platform: 'windows',
          Resources: [
            {
              name: 'AccountsLimitLocalAccountUseOfBlankPasswordsToConsoleLogonOnly',
              type: 'Microsoft.Windows/Registry',
            },
          ],
        },
        {
          Name: 'Windows-Server-2025-Member-Server',
          DisplayName: 'Windows Server 2025 Member Server',
          Source: 'user',
          Platform: 'windows',
          Resources: [
            {
              name: 'AccountsLimitLocalAccountUseOfBlankPasswordsToConsoleLogonOnly',
              type: 'Microsoft.Windows/Registry',
            },
          ],
        },
      ],
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Initial: both manifests visible
    expect(result.current.filteredManifests).toHaveLength(2);

    // "Blank" exists in a setting name shared by both baselines, but the
    // visible list search must match only baseline identity.
    act(() => {
      result.current.setSearchQuery('Blank');
    });
    await waitFor(() => {
      expect(result.current.filteredManifests).toHaveLength(1);
      expect(result.current.filteredManifests[0]?.Name).toBe('Blankmanifest');
    });

    // "windows" is also present in every resource type. It should return
    // only the baseline whose namespace/display name contains the term.
    act(() => {
      result.current.setSearchQuery('windows');
    });
    await waitFor(() => {
      expect(result.current.filteredManifests).toHaveLength(1);
      expect(result.current.filteredManifests[0]?.Name).toBe(
        'Windows-Server-2025-Member-Server',
      );
    });

    // Resource-only terms are not list-search fields.
    act(() => {
      result.current.setSearchQuery('Registry');
    });
    await waitFor(() => {
      expect(result.current.filteredManifests).toHaveLength(0);
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
          Compliance: {
            auditedAt: new Date(now).toISOString(),
            total: 10,
            compliant: 10,
            nonCompliant: 0,
            indeterminate: 0,
            errors: 0,
          },
        },
        {
          Name: 'linux-issues',
          Source: 'user',
          Platform: 'linux',
          Resources: [],
          LastModifiedAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
          Validation: { issues: ['Schema warning', 'Missing value'] },
          Compliance: {
            auditedAt: new Date(now).toISOString(),
            total: 10,
            compliant: 7,
            nonCompliant: 2,
            indeterminate: 1,
            errors: 0,
          },
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
    expect(result.current.filteredManifests.map((manifest) => manifest.Name)).toEqual(['legacy']);
  });

  it("resets active filters whose options disappear after a refresh", async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          Name: "old-linux-issues",
          Source: "user",
          Platform: "linux",
          Resources: [],
          LastModifiedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
          Validation: { issues: ["Missing value"] },
          Compliance: {
            auditedAt: new Date().toISOString(),
            total: 2,
            compliant: 1,
            nonCompliant: 1,
            indeterminate: 0,
            errors: 0,
          },
        },
      ],
    });
    installMocks({ list });

    const { result } = renderHook(() => useManifestList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.setOperatingSystemFilter("linux");
      result.current.setIssuesFilter("has-issues");
      result.current.setComplianceFilter("partially-compliant");
      result.current.setLastModifiedFilter("older-than-30-days");
    });
    expect(result.current.filteredManifests.map((manifest) => manifest.Name)).toEqual([
      "old-linux-issues",
    ]);

    list.mockResolvedValueOnce({
      data: [
        {
          Name: "current-windows-clean",
          Source: "user",
          Platform: "windows",
          Resources: [],
          LastModifiedAt: new Date().toISOString(),
          Validation: { issues: [] },
          Compliance: {
            auditedAt: new Date().toISOString(),
            total: 1,
            compliant: 1,
            nonCompliant: 0,
            indeterminate: 0,
            errors: 0,
          },
        },
      ],
    });
    await act(async () => {
      await result.current.fetchManifests();
    });

    await waitFor(() => {
      expect(result.current.operatingSystemFilter).toBe("all");
      expect(result.current.issuesFilter).toBe("all");
      expect(result.current.complianceFilter).toBe("all");
      expect(result.current.lastModifiedFilter).toBe("all");
    });
    expect(result.current.filteredManifests.map((manifest) => manifest.Name)).toEqual([
      "current-windows-clean",
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
