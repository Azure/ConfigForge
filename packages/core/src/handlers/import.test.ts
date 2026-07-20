// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the `importFile` handler.
 *
 * Cover all four file types: osc-yaml, yaml, json (manifest +
 * security-definition + ambiguous), csv. Plus input validation
 * (empty, oversized, missing fields).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../import-export', () => ({
  parseOscYaml: vi.fn((text: string) => ({
    $schema: 'https://aka.ms/osc/schemas/prerelease/document.json',
    resources: [{ name: 'r1', type: 't' }],
    raw: text,
  })),
  parseSecurityDefinition: vi.fn(() => ({
    name: 'win10-baseline',
    version: '1.0',
    description: 'test',
    settings: [{ name: 's1', keyPath: 'HKLM\\Soft', expectedValue: 1 }],
  })),
  parseExcelBaseline: vi.fn(() => [
    {
      settingName: 'PasswordHistory',
      registryPath: 'HKLM\\Soft',
      expectedValue: '24',
      format: 'generic',
      rowNumber: 2,
      columns: {},
    },
  ]),
  inferRegistryValueType: vi.fn((expectedValue: unknown) => {
    if (
      (typeof expectedValue === 'number' && Number.isInteger(expectedValue)) ||
      (typeof expectedValue === 'string' && /^-?\d+$/.test(expectedValue.trim()))
    ) {
      return 'Dword';
    }
    return 'String';
  }),
  buildBaselineManifest: vi.fn((settings: Array<Record<string, unknown>>) => ({
    manifest: {
      $schema: 'https://aka.ms/osc/schemas/prerelease/document.json',
      resources: settings.map((setting) => ({
        name: String(setting.settingName),
        type: 'Microsoft.Windows/Registry',
        properties: {
          keyPath: setting.registryPath,
          valueName: setting.settingName,
          valueType: 'Dword',
          value: 24,
        },
        compliance: { equals: 24 },
      })),
    },
    includedSettings: settings,
    skippedSettings: [],
  })),
  exportToYaml: vi.fn(() => 'resources:\n  - name: out\n'),
}));

import {
  importFile,
  detectFileType,
  inferRegistryValueType,
  MAX_IMPORT_BYTES,
} from './import';
import { exportToYaml } from '../import-export';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('detectFileType', () => {
  it.each([
    ['x.osc.yaml', 'osc-yaml'],
    ['x.OSC.YML', 'osc-yaml'],
    ['plain.yaml', 'yaml'],
    ['plain.YML', 'yaml'],
    ['data.json', 'json'],
    ['baseline.csv', 'csv'],
    ['baseline.TSV', 'csv'],
    ['baseline.xlsx', 'csv'],
    ['unknown.bin', 'yaml'],
  ])('detects %s as %s', (filename, expected) => {
    expect(detectFileType(filename)).toBe(expected);
  });
});

