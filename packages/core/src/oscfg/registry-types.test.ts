// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Registry valueType compatibility tests.
 *
 * The current microsoft/osconfig `schema/.document.json` defines only
 * `REG_DWORD`/`REG_QWORD` in its integer enum and `REG_MULTI_SZ` in its array
 * enum. `docs/resources/windows/Registry.md`, `examples/registry.osc.yaml`,
 * and Microsoft Learn set/test/quickstart files also author Registry
 * resources with `REG_*` names. Hardware verification additionally found
 * that `Dword` can return exit code 0 without applying the value. These tests
 * keep compatibility inputs behind that canonical boundary.
 */
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  canonicalizeRegistryValueType,
  normalizeRegistryKeyPath,
} from './index';
import {
  normalizeManifestRegistryTypes,
  normalizeManifestRegistryTypesInYaml,
  normalizeRegistryValueType,
} from './registry-types';

const RECOGNIZED_REGISTRY_HIVES = [
  'HKEY_LOCAL_MACHINE',
  'HKEY_CURRENT_USER',
  'HKEY_USERS',
  'HKEY_CLASSES_ROOT',
  'HKEY_CURRENT_CONFIG',
  'HKLM',
  'HKCU',
  'HKU',
  'HKCR',
  'HKCC',
] as const;

describe('canonicalizeRegistryValueType (public baseline guard helper)', () => {
  it.each([
    'REG_NONE',
    'REG_SZ',
    'REG_EXPAND_SZ',
    'REG_BINARY',
    'REG_DWORD',
    'REG_MULTI_SZ',
    'REG_QWORD',
  ])('keeps current upstream type %s byte-for-byte exact', (valueType) => {
    expect(canonicalizeRegistryValueType(valueType)).toBe(valueType);
  });

  it.each([
    ['Dword', 'REG_DWORD'],
    ['QWord', 'REG_QWORD'],
    ['MultiString', 'REG_MULTI_SZ'],
    ['String', 'REG_SZ'],
  ])('canonicalizes compatibility input %s to %s', (input, expected) => {
    expect(canonicalizeRegistryValueType(input)).toBe(expected);
  });

  it('preserves unknown values for the caller to validate', () => {
    expect(canonicalizeRegistryValueType('REG_FUTURE')).toBe('REG_FUTURE');
  });
});

describe('normalizeRegistryKeyPath (public baseline guard helper)', () => {
  // The dependent repository-wide guard can compare source and normalized
  // values. This unit suite intentionally does not rewrite shipped baselines.
  it.each(RECOGNIZED_REGISTRY_HIVES)(
    'keeps canonical recognized hive %s byte-for-byte exact',
    (hive) => {
      const keyPath = `${hive}:\\Software\\Canonical`;
      expect(normalizeRegistryKeyPath(keyPath)).toBe(keyPath);
    },
  );

  it.each(RECOGNIZED_REGISTRY_HIVES)(
    'canonicalizes colon-less recognized hive %s',
    (hive) => {
      expect(normalizeRegistryKeyPath(`${hive}\\Software\\Legacy`)).toBe(
        `${hive}:\\Software\\Legacy`,
      );
    },
  );
});

