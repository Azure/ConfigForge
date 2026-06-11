// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the audit-fidelity changes in PR10:
 *
 *   1. compareDesiredActual returns `indeterminate` (not `error`) when the
 *      CLI couldn't read the resource — distinguishing "we don't know" from
 *      "the device disagrees".
 *   2. Test resources whose CLI response has no compliance field also
 *      surface as `indeterminate`.
 *   3. summarizeCompliance counts indeterminate separately.
 *   4. Bug 2 surfacing: CSP /Result/UserRights/* paths that the CLI cannot
 *      read are reported as "Could not read" rather than spuriously
 *      "noncompliant".
 *   5. Bug 1 fix: the Defender baseline's enum schemas are wrapped in a
 *      null-tolerant oneOf so an unset registry value doesn't false-flag.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import {
  compareDesiredActual,
  summarizeCompliance,
  valuesEqual,
  type ComplianceResult,
  type DesiredResource,
} from './compliance';

// ── compareDesiredActual: indeterminate state ─────────────────────────────

describe('compareDesiredActual — indeterminate state', () => {
  it('returns indeterminate (not error) when actual is null', () => {
    const desired: DesiredResource = {
      name: 'unreadable',
      type: 'Microsoft.Windows/Registry',
      properties: { keyPath: 'HKLM:\\Software\\X', valueName: 'V', value: 1 },
    };
    const r = compareDesiredActual(desired, null);
    expect(r.status).toBe('indeterminate');
    expect(r.reason).toMatch(/could not be read/i);
  });

  it('returns indeterminate when a Test resource lacks a compliance field', () => {
    const desired: DesiredResource = {
      name: 'test-no-verdict',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/CSP',
          properties: { path: './Vendor/MSFT/Policy/Result/UserRights/AccessFromNetwork', type: 'array' },
        },
        schema: {},
      },
    };
    // Simulate a CLI response that has the inner resource but no
    // `compliance` field — exactly what we observe when the CLI fails to
    // evaluate UserRights CSP paths.
    const actual = {
      properties: {
        resource: {
          type: 'Microsoft.Windows/CSP',
          properties: {
            path: './Vendor/MSFT/Policy/Result/UserRights/AccessFromNetwork',
            value: null,
          },
        },
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('indeterminate');
    expect(r.reason).toMatch(/did not return a compliance verdict/i);
  });

  it('still returns noncompliant when the device DID respond but disagreed', () => {
    const desired: DesiredResource = {
      name: 'mismatch',
      type: 'Microsoft.Windows/Registry',
      properties: { keyPath: 'HKLM:\\Software\\X', valueName: 'V', value: 1 },
    };
    const r = compareDesiredActual(desired, {
      properties: { keyPath: 'HKLM:\\Software\\X', valueName: 'V', value: 0 },
    });
    expect(r.status).toBe('noncompliant');
  });

  it('returns compliant when actual matches desired', () => {
    const desired: DesiredResource = {
      name: 'good',
      type: 'Microsoft.Windows/Registry',
      properties: { keyPath: 'HKLM:\\Software\\X', valueName: 'V', value: 1 },
    };
    const r = compareDesiredActual(desired, {
      properties: { keyPath: 'HKLM:\\Software\\X', valueName: 'V', value: 1 },
    });
    expect(r.status).toBe('compliant');
  });

  // v0.1.1 regression — false-positive compliance.
  // Reported on a fake test manifest that declared a Microsoft.Windows/
  // Registry resource named `examplesetting` with ONLY identity fields
  // (keyPath / valueName / valueType) and no `valueData` / `value`. The
  // CLI happily echoed those identity fields back, the comparison loop
  // skipped every key as IDENTITY_KEY, and the function returned
  // 'compliant' by default — making a fake registry rule look as if it
  // had passed audit. The audit must NOT silently pass when nothing
  // was actually checked.
  it('returns indeterminate (not compliant) when the desired YAML has no comparable state — Microsoft.Windows/Registry', () => {
    const desired: DesiredResource = {
      name: 'examplesetting',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\Fake',
        valueName: 'examplesetting',
        valueType: 'REG_SZ',
        // NB: no valueData / no value — only identity/address fields
      },
    };
    // CLI echoes the identity fields back without any state.
    const actual = {
      properties: {
        keyPath: 'HKLM:\\Software\\Fake',
        valueName: 'examplesetting',
        valueType: 'REG_SZ',
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('indeterminate');
    expect(r.reason).toMatch(/no comparable state|valueData/i);
  });

  it('returns indeterminate (not compliant) when desired has only identity keys — generic resource', () => {
    // Same defense for non-Registry providers: if the YAML declared
    // nothing the comparator could check, do not emit a green pass.
    const desired: DesiredResource = {
      name: 'AccessFromNetwork',
      type: 'Microsoft.Windows/CSP',
      properties: {
        path: './Vendor/MSFT/Policy/Config/UserRights/AccessFromNetwork',
        // no value declared
      },
    };
    const actual = {
      properties: {
        path: './Vendor/MSFT/Policy/Config/UserRights/AccessFromNetwork',
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('indeterminate');
    expect(r.reason).toMatch(/no comparable state/i);
  });

  it('still returns indeterminate when desired declared a state value but it was null/undefined', () => {
    // Belt-and-suspenders: even if `value` IS in the YAML but is
    // explicitly null (the comparator skips null/undefined desireds),
    // the loop produces zero comparisons. We don't want that to
    // silently pass either.
    const desired: DesiredResource = {
      name: 'no-value-set',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\X',
        valueName: 'V',
        value: null,
      },
    };
    const actual = {
      properties: {
        keyPath: 'HKLM:\\Software\\X',
        valueName: 'V',
        value: 0,
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('indeterminate');
  });

  it('valueType-only Registry rule is NOT enough to call compliant — must compare valueData', () => {
    // v0.1.1: a Registry YAML that declares only `valueType` and no
    // `valueData` cannot be a green pass. The CLI echoes the requested
    // valueType back even for non-existent registry values, so a
    // type-only "match" is not proof of compliance — that was the path
    // exploited by the fake `examplesetting` rule. Force it to
    // indeterminate.
    const desired: DesiredResource = {
      name: 'type-only',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\X',
        valueName: 'V',
        valueType: 'REG_DWORD',
      },
    };
    const actual = {
      properties: {
        keyPath: 'HKLM:\\Software\\X',
        valueName: 'V',
        valueType: 'REG_DWORD',
        valueData: 1,
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('indeterminate');
    expect(r.reason).toMatch(/valueData|value content|never read/i);
  });

  it('Registry resource WITH valueData declared and matching device state is compliant', () => {
    // The legitimate happy path that should NOT regress to indeterminate.
    const desired: DesiredResource = {
      name: 'real-rule',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\X',
        valueName: 'V',
        valueType: 'REG_DWORD',
        valueData: 1,
      },
    };
    const actual = {
      properties: {
        keyPath: 'HKLM:\\Software\\X',
        valueName: 'V',
        valueType: 'REG_DWORD',
        valueData: 1,
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('compliant');
  });
});

// ── summarizeCompliance counts indeterminate separately ────────────────────

describe('summarizeCompliance', () => {
  it('counts indeterminate separately from noncompliant and errors', () => {
    const make = (n: string, status: ComplianceResult['status']): ComplianceResult => ({
      name: n,
      type: 'Microsoft.Windows/Registry',
      status,
      reason: '',
      desired: {},
      actual: null,
    });
    const results = [
      make('a', 'compliant'),
      make('b', 'compliant'),
      make('c', 'noncompliant'),
      make('d', 'indeterminate'),
      make('e', 'indeterminate'),
      make('f', 'error'),
    ];
    expect(summarizeCompliance(results)).toEqual({
      compliant: 2,
      noncompliant: 1,
      indeterminate: 2,
      errors: 1,
    });
  });
});

// ── Bug 1: defender baseline schemas are null-tolerant ────────────────────

describe('defender baseline — Bug 1 regression (null-tolerant enum schemas)', () => {
  const baseline = yaml.load(
    readFileSync(
      join(__dirname, '..', '..', '..', '..', 'public', '_baselines', 'defender-antivirus.osc.yaml'),
      'utf8',
    ),
  ) as { resources: Array<Record<string, unknown>> };

  const targets = ['EngineRing', 'MpCloudBlockLevel', 'PlatformRing', 'SubmitSamplesConsent'];
  for (const targetName of targets) {
    it(`${targetName}'s schema accepts both the configured value AND null (default)`, () => {
      const r = baseline.resources.find((x) => x.name === targetName);
      expect(r, `resource ${targetName} not found`).toBeDefined();
      const props = r!.properties as Record<string, unknown>;
      const schema = props.schema as Record<string, unknown>;
      expect(schema.oneOf, `${targetName} schema is not a oneOf`).toBeDefined();
      const branches = schema.oneOf as Array<Record<string, unknown>>;
      // Branch 1: enum branch with the original allowed values
      const enumBranch = branches.find((b) => Array.isArray(b.enum));
      expect(enumBranch, `${targetName} missing enum branch`).toBeDefined();
      const enumValues = enumBranch!.enum as unknown[];
      expect(enumValues.length).toBeGreaterThan(0);
      enumValues.forEach((v) => expect(typeof v).toBe('number'));
      // Branch 2: null tolerance for unset-on-default-machine
      const nullBranch = branches.find((b) => b.type === 'null');
      expect(nullBranch, `${targetName} missing type:null branch`).toBeDefined();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// PR17: valuesEqual must NOT collapse huge string-numbers to Infinity.
// Bug: `Number(""1e500"")` is Infinity. Pre-fix, the comparator accidentally
// said two distinct giant string-numbers were equal (both === Infinity)
// and audit reported a misconfigured device as compliant.
// ─────────────────────────────────────────────────────────────────────────
describe('valuesEqual: numeric overflow guard (PR17)', () => {
  it('returns false when string coerces to Infinity (overflow)', () => {
    // 1 followed by 500 zeros — overflows Number.
    const huge = '1' + '0'.repeat(500);
    expect(valuesEqual(1, huge)).toBe(false);
    expect(valuesEqual(huge, 1)).toBe(false);
  });

  it('returns false for Infinity/-Infinity strings', () => {
    expect(valuesEqual(1, 'Infinity')).toBe(false);
    expect(valuesEqual(1, '-Infinity')).toBe(false);
  });

  it('returns false for non-numeric strings (NaN coercion)', () => {
    expect(valuesEqual(1, 'banana')).toBe(false);
  });

  it('still returns true for legitimate numeric coercion', () => {
    expect(valuesEqual(1, '1')).toBe(true);
    expect(valuesEqual(0, '0')).toBe(true);
    expect(valuesEqual(42, '42')).toBe(true);
  });
});

// ── Registry valueType mismatch (cis-ws2022-ms regression) ───────────────

describe('compareDesiredActual — Microsoft.Windows/Registry valueType', () => {
  // The CIS ws2022 manifest declares `valueType: REG_SZ value: '1'` for
  // EnableCertPaddingCheck; the actual registry holds REG_DWORD `1`. The
  // CLI returns `value: 1, valueType: REG_DWORD` regardless of the type
  // we requested. With the previous comparator, valueType was treated
  // as an address-only IDENTITY field and `valuesEqual('1', 1)` coerced
  // string ↔ number, so the resource was silently marked compliant. Bug
  // surfaced by the WS2022 audit-vs-CLI smoke test on 2026-05-04.
  it('flags noncompliant when desired REG_SZ vs actual REG_DWORD even if values coerce equal', () => {
    const desired: DesiredResource = {
      name: 'EnableCertPaddingCheck',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Cryptography\\Wintrust\\Config',
        valueType: 'REG_SZ',
        valueName: 'EnableCertPaddingCheck',
        value: '1',
      },
    };
    const actual = {
      properties: {
        keyPath: 'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Cryptography\\Wintrust\\Config',
        valueType: 'REG_DWORD',
        valueName: 'EnableCertPaddingCheck',
        value: 1,
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('noncompliant');
    expect(r.reason).toMatch(/valueType/);
  });

  it('treats REG_SZ desired as equivalent to String actual (DSC-flavor variance)', () => {
    const desired: DesiredResource = {
      name: 'foo',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\Test',
        valueType: 'REG_SZ',
        valueName: 'foo',
        value: 'bar',
      },
    };
    const actual = {
      properties: {
        keyPath: 'HKLM:\\Software\\Test',
        valueType: 'String',
        valueName: 'foo',
        value: 'bar',
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('compliant');
  });

  it('treats REG_DWORD_LITTLE_ENDIAN as equivalent to Dword (canonicalization)', () => {
    const desired: DesiredResource = {
      name: 'foo',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\Test',
        valueType: 'REG_DWORD',
        valueName: 'foo',
        value: 0,
      },
    };
    const actual = {
      properties: {
        keyPath: 'HKLM:\\Software\\Test',
        valueType: 'REG_DWORD_LITTLE_ENDIAN',
        valueName: 'foo',
        value: 0,
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('compliant');
  });

  it('does not crash if either side is missing valueType', () => {
    const desired: DesiredResource = {
      name: 'no-type',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\Test',
        valueName: 'foo',
        value: 0,
      },
    };
    const actual = {
      properties: {
        keyPath: 'HKLM:\\Software\\Test',
        valueType: 'REG_DWORD',
        valueName: 'foo',
        value: 0,
      },
    };
    const r = compareDesiredActual(desired, actual);
    expect(r.status).toBe('compliant');
  });
});