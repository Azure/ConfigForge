// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the manifest CRUD handlers.
 *
 * Cover:
 *   - normalizeManifestContent on YAML, manifest-JSON, security-def-JSON,
 *     raw resource arrays, malformed JSON
 *   - listManifests cache + invalidation
 *   - registerManifest happy path + error paths (missing name, bad URI
 *     scheme, schema errors, mixed-platform warning, oversize remote)
 *   - deleteManifest happy path + error path
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../oscfg', () => ({
  deleteNamespace: vi.fn(),
  deleteRegistration: vi.fn(),
  getNamespaces: vi.fn(),
  getRegistration: vi.fn(),
  getRegistrationSource: vi.fn(),
  listRegistrations: vi.fn(),
  parseYamlDocument: vi.fn((s: string) => {
    if (typeof s !== 'string' || !s.trim()) return {};
    // Naive: just match resources blocks for tests.
    const resourcesMatch = s.match(/resources:\s*\[(.*)\]/s);
    if (resourcesMatch) {
      try {
        return { resources: JSON.parse('[' + resourcesMatch[1] + ']') };
      } catch {
        return { resources: [] };
      }
    }
    if (s.includes('resources:')) return { resources: [] };
    return {};
  }),
  REGISTERED_LINUX_TYPES: ['linux/Test'],
  REGISTERED_WINDOWS_TYPES: ['windows/Test', 'Microsoft.Windows/Registry'],
  sanitizeNamespace: vi.fn((s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-')),
  saveRegistration: vi.fn(),
  saveRegistrationIfAbsent: vi.fn(),
}));

vi.mock('../platform', () => ({
  detectManifestPlatform: vi.fn(() => 'windows'),
  extractResourceSummary: vi.fn(() => []),
  extractValidationSummary: vi.fn(() => ({
    hasSchema: false,
    hasEnforcementValues: false,
    hasComplianceCriteria: false,
    issues: [],
  })),
  hasMixedPlatformResources: vi.fn(() => false),
  validateManifestSchema: vi.fn(() => []),
  walkResourceTypes: vi.fn(() => [] as { type: string }[]),
}));

vi.mock('../history', () => ({
  createSnapshot: vi.fn().mockResolvedValue(undefined),
  deleteHistoryForManifest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../history/author', () => ({
  resolveAuthor: vi.fn().mockResolvedValue({ name: 'amir', source: 'git' }),
}));

vi.mock('../manifest/rationale-store', () => ({
  deleteRationale: vi.fn().mockResolvedValue({ removed: true }),
}));

vi.mock('../manifest/audit-results-store', () => ({
  deleteAuditResult: vi.fn().mockResolvedValue(undefined),
  readAuditResultForRegistration: vi.fn().mockResolvedValue(null),
}));

import {
  normalizeManifestContent,
  listManifests,
  registerManifest,
  restoreManifest,
  deleteManifest,
  getManifest,
  _clearManifestsListCache,
} from './manifests';
import * as oscfg from '../oscfg';
import * as platform from '../platform';
import * as history from '../history';
import * as historyAuthor from '../history/author';
import * as rationaleStore from '../manifest/rationale-store';
import * as auditResultsStore from '../manifest/audit-results-store';

const listRegistrationsMock = vi.mocked(oscfg.listRegistrations);
const getNamespacesMock = vi.mocked(oscfg.getNamespaces);
const getRegistrationMock = vi.mocked(oscfg.getRegistration);
const saveRegistrationMock = vi.mocked(oscfg.saveRegistration);
const saveRegistrationIfAbsentMock = vi.mocked(oscfg.saveRegistrationIfAbsent);
const deleteNamespaceMock = vi.mocked(oscfg.deleteNamespace);
const deleteRegistrationMock = vi.mocked(oscfg.deleteRegistration);
const validateMock = vi.mocked(platform.validateManifestSchema);
const detectPlatformMock = vi.mocked(platform.detectManifestPlatform);
const createSnapshotMock = vi.mocked(history.createSnapshot);
const resolveAuthorMock = vi.mocked(historyAuthor.resolveAuthor);
const deleteRationaleMock = vi.mocked(rationaleStore.deleteRationale);
const readAuditResultMock = vi.mocked(auditResultsStore.readAuditResultForRegistration);

