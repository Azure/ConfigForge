// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import {
  buildBaselineManifest,
  inferRegistryValueType,
  parseComplianceExpression,
  parseExcelBaseline,
} from './baseline';

describe('parseExcelBaseline', () => {
  it('parses BOM-prefixed quoted records with embedded commas and newlines', () => {
    const csv =
      '\uFEFF"Name","Registry Key","Registry Value","Registry Value Type","Default Value","Expected Value","Description"\r\n' +
      '"QuotedSetting","HKLM:\\SOFTWARE\\Example","ValueName","REG_SZ","hello","Equals(\'hello\')","line one,\r\nline two"\r\n';

    const [setting] = parseExcelBaseline(csv);

    expect(setting).toEqual(
      expect.objectContaining({
        settingName: 'QuotedSetting',
        registryPath: 'HKLM:\\SOFTWARE\\Example',
        registryValueName: 'ValueName',
        registryValueType: 'REG_SZ',
        defaultValue: 'hello',
        expectedValue: "Equals('hello')",
        description: 'line one,\r\nline two',
        format: 'osconfig',
      }),
    );
  });

  it('supports semicolon-delimited generic spreadsheets', () => {
    const [setting] = parseExcelBaseline(
      'Setting Name;Registry Path;Expected Value\nPasswordHistory;HKLM:\\Soft;24\n',
    );
    expect(setting).toEqual(
      expect.objectContaining({
        settingName: 'PasswordHistory',
        registryPath: 'HKLM:\\Soft',
        expectedValue: '24',
        format: 'generic',
      }),
    );
  });

  it('selects Member Server values and leaves non-applicable rows skippable', () => {
    const csv = [
      'Name,Registry Key,Registry Value,Registry Value Type,Default Value: Domain Controller,Default Value: Member Server,Expected Value: Domain Controller,Expected Value: Member Server',
      'Shared,HKLM:\\A,ValueA,REG_DWORD,0,1,Equals(0),Equals(1)',
      'DomainOnly,HKLM:\\B,ValueB,REG_DWORD,1,,Equals(1),',
    ].join('\n');

    const settings = parseExcelBaseline(csv);

    expect(settings[0]).toEqual(
      expect.objectContaining({
        selectedProfile: 'Member Server',
        defaultValue: '1',
        expectedValue: 'Equals(1)',
      }),
    );
    expect(settings[1]).toEqual(
      expect.objectContaining({
        selectedProfile: 'Member Server',
        defaultValue: undefined,
        expectedValue: undefined,
      }),
    );
  });

  it('rejects flattened report CSVs that lack inner resource data', () => {
    expect(() =>
      parseExcelBaseline(
        'Name,Description,DataType,Default,Value,Compliance\n' +
          'WSLv1 should not be allowed,Microsoft.OSConfig/Test,Microsoft.OSConfig/Test,,,\n',
      ),
    ).toThrow(/flattened report.*Registry or CSP/i);
  });
});

describe('parseComplianceExpression', () => {
  it.each([
    ['Equals(1)', { const: 1 }],
    ["Equals('0')", { const: '0' }],
    ['Equals(null)', { const: null }],
    ['Range(1, 15)', { minimum: 1, maximum: 15 }],
    ['Range(1, )', { minimum: 1 }],
    ['OneOf(Equals(1), Equals(null))', { oneOf: [{ const: 1 }, { const: null }] }],
    [
      "AllOf(Pattern('Name:[1-3]'), Pattern('Age:\\\\d+'))",
      { allOf: [{ pattern: 'Name:[1-3]' }, { pattern: 'Age:\\d+' }] },
    ],
    ["Not(Equals('Administrator'))", { not: { const: 'Administrator' } }],
    ["Contains('.log')", { pattern: '.log' }],
    [
      "ContainsAtLeast('A', 'B')",
      { allOf: [{ contains: { const: 'A' } }, { contains: { const: 'B' } }] },
    ],
    ["ContainsAtMost('A', 'B')", { items: { enum: ['A', 'B'] } }],
    [
      "ContainsExactly('A')",
      {
        allOf: [{ contains: { const: 'A' } }],
        items: { enum: ['A'] },
        minItems: 1,
        maxItems: 1,
        uniqueItems: true,
      },
    ],
  ])('converts %s to JSON Schema', (expression, expected) => {
    expect(parseComplianceExpression(expression)).toEqual(expected);
  });

  it('rejects unsupported operators instead of silently dropping compliance', () => {
    expect(() => parseComplianceExpression('UnknownRule(1)')).toThrow(
      /Unsupported compliance expression/,
    );
  });

  it('preserves unsafe integer literals exactly', () => {
    expect(parseComplianceExpression('Equals(18446744073709551615)')).toEqual({
      const: 18446744073709551615n,
    });
  });
});

describe('inferRegistryValueType', () => {
  it.each([
    [1, 'REG_DWORD'],
    ['4294967295', 'REG_DWORD'],
    ['4294967296', 'REG_QWORD'],
    [18446744073709551615n, 'REG_QWORD'],
    ['text', 'REG_SZ'],
  ])('infers %s as %s', (value, expected) => {
    expect(inferRegistryValueType(value)).toBe(expected);
  });
});

