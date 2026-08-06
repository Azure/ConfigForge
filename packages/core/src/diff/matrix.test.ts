// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import { buildMatrix, type BuildMatrixInput } from './matrix';

function reg(
  valueName: string,
  value: number | string,
  keyPath = 'HKLM:\\System\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
) {
  const valueShape =
    typeof value === 'number' ? { dword: value } : { string: value };
  return {
    name: `${valueName}-r`,
    type: 'Microsoft.Windows/Registry',
    properties: { keyPath, valueName, value: valueShape },
  };
}

function doc(...resources: unknown[]) {
  return { resources };
}

// ── Empty / minimal inputs ─────────────────────────────────────────────────

describe('buildMatrix — empty input', () => {
  it('returns [] for zero manifests', () => {
    expect(buildMatrix([])).toEqual([]);
  });

  it('returns [] for manifests with no resources', () => {
    const m: BuildMatrixInput[] = [
      { name: 'a', doc: { resources: [] } },
      { name: 'b', doc: { resources: [] } },
    ];
    expect(buildMatrix(m)).toEqual([]);
  });

  it('handles a non-object doc gracefully', () => {
    expect(buildMatrix([{ name: 'a', doc: null }, { name: 'b', doc: 'not yaml' }])).toEqual([]);
  });
});

// ── Identical / different / partial ────────────────────────────────────────

describe('buildMatrix — status classification', () => {
  it('marks identical baselines as identical', () => {
    const a = doc(reg('MaxAuthTries', 3));
    const b = doc(reg('MaxAuthTries', 3));
    const m = buildMatrix([
      { name: 'WS2022', doc: a },
      { name: 'WS2025', doc: b },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].status).toBe('identical');
    expect(m[0].values.WS2022.status).toBe('identical');
    expect(m[0].values.WS2025.status).toBe('identical');
    expect(m[0].values.WS2022.value).toBe(3);
  });

  it('marks differing values as differs', () => {
    const a = doc(reg('MaxAuthTries', 5));
    const b = doc(reg('MaxAuthTries', 3));
    const m = buildMatrix([
      { name: 'WS2022', doc: a },
      { name: 'WS2025', doc: b },
    ]);
    expect(m[0].status).toBe('differs');
    expect(m[0].values.WS2022.status).toBe('identical'); // reference
    expect(m[0].values.WS2025.status).toBe('differs');
  });

  it('treats decimal strings as equivalent to numeric values', () => {
    const m = buildMatrix([
      { name: 'text', doc: doc(reg('NumericText', '24')) },
      { name: 'number', doc: doc(reg('NumericText', 24)) },
    ]);

    expect(m[0].status).toBe('identical');
  });

  it('does not coerce quoted hexadecimal strings into numbers', () => {
    const m = buildMatrix([
      { name: 'text', doc: doc(reg('HexText', '0x10')) },
      { name: 'number', doc: doc(reg('HexText', 16)) },
    ]);

    expect(m[0].status).toBe('differs');
  });

  it('marks settings present in some baselines as partial', () => {
    const a = doc(reg('MaxAuthTries', 3), reg('LegalNotice', 'A'));
    const b = doc(reg('MaxAuthTries', 3));
    const m = buildMatrix([
      { name: 'WS2022', doc: a },
      { name: 'WS2025', doc: b },
    ]);
    const legal = m.find((r) => r.valueName === 'LegalNotice')!;
    expect(legal.status).toBe('partial');
    expect(legal.values.WS2025.status).toBe('missing');
    expect(legal.values.WS2025.value).toBeUndefined();
  });

  it('merges same setting across baselines even when display names differ', () => {
    // Same registry value, different resource `name` field across baselines
    // — common across CIS-derived vs Microsoft-derived baselines.
    const a = doc({ ...reg('MaxAuthTries', 3), name: 'maxAuthTries-r' });
    const b = doc({ ...reg('MaxAuthTries', 5), name: 'PolicyMaxAuthTries' });
    const m = buildMatrix([
      { name: 'A', doc: a },
      { name: 'B', doc: b },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].status).toBe('differs');
  });
});

// ── 3-way and only-in-one ───────────────────────────────────────────────────

