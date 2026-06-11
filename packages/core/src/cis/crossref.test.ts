// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for src/lib/cis/crossref.ts.
 *
 * The data layer is mocked so these tests don't depend on the (legally
 * unbundled) CIS catalog files. We exercise the cross-reference logic
 * — strict-name match, property-mapping fallback, bulk variant — with
 * synthetic fixtures.
 *
 * The "no data → null" contract is also covered: when the mocked
 * loaders all return null, every cross-reference call must return null
 * (the user-facing CIS feature degrades gracefully).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./data', () => ({
  loadCisGlobalMappings: vi.fn(),
  loadCisRuleCatalog: vi.fn(),
  loadCisRuleIdMappings: vi.fn(),
}));

import {
  loadCisGlobalMappings,
  loadCisRuleCatalog,
  loadCisRuleIdMappings,
} from './data';
import { findCisRuleForResource, findCisRulesForResources } from './crossref';

const mockedLoadGlobal = vi.mocked(loadCisGlobalMappings);
const mockedLoadCatalog = vi.mocked(loadCisRuleCatalog);
const mockedLoadIdMap = vi.mocked(loadCisRuleIdMappings);

const FIXTURE_GLOBAL = {
  _description: 'synthetic',
  _version: '0.0.0',
  accountPolicies: {
    password_hist: {
      cisName: 'Example password rule A',
      osconfigProperty: 'PasswordHistorySize',
      valueType: 'integer',
    },
  },
  userRights: {
    SeSecurity: {
      privilege: 'SeSecurityPrivilege',
      cisName: 'Example user right A',
    },
  },
  auditPolicies: {
    'audit_policy_example_a': {
      osconfigProperty: 'AuditCredentialValidation',
      guid: '0CCE923F-69AE-11D9-BED3-505054503030',
    },
  },
  registryTypes: {},
} as const;

const RULE_PASSWORD_HISTORY = {
  ruleId: 'r-pw-hist',
  name: "1.1.1 (L1) Ensure 'Example password rule A' is set to '24'",
  severity: 'high',
  groupPolicyPath: 'Account Policies\\Password Policy',
};

const RULE_SECURITY_LOG = {
  ruleId: 'r-sec-log',
  name: "2.2.21 (L1) Ensure 'Example user right A' is set to 'Administrators'",
  severity: 'high',
  groupPolicyPath: 'Local Policies\\User Rights Assignment',
};

const RULE_CREDENTIAL_AUDIT = {
  ruleId: 'r-cred-audit',
  name: "17.1.1 (L1) Ensure 'Audit Policy Example A' is set to 'Success and Failure'",
  severity: 'medium',
  groupPolicyPath: 'Advanced Audit Policy Configuration\\Account Logon',
};

const ID_MAP = {
  [RULE_PASSWORD_HISTORY.name]: 'guid-pw-hist',
  [RULE_SECURITY_LOG.name]: 'guid-sec-log',
};

beforeEach(() => {
  // Default to "data present" with our fixtures. Individual tests can
  // override to test the no-data path.
  mockedLoadGlobal.mockResolvedValue(FIXTURE_GLOBAL);
  mockedLoadIdMap.mockResolvedValue(ID_MAP);
  mockedLoadCatalog.mockImplementation(async (osVersion: string) => {
    if (osVersion === '2025') {
      return {
        rules: [RULE_PASSWORD_HISTORY, RULE_SECURITY_LOG, RULE_CREDENTIAL_AUDIT],
      };
    }
    return null;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── No data → null contract ─────────────────────────────────────────────

describe('findCisRuleForResource — no data bundled', () => {
  it('returns null when ALL loaders return null', async () => {
    mockedLoadGlobal.mockResolvedValue(null);
    mockedLoadIdMap.mockResolvedValue(null);
    mockedLoadCatalog.mockResolvedValue(null);
    expect(
      await findCisRuleForResource({
        type: 'Microsoft.Windows/AccountPolicy',
        name: RULE_PASSWORD_HISTORY.name,
      }),
    ).toBeNull();
  });
});

// ── Strict name match ────────────────────────────────────────────────────

describe('findCisRuleForResource — strict name match', () => {
  it('returns the matching rule with confidence 1.0', async () => {
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/Registry',
      name: RULE_PASSWORD_HISTORY.name,
    });
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe(1.0);
    expect(m!.matchSource).toBe('strict');
    expect(m!.osVersion).toBe('2025');
    expect(m!.ruleId).toBe('guid-pw-hist'); // from the id map
  });

  it('falls back to rule.ruleId when the id map is null', async () => {
    mockedLoadIdMap.mockResolvedValue(null);
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/Registry',
      name: RULE_PASSWORD_HISTORY.name,
    });
    expect(m!.ruleId).toBe('r-pw-hist');
  });

  it('honors a specific osVersion when supplied (and returns null if missing)', async () => {
    const m = await findCisRuleForResource(
      {
        type: 'Microsoft.Windows/Registry',
        name: RULE_PASSWORD_HISTORY.name,
      },
      '2022',
    );
    expect(m).toBeNull();
  });

  it('returns null when the resource name is not in the catalog', async () => {
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/Registry',
      name: 'Some unrelated thing',
    });
    expect(m).toBeNull();
  });
});

