// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for src/lib/cis/data.ts.
 *
 * CIS data files are NOT bundled with the repo (license restrictions —
 * see public/_baselines/cis/README.md). The loaders return `null` when
 * the data is missing; that's the contract. These tests cover both:
 *
 *   1. The "no data" path (most users) — loaders return null, helper
 *      functions return null, no errors thrown.
 *   2. The "user dropped in their own data" path — vi.mock the readFile
 *      module and supply minimal synthetic fixtures so the parse, cache,
 *      and lookup logic is still exercised.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// We control fs/promises so the tests can simulate "data files present"
// or "data files absent" without touching the real public/ directory.
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';
import {
  loadCisGlobalMappings,
  loadCisRuleCatalog,
  loadCisRuleIdMappings,
  findCisNameForOsconfigProperty,
  findCisNameForPrivilege,
  findCisRule,
  _clearCisDataCacheForTests,
} from './data';

const mockedReadFile = vi.mocked(readFile);

const SYNTHETIC_GLOBAL_MAPPINGS = {
  _description: 'synthetic',
  _version: '0.0.0',
  accountPolicies: {
    foo: {
      cisName: 'Foo policy',
      osconfigProperty: 'FooProperty',
      valueType: 'integer',
    },
  },
  userRights: {
    bar: {
      privilege: 'SeBarPrivilege',
      cisName: 'Bar right',
    },
  },
  auditPolicies: {},
  registryTypes: {},
};

const SYNTHETIC_CATALOG = {
  rules: [
    {
      ruleId: 'rule-1',
      name: 'Foo policy',
      severity: 'high',
      groupPolicyPath: 'Computer Configuration\\Foo',
    },
  ],
};

const SYNTHETIC_ID_MAPPINGS = {
  'Foo policy': 'guid-1234',
};

afterEach(() => {
  _clearCisDataCacheForTests();
  vi.clearAllMocks();
});

// ── Missing data (default) ────────────────────────────────────────────

describe('loaders — data files absent (default)', () => {
  it('loadCisGlobalMappings returns null on ENOENT', async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await loadCisGlobalMappings()).toBeNull();
  });

  it('loadCisRuleCatalog returns null on ENOENT', async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await loadCisRuleCatalog('2025')).toBeNull();
  });

  it('loadCisRuleIdMappings returns null on ENOENT', async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await loadCisRuleIdMappings()).toBeNull();
  });

  it('findCisNameForOsconfigProperty returns null when mappings absent', async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await findCisNameForOsconfigProperty('PasswordHistorySize')).toBeNull();
  });

  it('findCisNameForPrivilege returns null when mappings absent', async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await findCisNameForPrivilege('SeBarPrivilege')).toBeNull();
  });

  it('findCisRule returns null when no catalogs are present', async () => {
    mockedReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await findCisRule('Foo policy')).toBeNull();
  });
});

describe('loaders — non-ENOENT errors still throw', () => {
  it('loadCisGlobalMappings throws on parse error', async () => {
    mockedReadFile.mockResolvedValueOnce('not json{');
    await expect(loadCisGlobalMappings()).rejects.toThrow(/cis-mappings\.json/);
  });

  it('loadCisRuleCatalog throws on EACCES', async () => {
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(loadCisRuleCatalog('2025')).rejects.toThrow();
  });
});

// ── Data present (user dropped in their own copies) ────────────────────

describe('loaders — data files present (user-supplied)', () => {
  it('loadCisGlobalMappings returns parsed mappings', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(SYNTHETIC_GLOBAL_MAPPINGS));
    const m = await loadCisGlobalMappings();
    expect(m).not.toBeNull();
    expect(m!.accountPolicies.foo.osconfigProperty).toBe('FooProperty');
  });

  it('loadCisGlobalMappings caches after first read', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(SYNTHETIC_GLOBAL_MAPPINGS));
    const a = await loadCisGlobalMappings();
    const b = await loadCisGlobalMappings();
    expect(a).toBe(b); // identical reference
    expect(mockedReadFile).toHaveBeenCalledTimes(1);
  });

  it('loadCisRuleCatalog returns parsed catalog', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(SYNTHETIC_CATALOG));
    const c = await loadCisRuleCatalog('2025');
    expect(c).not.toBeNull();
    expect(c!.rules).toHaveLength(1);
  });

  it('loadCisRuleCatalog caches per-OS', async () => {
    mockedReadFile
      .mockResolvedValueOnce(JSON.stringify(SYNTHETIC_CATALOG))
      .mockResolvedValueOnce(JSON.stringify({ rules: [] }));
    const a1 = await loadCisRuleCatalog('2025');
    const a2 = await loadCisRuleCatalog('2025');
    expect(a1).toBe(a2);
    const b = await loadCisRuleCatalog('2022');
    expect(b).not.toBe(a1);
    expect(mockedReadFile).toHaveBeenCalledTimes(2);
  });

  it('loadCisRuleIdMappings returns parsed map', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(SYNTHETIC_ID_MAPPINGS));
    const m = await loadCisRuleIdMappings();
    expect(m).not.toBeNull();
    expect(m!['Foo policy']).toBe('guid-1234');
  });

  it('findCisNameForOsconfigProperty matches via global mappings', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(SYNTHETIC_GLOBAL_MAPPINGS));
    expect(await findCisNameForOsconfigProperty('FooProperty')).toBe('Foo policy');
  });

  it('findCisNameForPrivilege matches via user-rights map', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(SYNTHETIC_GLOBAL_MAPPINGS));
    expect(await findCisNameForPrivilege('SeBarPrivilege')).toBe('Bar right');
  });

  it('findCisRule walks newest catalog first and returns first hit', async () => {
    // 2025 catalog → has the rule; 2022/2019/2016 → not consulted because 2025 hit first.
    mockedReadFile.mockResolvedValueOnce(JSON.stringify(SYNTHETIC_CATALOG));
    const r = await findCisRule('Foo policy');
    expect(r).not.toBeNull();
    expect(r!.osVersion).toBe('2025');
    expect(r!.rule.name).toBe('Foo policy');
  });
});