describe('buildMatrix — 3-way', () => {
  it('handles three baselines, mostly different', () => {
    const a = doc(reg('MaxAuthTries', 3));
    const b = doc(reg('MaxAuthTries', 5));
    const c = doc(reg('MaxAuthTries', 10));
    const m = buildMatrix([
      { name: 'a', doc: a },
      { name: 'b', doc: b },
      { name: 'c', doc: c },
    ]);
    expect(m[0].status).toBe('differs');
    expect(m[0].values.a.status).toBe('identical');
    expect(m[0].values.b.status).toBe('differs');
    expect(m[0].values.c.status).toBe('differs');
  });

  it('handles a setting that appears in only one of three baselines', () => {
    const a = doc(reg('MaxAuthTries', 3));
    const b = doc(reg('MaxAuthTries', 3));
    const c = doc(reg('MaxAuthTries', 3), reg('NewSetting', 'X'));
    const m = buildMatrix([
      { name: 'a', doc: a },
      { name: 'b', doc: b },
      { name: 'c', doc: c },
    ]);
    const newRow = m.find((r) => r.valueName === 'NewSetting')!;
    expect(newRow.status).toBe('partial');
    expect(newRow.values.a.status).toBe('missing');
    expect(newRow.values.b.status).toBe('missing');
    expect(newRow.values.c.status).toBe('identical');
  });
});

// ── Test-wrapper unwrapping ────────────────────────────────────────────────

describe('buildMatrix — Test wrapper', () => {
  it('unwraps Microsoft.OSConfig/Test to compare the inner resource', () => {
    const wrapped = {
      name: 'MaxAuthTries-test',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: reg('MaxAuthTries', 3),
        schema: { equals: 3 },
      },
    };
    const a = doc(wrapped);
    const b = doc(reg('MaxAuthTries', 3));
    const m = buildMatrix([
      { name: 'A', doc: a },
      { name: 'B', doc: b },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].type).toBe('Microsoft.Windows/Registry');
    expect(m[0].status).toBe('identical');
    expect(m[0].values.A.fromTestWrapper).toBe(true);
    expect(m[0].values.B.fromTestWrapper).toBeUndefined();
  });

  // ── Regression: matrix must compare resource-level compliance.equals ──
  //
  // Pre-fix: the matrix builder only inspected resource.properties when
  // extracting the "enforcement value" to compare. For manifests authored
  // via CSV import or with a top-level `compliance:` block (the canonical
  // way to declare the expected value), two baselines that targeted the
  // SAME registry path with DIFFERENT desired values would both fall back
  // to comparing the whole properties object — which was identical
  // ({keyPath, valueName, valueType}). Result: matrix said "identical"
  // when the manifests actually disagreed. Reported via the Diff page
  // probe on 2026-05-19.
  it('detects compliance.equals differences (CSV-style imports)', () => {
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'Setting2',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\Test',
              valueName: 'V2',
              valueType: 'Dword',
            },
            compliance: { equals: 10 },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'Setting2',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\Test',
              valueName: 'V2',
              valueType: 'Dword',
            },
            compliance: { equals: 20 },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    expect(m).toHaveLength(1);
    expect(m[0].status).toBe('differs');
    expect(m[0].values.A.status).toBe('identical'); // first baseline is the ref → always "identical" relative to itself
    expect(m[0].values.B.status).toBe('differs');
    expect(m[0].values.A.value).toBe(10);
    expect(m[0].values.B.value).toBe(20);
  });

  it('treats identical compliance.equals as identical (negative control)', () => {
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'Setting1',
            type: 'Microsoft.Windows/Registry',
            properties: { keyPath: 'HKLM:\\Software\\Test', valueName: 'V1', valueType: 'Dword' },
            compliance: { equals: 1 },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'Setting1',
            type: 'Microsoft.Windows/Registry',
            properties: { keyPath: 'HKLM:\\Software\\Test', valueName: 'V1', valueType: 'Dword' },
            compliance: { equals: 1 },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    expect(m).toHaveLength(1);
    expect(m[0].status).toBe('identical');
    expect(m[0].values.A.status).toBe('identical');
    expect(m[0].values.B.status).toBe('identical');
  });

  it('legacy properties.value still wins when compliance is absent', () => {
    // Make sure the new compliance-first preference doesn't break manifests
    // that only use the legacy inline-value pattern (no compliance block).
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'r',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\Vendor',
              valueName: 'X',
              value: { dword: 5 },
            },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'r',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\Vendor',
              valueName: 'X',
              value: { dword: 7 },
            },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    expect(m[0].status).toBe('differs');
    expect(m[0].values.A.value).toBe(5);
    expect(m[0].values.B.value).toBe(7);
  });

  it('compliance is preferred over properties.value when BOTH are present', () => {
    // Some authored manifests carry both — a legacy inline value AND a
    // newer compliance block. The user-declared `equals` is the canonical
    // intent, so it wins.
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'r',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\Vendor',
              valueName: 'X',
              value: { dword: 99 }, // legacy inline (ignored)
            },
            compliance: { equals: 100 }, // canonical
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'r',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\Vendor',
              valueName: 'X',
              value: { dword: 100 }, // legacy inline
            },
            compliance: { equals: 100 }, // canonical (matches A's compliance)
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    expect(m[0].status).toBe('identical'); // compliance.equals matches; legacy values diverging doesn't matter
    expect(m[0].values.A.value).toBe(100);
    expect(m[0].values.B.value).toBe(100);
  });

  it('handles compliance.contains / matches / regex as distinct comparison ops', () => {
    // Two manifests both using compliance.contains with different values
    // should still report differs.
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'r',
            type: 'Microsoft.OSConfig/FileLine',
            properties: { path: '/etc/sshd_config', valueName: 'PermitRootLogin' },
            compliance: { contains: 'no' },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'r',
            type: 'Microsoft.OSConfig/FileLine',
            properties: { path: '/etc/sshd_config', valueName: 'PermitRootLogin' },
            compliance: { contains: 'yes' },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    expect(m[0].status).toBe('differs');
    expect(m[0].values.A.value).toEqual({ contains: 'no' });
    expect(m[0].values.B.value).toEqual({ contains: 'yes' });
  });
});