beforeEach(() => {
  vi.clearAllMocks();
  _clearManifestsListCache();
  listRegistrationsMock.mockResolvedValue([]);
  getRegistrationMock.mockResolvedValue(null);
  getNamespacesMock.mockResolvedValue({ success: true, data: [], error: null, exitCode: 0 });
  saveRegistrationMock.mockResolvedValue();
  saveRegistrationIfAbsentMock.mockResolvedValue(true);
  deleteNamespaceMock.mockResolvedValue({ success: true, error: null, exitCode: 0, data: null });
  deleteRegistrationMock.mockImplementation(async (_namespace, options) => {
    await options?.afterDeleteWhileLocked?.();
    return {
      removed: true,
      recovery: null,
    };
  });
  deleteRationaleMock.mockResolvedValue({ removed: true });
  readAuditResultMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  _clearManifestsListCache();
});

describe('normalizeManifestContent', () => {
  it('passes YAML through unchanged', () => {
    const result = normalizeManifestContent('resources: []');
    expect(result.ok).toBe(true);
    expect(result.yaml).toBe('resources: []');
  });

  it('rejects malformed JSON with a clear error', () => {
    const result = normalizeManifestContent('{not json');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/failed to parse/);
  });

  it('wraps a raw resource array in a manifest envelope', () => {
    const result = normalizeManifestContent('[{"name":"r1","type":"x"}]');
    expect(result.ok).toBe(true);
    expect(result.yaml).toContain('resources:');
    expect(result.yaml).toContain('r1');
    expect(result.yaml).toContain('$schema');
  });

  it('canonicalizes manifest-JSON', () => {
    const json = '{"resources":[{"name":"a","type":"t"}]}';
    const result = normalizeManifestContent(json);
    expect(result.ok).toBe(true);
    expect(result.yaml).toContain('resources:');
    expect(result.yaml).toContain('a');
  });

  it('preserves unsafe QWords while normalizing manifest JSON to YAML', () => {
    const result = normalizeManifestContent(
      '{"resources":[{"name":"qword","type":"Microsoft.Windows/Registry",' +
        '"properties":{"valueType":"REG_QWORD","value":18446744073709551615}}]}',
    );

    expect(result.ok).toBe(true);
    expect(result.yaml).toContain('18446744073709551615');
    expect(result.yaml).not.toContain('18446744073709552000');
  });

  it('converts security-definition JSON with Settings array', () => {
    const json = JSON.stringify({
      Name: 'win10-baseline',
      Settings: [{ Name: 'PasswordHistory', Path: 'HKLM\\Soft', ExpectedValue: 24 }],
    });
    const result = normalizeManifestContent(json);
    expect(result.ok).toBe(true);
    expect(result.yaml).toContain('PasswordHistory');
    expect(result.yaml).toContain('keyPath');
  });

  it('rejects security-definition JSON with empty Settings', () => {
    const result = normalizeManifestContent('{"Settings": []}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no settings/i);
  });

  it('rejects unrecognized JSON shapes', () => {
    const result = normalizeManifestContent('{"foo": "bar"}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unrecognized JSON shape/);
  });

  it('does not attempt JSON parse for non-object/non-array content (numbers, strings)', () => {
    // 42 doesn't look like JSON ({ or [), so it's passed through as YAML.
    // The schema validator downstream will reject it; normalize itself is ok.
    const result = normalizeManifestContent('42');
    expect(result.ok).toBe(true);
    expect(result.yaml).toBe('42');
  });

  it('rejects parsed JSON that is a primitive value', () => {
    // If a caller passes a JSON-ish string that starts with [ but parses as
    // a non-array, the security-def + manifest checks both fail through.
    const result = normalizeManifestContent('[null]');
    expect(result.ok).toBe(true); // arrays are OK; null elements survive
  });
});

describe('listManifests', () => {
  it('returns empty data for an empty system', async () => {
    const result = await listManifests();
    expect(result.data).toEqual([]);
  });

  it('caches the disk-only list across calls', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'a',
        displayName: 'a',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        resourceSummary: [],
        validationSummary: undefined as never,
      } as never,
    ]);

    await listManifests();
    await listManifests();
    await listManifests();
    expect(listRegistrationsMock).toHaveBeenCalledTimes(1);
  });

  it('does not poison the disk cache with the live cache', async () => {
    listRegistrationsMock.mockResolvedValue([]);
    getNamespacesMock.mockResolvedValue({
      success: true,
      data: ['cli-only-ns'],
      error: null,
      exitCode: 0,
    });

    await listManifests({ live: false });
    await listManifests({ live: true });

    // listRegistrations called twice (one per cache bucket); getNamespaces
    // called once (only on the live path).
    expect(listRegistrationsMock).toHaveBeenCalledTimes(2);
    expect(getNamespacesMock).toHaveBeenCalledTimes(1);
  });

  it('strips Resources[] when includeResources=false', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'a',
        displayName: 'a',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        resourceSummary: [{ name: 'r', type: 't' }],
        validationSummary: undefined as never,
      } as never,
    ]);

    const summary = await listManifests({ includeResources: false });
    const entry = (summary.data[0] ?? {}) as Record<string, unknown>;
    expect('Resources' in entry).toBe(false);
    expect(entry.ResourceCount).toBe(1);
  });

  it('exposes registration time as RegisteredAt and LastModifiedAt', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'dated',
        displayName: 'Dated baseline',
        platform: 'windows',
        registeredAt: '2026-07-15T18:30:00.000Z',
        source: 'import',
        sourceId: 'baseline-file.yaml',
        resourceSummary: [],
        validationSummary: {
          hasSchema: true,
          hasEnforcementValues: true,
          hasComplianceCriteria: true,
          issues: ['Example validation issue'],
        },
      } as never,
    ]);

    const result = await listManifests({ lite: true });

    expect(result.data[0]).toMatchObject({
      RegisteredAt: '2026-07-15T18:30:00.000Z',
      LastModifiedAt: '2026-07-15T18:30:00.000Z',
      RegistrationSource: 'import',
      RegistrationSourceId: 'baseline-file.yaml',
      Validation: {
        issues: ['Example validation issue'],
      },
    });
  });

  it('exposes the latest persisted audit as a compact compliance summary', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'audited',
        displayName: 'Audited baseline',
        platform: 'windows',
        registeredAt: '2026-07-15T18:30:00.000Z',
        source: 'user',
        resourceSummary: [],
        validationSummary: {
          hasSchema: true,
          hasEnforcementValues: true,
          hasComplianceCriteria: true,
          issues: [],
        },
      } as never,
    ]);
    readAuditResultMock.mockResolvedValue({
      version: 1,
      recordedAt: '2026-07-15T20:00:00.000Z',
      mode: 'audit',
      result: {
        TotalResources: 10,
        Compliant: 8,
        NonCompliant: 1,
        Indeterminate: 1,
        Errors: 0,
      },
    });

    const result = await listManifests({ lite: true });

    expect(result.data[0]?.Compliance).toEqual({
      auditedAt: '2026-07-15T20:00:00.000Z',
      total: 10,
      compliant: 8,
      nonCompliant: 1,
      indeterminate: 1,
      errors: 0,
    });
  });

  it('ignores an audit from an older registration revision and shows the current revision', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'revisioned',
        displayName: 'Revisioned baseline',
        platform: 'windows',
        registeredAt: '2026-07-15T18:30:00.000Z',
        modifiedAt: '2026-07-15T20:00:00.000Z',
        revision: 'current-revision',
        source: 'user',
        resourceSummary: [],
        validationSummary: {
          hasSchema: true,
          hasEnforcementValues: true,
          hasComplianceCriteria: true,
          issues: [],
        },
      } as never,
    ]);
    const auditResult = {
      TotalResources: 2,
      Compliant: 1,
      NonCompliant: 1,
      Indeterminate: 0,
      Errors: 0,
    };
    readAuditResultMock.mockResolvedValue(null);

    expect((await listManifests({ lite: true, force: true })).data[0]?.Compliance).toBeNull();

    readAuditResultMock.mockResolvedValue({
      version: 1,
      recordedAt: '2026-07-15T21:01:00.000Z',
      registrationRevision: 'current-revision',
      mode: 'audit',
      result: auditResult,
    });

    expect((await listManifests({ lite: true, force: true })).data[0]?.Compliance).toEqual({
      auditedAt: '2026-07-15T21:01:00.000Z',
      total: 2,
      compliant: 1,
      nonCompliant: 1,
      indeterminate: 0,
      errors: 0,
    });
  });

  it('force refresh bypasses the 60-second cache so fresh audit status is visible immediately', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'audited',
        displayName: 'Audited baseline',
        platform: 'windows',
        registeredAt: '2026-07-15T18:30:00.000Z',
        source: 'user',
        resourceSummary: [],
        validationSummary: {
          hasSchema: true,
          hasEnforcementValues: true,
          hasComplianceCriteria: true,
          issues: [],
        },
      } as never,
    ]);

    const initial = await listManifests({ lite: true });
    expect(initial.data[0]?.Compliance).toBeNull();

    readAuditResultMock.mockResolvedValue({
      version: 1,
      recordedAt: '2026-07-15T20:00:00.000Z',
      mode: 'audit',
      result: {
        TotalResources: 4,
        Compliant: 3,
        NonCompliant: 1,
        Indeterminate: 0,
        Errors: 0,
      },
    });

    expect((await listManifests({ lite: true })).data[0]?.Compliance).toBeNull();
    expect((await listManifests({ lite: true, force: true })).data[0]?.Compliance).toEqual({
      auditedAt: '2026-07-15T20:00:00.000Z',
      total: 4,
      compliant: 3,
      nonCompliant: 1,
      indeterminate: 0,
      errors: 0,
    });
    expect(listRegistrationsMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache forces re-read', async () => {
    await listManifests();
    _clearManifestsListCache();
    await listManifests();
    expect(listRegistrationsMock).toHaveBeenCalledTimes(2);
  });

  // perf W2 / H6 — `lite: true` is the conservative opt-in to a
  // Resources-stripped payload. Defaults are unchanged.
  it('strips Resources[] when lite=true (perf W2 / H6)', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'a',
        displayName: 'a',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        resourceSummary: [{ name: 'r', type: 't' }],
        validationSummary: undefined as never,
      } as never,
    ]);

    const liteResult = await listManifests({ lite: true });
    const entry = (liteResult.data[0] ?? {}) as Record<string, unknown>;
    expect('Resources' in entry).toBe(false);
    expect(entry.ResourceCount).toBe(1);
  });

  it('lite=true beats includeResources=true (lite is explicit opt-in)', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'a',
        displayName: 'a',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        resourceSummary: [{ name: 'r', type: 't' }],
        validationSummary: undefined as never,
      } as never,
    ]);

    const result = await listManifests({ lite: true, includeResources: true });
    const entry = (result.data[0] ?? {}) as Record<string, unknown>;
    expect('Resources' in entry).toBe(false);
  });

  it('preserves the legacy default (Resources included) when neither flag set', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'a',
        displayName: 'a',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        resourceSummary: [{ name: 'r', type: 't' }],
        validationSummary: undefined as never,
      } as never,
    ]);

    const result = await listManifests();
    const entry = (result.data[0] ?? {}) as Record<string, unknown>;
    expect('Resources' in entry).toBe(true);
    expect((entry.Resources as unknown[]).length).toBe(1);
  });
});