describe('buildBaselineManifest', () => {
  it('builds typed Registry and CSP Test resources and skips another profile', () => {
    const csv = [
      'Name,Registry Key,Registry Value,Registry Value Type,CSP Name,CSP Path,CSP Value Type,Default Value: Domain Controller,Default Value: Member Server,Expected Value: Domain Controller,Expected Value: Member Server',
      'RegistryDword,HKLM:\\SOFTWARE\\Example,Enabled,REG_DWORD,,,,0,1,Equals(0),"OneOf(Equals(1), Equals(null))"',
      'PreferCsp,HKLM:\\SOFTWARE\\Example,Mode,REG_DWORD,./Vendor/MSFT/Policy,Config/Example/Mode,Integer,0,2,Equals(0),"Range(1, 3)"',
      "MultiString,HKLM:\\SOFTWARE\\Example,Items,REG_MULTI_SZ,,,,A,B,\"ContainsAtMost('A', 'B')\",\"ContainsAtMost('A', 'B')\"",
      "AuditOnly,HKLM:\\SOFTWARE\\Example,AdminName,REG_SZ,,,,Administrator,,Equals('Administrator'),Not(Equals('Administrator'))",
      'DomainOnly,HKLM:\\SOFTWARE\\Example,Domain,REG_DWORD,,,,1,,Equals(1),',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));

    expect(built.profile).toBe('Member Server');
    expect(built.manifest.resources).toHaveLength(4);
    expect(built.skippedSettings.map((setting) => setting.settingName)).toEqual(['DomainOnly']);
    expect(built.manifest.resources[0]).toEqual({
      name: 'RegistryDword',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Example',
            valueName: 'Enabled',
            valueType: 'REG_DWORD',
            value: 1,
          },
        },
        schema: { oneOf: [{ const: 1 }, { const: null }] },
      },
    });
    expect(built.manifest.resources[1]).toEqual({
      name: 'PreferCsp',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/CSP',
          properties: {
            path: './Vendor/MSFT/Policy/Config/Example/Mode',
            type: 'integer',
            value: 2,
          },
        },
        schema: { minimum: 1, maximum: 3 },
      },
    });
    expect(built.manifest.resources[2]).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          resource: expect.objectContaining({
            properties: expect.objectContaining({
              valueType: 'REG_MULTI_SZ',
              value: ['B'],
            }),
          }),
        }),
      }),
    );
    expect(built.manifest.resources[3]).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          resource: expect.objectContaining({
            properties: expect.not.objectContaining({ value: expect.anything() }),
          }),
          schema: { not: { const: 'Administrator' } },
        }),
      }),
    );
  });

  it('keeps enforcement-only rows as direct resources', () => {
    const csv = [
      'Name,Registry Key,Registry Value,Registry Value Type,Default Value,Expected Value',
      'AutoAccountName,HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\LAPS,AutomaticAccountManagementNameOrPrefix,REG_SZ,WLapsAdmin,',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));

    expect(built.manifest.resources).toEqual([
      {
        name: 'AutoAccountName',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath:
            'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\LAPS',
          valueName: 'AutomaticAccountManagementNameOrPrefix',
          valueType: 'REG_SZ',
          value: 'WLapsAdmin',
        },
      },
    ]);
  });

  it('keeps resource-only rows when the CSV is not profile-specific', () => {
    const csv = [
      'Name,Registry Key,Registry Value,Registry Value Type,Default Value,Expected Value',
      'AuthorizedDecryptors,HKLM:\\SOFTWARE\\Example,Principal,REG_SZ,,',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));

    expect(built.manifest.resources).toEqual([
      {
        name: 'AuthorizedDecryptors',
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Example',
          valueName: 'Principal',
          valueType: 'REG_SZ',
        },
      },
    ]);
  });

  it('derives a desired value from Equals when an older OSConfig CSV has no Default column', () => {
    const csv = [
      'Name,Registry Key,Registry Value,Registry Value Type,Expected Value',
      'PasswordLength,HKLM:\\SOFTWARE\\Example,PasswordLength,REG_DWORD,Equals(15)',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));
    const resource = built.manifest.resources[0] as {
      properties: { resource: { properties: Record<string, unknown> } };
    };

    expect(resource.properties.resource.properties.value).toBe(15);
  });

  it('keeps generic default and expected values distinct', () => {
    const csv = [
      'Setting Name,Registry Path,Default Value,Expected Value',
      'MySetting,HKLM:\\SOFTWARE\\Example,0,1',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));

    expect(built.manifest.resources[0]).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ value: 0 }),
        compliance: { equals: 1 },
      }),
    );
  });

  it('uses QWord when either generic default or expected value exceeds DWORD', () => {
    const csv = [
      'Setting Name,Registry Path,Default Value,Expected Value',
      'WideExpected,HKLM:\\SOFTWARE\\Example,0,18446744073709551615',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));

    expect(built.manifest.resources[0]).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          valueType: 'REG_QWORD',
          value: 0,
        }),
        compliance: { equals: 18446744073709551615n },
      }),
    );
  });

  it('keeps inferred generic QWord values exact', () => {
    const csv = [
      'Setting Name,Registry Path,Default Value,Expected Value',
      'ExactQword,HKLM:\\SOFTWARE\\Example,18446744073709551615,18446744073709551614',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));

    expect(built.manifest.resources[0]).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          valueType: 'REG_QWORD',
          value: 18446744073709551615n,
        }),
        compliance: { equals: 18446744073709551614n },
      }),
    );
  });

  it('keeps explicit QWord defaults and compliance literals exact', () => {
    const csv = [
      'Name,Registry Key,Registry Value,Registry Value Type,Default Value,Expected Value',
      'ExactQword,HKLM:\\SOFTWARE\\Example,Exact,REG_QWORD,18446744073709551615,Equals(18446744073709551614)',
    ].join('\n');

    const built = buildBaselineManifest(parseExcelBaseline(csv));
    const resource = built.manifest.resources[0] as {
      properties: {
        resource: { properties: Record<string, unknown> };
        schema: Record<string, unknown>;
      };
    };

    expect(resource.properties.resource.properties.valueType).toBe('REG_QWORD');
    expect(resource.properties.resource.properties.value).toBe(18446744073709551615n);
    expect(resource.properties.schema).toEqual({ const: 18446744073709551614n });
  });
});
