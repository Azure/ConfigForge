// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR19: tests for the Win32 -> DSC registry valueType normalizer.
 *
 * The bug it fixes: oscfg's Microsoft.Windows/Registry provider expects
 * DSC-style names (Dword, String, MultiString, Binary, QWord,
 * ExpandString, None). Microsoft Defender baselines, ConfigManager
 * exports, and most group-policy CSVs use the Win32 API names instead
 * (REG_DWORD, REG_SZ, ...). Sending those to oscfg fails with
 * "The parameter is incorrect. (os error 87)" — every rule silently
 * dies on enforce.
 *
 * The fix: a defensive normalizer in the apply path that translates
 * REG_* -> DSC names before the YAML hits the CLI. Exercised here at
 * three layers: the leaf string mapper, the manifest-tree walker, and
 * the YAML round-trip.
 */
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  normalizeManifestRegistryTypes,
  normalizeManifestRegistryTypesInYaml,
  normalizeRegistryValueType,
} from './registry-types';

describe('normalizeRegistryValueType (PR19 leaf mapper)', () => {
  it('translates REG_DWORD -> Dword', () => {
    expect(normalizeRegistryValueType('REG_DWORD')).toBe('Dword');
  });

  it('translates the full Win32 -> DSC table', () => {
    expect(normalizeRegistryValueType('REG_NONE')).toBe('None');
    expect(normalizeRegistryValueType('REG_SZ')).toBe('String');
    expect(normalizeRegistryValueType('REG_EXPAND_SZ')).toBe('ExpandString');
    expect(normalizeRegistryValueType('REG_BINARY')).toBe('Binary');
    expect(normalizeRegistryValueType('REG_DWORD')).toBe('Dword');
    expect(normalizeRegistryValueType('REG_DWORD_LITTLE_ENDIAN')).toBe('Dword');
    expect(normalizeRegistryValueType('REG_DWORD_BIG_ENDIAN')).toBe('Dword');
    expect(normalizeRegistryValueType('REG_MULTI_SZ')).toBe('MultiString');
    expect(normalizeRegistryValueType('REG_QWORD')).toBe('QWord');
    expect(normalizeRegistryValueType('REG_QWORD_LITTLE_ENDIAN')).toBe('QWord');
  });

  it('is case-insensitive on the Win32 spellings', () => {
    expect(normalizeRegistryValueType('reg_dword')).toBe('Dword');
    expect(normalizeRegistryValueType('Reg_Sz')).toBe('String');
  });

  it('leaves DSC-style names untouched', () => {
    expect(normalizeRegistryValueType('Dword')).toBe('Dword');
    expect(normalizeRegistryValueType('String')).toBe('String');
    expect(normalizeRegistryValueType('MultiString')).toBe('MultiString');
  });

  it('leaves unknown strings untouched (so the CLI can surface its own error)', () => {
    expect(normalizeRegistryValueType('totally-not-a-type')).toBe('totally-not-a-type');
  });

  it('passes through non-string inputs unchanged', () => {
    expect(normalizeRegistryValueType(null)).toBe(null);
    expect(normalizeRegistryValueType(undefined)).toBe(undefined);
    expect(normalizeRegistryValueType(42)).toBe(42);
  });
});