describe('importFile', () => {
  it('rejects missing payload', () => {
    expect(() => importFile(undefined as never)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects empty filename', () => {
    expect(() => importFile({ filename: '', content: 'x' })).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects non-string content', () => {
    expect(() => importFile({ filename: 'a.yaml', content: 42 as never })).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects empty/whitespace content', () => {
    expect(() => importFile({ filename: 'a.yaml', content: '   \n\n' })).toThrowError(
      expect.objectContaining({ status: 400, message: expect.stringMatching(/empty/) }),
    );
  });

  it('rejects oversized content with 413', () => {
    const huge = 'x'.repeat(MAX_IMPORT_BYTES + 1);
    expect(() => importFile({ filename: 'big.yaml', content: huge })).toThrowError(
      expect.objectContaining({
        status: 413,
        message: expect.stringMatching(/too large/i),
      }),
    );
  });

  it('parses .osc.yaml as manifest', () => {
    const result = importFile({ filename: 'x.osc.yaml', content: 'resources: []' });
    expect(result.type).toBe('manifest');
    expect(result.data.resourceCount).toBe(1);
    expect(result.yaml).toBe('resources: []');
  });

  it('parses plain .yaml as manifest too', () => {
    const result = importFile({ filename: 'x.yaml', content: 'resources: []' });
    expect(result.type).toBe('manifest');
  });

  it('parses .json with resources array as manifest', () => {
    const json = JSON.stringify({ resources: [{ name: 'a' }, { name: 'b' }] });
    const result = importFile({ filename: 'x.json', content: json });
    expect(result.type).toBe('manifest');
    expect(result.data.resourceCount).toBe(2);
  });

  it('parses .json with Settings array as security-definition', () => {
    const json = JSON.stringify({
      Name: 'w10',
      Settings: [{ Name: 'PassPolicy' }],
    });
    const result = importFile({ filename: 'x.json', content: json });
    expect(result.type).toBe('security-definition');
    expect(result.data.settingCount).toBe(1);
  });

  it('rejects malformed JSON', () => {
    expect(() => importFile({ filename: 'x.json', content: '{not json' })).toThrowError(
      expect.objectContaining({ status: 400, message: expect.stringMatching(/not valid JSON/) }),
    );
  });

  it('rejects JSON arrays (manifest must be an object)', () => {
    expect(() => importFile({ filename: 'x.json', content: '[]' })).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects unrecognized JSON shapes', () => {
    expect(() => importFile({ filename: 'x.json', content: '{"foo": 42}' })).toThrowError(
      expect.objectContaining({
        status: 400,
        message: expect.stringMatching(/Unrecognized JSON shape/),
      }),
    );
  });

  it('parses .csv as baseline spreadsheet', () => {
    const result = importFile({
      filename: 'baseline.csv',
      content: 'name,path,value\nx,y,z\n',
    });
    expect(result.type).toBe('baseline-spreadsheet');
    expect(result.data.settingCount).toBe(1);
  });

  it('CSV import emits Registry resources with valueName + valueType so the editor schema validator passes', () => {
    // CF-FIX (importer): previously imported CSVs lacked valueName/valueType
    // and the inline manifest-editor validator immediately flagged every
    // imported resource as invalid. Schema requires both fields.
    const result = importFile({
      filename: 'baseline.csv',
      content: 'name,path,value\nx,y,z\n',
    });
    expect(result.type).toBe('baseline-spreadsheet');

    // The handler builds a manifest object and passes it to exportToYaml.
    // We assert the structure of that manifest argument so the test fails
    // if anyone regresses the valueType/valueName fields.
    const exportToYamlMock = vi.mocked(exportToYaml);
    const lastCallManifest = exportToYamlMock.mock.calls.at(-1)?.[0] as {
      resources: Array<{
        type: string;
        properties: Record<string, unknown>;
        compliance?: { equals: unknown };
      }>;
    };
    expect(lastCallManifest).toBeDefined();
    expect(lastCallManifest.resources.length).toBe(1);
    const r = lastCallManifest.resources[0];
    expect(r.type).toBe('Microsoft.Windows/Registry');
    expect(r.properties.keyPath).toBe('HKLM\\Soft');
    expect(r.properties.valueName).toBe('PasswordHistory');
    // mocked expectedValue is 24 (integer) → Dword
    expect(r.properties.valueType).toBe('Dword');
    expect(r.compliance).toEqual({ equals: 24 });
  });

  it('JSON security-definition import emits Registry resources with valueName + valueType', () => {
    // CF-FIX (importer): the security-definition branch previously also
    // omitted both fields; only keyPath was set, which fails schema
    // validation in the editor.
    const json = JSON.stringify({ Name: 'w10', Settings: [{ Name: 'PassPolicy' }] });
    const result = importFile({ filename: 'x.json', content: json });
    expect(result.type).toBe('security-definition');

    const exportToYamlMock = vi.mocked(exportToYaml);
    const lastCallManifest = exportToYamlMock.mock.calls.at(-1)?.[0] as {
      resources: Array<{
        name: string;
        type: string;
        properties: Record<string, unknown>;
      }>;
    };
    expect(lastCallManifest).toBeDefined();
    expect(lastCallManifest.resources.length).toBe(1);
    const r = lastCallManifest.resources[0];
    expect(r.type).toBe('Microsoft.Windows/Registry');
    expect(r.properties.keyPath).toBe('HKLM\\Soft');
    // valueName falls back to the setting name when not present in the
    // security-definition row.
    expect(r.properties.valueName).toBe('s1');
    // mocked expectedValue is 1 (integer) → Dword
    expect(r.properties.valueType).toBe('Dword');
  });
});

describe('inferRegistryValueType', () => {
  it('returns Dword for integer numbers', () => {
    expect(inferRegistryValueType(0)).toBe('Dword');
    expect(inferRegistryValueType(1)).toBe('Dword');
    expect(inferRegistryValueType(-1)).toBe('Dword');
    expect(inferRegistryValueType(24)).toBe('Dword');
  });

  it('returns Dword for integer-shaped strings', () => {
    expect(inferRegistryValueType('0')).toBe('Dword');
    expect(inferRegistryValueType('  42  ')).toBe('Dword');
    expect(inferRegistryValueType('-7')).toBe('Dword');
  });

  it('returns String for non-integer values', () => {
    expect(inferRegistryValueType('Enabled')).toBe('String');
    expect(inferRegistryValueType('true')).toBe('String'); // boolean-as-string is not Dword
    expect(inferRegistryValueType('1.5')).toBe('String'); // non-integer numeric string
    expect(inferRegistryValueType('')).toBe('String');
    expect(inferRegistryValueType('   ')).toBe('String');
    expect(inferRegistryValueType('1e3')).toBe('String'); // scientific notation
  });

  it('returns String for undefined / null / non-integer JS numbers / other types', () => {
    expect(inferRegistryValueType(undefined)).toBe('String');
    expect(inferRegistryValueType(null)).toBe('String');
    expect(inferRegistryValueType(1.5)).toBe('String'); // floats are not Dword
    expect(inferRegistryValueType(true)).toBe('String');
    expect(inferRegistryValueType({})).toBe('String');
  });
});