// ── Performance bound ──────────────────────────────────────────────────────

describe('buildMatrix — performance', () => {
  it('computes 10 baselines × 350 settings in <200ms', () => {
    const baselines: BuildMatrixInput[] = [];
    for (let b = 0; b < 10; b++) {
      const resources: unknown[] = [];
      for (let i = 0; i < 350; i++) {
        // Inject a few deltas across baselines so the differ path runs.
        const v = i % 17 === 0 ? b : i;
        resources.push(reg(`Setting${i}`, v));
      }
      baselines.push({ name: `b${b}`, doc: { resources } });
    }
    const start = performance.now();
    const matrix = buildMatrix(baselines);
    const elapsed = performance.now() - start;
    expect(matrix).toHaveLength(350);
    expect(elapsed).toBeLessThan(200);
  });
});

// ── Schema-canonical identity ──────────────────────────────────────────────

describe('buildMatrix — schema-canonical identity', () => {
  it('keys AuditPolicy by subcategory', () => {
    // Two baselines use different display names but same subcategory.
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'Audit Account Lockout',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Account Lockout' },
            compliance: { equals: 'Success and Failure' },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'AuditAccountLockout',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Account Lockout' },
            compliance: { equals: 'Success' },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    // Should merge into ONE row (keyed by subcategory), not two.
    const audit = m.filter((r) => r.type === 'Microsoft.Windows/AuditPolicy');
    expect(audit).toHaveLength(1);
    expect(audit[0].values.A.status).toBe('identical'); // reference
    expect(audit[0].values.B.status).toBe('differs');
  });

  it('keys UserRightsAssignment by policy', () => {
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'Access Credential Manager as a trusted caller',
            type: 'Microsoft.Windows/UserRightsAssignment',
            properties: { policy: 'SeTrustedCredManAccessPrivilege' },
            compliance: { equals: '' },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'SeTrustedCredManAccess',
            type: 'Microsoft.Windows/UserRightsAssignment',
            properties: { policy: 'SeTrustedCredManAccessPrivilege' },
            compliance: { equals: '' },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    const ura = m.filter((r) => r.type === 'Microsoft.Windows/UserRightsAssignment');
    expect(ura).toHaveLength(1);
    expect(ura[0].values.A.status).toBe('identical');
    expect(ura[0].values.B.status).toBe('identical');
  });

  it('keys AccountPolicy by policy', () => {
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'MaxPasswordAge',
            type: 'Microsoft.Windows/AccountPolicy',
            properties: { policy: 'MaximumPasswordAge' },
            compliance: { equals: 60 },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'Maximum password age',
            type: 'Microsoft.Windows/AccountPolicy',
            properties: { policy: 'MaximumPasswordAge' },
            compliance: { equals: 90 },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    const ap = m.filter((r) => r.type === 'Microsoft.Windows/AccountPolicy');
    expect(ap).toHaveLength(1);
    expect(ap[0].values.A.value).toBe(60);
    expect(ap[0].values.B.value).toBe(90);
  });
});

