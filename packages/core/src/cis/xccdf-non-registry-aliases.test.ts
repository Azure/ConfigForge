// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Regression tests for the alias fallbacks in `lookupNonRegistryInXccdf`
 * (UserRightsAssignment + AccountPolicy branches). These cover manifest
 * `properties.name` spellings whose normalized form doesn't share a key
 * with the OVAL-derived index (`userRightIndex` / `passwordPolicyIndex`),
 * where the fix is a minimal alias entry consulted only after the exact
 * lookup misses.
 *
 * Catalogs are synthetic (no CIS XCCDF/OVAL data is read or bundled —
 * that content is licensed and never committed to this repo). Each test
 * builds the minimal `XccdfCatalog` shape `lookupNonRegistryInXccdf`
 * actually reads: `rules` plus the specific reverse index under test.
 */

import { describe, expect, it } from 'vitest';
import { lookupNonRegistryInXccdf, type XccdfCatalog, type XccdfRule } from './xccdf-parser';

function makeRule(ruleId: string, title: string): XccdfRule {
  return {
    ruleId,
    title,
    description: '',
    severity: 'medium',
    fixtext: '',
    registryPaths: [],
    userRights: [],
    auditSubcategories: [],
    passwordPolicies: [],
  };
}

/** Minimal catalog — only populates the indices the function under test reads. */
function makeCatalog(opts: {
  rules: XccdfRule[];
  userRightIndex?: Record<string, number[]>;
  passwordPolicyIndex?: Record<string, number[]>;
  titleWordIndex?: Array<{ ruleIdx: number; words: string[] }>;
}): XccdfCatalog {
  return {
    rules: opts.rules,
    userRightIndex: new Map(Object.entries(opts.userRightIndex ?? {})),
    auditSubcategoryIndex: new Map(),
    passwordPolicyIndex: new Map(Object.entries(opts.passwordPolicyIndex ?? {})),
    titleWordIndex: opts.titleWordIndex ?? [],
  } as unknown as XccdfCatalog;
}

describe('lookupNonRegistryInXccdf — UserRightsAssignment alias fallback', () => {
  it('resolves SeIncreaseBasePriorityPrivilege to the "Increase scheduling priority" rule via alias', () => {
    // normalizeUserRight('SeIncreaseBasePriorityPrivilege') -> 'increasebasepriority'
    // OVAL side (SE_INC_BASE_PRIORITY_NAME) normalizes to 'incbasepriority' —
    // the two don't share a key without the alias.
    const catalog = makeCatalog({
      rules: [makeRule('R1', "Increase scheduling priority")],
      userRightIndex: { incbasepriority: [0] },
    });
    const hit = lookupNonRegistryInXccdf(
      catalog,
      'Microsoft.Windows/UserRightsAssignment',
      'unrelated-resource-name',
      'SeIncreaseBasePriorityPrivilege',
    );
    expect(hit?.ruleId).toBe('R1');
  });

  it('still prefers an exact userRightIndex match over the alias', () => {
    const catalog = makeCatalog({
      rules: [makeRule('EXACT', 'Exact rule'), makeRule('ALIASED', 'Aliased rule')],
      userRightIndex: { increasebasepriority: [0], incbasepriority: [1] },
    });
    const hit = lookupNonRegistryInXccdf(
      catalog,
      'Microsoft.Windows/UserRightsAssignment',
      'unrelated',
      'SeIncreaseBasePriorityPrivilege',
    );
    expect(hit?.ruleId).toBe('EXACT');
  });
});

describe('lookupNonRegistryInXccdf — AccountPolicy alias fallback', () => {
  it('resolves EnforcePasswordComplexity to the "Password must meet complexity requirements" rule via alias', () => {
    // normalizePasswordPolicy('EnforcePasswordComplexity') -> 'enforcepasswordcomplexity'
    // OVAL passwordpolicy_object comment side ("Password Complexity") normalizes
    // to 'passwordcomplexity' — the two don't share a key without the alias.
    const catalog = makeCatalog({
      rules: [makeRule('R1', "Password must meet complexity requirements")],
      passwordPolicyIndex: { passwordcomplexity: [0] },
    });
    const hit = lookupNonRegistryInXccdf(
      catalog,
      'Microsoft.Windows/AccountPolicy',
      'unrelated-resource-name',
      'EnforcePasswordComplexity',
    );
    expect(hit?.ruleId).toBe('R1');
  });

  it('resolves EnableGuestAccount to the guest-account-status rule via narrow title alias', () => {
    // normalizePasswordPolicy('EnableGuestAccount') -> 'enableguestaccount'
    // This CIS rule is backed by a SID-pattern OVAL object, so there is no
    // passwordPolicyIndex entry. The title alias must match all three words.
    const catalog = makeCatalog({
      rules: [makeRule('R1', "Accounts: Guest account status")],
      titleWordIndex: [
        { ruleIdx: 0, words: ['accounts', 'guest', 'account', 'status'] },
      ],
    });
    const hit = lookupNonRegistryInXccdf(
      catalog,
      'Microsoft.Windows/AccountPolicy',
      'unrelated-resource-name',
      'EnableGuestAccount',
    );
    expect(hit?.ruleId).toBe('R1');
  });

  it('still prefers an exact passwordPolicyIndex match over the alias', () => {
    const catalog = makeCatalog({
      rules: [makeRule('EXACT', 'Exact rule'), makeRule('ALIASED', 'Aliased rule')],
      passwordPolicyIndex: { enableguestaccount: [0] },
      titleWordIndex: [
        { ruleIdx: 1, words: ['accounts', 'guest', 'account', 'status'] },
      ],
    });
    const hit = lookupNonRegistryInXccdf(
      catalog,
      'Microsoft.Windows/AccountPolicy',
      'unrelated',
      'EnableGuestAccount',
    );
    expect(hit?.ruleId).toBe('EXACT');
  });

  it('returns null when neither the exact key nor the alias target is indexed (no regression)', () => {
    const catalog = makeCatalog({
      rules: [makeRule('R1', 'Unrelated rule')],
      passwordPolicyIndex: { somethingelse: [0] },
    });
    const hit = lookupNonRegistryInXccdf(
      catalog,
      'Microsoft.Windows/AccountPolicy',
      'unrelated',
      'EnableGuestAccount',
    );
    expect(hit).toBeNull();
  });
});
