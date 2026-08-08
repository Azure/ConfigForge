// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLosslessJson } from '../manifest/lossless';
import { execResource, serializeProperties } from './exec';
import { runOscfg } from './runner';

vi.mock('./runner', () => ({
  runOscfg: vi.fn(),
}));

const runOscfgMock = vi.mocked(runOscfg);

beforeEach(() => {
  vi.clearAllMocks();
  runOscfgMock.mockResolvedValue({
    success: true,
    data: { name: 'registry', type: 'Microsoft.Windows/Registry', properties: {} },
    error: null,
    exitCode: 0,
  });
});

function executedProperties(): Record<string, unknown> {
  const args = runOscfgMock.mock.calls[0][0];
  const propertiesIndex = args.indexOf('--properties');
  if (propertiesIndex === -1) throw new Error('Expected --properties');
  return parseLosslessJson(args[propertiesIndex + 1]) as Record<string, unknown>;
}

describe('serializeProperties', () => {
  it('returns empty string for undefined', () => {
    expect(serializeProperties(undefined)).toBe('');
  });

  it('returns empty string for empty object', () => {
    expect(serializeProperties({})).toBe('');
  });

  it('serializes simple properties to JSON', () => {
    const result = serializeProperties({ keyPath: 'HKLM:\\Software', valueName: 'Version' });
    const parsed = JSON.parse(result);
    expect(parsed.keyPath).toBe('HKLM:\\Software');
    expect(parsed.valueName).toBe('Version');
  });

  it('preserves numeric values', () => {
    const result = serializeProperties({ value: 42, enabled: true });
    const parsed = JSON.parse(result);
    expect(parsed.value).toBe(42);
    expect(parsed.enabled).toBe(true);
  });

  it('handles nested objects', () => {
    const result = serializeProperties({ outer: { inner: 'deep' } });
    const parsed = JSON.parse(result);
    expect(parsed.outer.inner).toBe('deep');
  });

  it('produces valid JSON with backslashes in registry paths', () => {
    const result = serializeProperties({ keyPath: 'HKLM:\\Software\\MyApp\\Settings' });
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).keyPath).toBe('HKLM:\\Software\\MyApp\\Settings');
  });

  it('serializes unsafe QWord bigints without rounding', () => {
    const result = serializeProperties({ value: 18446744073709551615n });

    expect(result).toBe('{"value":18446744073709551615}');
    expect(parseLosslessJson(result)).toEqual({ value: 18446744073709551615n });
  });
});