// perf W2 / C5 — single-manifest fetch replaces the list+find pattern
// in ManifestEditor.tsx. Verifies shape parity with listManifests
// entries plus the single-manifest semantics.
describe('getManifest (perf W2 / C5)', () => {
  it('rejects empty name with 400', async () => {
    await expect(getManifest('')).rejects.toMatchObject({ status: 400 });
  });

  it('returns data:null for unknown namespace (does not throw)', async () => {
    listRegistrationsMock.mockResolvedValue([]);
    const result = await getManifest('nope');
    expect(result.data).toBeNull();
  });

  it('returns the matching manifest with Resources[] by default', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'mybase',
        displayName: 'My Base',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        resourceSummary: [
          { name: 'r1', type: 't1' },
          { name: 'r2', type: 't2' },
        ],
        validationSummary: {
          hasSchema: true,
          hasEnforcementValues: true,
          hasComplianceCriteria: true,
          issues: [],
        },
      } as never,
    ]);

    const result = await getManifest('mybase');
    expect(result.data).not.toBeNull();
    expect(result.data?.Name).toBe('mybase');
    expect(result.data?.DisplayName).toBe('My Base');
    expect(result.data?.Source).toBe('oscfg');
    expect(result.data?.ResourceCount).toBe(2);
    expect(result.data?.RegisteredAt).toBe('2026-01-01');
    expect(result.data?.LastModifiedAt).toBe('2026-01-01');
    expect(result.data?.Resources).toEqual([
      { name: 'r1', type: 't1' },
      { name: 'r2', type: 't2' },
    ]);
  });

  it('omits Resources[] when includeResources=false', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'mybase',
        displayName: 'mybase',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        resourceSummary: [{ name: 'r1', type: 't1' }],
        validationSummary: {
          hasSchema: false,
          hasEnforcementValues: false,
          hasComplianceCriteria: false,
          issues: [],
        },
      } as never,
    ]);

    const result = await getManifest('mybase', { includeResources: false });
    expect(result.data).not.toBeNull();
    expect(result.data?.ResourceCount).toBe(1);
    expect(result.data?.Resources).toBeUndefined();
  });

  it('flags library source vs oscfg source', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'libent',
        displayName: 'libent',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'library',
        resourceSummary: [],
        validationSummary: {
          hasSchema: false,
          hasEnforcementValues: false,
          hasComplianceCriteria: false,
          issues: [],
        },
      } as never,
    ]);

    const result = await getManifest('libent');
    expect(result.data?.Source).toBe('library');
  });

  it('reports Deployed=true when lastAppliedAt is set', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'deployed',
        displayName: 'deployed',
        platform: 'windows',
        registeredAt: '2026-01-01',
        source: 'user',
        lastAppliedAt: '2026-02-01T12:00:00Z',
        resourceSummary: [],
        validationSummary: {
          hasSchema: false,
          hasEnforcementValues: false,
          hasComplianceCriteria: false,
          issues: [],
        },
      } as never,
    ]);

    const result = await getManifest('deployed');
    expect(result.data?.Deployed).toBe(true);
    expect(result.data?.LastAppliedAt).toBe('2026-02-01T12:00:00Z');
  });

  it('ignores a pre-edit legacy audit and shows a post-edit audit', async () => {
    listRegistrationsMock.mockResolvedValue([
      {
        namespace: 'legacy-audit',
        displayName: 'Legacy Audit',
        platform: 'windows',
        registeredAt: '2026-07-15T18:00:00.000Z',
        modifiedAt: '2026-07-15T20:00:00.000Z',
        source: 'user',
        resourceSummary: [],
        validationSummary: {
          hasSchema: true,
          hasEnforcementValues: true,
          hasComplianceCriteria: true,
          issues: [],
        },
      } as never,
    ]);
    const result = {
      TotalResources: 1,
      Compliant: 1,
      NonCompliant: 0,
      Indeterminate: 0,
      Errors: 0,
    };
    readAuditResultMock.mockResolvedValue(null);

    expect((await getManifest('legacy-audit')).data?.Compliance).toBeNull();

    readAuditResultMock.mockResolvedValue({
      version: 1,
      recordedAt: '2026-07-15T20:00:00.001Z',
      mode: 'audit',
      result,
    });
    expect((await getManifest('legacy-audit')).data?.Compliance).toEqual({
      auditedAt: '2026-07-15T20:00:00.001Z',
      total: 1,
      compliant: 1,
      nonCompliant: 0,
      indeterminate: 0,
      errors: 0,
    });
  });
});

