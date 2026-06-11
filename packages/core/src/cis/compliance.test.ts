// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR24: tests for the compliance % report.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _clearCisDataCacheForTests } from './data';
import { computeCompliance, propertiesEqual, reportToMarkdown, valuesEqual } from './compliance';

beforeEach(() => _clearCisDataCacheForTests());
afterEach(() => _clearCisDataCacheForTests());

const RULE_A = "1.1.1 (L1) Ensure 'Example password rule A' is set to '24'";
const RULE_B = "1.1.2 (L1) Ensure 'Example password rule B' is set to '365'";
const RULE_C = "1.1.3 (L1) Ensure 'Example password rule C' is set to '1'";
const RULE_D = "1.1.4 (L1) Ensure 'Example password rule D' is set to '14'";

function res(name: string, value: unknown, prop = 'PasswordHistorySize') {
  return {
    name,
    type: 'Microsoft.Windows/AccountPolicy',
    properties: { name: prop, value },
  };
}

describe('valuesEqual / propertiesEqual', () => {
  it('treats identical primitives as equal', () => {
    expect(valuesEqual(24, 24)).toBe(true);
    expect(valuesEqual('a', 'a')).toBe(true);
    expect(valuesEqual(false, false)).toBe(true);
  });
  it('treats different primitives as unequal', () => {
    expect(valuesEqual(24, 25)).toBe(false);
    expect(valuesEqual('a', 'b')).toBe(false);
  });
  it('compares object property bags ignoring key order', () => {
    expect(propertiesEqual({ name: 'x', value: 1 }, { value: 1, name: 'x' })).toBe(true);
  });
  it('flags differing enforcement values', () => {
    expect(propertiesEqual({ value: 24 }, { value: 12 })).toBe(false);
  });
  it('handles missing properties gracefully', () => {
    expect(propertiesEqual(undefined, undefined)).toBe(true);
    expect(propertiesEqual({}, undefined)).toBe(false);
  });
});

describe('computeCompliance', () => {
  const cis = {
    resources: [res(RULE_A, 24), res(RULE_B, 365), res(RULE_C, 1), res(RULE_D, 14, 'MinimumPasswordLength')],
  };

  it('returns 100% when manifests match exactly', async () => {
    const report = await computeCompliance(cis, cis);
    expect(report.score).toBe(100);
    expect(report.matched).toBe(4);
    expect(report.mismatched).toBe(0);
    expect(report.missing).toBe(0);
    expect(report.extras.length).toBe(0);
  });

  it('returns ~50% when half the rules match', async () => {
    const mine = {
      resources: [res(RULE_A, 24), res(RULE_B, 365)],
    };
    const report = await computeCompliance(mine, cis);
    expect(report.matched).toBe(2);
    expect(report.missing).toBe(2);
    expect(Math.abs(report.score - 50)).toBeLessThanOrEqual(1);
  });

  it('flags mismatches separately from misses', async () => {
    const mine = {
      resources: [
        res(RULE_A, 24), // match
        res(RULE_B, 30), // mismatch (CIS says 365)
        // RULE_C missing
      ],
    };
    const report = await computeCompliance(mine, cis);
    expect(report.matched).toBe(1);
    expect(report.mismatched).toBe(1);
    expect(report.missing).toBe(2);
    const mismatchEntry = report.perRule.find((r) => r.ruleName === RULE_B);
    expect(mismatchEntry?.status).toBe('mismatched');
    expect(mismatchEntry?.myValue).toBe(30);
    expect(mismatchEntry?.expected).toBe(365);
  });

  it('reports extras without lowering the score (superset → 100%)', async () => {
    const mine = {
      resources: [
        ...cis.resources,
        res('My custom non-CIS hardening rule', true, 'CustomThing'),
      ],
    };
    const report = await computeCompliance(mine, cis);
    expect(report.score).toBe(100);
    expect(report.matched).toBe(4);
    expect(report.extras.length).toBe(1);
    expect(report.extras[0].ruleName).toBe('My custom non-CIS hardening rule');
  });

  it('returns score=0 with all-missing when user manifest is empty', async () => {
    const report = await computeCompliance({ resources: [] }, cis);
    expect(report.score).toBe(0);
    expect(report.matched).toBe(0);
    expect(report.missing).toBe(4);
  });

  it('returns score=0 when both manifests are empty (denominator guard)', async () => {
    const report = await computeCompliance({ resources: [] }, { resources: [] });
    expect(report.score).toBe(0);
    expect(report.total).toBe(0);
  });

  it('handles malformed / missing resources gracefully', async () => {
    const report = await computeCompliance(null, cis);
    expect(report.score).toBe(0);
    expect(report.missing).toBe(4);
  });

  it('rolls up severity into a breakdown', async () => {
    const report = await computeCompliance({ resources: [res(RULE_A, 24)] }, cis);
    // The CIS-derived rules carry a severity from the catalog.
    const totals = Object.values(report.severityBreakdown);
    const summed = totals.reduce(
      (acc, b) => ({
        matched: acc.matched + b.matched,
        mismatched: acc.mismatched + b.mismatched,
        missing: acc.missing + b.missing,
      }),
      { matched: 0, mismatched: 0, missing: 0 },
    );
    expect(summed.matched + summed.mismatched + summed.missing).toBe(4);
  });
});

describe('reportToMarkdown', () => {
  it('renders a markdown audit pack with all sections', async () => {
    const cis = { resources: [res(RULE_A, 24), res(RULE_B, 365)] };
    const mine = { resources: [res(RULE_A, 24), res(RULE_B, 30)] };
    const report = await computeCompliance(mine, cis);
    const md = reportToMarkdown('my-baseline', 'cis-ws2025-ms', report);
    expect(md).toContain('# Compliance Audit Pack — my-baseline');
    expect(md).toContain('cis-ws2025-ms');
    expect(md).toMatch(/Score:\*\*\s*\d+%/);
    expect(md).toContain('## Rules');
    expect(md).toContain('matched');
    expect(md).toContain('mismatched');
  });
});
