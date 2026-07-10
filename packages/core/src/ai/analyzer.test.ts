// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  analyzeDiff,
  detectConflicts,
  explainDelta,
  generateChangelog,
  renderChangelogMarkdown,
  isCriticalSetting,
  isEnforcementField,
  CRITICAL_PATH_SUBSTRINGS,
  ENFORCEMENT_FIELD_KEYS,
} from './analyzer';

describe('manifest parsing contract', () => {
  it('rejects malformed before YAML instead of reporting a clean diff', () => {
    expect(() => analyzeDiff('{{{', 'resources: []\n')).toThrow(
      /Invalid before manifest YAML/i,
    );
  });

  it('rejects malformed after YAML', () => {
    expect(() => analyzeDiff('resources: []\n', 'resources: [')).toThrow(
      /Invalid after manifest YAML/i,
    );
  });

  it('rejects documents without a resources array', () => {
    expect(() => analyzeDiff('name: before\n', 'resources: []\n')).toThrow(
      /before manifest: resources must be an array/i,
    );
  });

  it('continues to accept valid empty manifests', () => {
    const result = analyzeDiff('resources: []\n', 'Resources: []\n');
    expect(result.summary).toBe('No differences detected between manifests');
    expect(result.riskLevel).toBe('low');
  });

  it('rejects changelog generation when either manifest is malformed', () => {
    expect(() => generateChangelog('{{{', 'resources: []\n', 'baseline')).toThrow(
      /Invalid before manifest YAML/i,
    );
  });

  it('identifies the malformed manifest during conflict detection', () => {
    expect(() =>
      detectConflicts([
        { name: 'good', content: 'resources: []\n' },
        { name: 'broken', content: '{{{' },
      ]),
    ).toThrow(/Invalid 'broken' manifest YAML/i);
  });
});

// ── isCriticalSetting ──────────────────────────────────────────────────────