describe('normalizeRegistryValueType (PR19 leaf mapper)', () => {
  it('normalizes Dword input to REG_DWORD', () => {
    expect(normalizeRegistryValueType('Dword')).toBe('REG_DWORD');
  });

  it('normalizes aliases to the REG_* spellings used by upstream schema and examples', () => {
    expect(normalizeRegistryValueType('None')).toBe('REG_NONE');
    expect(normalizeRegistryValueType('REG_NONE')).toBe('REG_NONE');
    expect(normalizeRegistryValueType('String')).toBe('REG_SZ');
    expect(normalizeRegistryValueType('REG_SZ')).toBe('REG_SZ');
    expect(normalizeRegistryValueType('ExpandString')).toBe('REG_EXPAND_SZ');
    expect(normalizeRegistryValueType('REG_EXPAND_SZ')).toBe('REG_EXPAND_SZ');
    expect(normalizeRegistryValueType('Binary')).toBe('REG_BINARY');
    expect(normalizeRegistryValueType('REG_BINARY')).toBe('REG_BINARY');
    expect(normalizeRegistryValueType('Dword')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('REG_DWORD')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('REG_DWORD_LITTLE_ENDIAN')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('REG_DWORD_BIG_ENDIAN')).toBe(
      'REG_DWORD_BIG_ENDIAN',
    );
    expect(normalizeRegistryValueType('MultiString')).toBe('REG_MULTI_SZ');
    expect(normalizeRegistryValueType('REG_MULTI_SZ')).toBe('REG_MULTI_SZ');
    expect(normalizeRegistryValueType('QWord')).toBe('REG_QWORD');
    expect(normalizeRegistryValueType('REG_QWORD')).toBe('REG_QWORD');
    expect(normalizeRegistryValueType('REG_QWORD_LITTLE_ENDIAN')).toBe('REG_QWORD');
  });

  it('is case-insensitive for known aliases', () => {
    expect(normalizeRegistryValueType('dword')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('reg_dword')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('Reg_Sz')).toBe('REG_SZ');
  });

  it('keeps current REG_* input canonical', () => {
    expect(normalizeRegistryValueType('REG_DWORD')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('REG_QWORD')).toBe('REG_QWORD');
    expect(normalizeRegistryValueType('REG_SZ')).toBe('REG_SZ');
    expect(normalizeRegistryValueType('REG_MULTI_SZ')).toBe('REG_MULTI_SZ');
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
  it('normalizes Dword on a top-level Microsoft.Windows/Registry resource', () => {
    const m = {
      resources: [
        {
          name: 'r1',
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath: 'HKLM:\\Software\\X',
            valueName: 'V',
            valueType: 'Dword',
            value: 1,
          },
        },
      ],
    };
    const out = normalizeManifestRegistryTypes(m);
    expect(out.resources[0].properties.valueType).toBe('REG_DWORD');
  });

  it('keeps REG_DWORD inside a Microsoft.OSConfig/Test wrapper', () => {
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
    expect(inner.valueType).toBe('REG_DWORD');
  });

  it('normalizes compatibility aliases inside a Microsoft.OSConfig/Group container', () => {
    const m = {
      resources: [
        {
          name: 'g',
          type: 'Microsoft.OSConfig/Group',
          properties: {
            resources: [
              {
                type: 'Microsoft.Windows/Registry',
                properties: { keyPath: 'X', valueName: 'V', valueType: 'String', value: 'hi' },
              },
              {
                type: 'Microsoft.Windows/Registry',
                properties: { keyPath: 'Y', valueName: 'W', valueType: 'MultiString', value: ['a'] },
              },
            ],
          },
        },
      ],
    };
    const out = normalizeManifestRegistryTypes(m);
    expect(out.resources[0].properties.resources[0].properties.valueType).toBe('REG_SZ');
    expect(out.resources[0].properties.resources[1].properties.valueType).toBe(
      'REG_MULTI_SZ',
    );
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

  it('normalizes Registry resources through pathologically deep nesting', () => {
    let nested: Record<string, unknown> = {
      type: 'Microsoft.Windows/Registry',
      properties: { valueType: 'Dword' },
    };
    for (let i = 0; i < 200; i++) {
      nested = { type: 'Microsoft.OSConfig/Group', properties: { resources: [nested] } };
    }

    const normalized = normalizeManifestRegistryTypes(nested);
    let current = normalized;
    for (let i = 0; i < 200; i++) {
      current = (
        current.properties as { resources: Record<string, unknown>[] }
      ).resources[0];
    }
    expect(
      (current.properties as { valueType: string }).valueType,
    ).toBe('REG_DWORD');
  });
});

describe('normalizeManifestRegistryTypes — Registry keyPath', () => {
  it('normalizes a direct Registry resource while preserving hive casing', () => {
    const manifest = {
      resources: [
        {
          name: 'direct',
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath: 'hkey_local_machine\\Software\\Vendor',
            valueName: 'Enabled',
            valueType: 'Dword',
            value: 1,
          },
        },
      ],
    };

    const output = normalizeManifestRegistryTypes(manifest);

    expect(output.resources[0].properties.keyPath).toBe(
      'hkey_local_machine:\\Software\\Vendor',
    );
    expect(manifest.resources[0].properties.keyPath).toBe(
      'hkey_local_machine\\Software\\Vendor',
    );
  });

  it('normalizes Registry nested inside a Test resource', () => {
    const manifest = {
      resources: [
        {
          name: 'test',
          type: 'Microsoft.OSConfig/Test',
          properties: {
            resource: {
              type: 'Microsoft.Windows/Registry',
              properties: { keyPath: 'HKLM\\Software\\Test' },
            },
          },
        },
      ],
    };

    const output = normalizeManifestRegistryTypes(manifest);

    expect(output.resources[0].properties.resource.properties.keyPath).toBe(
      'HKLM:\\Software\\Test',
    );
  });

  it('normalizes Registry through nested Group containers', () => {
    const manifest = {
      resources: [
        {
          name: 'outer',
          type: 'Microsoft.OSConfig/Group',
          properties: {
            resources: [
              {
                name: 'inner',
                type: 'Microsoft.OSConfig/Group',
                properties: {
                  resources: [
                    {
                      name: 'registry',
                      type: 'Microsoft.Windows/Registry',
                      properties: { keyPath: 'HKCU\\Software\\Nested' },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    const output = normalizeManifestRegistryTypes(manifest);

    expect(
      output.resources[0].properties.resources[0].properties.resources[0].properties
        .keyPath,
    ).toBe('HKCU:\\Software\\Nested');
  });

  it('preserves already-canonical and unknown paths verbatim', () => {
    expect(normalizeRegistryKeyPath('HKLM:\\Software\\Canonical')).toBe(
      'HKLM:\\Software\\Canonical',
    );
    expect(normalizeRegistryKeyPath('CUSTOM_HIVE\\Software\\Unknown')).toBe(
      'CUSTOM_HIVE\\Software\\Unknown',
    );
  });

  it('does not rewrite keyPath-shaped fields on non-Registry resources', () => {
    const manifest = {
      resources: [
        {
          name: 'custom',
          type: 'Contoso/Custom',
          properties: { keyPath: 'HKLM\\MustRemainUnchanged' },
        },
      ],
    };

    expect(normalizeManifestRegistryTypes(manifest)).toEqual(manifest);
  });
});

describe('normalizeManifestRegistryTypesInYaml (PR19 YAML round-trip)', () => {
  it('keeps REG_DWORD canonical inside a Test resource', () => {
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
    expect(doc.resources[0].properties.resource.properties.valueType).toBe('REG_DWORD');
    expect(out).toContain('REG_DWORD');
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

  it('preserves aliases, arbitrary fields, and exact QWord values', () => {
    const input = `customTopLevel:
  retained: true
resources:
  - &registry
    name: direct
    type: Microsoft.Windows/Registry
    customResourceField: keep-me
    properties:
      keyPath: HKEY_LOCAL_MACHINE\\Software\\Alias
      valueName: LargeValue
      valueType: REG_QWORD
      value: 18446744073709551615
      customProperty: keep-me-too
  - *registry
`;

    const output = normalizeManifestRegistryTypesInYaml(input);
    const doc = yaml.load(output) as {
      customTopLevel: { retained: boolean };
      resources: Array<{
        customResourceField: string;
        properties: {
          keyPath: string;
          customProperty: string;
        };
      }>;
    };

    expect(doc.customTopLevel.retained).toBe(true);
    expect(doc.resources[0].customResourceField).toBe('keep-me');
    expect(doc.resources[0].properties.customProperty).toBe('keep-me-too');
    expect(doc.resources[0].properties.keyPath).toBe(
      'HKEY_LOCAL_MACHINE:\\Software\\Alias',
    );
    expect(output).toMatch(/&ref_\d+/);
    expect(output).toMatch(/\*ref_\d+/);
    expect(output).toContain('18446744073709551615');
  });

  it('returns input unchanged when YAML fails to parse', () => {
    const broken = `not: valid: yaml: at all: [`;
    expect(normalizeManifestRegistryTypesInYaml(broken)).toBe(broken);
  });
});