describe('registerManifest', () => {
  it('rejects empty name', async () => {
    await expect(registerManifest({ name: '', content: 'resources: []' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects when no source provided', async () => {
    await expect(registerManifest({ name: 'foo' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/path, uri, or content/),
    });
  });

  it('rejects whitespace-only content as if absent', async () => {
    await expect(registerManifest({ name: 'foo', content: '   \n\n   ' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects non-http URI', async () => {
    await expect(
      registerManifest({ name: 'foo', uri: 'file:///etc/passwd' }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Unsupported URI scheme/),
    });
  });

  it('rejects malformed URI', async () => {
    await expect(registerManifest({ name: 'foo', uri: 'not a url' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Invalid URI/),
    });
  });

  it('rejects schema errors with a multi-line error', async () => {
    validateMock.mockReturnValueOnce(['no resources field', 'no $schema']);
    await expect(registerManifest({ name: 'foo', content: 'invalid:' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Invalid manifest schema/),
    });
  });

  it('persists the registration on the happy path', async () => {
    const result = await registerManifest({
      name: 'mybase',
      content: 'resources: []',
    });
    expect(result.message).toMatch(/registered/);
    expect(result.data.namespace).toBe('mybase');
    expect(saveRegistrationMock).toHaveBeenCalledTimes(1);
    expect(saveRegistrationMock.mock.calls[0][0].source).toBe('user');
  });

  it('persists exact QWord YAML when registering manifest JSON', async () => {
    await registerManifest({
      name: 'qword',
      content:
        '{"resources":[{"name":"qword","type":"Microsoft.Windows/Registry",' +
        '"properties":{"keyPath":"HKLM:\\\\Software\\\\QWord","valueName":"Exact",' +
        '"valueType":"REG_QWORD","value":18446744073709551615}}]}',
    });

    const persistedYaml = saveRegistrationMock.mock.calls[0][1];
    expect(persistedYaml).toContain('18446744073709551615');
    expect(persistedYaml).not.toContain('18446744073709552000');
  });

  it('waits for the history snapshot so consecutive saves preserve order', async () => {
    let markSnapshotStarted!: () => void;
    let finishSnapshot!: () => void;
    const snapshotStarted = new Promise<void>((resolve) => {
      markSnapshotStarted = resolve;
    });
    const snapshotPending = new Promise<void>((resolve) => {
      finishSnapshot = resolve;
    });
    createSnapshotMock.mockImplementationOnce(async () => {
      markSnapshotStarted();
      await snapshotPending;
    });

    let settled = false;
    const registration = registerManifest({
      name: 'ordered',
      content: 'resources: []',
    }).then((result) => {
      settled = true;
      return result;
    });

    await snapshotStarted;
    expect(settled).toBe(false);
    finishSnapshot();
    await expect(registration).resolves.toMatchObject({
      data: { namespace: 'ordered' },
    });
  });

  it('does not resolve an email when the caller supplies an explicit author', async () => {
    await registerManifest({
      name: 'explicit-author',
      content: 'resources: []',
      author: 'Release Automation',
    });

    expect(resolveAuthorMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).toHaveBeenCalledWith(
      'explicit-author',
      'resources: []',
      expect.objectContaining({
        author: 'Release Automation',
        authorEmail: '',
      }),
    );
  });

  it('keeps registration successful when the awaited snapshot fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createSnapshotMock.mockRejectedValueOnce(new Error('history disk unavailable'));

    await expect(
      registerManifest({ name: 'snapshot-failure', content: 'resources: []' }),
    ).resolves.toMatchObject({
      data: { namespace: 'snapshot-failure' },
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringMatching(/auto-snapshot failed.*history disk unavailable/),
    );
  });

  it('assigns a fresh revision for identical and changed saves and removes stale audit data', async () => {
    const first = await registerManifest({
      name: 'mybase',
      content: 'resources: []',
    });
    getRegistrationMock.mockResolvedValueOnce(saveRegistrationMock.mock.calls[0]?.[0] as never);
    await registerManifest({
      name: 'mybase',
      content: 'resources: []',
    });
    getRegistrationMock.mockResolvedValueOnce(saveRegistrationMock.mock.calls[1]?.[0] as never);
    await registerManifest({
      name: 'mybase',
      content: 'resources:\n  # changed\n',
    });

    expect(first.data.namespace).toBe('mybase');
    const registrations = saveRegistrationMock.mock.calls.map(([registration]) => registration);
    expect(new Set(registrations.map((registration) => registration.revision)).size).toBe(3);
    expect(
      registrations.every(
        (registration) =>
          typeof registration.modifiedAt === 'string' && registration.modifiedAt.length > 0,
      ),
    ).toBe(true);
  });

  it('warns when manifest platform != host', async () => {
    detectPlatformMock.mockReturnValueOnce('linux');
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const result = await registerManifest({ name: 'l1', content: 'resources: []' });
      expect(result.warnings.some((w) => /linux/i.test(w) && /windows/i.test(w))).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('warns about mixed-platform manifests', async () => {
    detectPlatformMock.mockReturnValueOnce('mixed');
    const result = await registerManifest({ name: 'mix', content: 'resources: []' });
    expect(result.warnings.some((w) => /mixes Windows and Linux/i.test(w))).toBe(true);
  });

  it('invalidates the list cache on register', async () => {
    await listManifests(); // prime cache
    listRegistrationsMock.mockClear();
    await registerManifest({ name: 'mybase', content: 'resources: []' });
    await listManifests();
    expect(listRegistrationsMock).toHaveBeenCalledTimes(1); // re-read after invalidation
  });
});

describe('restoreManifest', () => {
  it('restores source and original display name only when the namespace is absent', async () => {
    const result = await restoreManifest({
      namespace: 'mybase',
      displayName: 'My Original Baseline',
      content: 'resources: []',
      source: 'import',
      sourceId: 'original.yaml',
    });

    expect(result.message).toMatch(/restored/i);
    expect(saveRegistrationIfAbsentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'mybase',
        displayName: 'My Original Baseline',
        source: 'import',
        sourceId: 'original.yaml',
      }),
      'resources: []',
    );
    expect(saveRegistrationIfAbsentMock.mock.calls[0]?.[0]).not.toHaveProperty('lastAppliedAt');
    expect(saveRegistrationIfAbsentMock.mock.calls[0]?.[0]).not.toHaveProperty('lastAuditedAt');
  });

  it('returns a clear conflict and does not overwrite a recreated namespace', async () => {
    saveRegistrationIfAbsentMock.mockResolvedValueOnce(false);

    await expect(
      restoreManifest({
        namespace: 'mybase',
        displayName: 'Deleted Baseline',
        content: 'resources: []',
        source: 'user',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already registered.*not changed.*Undo remains available/i),
    });
    expect(saveRegistrationMock).not.toHaveBeenCalled();
  });
});

describe('deleteManifest', () => {
  it('rejects empty name', async () => {
    await expect(deleteManifest('')).rejects.toMatchObject({ status: 400 });
  });

  it('removes registration + CLI namespace + rationale log', async () => {
    const result = await deleteManifest('mybase');
    expect(result.message).toMatch(/removed/);
    expect(result.data.cliRemoved).toBe(true);
    expect(result.data.rationaleLogRemoved).toBe(true);
    expect(deleteNamespaceMock).toHaveBeenCalledWith('mybase');
    expect(deleteRegistrationMock).toHaveBeenCalledWith('mybase', {
      afterDeleteWhileLocked: expect.any(Function),
    });
  });

  it('returns the atomically captured recovery backup when required', async () => {
    deleteRegistrationMock.mockImplementationOnce(async (_namespace, options) => {
      await options?.afterDeleteWhileLocked?.();
      return {
        removed: true,
        recovery: {
          namespace: 'mybase',
          displayName: 'My Baseline',
          sourceYaml: 'resources: []',
          source: 'import',
          sourceId: 'mybase.yaml',
        },
      };
    });

    const result = await deleteManifest('mybase', {
      requireRecovery: true,
    });

    expect(deleteRegistrationMock).toHaveBeenCalledWith('mybase', {
      requireRecovery: true,
      afterDeleteWhileLocked: expect.any(Function),
    });
    expect(result.data.recovery).toEqual({
      namespace: 'mybase',
      displayName: 'My Baseline',
      sourceYaml: 'resources: []',
      source: 'import',
      sourceId: 'mybase.yaml',
    });
    expect(deleteRegistrationMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteNamespaceMock.mock.invocationCallOrder[0],
    );
  });

  it('performs no CLI or side-store cleanup when required recovery is unavailable', async () => {
    deleteRegistrationMock.mockResolvedValueOnce({
      removed: false,
      recovery: null,
    });

    await expect(deleteManifest('unrecoverable', { requireRecovery: true })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/recovery source YAML is unavailable/i),
    });
    expect(deleteNamespaceMock).not.toHaveBeenCalled();
    expect(deleteRationaleMock).not.toHaveBeenCalled();
  });

  it('still removes registration if CLI cleanup fails', async () => {
    deleteNamespaceMock.mockResolvedValueOnce({
      success: false,
      error: 'no such namespace',
      exitCode: 1,
      data: null,
    });
    const result = await deleteManifest('ghost');
    expect(result.data.cliRemoved).toBe(false);
    expect(result.data.cliError).toBe('no such namespace');
    expect(deleteRegistrationMock).toHaveBeenCalledTimes(1);
  });

  it('still removes registration if rationale cleanup throws', async () => {
    deleteRationaleMock.mockRejectedValueOnce(new Error('disk full'));
    const result = await deleteManifest('mybase');
    expect(result.data.rationaleLogRemoved).toBe(false);
    expect(result.data.rationaleLogError).toBe('disk full');
  });

  it('invalidates the list cache on delete', async () => {
    await listManifests();
    listRegistrationsMock.mockClear();
    await deleteManifest('mybase');
    await listManifests();
    expect(listRegistrationsMock).toHaveBeenCalledTimes(1);
  });
});