describe('isCriticalSetting', () => {
  it.each([
    'HKLM:\\System\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
    'HKLM:\\System\\CurrentControlSet\\Control\\Lsa',
    'HKLM:\\System\\CurrentControlSet\\Services\\Kerberos\\Parameters',
    'HKLM:\\Software\\Policies\\Microsoft\\WindowsFirewall',
    'HKLM:\\Software\\Policies\\Microsoft\\Windows\\WindowsUpdate',
    'HKLM:\\System\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    'HKLM:\\System\\CurrentControlSet\\Control\\SecurityProviders',
    'HKLM:\\System\\CurrentControlSet\\Services\\EventLog\\Security',
    'HKLM:\\Software\\Microsoft\\Windows Defender',
    'HKLM:\\System\\CurrentControlSet\\Control\\Session Manager',
  ])('classifies %s as critical', (path) => {
    expect(isCriticalSetting({ name: 'r', properties: { keyPath: path } })).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(
      isCriticalSetting({
        name: 'r',
        properties: { keyPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\LSA' },
      }),
    ).toBe(true);
  });

  it('reads from `path` and `Path` aliases', () => {
    expect(isCriticalSetting({ name: 'r', properties: { path: 'firewall' } })).toBe(true);
    expect(isCriticalSetting({ name: 'r', properties: { Path: 'security' } })).toBe(true);
  });

  it.each([
    'HKLM:\\Software\\Vendor\\App\\Telemetry',
    'HKCU:\\Console',
    '/etc/motd',
    'desktop wallpaper',
  ])('does NOT classify %s as critical', (path) => {
    expect(isCriticalSetting({ name: 'r', properties: { keyPath: path } })).toBe(false);
  });

  it('returns false when path is missing or non-string', () => {
    expect(isCriticalSetting({ name: 'r', properties: {} })).toBe(false);
    expect(isCriticalSetting({ name: 'r' })).toBe(false);
    expect(isCriticalSetting({ name: 'r', properties: { keyPath: 42 as unknown as string } })).toBe(false);
    expect(isCriticalSetting({ name: 'r', properties: { keyPath: '' } })).toBe(false);
  });

  it('exposes the pattern list for ad-hoc inspection', () => {
    expect(CRITICAL_PATH_SUBSTRINGS).toContain('lsa');
    expect(CRITICAL_PATH_SUBSTRINGS).toContain('windowsfirewall');
  });
});

// ── isEnforcementField ─────────────────────────────────────────────────────

describe('isEnforcementField', () => {
  it.each([
    'value',
    'data',
    'desired',
    'enforce',
    'enforcement',
    'desiredState',
    'Value',
    'DATA',
  ])('classifies %s as enforcement (case-insensitive top-level)', (f) => {
    expect(isEnforcementField(f)).toBe(true);
  });

  it.each([
    'value.dword',
    'value.string',
    'value.qword',
    'value.multistring',
    'value.expandstring',
    'value.binary',
    'data.string',
    'desired.equals',
  ])('classifies dotted enforcement paths %s', (f) => {
    expect(isEnforcementField(f)).toBe(true);
  });

  it.each([
    'valueName',
    'valueData', // looks like value+Data but it is a singular identifier name
    'metadata',
    'description',
    'compliance.equals',
    'enforced.byPolicy', // 'enforced' isn't in the set; only 'enforce'/'enforcement'
    'auditEnforce', // substring match would mis-classify; we don't
    'name',
    'type',
    'keyPath',
  ])('does NOT classify look-alike %s as enforcement', (f) => {
    expect(isEnforcementField(f)).toBe(false);
  });

  it('exposes the key set for ad-hoc inspection', () => {
    expect(ENFORCEMENT_FIELD_KEYS.has('value')).toBe(true);
    expect(ENFORCEMENT_FIELD_KEYS.has('valuename')).toBe(false);
  });
});

// ── analyzeDiff regression tests for the heuristic fixes ───────────────────

function manifestWith(resources: Array<Record<string, unknown>>): string {
  return yaml.dump({ resources });
}

describe('analyzeDiff — regression tests for analyzer correctness fixes', () => {
  it('promotes risk to high when a CIS-relevant LSA registry setting changes', () => {
    const before = manifestWith([
      {
        name: 'lsa-restrict',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\Control\\Lsa',
          valueName: 'RestrictAnonymous',
          value: { dword: 0 },
        },
      },
    ]);
    const after = manifestWith([
      {
        name: 'lsa-restrict',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\Control\\Lsa',
          valueName: 'RestrictAnonymous',
          value: { dword: 1 },
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.riskLevel).toBe('high');
  });

  it('does NOT escalate risk when only `valueName` changes (target rename, not enforcement)', () => {
    // valueName is the registry value identifier, not an enforcement field.
    // Old code's substring "value" match treated this as enforcement.
    const before = manifestWith([
      {
        name: 'audit',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\Software\\Vendor\\App',
          valueName: 'OldName',
          value: { dword: 1 },
        },
      },
    ]);
    const after = manifestWith([
      {
        name: 'audit',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\Software\\Vendor\\App',
          valueName: 'NewName',
          value: { dword: 1 },
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    // valueName is not in ENFORCEMENT_FIELD_KEYS, so the change goes to the
    // non-enforcement bucket; non-critical path keeps risk at low/medium.
    expect(r.riskLevel).not.toBe('high');
  });

  it('counts `value.dword` change under enforcement (dotted path matched)', () => {
    const before = manifestWith([
      {
        name: 'r',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\Software\\Vendor', value: { dword: 1 } },
      },
    ]);
    const after = manifestWith([
      {
        name: 'r',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\Software\\Vendor', value: { dword: 2 } },
      },
    ]);
    const r = analyzeDiff(before, after);
    // Non-critical path so medium, not high; but enforcement count > 0 ensures
    // it's not classified as compliance-only.
    expect(r.summary).toMatch(/enforcement value/);
  });

  it('treats LanmanServer parameter changes as critical (CIS hive)', () => {
    const before = manifestWith([
      {
        name: 'autodisconnect',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
          valueName: 'AutoDisconnect',
          value: { dword: 15 },
        },
      },
    ]);
    const after = manifestWith([
      {
        name: 'autodisconnect',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
          valueName: 'AutoDisconnect',
          value: { dword: 30 },
        },
      },
    ]);
    expect(analyzeDiff(before, after).riskLevel).toBe('high');
  });

  it('returns "low" risk for no-change input', () => {
    const m = manifestWith([
      { name: 'r', properties: { keyPath: 'HKLM:\\Software\\App', value: { dword: 1 } } },
    ]);
    expect(analyzeDiff(m, m).riskLevel).toBe('low');
  });

  // ── Regression: detect changes on resource-level fields like `compliance` ──
  //
  // Pre-fix: analyzeDiff only flattened `resource.properties`, so manifests
  // that differed ONLY on `resource.compliance.equals` (a sibling of
  // properties, not nested under it) ended up with empty `changedResources`
  // and a misleading "No differences detected between manifests" summary —
  // even though the Diff page's line-diff and DiffViewer showed an obvious
  // delta. Reported via in-app probe on the Diff page.
  it('detects changes on resource-level compliance.equals (not nested under properties)', () => {
    const before = manifestWith([
      {
        name: 'Setting1',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\Software\\Test',
          valueName: 'ValA',
          valueType: 'Dword',
        },
        compliance: { equals: 1 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Setting1',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\Software\\Test',
          valueName: 'ValA',
          valueType: 'Dword',
        },
        compliance: { equals: 0 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.summary).not.toMatch(/No differences detected/);
    expect(r.changedResources).toHaveLength(1);
    expect(r.changedResources[0]).toMatchObject({
      name: 'Setting1',
      field: 'compliance.equals',
      from: 1,
      to: 0,
    });
    // compliance-only field per isComplianceOnlyField — risk should stay low,
    // not escalate to medium/high.
    expect(r.riskLevel).toBe('low');
  });

  it('detects changes on other top-level resource fields (dependsOn, condition)', () => {
    const before = manifestWith([
      {
        name: 'r',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\Software\\Vendor', value: { dword: 1 } },
        dependsOn: 'r-bootstrap',
        condition: 'OnDC',
      },
    ]);
    const after = manifestWith([
      {
        name: 'r',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\Software\\Vendor', value: { dword: 1 } },
        dependsOn: 'r-bootstrap-v2',
        condition: 'OnMember',
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.summary).not.toMatch(/No differences detected/);
    // Both fields should be picked up as changes.
    const fields = r.changedResources.map((c) => c.field).sort();
    expect(fields).toEqual(['condition', 'dependsOn']);
  });

  it('still keeps properties.* paths flat (no `properties.` prefix) — preserves the existing isEnforcementField contract', () => {
    // `value.dword` must remain `value.dword` (not `properties.value.dword`)
    // so the first-segment match against ENFORCEMENT_FIELD_KEYS keeps working.
    const before = manifestWith([
      {
        name: 'r',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\Software\\Vendor', value: { dword: 1 } },
      },
    ]);
    const after = manifestWith([
      {
        name: 'r',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\Software\\Vendor', value: { dword: 9 } },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.changedResources).toHaveLength(1);
    expect(r.changedResources[0].field).toBe('value.dword');
  });

  // ── Semantic-identity matching (2026-05-19) ──
  //
  // Reported as: "diffing a Windows 2019 baseline and 2025 will put the
  // same rule in both before and after if the rule is in a different
  // place within the yaml/json/csv". Root cause: the previous
  // `resourceKey` was `r.name ?? r.type`, so two manifests that target
  // the same registry value but cosmetically rename the rule
  // (`EnsureFoo-WS2019` → `EnsureFoo`) produced a phantom add + remove
  // pair. Matrix diff already keys by `${type}:${keyPath}\\${valueName}`;
  // analyzeDiff now does too.
  it('matches same registry rule across cosmetic name changes (Win2019→Win2025 scenario)', () => {
    const before = manifestWith([
      {
        name: 'EnsureAuditUserAccountManagement-WS2019',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\Audit',
          valueName: 'AuditUserMgmt',
          valueType: 'Dword',
        },
        compliance: { equals: 1 },
      },
      {
        name: 'EnsureRDPDisabled',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\TerminalServer',
          valueName: 'fDenyTSConnections',
          valueType: 'Dword',
        },
        compliance: { equals: 1 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'EnsureAuditUserAccountManagement',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\Audit',
          valueName: 'AuditUserMgmt',
          valueType: 'Dword',
        },
        compliance: { equals: 1 },
      },
      {
        name: 'EnsureRDPDisabled',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\CurrentControlSet\\TerminalServer',
          valueName: 'fDenyTSConnections',
          valueType: 'Dword',
        },
        compliance: { equals: 1 },
      },
    ]);
    const r = analyzeDiff(before, after);
    // No phantom add or remove — both rules match across the rename.
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
    // The renamed rule surfaces as a `name` field change so audit trail
    // is still complete.
    const nameChanges = r.changedResources.filter((c) => c.field === 'name');
    expect(nameChanges).toHaveLength(1);
    expect(nameChanges[0]).toMatchObject({
      name: 'EnsureAuditUserAccountManagement', // after-name, not before
      field: 'name',
      from: 'EnsureAuditUserAccountManagement-WS2019',
      to: 'EnsureAuditUserAccountManagement',
    });
  });

  it('rename + value change reports BOTH changes on the same matched resource (not as add+remove)', () => {
    const before = manifestWith([
      {
        name: 'OldName',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\X', valueName: 'V', valueType: 'Dword' },
        compliance: { equals: 1 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'NewName',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\X', valueName: 'V', valueType: 'Dword' },
        compliance: { equals: 0 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
    const fields = r.changedResources.map((c) => c.field).sort();
    expect(fields).toContain('name');
    expect(fields).toContain('compliance.equals');
    // Both changes carry the AFTER name for readability.
    for (const c of r.changedResources) {
      expect(c.name).toBe('NewName');
    }
  });

  it('genuine add/remove still reported when keyPath/valueName differ', () => {
    // Different rules (different registry values) → still appear as
    // add+remove. The fix only suppresses PHANTOM add+removes from
    // cosmetic renames, not real ones.
    const before = manifestWith([
      {
        name: 'A',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\X', valueName: 'V1', valueType: 'Dword' },
        compliance: { equals: 1 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'B',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\X', valueName: 'V2', valueType: 'Dword' },
        compliance: { equals: 1 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual(['B']);
    expect(r.removedResources).toEqual(['A']);
    expect(r.changedResources).toEqual([]);
  });

  it('matches across Test-wrapper boundary (unwraps inner resource for identity)', () => {
    // Win 2019 baseline might wrap a registry check in a Test gate,
    // Win 2025 baseline (or vice versa) might inline it. Either form
    // is semantically the same setting.
    const before = manifestWith([
      {
        name: 'AuditPolicyCheck',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            name: 'AuditPolicy',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\System\\Audit',
              valueName: 'PolicyEnabled',
              valueType: 'Dword',
            },
          },
          expression: 'value == 1',
        },
      },
    ]);
    const after = manifestWith([
      {
        name: 'AuditPolicyEnabled',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKLM:\\System\\Audit',
          valueName: 'PolicyEnabled',
          valueType: 'Dword',
        },
        compliance: { equals: 1 },
      },
    ]);
    const r = analyzeDiff(before, after);
    // Same semantic setting — no phantom add+remove.
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
  });

  it('matches BaselineRule placeholders by ruleId across catalog refreshes', () => {
    // Imported Azure Policy GC baseline placeholder. ruleId is the
    // stable identity; displayName / settingName can drift between
    // catalog versions.
    const before = manifestWith([
      {
        name: '1_1_1_1_Ensure_cramfs_kernel_module_is_not_available',
        type: 'Microsoft.OSConfig/BaselineRule',
        properties: {
          ruleId: '2b568469-ea61-c184-66ba-db6720414ddd',
          displayName: '1.1.1.1 Ensure cramfs kernel module is not available',
          severity: 'Critical',
        },
      },
    ]);
    const after = manifestWith([
      {
        name: '1_1_1_2_Ensure_cramfs_kernel_module_is_not_available_renumbered',
        type: 'Microsoft.OSConfig/BaselineRule',
        properties: {
          ruleId: '2b568469-ea61-c184-66ba-db6720414ddd', // same stable ruleId
          displayName: '1.1.1.2 Ensure cramfs kernel module is not available',
          severity: 'High', // severity changed in the new catalog
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
    // Severity change should surface as a normal field change.
    const sev = r.changedResources.find((c) => c.field === 'severity');
    expect(sev).toBeDefined();
    expect(sev?.from).toBe('Critical');
    expect(sev?.to).toBe('High');
  });

  // ── Name normalization + schema-canonical identity (2026-05-20) ──
  //
  // Reported scenario: diffing Windows Server 2019 Member Server against
  // Windows Server 2025 Workgroup Member showed the SAME rule on both
  // sides (added AND removed) for many rules — root cause: one baseline
  // concatenates the name (`AuditLogon`) and the other puts spaces
  // (`Audit Logon`). Same logical setting, different naming convention.
  //
  // Fix splits into two parts:
  //  1. Use schema-canonical identity fields (AuditPolicy.subcategory,
  //     UserRightsAssignment.policy, AccountPolicy.policy) for matching
  //     instead of falling back to display name when the type doesn't
  //     have a Registry-style keyPath+valueName.
  //  2. Normalize the display name (lowercase + strip non-alphanumeric)
  //     as a last-resort fallback so even custom resource types whose
  //     only identifier is the name match across spacing/punctuation
  //     drift.
  it('matches AuditPolicy resources by subcategory regardless of display name spacing', () => {
    const before = manifestWith([
      {
        name: 'AuditLogon', // concatenated style (WS2019 baseline)
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: 'AuditLogon', value: 3 },
      },
      {
        name: 'AuditAccountLockout',
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: 'AuditAccountLockout', value: 2 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Audit Logon', // spaced style (WS2025 baseline)
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: 'AuditLogon', value: 3 },
      },
      {
        name: 'Audit Account Lockout',
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: 'AuditAccountLockout', value: 2 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
    // Renames surface as field-level changes, not as duplicate add+remove.
    const nameChanges = r.changedResources.filter((c) => c.field === 'name');
    expect(nameChanges).toHaveLength(2);
  });

  it('matches UserRightsAssignment by policy enum (privilege SID name)', () => {
    const before = manifestWith([
      {
        name: 'SeAssignPrimaryTokenPrivilege',
        type: 'Microsoft.Windows/UserRightsAssignment',
        properties: {
          policy: 'SeAssignPrimaryTokenPrivilege',
          value: ['BUILTIN\\Administrators'],
        },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Replace a process level token', // human-readable name
        type: 'Microsoft.Windows/UserRightsAssignment',
        properties: {
          policy: 'SeAssignPrimaryTokenPrivilege',
          value: ['BUILTIN\\Administrators'],
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
  });

  it('matches AccountPolicy by policy enum (MinimumPasswordLength, etc.)', () => {
    const before = manifestWith([
      {
        name: 'MinimumPasswordLength',
        type: 'Microsoft.Windows/AccountPolicy',
        properties: { policy: 'MinimumPasswordLength', value: 14 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Minimum Password Length', // spaced style
        type: 'Microsoft.Windows/AccountPolicy',
        properties: { policy: 'MinimumPasswordLength', value: 14 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
  });

  it('normalizes display names (lowercase + strip non-alphanumeric) for fallback matching', () => {
    // Custom resource types with no schema-canonical identity should
    // still match across naming-convention drift via name normalization.
    const before = manifestWith([
      {
        name: 'PasswordAge_Maximum', // underscore style
        type: 'Some.Custom/Type',
        properties: { value: 90 },
      },
      {
        name: 'enforce-password-history',
        type: 'Some.Custom/Type',
        properties: { value: 24 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Password Age Maximum', // spaced style
        type: 'Some.Custom/Type',
        properties: { value: 90 },
      },
      {
        name: 'EnforcePasswordHistory', // concatenated style
        type: 'Some.Custom/Type',
        properties: { value: 24 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
  });

  it('does NOT confuse genuinely different rules that happen to share a substring', () => {
    // Negative control: "AuditLogon" and "AuditLogonEvents" normalize
    // to "auditlogon" and "auditlogonevents" — different keys, still
    // reported as add+remove (correctly).
    const before = manifestWith([
      {
        name: 'AuditLogon',
        type: 'Some.Custom/Type',
        properties: { value: 1 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'AuditLogonEvents',
        type: 'Some.Custom/Type',
        properties: { value: 1 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual(['AuditLogonEvents']);
    expect(r.removedResources).toEqual(['AuditLogon']);
  });

  it('matches same normalized name across different types via Pass 2 (cross-type bridge)', () => {
    // Updated v0.2.5: the old "negative control" (same name +
    // different type → must stay distinct) is invalidated by the
    // intentional cross-type Pass 2 bridge. The user wants WS2019's
    // Microsoft.Windows/AccountPolicy to match WS2025's
    // Microsoft.Windows/CSP for the same logical setting, even
    // though the type changed.
    //
    // Pass 1 keys these as different (one has AccountPolicy.policy
    // structural identity, the other has only a generic name); Pass
    // 2 normalizes both names to "passwordpolicy" and matches.
    const before = manifestWith([
      {
        name: 'PasswordPolicy',
        type: 'Microsoft.Windows/AccountPolicy',
        properties: { policy: 'MinimumPasswordLength', value: 14 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Password Policy',
        type: 'Some.Other/Type',
        properties: { value: 14 },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
  });

  // ── 2-pass cross-type matching (2026-05-20) ──
  //
  // Reported scenario: diffing WS2019 (which uses Microsoft.Windows/
  // AuditPolicy + UserRightsAssignment + AccountPolicy) against WS2025
  // (which Test-wraps Microsoft.Windows/Registry + Microsoft.Windows/CSP)
  // produced 25 phantom-rename pairs because the same logical rule was
  // encoded with TWO DIFFERENT types between baselines. Pass 1
  // structural-identity matching is type-prefixed, so cross-type
  // pairs miss it. Pass 2 fallback matches remaining unmatched
  // resources by normalized display name regardless of type.
  it('matches a rule across resource-type changes via normalized display name (Pass 2)', () => {
    // Simulates WS2019 → WS2025 type shift: AuditPolicy → Test-wrapped CSP,
    // same logical rule, with the WS2019-style spaced name vs WS2025-style
    // concatenated name. Pass 1 (structural identity) keys them as
    // `Microsoft.Windows/AuditPolicy:AuditAccountLockout` vs
    // `Microsoft.Windows/CSP:./Vendor/.../AccountLockout` — no match.
    // Pass 2 sees their display names normalize to the same string and
    // bridges the gap.
    const before = manifestWith([
      {
        name: 'Audit Account Lockout',
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: 'AuditAccountLockout', value: 3 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'AuditAccountLockout',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            type: 'Microsoft.Windows/CSP',
            properties: {
              path: './Vendor/MSFT/Policy/Config/Audit/AccountLockout',
              type: 'integer',
              value: 3,
            },
          },
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
  });

  it('Pass 2 does NOT over-match — first unmatched after-resource per normalized name claims the slot', () => {
    // Two unmatched before-resources both normalize to the same name?
    // Only the first finds a match in after — the second stays
    // genuinely unmatched. Prevents silently collapsing distinct
    // settings that happen to normalize to the same name.
    const before = manifestWith([
      {
        name: 'audit-logon',
        type: 'Some.Custom/Type',
        properties: { value: 1 },
      },
      {
        name: 'AuditLogon',
        type: 'Other.Custom/Type',
        properties: { value: 2 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Audit Logon',
        type: 'Yet.Another/Type',
        properties: { value: 3 },
      },
    ]);
    const r = analyzeDiff(before, after);
    // One of the two before-resources matches the after-resource;
    // the other stays in removedResources.
    expect(r.removedResources).toHaveLength(1);
    expect(r.addedResources).toHaveLength(0);
  });

  it('cross-type match reports ONLY the enforcement-value diff (Pass-2 quiet mode)', () => {
    // After v0.2.5 introduced Pass-2 cross-type matching, a naive
    // field-level flatten-diff over the two encodings reported every
    // structural-field difference as a change (700+ noise rows for
    // a real WS2019 vs WS2025 diff). v0.2.6 quiets that down to
    // just the enforcement-value diff for cross-type matches.
    //
    // Same logical rule, same value (2), different encoding:
    //   WS2019: Microsoft.Windows/AuditPolicy with subcategory+value
    //   WS2025: Microsoft.OSConfig/Test wrapping CSP with path+value
    // Expected: zero changes reported (the rule is the same in both).
    const before = manifestWith([
      {
        name: 'Audit Account Lockout',
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: 'AuditAccountLockout', value: 2 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'AuditAccountLockout',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            type: 'Microsoft.Windows/CSP',
            properties: {
              path: './Vendor/MSFT/Policy/Config/Audit/AccountLockout',
              type: 'integer',
              value: 2,
            },
          },
          schema: { enum: [2, 3] },
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
    expect(r.changedResources).toEqual([]);
    expect(r.summary).toMatch(/No differences detected/);
  });

  it('cross-type match WITH value drift reports exactly one clean change', () => {
    // Same scenario as above, but the value drifted from 2 to 3.
    // Expected: ONE row, field "value", from 2, to 3 — not a cascade
    // of structural-field noise.
    const before = manifestWith([
      {
        name: 'Audit Account Lockout',
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: 'AuditAccountLockout', value: 2 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'AuditAccountLockout',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            type: 'Microsoft.Windows/CSP',
            properties: {
              path: './Vendor/MSFT/Policy/Config/Audit/AccountLockout',
              type: 'integer',
              value: 3,
            },
          },
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.changedResources).toHaveLength(1);
    expect(r.changedResources[0]).toMatchObject({
      name: 'AuditAccountLockout',
      field: 'value',
      from: 2,
      to: 3,
    });
  });

  it('cross-type match: compliance.equals beats inline value (matches matrix-diff contract)', () => {
    // The enforcement-value extractor follows the same priority chain
    // as the matrix builder: compliance.equals > properties.value >
    // properties.data > properties.desired > properties.Value.
    const before = manifestWith([
      {
        name: 'EnforceFoo',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\X', valueName: 'Y', valueType: 'Dword' },
        compliance: { equals: 7 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'Enforce Foo',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            type: 'Microsoft.Windows/CSP',
            properties: { path: './SomeDifferent/Path', type: 'integer', value: 7 },
          },
        },
      },
    ]);
    const r = analyzeDiff(before, after);
    expect(r.changedResources).toEqual([]);
    expect(r.addedResources).toEqual([]);
    expect(r.removedResources).toEqual([]);
  });

  it('same-type match still does the FULL field flatten-diff (no change in v0.2.6 behavior)', () => {
    // Negative control: when both resources share a type, the
    // existing flatten-diff applies (rename surfaces as `name`
    // field change; value change surfaces as `value` field change;
    // etc.). v0.2.6's cross-type quiet path is only for type
    // mismatches.
    const before = manifestWith([
      {
        name: 'OldName',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\X', valueName: 'V', valueType: 'Dword' },
        compliance: { equals: 1 },
      },
    ]);
    const after = manifestWith([
      {
        name: 'NewName',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM:\\X', valueName: 'V', valueType: 'Dword' },
        compliance: { equals: 2 },
      },
    ]);
    const r = analyzeDiff(before, after);
    const fields = r.changedResources.map((c) => c.field).sort();
    expect(fields).toContain('name');
    expect(fields).toContain('compliance.equals');
  });
});

// ── explainDelta (PR23) ────────────────────────────────────────────────────

describe('explainDelta', () => {
  const RULE = { type: 'Microsoft.Windows/Registry', name: 'MaxAuthTries' };

  it('returns "no delta" when values are equal', () => {
    const out = explainDelta(RULE, 3, 3, ['WS2022', 'WS2025']);
    expect(out.confidence).toBe(1);
    expect(out.explanation).toMatch(/no delta/i);
  });

  it('explains a numeric "lower is stricter" delta directionally', () => {
    const out = explainDelta(RULE, 5, 3, ['WS2022', 'WS2025']);
    expect(out.explanation).toMatch(/WS2025.*stricter/);
    expect(out.explanation).toMatch(/3/);
    expect(out.explanation).toMatch(/5/);
    expect(out.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('explains a numeric "higher is stricter" delta directionally', () => {
    const out = explainDelta(
      { type: 'Microsoft.Windows/Registry', name: 'MinimumPasswordLength' },
      8,
      14,
      ['Old', 'New'],
    );
    expect(out.explanation).toMatch(/New.*stricter/);
    expect(out.explanation).toMatch(/14/);
  });

  it('falls back to a generic numeric narrative for unknown rules', () => {
    const out = explainDelta(
      { type: 'Microsoft.Windows/Registry', name: 'WeirdSetting' },
      1,
      2,
      ['A', 'B'],
    );
    expect(out.explanation).toMatch(/A.*1/);
    expect(out.explanation).toMatch(/B.*2/);
    expect(out.confidence).toBeLessThan(0.7);
  });

  it('explains boolean deltas as enable/disable', () => {
    const out = explainDelta(
      { type: 'Microsoft.Windows/Registry', name: 'EnableFirewall' },
      true,
      false,
      ['Strict', 'Lax'],
    );
    expect(out.explanation).toMatch(/Strict.*enables/);
    expect(out.explanation).toMatch(/Lax.*disables/);
  });

  it('flags only-in-one when a side is undefined', () => {
    const out = explainDelta(RULE, undefined, 3, ['A', 'B']);
    expect(out.explanation).toMatch(/only enforced in B/);
    expect(out.explanation).toMatch(/A leaves it unmanaged/);
  });

  it('is deterministic — same input produces same output', () => {
    const a = explainDelta(RULE, 5, 3, ['WS2022', 'WS2025']);
    const b = explainDelta(RULE, 5, 3, ['WS2022', 'WS2025']);
    expect(a).toEqual(b);
  });
});

// ── renderChangelogMarkdown ──────────────────────────────────────────────────

describe('renderChangelogMarkdown', () => {
  const before = `resources:
  - name: A
    type: Microsoft.Windows/Registry
    properties: { value: 1 }
  - name: B
    type: Microsoft.Windows/Registry
    properties: { value: 5 }
`;
  const after = `resources:
  - name: A
    type: Microsoft.Windows/Registry
    properties: { value: 2 }
  - name: C
    type: Microsoft.Windows/Registry
    properties: { value: 9 }
`;

  it('produces a markdown document with title, date, and grouped sections', () => {
    const cl = generateChangelog(before, after, 'my-baseline');
    const md = renderChangelogMarkdown(cl, { beforeLabel: 'v1', afterLabel: 'v2' });

    expect(md).toMatch(/^# Changelog — my-baseline/m);
    expect(md).toMatch(/Generated \d{4}-\d{2}-\d{2}/);
    expect(md).toMatch(/Comparing \*\*v1\*\* → \*\*v2\*\*/);
    expect(md).toMatch(/## Added \(1\)/);
    expect(md).toMatch(/## Removed \(1\)/);
    expect(md).toMatch(/## Changed \(1\)/);
    expect(md).toContain('`C`');
    expect(md).toContain('`B`');
    expect(md).toMatch(/\*\*A → value\*\*/);
  });

  it('renders empty changelog message when there are no changes', () => {
    const cl = generateChangelog(before, before, 'unchanged');
    const md = renderChangelogMarkdown(cl);
    expect(md).toContain('No changes detected.');
    expect(md).not.toMatch(/## Added/);
    expect(md).not.toMatch(/## Removed/);
    expect(md).not.toMatch(/## Changed/);
  });

  it('omits sections that are empty', () => {
    // before -> after where only one resource value changes (no add/remove)
    const onlyChanged = generateChangelog(
      'resources:\n  - name: A\n    type: T\n    properties: { value: 1 }\n',
      'resources:\n  - name: A\n    type: T\n    properties: { value: 2 }\n',
      'm',
    );
    const md = renderChangelogMarkdown(onlyChanged);
    expect(md).toMatch(/## Changed \(1\)/);
    expect(md).not.toMatch(/## Added/);
    expect(md).not.toMatch(/## Removed/);
  });

  it('uses default before/after labels when not provided', () => {
    const cl = generateChangelog(before, after, 'm');
    const md = renderChangelogMarkdown(cl);
    expect(md).toMatch(/Comparing \*\*before\*\* → \*\*after\*\*/);
  });

  it('is tagged as ai-generated so the circular-reference guard rejects it', () => {
    const cl = generateChangelog(before, after, 'm');
    const md = renderChangelogMarkdown(cl);
    expect(md).toMatch(/<!--\s*ai-generated/i);
  });

  it('handles undefined from/to values cleanly', () => {
    const cl = generateChangelog('resources: []\n', 'resources:\n  - name: X\n    type: T\n', 'm');
    const md = renderChangelogMarkdown(cl);
    // Added section should render the new resource without "(unset)" lines
    expect(md).toMatch(/## Added \(1\)/);
    expect(md).toContain('`X`');
  });

  it('escapes nothing — values are wrapped in backticks for markdown safety', () => {
    const md = renderChangelogMarkdown({
      date: '2026-04-29',
      manifestName: 'm',
      changes: [{ field: 'A → value', from: '<script>', to: '&amp;' }],
    });
    expect(md).toContain('`<script>` → `&amp;`');
  });
});


// ── detectConflicts ────────────────────────────────────────────────────────
//
// v0.2.16: cross-manifest conflict detection rewritten to use the
// canonical resourceKey()/extractEnforcementValue() helpers instead of
// the naive `${type}|${keyPath}` + `props.value` lookup. These tests
// pin the bug scenarios the user reported:
//
//   1) Two baselines with different values for the same Registry
//      keyPath+valueName are correctly flagged as conflicts (this
//      USED to work for some shapes, broken for others).
//   2) Same keyPath with different valueName is NOT a conflict —
//      they're independent settings.
//   3) A Test-wrapped Registry resource and a bare Registry
//      resource for the same setting+different values IS a conflict.
//   4) Settings whose enforcement value lives in compliance.equals
//      (instead of properties.value) are now considered.
//   5) Same setting, same value across all manifests is not a
//      conflict.

describe('detectConflicts', () => {
  it('flags two baselines that set the same registry value to different values', () => {
    const a = `resources:
  - name: BaselineSettingA
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Foo
      valueName: EnableFoo
      valueType: Dword
      value: 1
`;
    const b = `resources:
  - name: BaselineSettingB
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Foo
      valueName: EnableFoo
      valueType: Dword
      value: 0
`;
    const { conflicts } = detectConflicts([
      { name: 'WS2019', content: a },
      { name: 'WS2025', content: b },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.manifests.sort()).toEqual(['WS2019', 'WS2025']);
    expect(conflicts[0]!.values).toEqual([1, 0]);
  });

  it('does NOT flag two resources with same keyPath but different valueName', () => {
    // Independent settings — under the v0.2.15 implementation these
    // collapsed into a single bucket and the differing values were
    // reported as a spurious conflict.
    const a = `resources:
  - name: Foo
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Same\\Key
      valueName: EnableFoo
      value: 1
`;
    const b = `resources:
  - name: Bar
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Same\\Key
      valueName: EnableBar
      value: 2
`;
    const { conflicts } = detectConflicts([
      { name: 'BaselineA', content: a },
      { name: 'BaselineB', content: b },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('unwraps Microsoft.OSConfig/Test wrappers so bare vs wrapped collide', () => {
    const bare = `resources:
  - name: EnableX
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Foo
      valueName: EnableX
      value: 1
`;
    const wrapped = `resources:
  - name: EnableX-Test
    type: Microsoft.OSConfig/Test
    properties:
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKLM\\SOFTWARE\\Policies\\Foo
          valueName: EnableX
          value: 0
`;
    const { conflicts } = detectConflicts([
      { name: 'WS2019', content: bare },
      { name: 'WS2025', content: wrapped },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.values).toEqual([1, 0]);
  });

  it('detects conflicts on compliance.equals (no properties.value)', () => {
    // Report-only manifests that only declare an expected value in
    // compliance.equals — the v0.2.15 implementation dropped these
    // silently because it only looked at properties.value.
    const a = `resources:
  - name: AuditLogon
    type: Microsoft.Windows/AuditPolicy
    properties:
      subcategory: AuditLogon
    compliance:
      equals: SuccessAndFailure
`;
    const b = `resources:
  - name: Audit Logon
    type: Microsoft.Windows/AuditPolicy
    properties:
      subcategory: AuditLogon
    compliance:
      equals: Success
`;
    const { conflicts } = detectConflicts([
      { name: 'CIS-A', content: a },
      { name: 'CIS-B', content: b },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.values).toEqual(['SuccessAndFailure', 'Success']);
  });

  it('does NOT flag two baselines that set the same setting to the same value', () => {
    const same = `resources:
  - name: EnableFoo
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Foo
      valueName: EnableFoo
      value: 1
`;
    const { conflicts } = detectConflicts([
      { name: 'A', content: same },
      { name: 'B', content: same },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('unwraps typed registry values like { dword: 1 }', () => {
    const a = `resources:
  - name: EnableFoo
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Foo
      valueName: EnableFoo
      value:
        dword: 1
`;
    const b = `resources:
  - name: EnableFoo
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Foo
      valueName: EnableFoo
      value:
        dword: 0
`;
    const { conflicts } = detectConflicts([
      { name: 'A', content: a },
      { name: 'B', content: b },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.values).toEqual([1, 0]);
  });
});


// ── detectConflicts: cross-encoding normalize bridge (v0.2.18) ───────────
//
// Doubly-confirmed: the Pass-2 normalized-name match treats spaced
// human-readable rule names and CamelCase rule IDs as the same logical
// rule. This is the exact case the user asked about — WS2019 ships
// rules with spaced display names ("Audit Account Lockout") and WS2025
// ships them as CamelCase concatenated IDs ("AuditAccountLockout").

describe('detectConflicts — Pass-2 normalize bridges naming styles', () => {
  it('spaced WS2019-style and CamelCase WS2025-style rule names with different values produce a conflict card', () => {
    const ws2019 = `resources:
  - name: Audit Account Lockout
    type: Microsoft.Windows/AuditPolicy
    properties:
      subcategory: "{0CCE9217-69AE-11D9-BED3-505054503030}"
      value: 2
`;
    const ws2025 = `resources:
  - name: AuditAccountLockout
    type: Microsoft.OSConfig/Test
    properties:
      resource:
        type: Microsoft.Windows/CSP
        properties:
          path: ./Vendor/MSFT/Policy/Result/Audit/AccountLogonLogoff_AuditAccountLockout
          value: 3
`;
    const { conflicts } = detectConflicts([
      { name: 'WS2019', content: ws2019 },
      { name: 'WS2025', content: ws2025 },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.manifests.sort()).toEqual(['WS2019', 'WS2025']);
    expect(conflicts[0]!.values).toEqual([2, 3]);
  });

  it('spaced and CamelCase rule names with the SAME value produce NO conflict (alignment, not conflict)', () => {
    const ws2019 = `resources:
  - name: Audit Account Lockout
    type: Microsoft.Windows/AuditPolicy
    properties:
      subcategory: "{0CCE9217-69AE-11D9-BED3-505054503030}"
      value: 2
`;
    const ws2025 = `resources:
  - name: AuditAccountLockout
    type: Microsoft.OSConfig/Test
    properties:
      resource:
        type: Microsoft.Windows/CSP
        properties:
          path: ./Vendor/MSFT/Policy/Result/Audit/AccountLogonLogoff_AuditAccountLockout
          value: 2
`;
    const { conflicts } = detectConflicts([
      { name: 'WS2019', content: ws2019 },
      { name: 'WS2025', content: ws2025 },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('normalizes hyphens, underscores, periods, and case the same way', () => {
    // All four resources represent the same logical rule via different
    // common naming conventions. Pass-2 must bucket them together.
    const a = `resources:
  - name: audit-account-lockout
    type: Microsoft.Custom/A
    properties: { value: 0 }
`;
    const b = `resources:
  - name: Audit_Account_Lockout
    type: Microsoft.Custom/B
    properties: { value: 1 }
`;
    const c = `resources:
  - name: AuditAccountLockout
    type: Microsoft.Custom/C
    properties: { value: 2 }
`;
    const d = `resources:
  - name: Audit.Account.Lockout
    type: Microsoft.Custom/D
    properties: { value: 3 }
`;
    const { conflicts } = detectConflicts([
      { name: 'a', content: a },
      { name: 'b', content: b },
      { name: 'c', content: c },
      { name: 'd', content: d },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.manifests.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(conflicts[0]!.values).toEqual([0, 1, 2, 3]);
  });

  it('canonical-key conflicts (Pass-1) take precedence over name-based ones (Pass-2)', () => {
    // Two manifests differ on the same Registry keyPath+valueName.
    // A third manifest has a same-named rule via Test wrapper for a
    // different CSP path but same canonical normalized name. The
    // Pass-1 keyPath+valueName conflict between the first two must
    // be the surfaced card, NOT a name-only Pass-2 match including
    // the third.
    const a = `resources:
  - name: Setting1
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Foo
      valueName: Setting1
      value: 1
`;
    const b = `resources:
  - name: Setting1
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM\\SOFTWARE\\Policies\\Foo
      valueName: Setting1
      value: 0
`;
    const { conflicts } = detectConflicts([
      { name: 'A', content: a },
      { name: 'B', content: b },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.manifests.sort()).toEqual(['A', 'B']);
    expect(conflicts[0]!.values).toEqual([1, 0]);
  });
});


// ── detectConflicts: empty-value equivalence (v0.2.20) ────────────────────
//
// "Nobody has this right" can be encoded as `""`, `[]`, `null`, or
// absent — all the same security posture. The previous
// JSON.stringify-based equality check treated `""` ('""') and `[]`
// ('[]') as different and spuriously flagged conflicts on rules where
// all baselines agreed on "empty."

describe('detectConflicts — empty value equivalence', () => {
  it('treats "", [], null, and undefined as equivalent', () => {
    const a = `resources:
  - name: UserRightsRule
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      policy: SeModifyObjectLabelPrivilege
      value: ""
`;
    const b = `resources:
  - name: UserRightsRule
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      policy: SeModifyObjectLabelPrivilege
      value: []
`;
    const c = `resources:
  - name: UserRightsRule
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      policy: SeModifyObjectLabelPrivilege
      value: null
`;
    const { conflicts } = detectConflicts([
      { name: 'A', content: a },
      { name: 'B', content: b },
      { name: 'C', content: c },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('still flags a conflict when one manifest has a real value and others are empty', () => {
    // Empty in 2, non-empty in 1 — this IS a real disagreement.
    const a = `resources:
  - name: R
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      policy: SeRemoteShutdownPrivilege
      value: ["*S-1-5-32-544"]
`;
    const b = `resources:
  - name: R
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      policy: SeRemoteShutdownPrivilege
      value: []
`;
    const { conflicts } = detectConflicts([
      { name: 'A', content: a },
      { name: 'B', content: b },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.values).toEqual([['*S-1-5-32-544'], []]);
  });

  it('treats a SID array in different order as the same set', () => {
    // User Rights are a SET of principals — `["A","B"]` and
    // `["B","A"]` describe identical permissions.
    const a = `resources:
  - name: R
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      policy: SeBackupPrivilege
      value: ["*S-1-5-32-544", "*S-1-5-32-551"]
`;
    const b = `resources:
  - name: R
    type: Microsoft.Windows/UserRightsAssignment
    properties:
      policy: SeBackupPrivilege
      value: ["*S-1-5-32-551", "*S-1-5-32-544"]
`;
    const { conflicts } = detectConflicts([
      { name: 'A', content: a },
      { name: 'B', content: b },
    ]);
    expect(conflicts).toHaveLength(0);
  });
});