// ── Property-mapping fallback ──────────────────────────────────────────

describe('findCisRuleForResource — property-mapping fallback', () => {
  it('finds AccountPolicy rule via OSConfig property name', async () => {
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/AccountPolicy',
      name: 'unrelated-resource-name',
      properties: { name: 'PasswordHistorySize' },
    });
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe(0.7);
    expect(m!.matchSource).toBe('property-mapping');
    expect(m!.name).toBe(RULE_PASSWORD_HISTORY.name);
  });

  it('finds UserRightsAssignment rule via SE_*_NAME → privilege', async () => {
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/UserRightsAssignment',
      name: 'unrelated',
      properties: { name: 'SeSecurityPrivilege' },
    });
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe(0.7);
    expect(m!.name).toBe(RULE_SECURITY_LOG.name);
  });

  it('finds AuditPolicy rule via subcategory GUID', async () => {
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/AuditPolicy',
      name: 'unrelated',
      properties: { subcategory: '0CCE923F-69AE-11D9-BED3-505054503030' },
    });
    expect(m).not.toBeNull();
    expect(m!.confidence).toBe(0.7);
    expect(m!.name).toBe(RULE_CREDENTIAL_AUDIT.name);
  });

  it('returns null when global mappings are absent', async () => {
    mockedLoadGlobal.mockResolvedValue(null);
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/AccountPolicy',
      name: 'unrelated',
      properties: { name: 'PasswordHistorySize' },
    });
    expect(m).toBeNull();
  });

  it('strict match wins over property-mapping when both apply', async () => {
    const m = await findCisRuleForResource({
      type: 'Microsoft.Windows/AccountPolicy',
      name: RULE_PASSWORD_HISTORY.name, // strict-matches
      properties: { name: 'PasswordHistorySize' }, // would also property-match
    });
    expect(m!.matchSource).toBe('strict');
    expect(m!.confidence).toBe(1.0);
  });
});

// ── Bulk variant ───────────────────────────────────────────────────────

describe('findCisRulesForResources — bulk', () => {
  it('returns one match per resource (or null)', async () => {
    const matches = await findCisRulesForResources([
      { type: 'Microsoft.Windows/Registry', name: RULE_PASSWORD_HISTORY.name },
      { type: 'Microsoft.Windows/Registry', name: 'unrelated' },
      { type: 'Microsoft.Windows/Registry', name: RULE_SECURITY_LOG.name },
    ]);
    expect(matches).toHaveLength(3);
    expect(matches[0]!.name).toBe(RULE_PASSWORD_HISTORY.name);
    expect(matches[1]).toBeNull();
    expect(matches[2]!.name).toBe(RULE_SECURITY_LOG.name);
  });

  it('returns all-null when no catalogs are present', async () => {
    mockedLoadCatalog.mockResolvedValue(null);
    const matches = await findCisRulesForResources([
      { type: 'Microsoft.Windows/Registry', name: RULE_PASSWORD_HISTORY.name },
    ]);
    expect(matches).toEqual([null]);
  });

  it('skips resources with empty/non-string names', async () => {
    const matches = await findCisRulesForResources([
      // @ts-expect-error testing runtime behavior
      { type: 'X', name: undefined },
      // @ts-expect-error testing runtime behavior
      { type: 'X', name: 42 },
      { type: 'X', name: '' },
    ]);
    expect(matches).toEqual([null, null, null]);
  });
});