describe('execResource response normalization', () => {
  it('preserves the object returned by oscfg 1.3.x', async () => {
    const resource = {
      name: 'registry',
      type: 'Microsoft.Windows/Registry',
      properties: { value: 1 },
    };
    runOscfgMock.mockResolvedValueOnce({
      success: true,
      data: resource,
      error: null,
      exitCode: 0,
    });

    const result = await execResource({
      mode: 'get',
      type: resource.type,
      properties: {
        keyPath: 'HKLM:\\Software\\ConfigForge',
        valueName: 'Enabled',
        valueType: 'REG_DWORD',
        value: 1,
      },
    });

    expect(result.data).toEqual(resource);
  });

  it('unwraps the single-item array returned by oscfg 1.4.3', async () => {
    const resource = {
      name: 'csp',
      type: 'Microsoft.Windows/CSP',
      properties: { value: 1 },
    };
    runOscfgMock.mockResolvedValueOnce({
      success: true,
      data: [resource],
      error: null,
      exitCode: 0,
    });

    const result = await execResource({
      mode: 'get',
      type: resource.type,
      properties: {
        path: './Vendor/MSFT/Policy/Config/Test/Setting',
        type: 'integer',
        value: 1,
      },
    });

    expect(result).toMatchObject({
      success: true,
      data: resource,
      error: null,
      exitCode: 0,
    });
  });

  it('returns null data for an empty direct exec response', async () => {
    runOscfgMock.mockResolvedValueOnce({
      success: true,
      data: [],
      error: null,
      exitCode: 0,
    });

    const result = await execResource({
      mode: 'get',
      type: 'Microsoft.Windows/CSP',
      properties: {
        path: './Vendor/MSFT/Policy/Config/Test/Setting',
        type: 'integer',
        value: 1,
      },
    });

    expect(result).toMatchObject({
      success: true,
      data: null,
      error: null,
      exitCode: 0,
    });
  });

  it('rejects ambiguous multi-resource exec responses', async () => {
    runOscfgMock.mockResolvedValueOnce({
      success: true,
      data: [
        { name: 'first', type: 'Microsoft.Windows/CSP', properties: {} },
        { name: 'second', type: 'Microsoft.Windows/CSP', properties: {} },
      ],
      error: null,
      exitCode: 0,
    });

    const result = await execResource({
      mode: 'get',
      type: 'Microsoft.Windows/CSP',
      properties: {
        path: './Vendor/MSFT/Policy/Config/Test/Setting',
        type: 'integer',
        value: 1,
      },
    });

    expect(result).toMatchObject({
      success: false,
      data: null,
      error: 'oscfg exec resource returned 2 resources; expected exactly one',
      exitCode: 0,
    });
  });

  it('preserves multi-resource responses for list mode', async () => {
    const resources = [
      { name: 'first', type: 'Microsoft.Windows/Firmware', properties: {} },
      { name: 'second', type: 'Microsoft.Windows/Firmware', properties: {} },
    ];
    runOscfgMock.mockResolvedValueOnce({
      success: true,
      data: resources,
      error: null,
      exitCode: 0,
    });

    const result = await execResource({
      mode: 'list',
      type: 'Microsoft.Windows/Firmware',
      properties: {},
    });

    expect(result).toMatchObject({
      success: true,
      data: resources,
      error: null,
      exitCode: 0,
    });
  });
});

describe('execResource Registry normalization', () => {
  it('sends canonical REG_DWORD for direct Dword input', async () => {
    await execResource({
      mode: 'set',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM\\Software\\Direct',
        valueName: 'Enabled',
        valueType: 'Dword',
        value: 1,
      },
    });

    expect(executedProperties()).toMatchObject({
      keyPath: 'HKLM:\\Software\\Direct',
      valueType: 'REG_DWORD',
    });
  });

  it('keeps direct REG_DWORD input canonical', async () => {
    await execResource({
      mode: 'set',
      type: 'Microsoft.Windows/Registry',
      properties: {
        keyPath: 'HKLM:\\Software\\Direct',
        valueName: 'Enabled',
        valueType: 'REG_DWORD',
        value: 1,
      },
    });

    expect(executedProperties().valueType).toBe('REG_DWORD');
  });

  it('keeps REG_DWORD canonical recursively through Test', async () => {
    await execResource({
      mode: 'set',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath: 'HKLM\\Software\\Test',
            valueName: 'Enabled',
            valueType: 'REG_DWORD',
            value: 1,
          },
        },
      },
    });

    const properties = executedProperties() as {
      resource: { properties: Record<string, unknown> };
    };
    expect(properties.resource.properties).toMatchObject({
      keyPath: 'HKLM:\\Software\\Test',
      valueType: 'REG_DWORD',
    });
  });

  it('normalizes Dword recursively through Group', async () => {
    await execResource({
      mode: 'set',
      type: 'Microsoft.OSConfig/Group',
      properties: {
        resources: [
          {
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM\\Software\\Group',
              valueName: 'Enabled',
              valueType: 'Dword',
              value: 1,
            },
          },
        ],
      },
    });

    const properties = executedProperties() as {
      resources: Array<{ properties: Record<string, unknown> }>;
    };
    expect(properties.resources[0].properties).toMatchObject({
      keyPath: 'HKLM:\\Software\\Group',
      valueType: 'REG_DWORD',
    });
  });
});
