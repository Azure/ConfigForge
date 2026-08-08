// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { resourcesToYaml, parseYamlDocument, parseYamlDocumentLossless } from './format';

describe('resourcesToYaml', () => {
  it('produces valid YAML with schema, name, and resources', () => {
    const result = resourcesToYaml('test-ns', [
      { name: 'r1', type: 'Microsoft.Windows/Registry', properties: { keyPath: 'HKLM:\\Test' } },
    ]);
    expect(result).toContain('$schema:');
    expect(result).toContain('name: test-ns');
    expect(result).toContain('r1');
    expect(result).toContain('Microsoft.Windows/Registry');
  });

  it('includes a header comment', () => {
    const result = resourcesToYaml('ns', []);
    expect(result).toMatch(/^# Reconstructed by ConfigForge/);
  });

  it('omits properties key when properties is empty', () => {
    const result = resourcesToYaml('ns', [{ name: 'r1', type: 'Microsoft.Windows/CSP' }]);
    // Parse back and check the resource doesn't have 'properties'
    const parsed = parseYamlDocument(result.replace(/^#.*\n/, ''));
    const resources = parsed.resources as Array<Record<string, unknown>>;
    expect(resources[0]).not.toHaveProperty('properties');
  });

  it('includes compliance field when present', () => {
    const result = resourcesToYaml('ns', [
      {
        name: 'r1',
        type: 'Microsoft.OSConfig/Test',
        properties: { resource: {} },
        compliance: { expression: '$.value == 1' },
      },
    ]);
    expect(result).toContain('compliance');
  });

  it('round-trips through parseYamlDocument', () => {
    const resources = [
      { name: 'reg1', type: 'Microsoft.Windows/Registry', properties: { keyPath: 'HKLM:\\Test', valueName: 'v' } },
      { name: 'csp1', type: 'Microsoft.Windows/CSP', properties: { uri: './Device/Vendor' } },
    ];
    const yamlText = resourcesToYaml('my-ns', resources);
    const parsed = parseYamlDocument(yamlText.replace(/^#.*\n/, ''));
    expect(parsed.name).toBe('my-ns');
    expect((parsed.resources as unknown[]).length).toBe(2);
  });
});

describe('parseYamlDocument', () => {
  it('returns empty object for empty string', () => {
    expect(parseYamlDocument('')).toEqual({});
  });

  it('returns empty object for non-object YAML', () => {
    expect(parseYamlDocument('just a string')).toEqual({});
  });

  it('parses a simple YAML document', () => {
    const result = parseYamlDocument('name: test\nvalue: 42\n');
    expect(result.name).toBe('test');
    expect(result.value).toBe(42);
  });

  it('parses JSON (JSON is valid YAML)', () => {
    const result = parseYamlDocument('{"name": "test", "count": 3}');
    expect(result.name).toBe('test');
    expect(result.count).toBe(3);
  });
});

describe('parseYamlDocumentLossless', () => {
  it('preserves QWord integers outside the JavaScript safe range', () => {
    const result = parseYamlDocumentLossless('value: 18446744073709551615');

    expect(result.value).toBe(18446744073709551615n);
  });
});