describe('normalizeManifestRegistryTypes (PR19 tree walker)', () => {
  it('rewrites valueType on a top-level Microsoft.Windows/Registry resource', () => {
    const m = {
      resources: [
        {
          name: 'r1',
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath: 'HKLM:\\Software\\X',
            valueName: 'V',
            valueType: 'REG_DWORD',
            value: 1,
          },
        },
      ],
    };
    const out = normalizeManifestRegistryTypes(m);
    expect(out.resources[0].properties.valueType).toBe('Dword');
  });

  it('rewrites valueType inside a Microsoft.OSConfig/Test wrapper (Defender baseline shape)', () => {
    const m = {
      resources: [
        {
          name: 'AllowDatagramProcessingOnWinServer',
          type: 'Microsoft.OSConfig/Test',
          properties: {
            resource: {
              type: 'Microsoft.Windows/Registry',
              properties: {
                keyPath: 'HKLM:\\Software\\X',
                valueName: 'AllowDatagramProcessingOnWinServer',
                valueType: 'REG_DWORD',
                value: 0,
              },
            },
            schema: { oneOf: [{ const: 0 }, { type: 'null' }] },
          },
        },
      ],
    };
    const out = normalizeManifestRegistryTypes(m);
    const inner = out.resources[0].properties.resource.properties;
    expect(inner.valueType).toBe('Dword');
  });

  it('rewrites valueType inside a Microsoft.OSConfig/Group container', () => {
    const m = {
      resources: [
        {
          name: 'g',
          type: 'Microsoft.OSConfig/Group',
          properties: {
            resources: [
              {
                type: 'Microsoft.Windows/Registry',
                properties: { keyPath: 'X', valueName: 'V', valueType: 'REG_SZ', value: 'hi' },
              },
              {
                type: 'Microsoft.Windows/Registry',
                properties: { keyPath: 'Y', valueName: 'W', valueType: 'REG_MULTI_SZ', value: ['a'] },
              },
            ],
          },
        },
      ],
    };
    const out = normalizeManifestRegistryTypes(m);
    expect(out.resources[0].properties.resources[0].properties.valueType).toBe('String');
    expect(out.resources[0].properties.resources[1].properties.valueType).toBe('MultiString');
  });

  it('does not mutate the input', () => {
    const m = {
      resources: [
        {
          type: 'Microsoft.Windows/Registry',
          properties: { valueType: 'REG_DWORD' },
        },
      ],
    };
    const orig = JSON.parse(JSON.stringify(m));
    normalizeManifestRegistryTypes(m);
    expect(m).toEqual(orig);
  });

  it('passes through manifests with no Registry resources unchanged', () => {
    const m = {
      resources: [
        { name: 'pkg', type: 'Microsoft.Linux/Package', properties: { name: 'curl' } },
      ],
    };
    const out = normalizeManifestRegistryTypes(m);
    expect(out).toEqual(m);
  });

  it('handles null / non-object input safely', () => {
    expect(normalizeManifestRegistryTypes(null)).toBe(null);
    expect(normalizeManifestRegistryTypes(undefined)).toBe(undefined);
    expect(normalizeManifestRegistryTypes('not an object' as unknown)).toBe('not an object');
  });

  it('does not stack-overflow on pathologically deep nesting', () => {
    let nested: Record<string, unknown> = { type: 'Microsoft.Windows/Registry', properties: { valueType: 'REG_DWORD' } };
    for (let i = 0; i < 200; i++) {
      nested = { type: 'Microsoft.OSConfig/Group', properties: { resources: [nested] } };
    }
    expect(() => normalizeManifestRegistryTypes(nested)).not.toThrow();
  });
});

describe('normalizeManifestRegistryTypesInYaml (PR19 YAML round-trip)', () => {
  it('rewrites REG_DWORD inside a Defender-shaped baseline', () => {
    const input = `resources:
  - name: AllowDatagramProcessingOnWinServer
    type: Microsoft.OSConfig/Test
    properties:
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKLM:\\Software\\Defender
          valueName: AllowDatagramProcessingOnWinServer
          valueType: REG_DWORD
          value: 0
`;
    const out = normalizeManifestRegistryTypesInYaml(input);
    const doc = yaml.load(out) as { resources: Array<{ properties: { resource: { properties: { valueType: string } } } }> };
    expect(doc.resources[0].properties.resource.properties.valueType).toBe('Dword');
    expect(out).not.toContain('REG_DWORD');
  });

  it('fast-paths YAML that does not mention REG_ (returns input unchanged)', () => {
    const input = `resources:
  - name: x
    type: Microsoft.Linux/Package
    properties:
      name: curl
`;
    expect(normalizeManifestRegistryTypesInYaml(input)).toBe(input);
  });

  it('returns input unchanged when YAML fails to parse', () => {
    const broken = `not: valid: yaml: at all: [`;
    expect(normalizeManifestRegistryTypesInYaml(broken)).toBe(broken);
  });
});
