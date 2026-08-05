// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROFILES,
  valueKind,
  normalizeKeyPath,
  normalizeRegistryValueType,
  translateSchema,
} from './repair-ws2022-baselines.mjs';

/**
 * Unit coverage for the WS2022 baseline repair tooling.
 *
 * The shipped YAML is asserted separately in
 * `apps/desktop/src/data/ws2022-baselines.test.ts`. This suite guards the
 * inputs to that conversion: the two reviewed mapping tables must stay
 * evidence-backed and conflict-free, and the deterministic normalisers must
 * keep producing the WS2025 shapes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(path.join(HERE, name), 'utf8'));

const cspMap = readJson('csp-provider-map.json');
const schemaMap = readJson('schema-expression-map.json');
const conversionReport = readJson('conversion-report.json');

const DEDICATED_PROVIDERS = [
  'Microsoft.Windows/AccountPolicy',
  'Microsoft.Windows/AuditPolicy',
  'Microsoft.Windows/UserRightsAssignment',
];

describe('csp-provider-map.json', () => {
  it('records the WS2025 commit it was extracted from', () => {
    expect(cspMap._provenance).toBeDefined();
    expect(String(cspMap._provenance.commit ?? cspMap._provenance.cspCommit)).toMatch(/\w{7}/);
  });

  it('maps every CSP path to exactly one dedicated provider', () => {
    const seen = new Set();
    for (const entry of cspMap.entries) {
      expect(entry.cspPath).toMatch(/^\.\/Vendor\/MSFT\/Policy\/Result\//);
      expect(seen.has(entry.cspPath), `duplicate mapping for ${entry.cspPath}`).toBe(false);
      seen.add(entry.cspPath);
      expect(DEDICATED_PROVIDERS).toContain(entry.target.type);
    }
    expect(cspMap.entries.length).toBe(81);
  });

  it('carries WS2025 evidence for every mapping', () => {
    for (const entry of cspMap.entries) {
      expect(entry.evidence.length, entry.cspPath).toBeGreaterThan(0);
      for (const source of entry.evidence) expect(source).toMatch(/^ws2025-[a-z-]+:\S+$/);
    }
  });

  it('carries address-only targets — never a borrowed WS2025 desired value', () => {
    for (const entry of cspMap.entries) {
      expect(Object.keys(entry.target.properties ?? {}), entry.cspPath).not.toContain('value');
    }
  });

  it('covers every CSP path the three WS2022 profiles actually used', () => {
    const mapped = new Set(cspMap.entries.map((entry) => entry.cspPath));
    for (const profile of conversionReport.profiles) {
      for (const conversion of profile.conversions) {
        expect(mapped.has(conversion.cspPath), `${profile.profile}: ${conversion.cspPath}`).toBe(
          true,
        );
      }
    }
  });
});

describe('schema-expression-map.json', () => {
  it('translates every reviewed schema shape to a CEL expression and template', () => {
    for (const entry of schemaMap.entries) {
      expect(typeof entry.expression).toBe('string');
      expect(entry.expression.length).toBeGreaterThan(0);
      expect(entry.template).toContain('{value}');
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
    expect(schemaMap.entries.length).toBe(49);
  });

  it('is unambiguous — one translation per (schema, value kind) pair', () => {
    const seen = new Set();
    for (const entry of schemaMap.entries) {
      const key = `${JSON.stringify(entry.schema)}|${entry.valueKind}`;
      expect(seen.has(key), `ambiguous translation for ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('deterministic normalisers', () => {
  it('adds the colon that the standalone registry provider requires', () => {
    expect(normalizeKeyPath('HKEY_LOCAL_MACHINE\\System\\CurrentControlSet\\Control\\Lsa')).toBe(
      'HKEY_LOCAL_MACHINE:\\System\\CurrentControlSet\\Control\\Lsa',
    );
    expect(normalizeKeyPath('HKLM\\SOFTWARE\\Policies')).toBe('HKLM:\\SOFTWARE\\Policies');
  });

  it('leaves an already-normalised keyPath untouched (idempotent)', () => {
    const normalized = 'HKEY_LOCAL_MACHINE:\\SYSTEM\\CurrentControlSet\\Services';
    expect(normalizeKeyPath(normalized)).toBe(normalized);
  });

  it('maps legacy value-type aliases onto the REG_* names WS2025 ships', () => {
    expect(normalizeRegistryValueType('Dword')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('String')).toBe('REG_SZ');
    expect(normalizeRegistryValueType('MultiString')).toBe('REG_MULTI_SZ');
    expect(normalizeRegistryValueType('REG_BINARY')).toBe('REG_BINARY');
  });

  it('classifies desired values the way the schema map is keyed', () => {
    expect(valueKind(1)).toBe('number');
    expect(valueKind('1')).toBe('string');
    expect(valueKind([])).toBe('array');
    expect(valueKind(true)).toBe('boolean');
  });

  it('renders informational, const, range and enum schemas in WS2025 CEL form', () => {
    expect(translateSchema({}, 'number')).toEqual({
      expression: 'true',
      template: 'The value {value} is informational for this control.',
    });
    expect(translateSchema({ const: 0 }, 'number').expression).toBe('(value == 0)');
    expect(translateSchema({ minimum: 14 }, 'number').expression).toBe(
      '(value != null && value >= 14)',
    );
    expect(translateSchema({ minimum: 1, maximum: 70 }, 'number').expression).toBe(
      '(value != null && value >= 1 && value <= 70)',
    );
  });

  it('refuses to guess at an unrecognised schema shape', () => {
    expect(() => translateSchema({ multipleOf: 3 }, 'number')).toThrow();
  });
});

describe('conversion report', () => {
  it('covers all three bundled WS2022 profiles', () => {
    expect(conversionReport.profiles.map((p) => p.profile)).toEqual([...PROFILES]);
  });

  it('leaves no residual Policy CSP rule in any profile', () => {
    for (const profile of conversionReport.profiles) {
      expect(profile.residualCsp, profile.profile).toEqual([]);
      expect(profile.convertedCsp, profile.profile).toBe(profile.sourceCsp);
    }
  });

  it('reconciles every rule-count delta through a declared expansion', () => {
    for (const profile of conversionReport.profiles) {
      const extra = profile.expansions.reduce((sum, e) => sum + e.into.length - 1, 0);
      expect(profile.sourceRules + extra, profile.profile).toBe(profile.outputRules);
    }
  });

  it('justifies every registry shape repair with a WS2025 contract', () => {
    for (const profile of conversionReport.profiles) {
      for (const repair of profile.registryShapeRepairs) {
        expect(repair.evidence, `${profile.profile}:${repair.name}`).toMatch(/^ws2025-/);
        expect(repair.from.valueType).not.toBe(repair.to.valueType);
      }
    }
  });
});