// ── Cross-type merging ─────────────────────────────────────────────────────

describe('buildMatrix — cross-type merging', () => {
  it('merges AuditPolicy row with CSP row sharing the same normalized name', () => {
    // WS2019 encodes "Audit Account Lockout" as AuditPolicy with subcategory.
    // WS2025 encodes it as CSP with a path.
    const ws2019: BuildMatrixInput = {
      name: 'WS2019',
      doc: {
        resources: [
          {
            name: 'Audit Account Lockout',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Account Lockout' },
            compliance: { equals: 'Success and Failure' },
          },
        ],
      },
    };
    const ws2025: BuildMatrixInput = {
      name: 'WS2025',
      doc: {
        resources: [
          {
            name: 'AuditAccountLockout',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/Policy/Config/Audit/AccountLockout' },
            compliance: { equals: 1 },
          },
        ],
      },
    };
    const m = buildMatrix([ws2019, ws2025]);
    // Should be merged into ONE row (not two separate partial rows).
    expect(m).toHaveLength(1);
    expect(m[0].values.WS2019.status).not.toBe('missing');
    expect(m[0].values.WS2025.status).not.toBe('missing');
  });

  it('does NOT merge rows when both baselines have values (overlap)', () => {
    // If both baselines have the same normalized name in the same type,
    // they should NOT be merged (they already share a structural key).
    // If two different types have the same name AND both baselines populate
    // both rows, they are genuinely different settings.
    const a: BuildMatrixInput = {
      name: 'Base',
      doc: {
        resources: [
          {
            name: 'SomeSetting',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'SomeSetting' },
            compliance: { equals: 'Success' },
          },
          {
            name: 'SomeSetting',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/SomeSetting' },
            compliance: { equals: 1 },
          },
        ],
      },
    };
    const m = buildMatrix([a]);
    // Both rows should remain distinct.
    expect(m).toHaveLength(2);
  });

  it('merges multiple cross-type pairs at once', () => {
    const ws2019: BuildMatrixInput = {
      name: 'WS2019',
      doc: {
        resources: [
          {
            name: 'Audit Logon',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Logon' },
            compliance: { equals: 'Success' },
          },
          {
            name: 'Audit Logoff',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Logoff' },
            compliance: { equals: 'Failure' },
          },
        ],
      },
    };
    const ws2025: BuildMatrixInput = {
      name: 'WS2025',
      doc: {
        resources: [
          {
            name: 'AuditLogon',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/Policy/Config/Audit/Logon' },
            compliance: { equals: 1 },
          },
          {
            name: 'AuditLogoff',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/Policy/Config/Audit/Logoff' },
            compliance: { equals: 2 },
          },
        ],
      },
    };
    const m = buildMatrix([ws2019, ws2025]);
    // 2 rows, each merged.
    expect(m).toHaveLength(2);
    for (const row of m) {
      expect(row.values.WS2019.status).not.toBe('missing');
      expect(row.values.WS2025.status).not.toBe('missing');
    }
  });

  it('preserves genuine partial rows (different normalized names)', () => {
    const ws2019: BuildMatrixInput = {
      name: 'WS2019',
      doc: {
        resources: [
          {
            name: 'Audit Account Lockout',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Account Lockout' },
            compliance: { equals: 'Success' },
          },
        ],
      },
    };
    const ws2025: BuildMatrixInput = {
      name: 'WS2025',
      doc: {
        resources: [
          {
            name: 'CompleteDifferentSetting',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/Different' },
            compliance: { equals: 1 },
          },
        ],
      },
    };
    const m = buildMatrix([ws2019, ws2025]);
    // 2 separate partial rows — names don't match.
    expect(m).toHaveLength(2);
    const ap = m.find((r) => r.type === 'Microsoft.Windows/AuditPolicy')!;
    expect(ap.values.WS2019.status).not.toBe('missing');
    expect(ap.values.WS2025.status).toBe('missing');
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe('buildMatrix — edge cases', () => {
  it('N>2: merges 3-way cross-type (AuditPolicy + CSP + Registry) into one row', () => {
    // Same setting encoded as 3 different types across 3 baselines.
    const ws2016: BuildMatrixInput = {
      name: 'WS2016',
      doc: {
        resources: [
          {
            name: 'Audit Account Lockout',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\Policies\\Audit',
              valueName: 'AccountLockout',
              value: { dword: 3 },
            },
          },
        ],
      },
    };
    const ws2019: BuildMatrixInput = {
      name: 'WS2019',
      doc: {
        resources: [
          {
            name: 'Audit Account Lockout',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Account Lockout' },
            compliance: { equals: 'Success and Failure' },
          },
        ],
      },
    };
    const ws2025: BuildMatrixInput = {
      name: 'WS2025',
      doc: {
        resources: [
          {
            name: 'AuditAccountLockout',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/Audit/AccountLockout' },
            compliance: { equals: 1 },
          },
        ],
      },
    };
    const m = buildMatrix([ws2016, ws2019, ws2025]);
    // All three should merge into one row.
    expect(m).toHaveLength(1);
    expect(m[0].values.WS2016.status).not.toBe('missing');
    expect(m[0].values.WS2019.status).not.toBe('missing');
    expect(m[0].values.WS2025.status).not.toBe('missing');
  });

  it('type-pair guard: refuses to merge ineligible types (e.g. FileLine + AuditPolicy)', () => {
    // Two different types with the same display name, but one is
    // FileLine (Linux) and the other is AuditPolicy (Windows).
    // They should NOT merge — they are genuinely different settings.
    const a: BuildMatrixInput = {
      name: 'LinuxBase',
      doc: {
        resources: [
          {
            name: 'PermitRootLogin',
            type: 'Microsoft.OSConfig/FileLine',
            properties: { path: '/etc/ssh/sshd_config', valueName: 'PermitRootLogin' },
            compliance: { equals: 'no' },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'WindowsBase',
      doc: {
        resources: [
          {
            name: 'PermitRootLogin',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\Software\\SSH',
              valueName: 'PermitRootLogin',
            },
            compliance: { equals: 0 },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    // Should remain 2 separate rows — FileLine is not merge-eligible
    // with Registry.
    expect(m).toHaveLength(2);
    expect(m.find((r) => r.type === 'Microsoft.OSConfig/FileLine')!.values.LinuxBase.status).not.toBe('missing');
    expect(m.find((r) => r.type === 'Microsoft.OSConfig/FileLine')!.values.WindowsBase.status).toBe('missing');
  });

  it('BaselineRule keyed by ruleId', () => {
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'Rule Display Name v1',
            type: 'Microsoft.OSConfig/BaselineRule',
            properties: { ruleId: 'CIS-1.2.3' },
            compliance: { equals: 'pass' },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'Rule Display Name v2',
            type: 'Microsoft.OSConfig/BaselineRule',
            properties: { ruleId: 'CIS-1.2.3' },
            compliance: { equals: 'fail' },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    // Same ruleId → same row, despite different display names.
    const br = m.filter((r) => r.type === 'Microsoft.OSConfig/BaselineRule');
    expect(br).toHaveLength(1);
    expect(br[0].status).toBe('differs');
  });

  it('name normalization in makeRowKey deduplicates within same type', () => {
    // Two resources of the same type with names that normalize identically.
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'Audit Logon',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Logon' },
            compliance: { equals: 'Success' },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'Audit-Logon',
            type: 'Microsoft.Windows/AuditPolicy',
            properties: { subcategory: 'Logon' },
            compliance: { equals: 'Failure' },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    const ap = m.filter((r) => r.type === 'Microsoft.Windows/AuditPolicy');
    // subcategory matches → one row. Values differ.
    expect(ap).toHaveLength(1);
    expect(ap[0].status).toBe('differs');
  });

  it('name-only resources with different casing merge within same type', () => {
    // Resources that lack schema-canonical fields (no subcategory, no
    // policy, no keyPath). They fall through to the normalized-name key.
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'Enable Firewall',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/Firewall/Enable' },
            compliance: { equals: 1 },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'Enable_Firewall',
            type: 'Microsoft.Windows/CSP',
            properties: { path: './Vendor/MSFT/Firewall/Enable' },
            compliance: { equals: 0 },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    // Same CSP path → structural key matches → one row.
    const csp = m.filter((r) => r.type === 'Microsoft.Windows/CSP');
    expect(csp).toHaveLength(1);
  });

  it('same-type merge: two Registry rows with same normalized name but different keys', () => {
    // Edge case: two Registry resources with different keyPaths but
    // the same display name in different baselines. Structural keys
    // differ, but same type + same normalized name → should merge
    // (same-type is always eligible).
    const a: BuildMatrixInput = {
      name: 'A',
      doc: {
        resources: [
          {
            name: 'MaxAuthTries',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\System\\OldPath',
              valueName: 'MaxAuthTries',
              value: { dword: 3 },
            },
          },
        ],
      },
    };
    const b: BuildMatrixInput = {
      name: 'B',
      doc: {
        resources: [
          {
            name: 'MaxAuthTries',
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM:\\System\\NewPath',
              valueName: 'MaxAuthTries',
              value: { dword: 5 },
            },
          },
        ],
      },
    };
    const m = buildMatrix([a, b]);
    // Different keyPaths → different structural keys. But same type +
    // same name + disjoint baselines → merge.
    const reg = m.filter((r) => r.type === 'Microsoft.Windows/Registry');
    expect(reg).toHaveLength(1);
    expect(reg[0].values.A.status).not.toBe('missing');
    expect(reg[0].values.B.status).not.toBe('missing');
  });
});


// ── v0.2.19: differs takes precedence over partial ────────────────────────
//
// Previously a row that had a real value disagreement among the
// present-baselines was misclassified as 'partial' just because one
// other baseline was missing the rule entirely. Real-world example:
// WS2019=1, WS2022=missing, WS2025=0 — the WS2019/WS2025 drift is
// real value disagreement and should show up under the "differs"
// filter, not be hidden behind a presence-gap classification.

describe('buildMatrix — differs precedence over partial', () => {
  it('classifies a 3-way row as "differs" when ≥2 present baselines disagree even if a third is missing', () => {
    const a = doc(reg('MaxAuthTries', 1));        // WS2019 sets 1
    const b = doc();                              // WS2022 missing the rule
    const c = doc(reg('MaxAuthTries', 0));        // WS2025 sets 0
    const m = buildMatrix([
      { name: 'WS2019', doc: a },
      { name: 'WS2022', doc: b },
      { name: 'WS2025', doc: c },
    ]);
    expect(m[0].status).toBe('differs');
    expect(m[0].values.WS2019.status).toBe('identical'); // reference (first present)
    expect(m[0].values.WS2022.status).toBe('missing');
    expect(m[0].values.WS2025.status).toBe('differs');
  });

  it('still classifies a row as "partial" when present-baselines all agree but ≥1 is missing', () => {
    // The pure presence-asymmetry case — partial is still right here.
    const a = doc(reg('NewRule', 1));   // WS2022 has it
    const b = doc();                    // WS2019 missing
    const c = doc(reg('NewRule', 1));   // WS2025 has same value as WS2022
    const m = buildMatrix([
      { name: 'WS2019', doc: b },
      { name: 'WS2022', doc: a },
      { name: 'WS2025', doc: c },
    ]);
    expect(m[0].status).toBe('partial');
    expect(m[0].values.WS2019.status).toBe('missing');
    expect(m[0].values.WS2022.status).toBe('identical');
    expect(m[0].values.WS2025.status).toBe('identical');
  });

  it('pairwise: rule in A=1, missing in B → "partial" (only one baseline has a value, no disagreement)', () => {
    const a = doc(reg('OnlyInA', 1));
    const b = doc();
    const m = buildMatrix([
      { name: 'A', doc: a },
      { name: 'B', doc: b },
    ]);
    expect(m[0].status).toBe('partial');
    expect(m[0].values.A.status).toBe('identical');
    expect(m[0].values.B.status).toBe('missing');
  });

  it('three-way: WS2019=1, WS2022=2, WS2025=missing → "differs" (real disagreement among present)', () => {
    const a = doc(reg('AuditedRule', 1));
    const b = doc(reg('AuditedRule', 2));
    const c = doc();
    const m = buildMatrix([
      { name: 'WS2019', doc: a },
      { name: 'WS2022', doc: b },
      { name: 'WS2025', doc: c },
    ]);
    expect(m[0].status).toBe('differs');
    expect(m[0].values.WS2019.status).toBe('identical');
    expect(m[0].values.WS2022.status).toBe('differs');
    expect(m[0].values.WS2025.status).toBe('missing');
  });
});
