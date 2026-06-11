// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { normalizeManifestForDiff, parseManifestCanonical } from './manifest-normalize';

// ── normalizeManifestForDiff ────────────────────────────────────────

describe('normalizeManifestForDiff', () => {
  it('returns original text for unparseable input', () => {
    expect(normalizeManifestForDiff('{{{')).toBe('{{{');
  });

  it('returns original text for empty string', () => {
    expect(normalizeManifestForDiff('')).toBe('');
  });

  it('normalizes YAML and JSON to identical output', () => {
    const yamlInput = `
name: test-ns
resources:
  - name: r1
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\\\Test
`;
    const jsonInput = JSON.stringify({
      name: 'test-ns',
      resources: [
        { name: 'r1', type: 'Microsoft.Windows/Registry', properties: { keyPath: 'HKLM:\\\\Test' } },
      ],
    });

    const normalizedYaml = normalizeManifestForDiff(yamlInput);
    const normalizedJson = normalizeManifestForDiff(jsonInput);
    expect(normalizedYaml).toBe(normalizedJson);
  });

  it('sorts resources by name', () => {
    const input = `
resources:
  - name: zebra
    type: Microsoft.Windows/CSP
    properties: {}
  - name: alpha
    type: Microsoft.Windows/Registry
    properties: {}
`;
    const result = normalizeManifestForDiff(input);
    const alphaIdx = result.indexOf('alpha');
    const zebraIdx = result.indexOf('zebra');
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it('sorts property keys deterministically', () => {
    const input = `
resources:
  - name: r1
    type: Microsoft.Windows/Registry
    properties:
      valueName: v1
      keyPath: HKLM:\\\\Test
`;
    const result = normalizeManifestForDiff(input);
    const keyPathIdx = result.indexOf('keyPath');
    const valueNameIdx = result.indexOf('valueName');
    expect(keyPathIdx).toBeLessThan(valueNameIdx);
  });

  it('handles case-insensitive top-level keys', () => {
    const input = `
Name: test-ns
Resources:
  - name: r1
    type: Microsoft.Windows/CSP
    properties: {}
`;
    const result = parseManifestCanonical(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-ns');
    expect(result!.resources).toHaveLength(1);
  });

  it('preserves schema field', () => {
    const input = `
$schema: https://aka.ms/osc/schemas/prerelease/document.json
resources:
  - name: r1
    type: Microsoft.Windows/CSP
    properties: {}
`;
    const result = normalizeManifestForDiff(input);
    expect(result).toContain('$schema');
  });

  it('preserves extra resource fields like dependsOn', () => {
    const input = `
resources:
  - name: r1
    type: Microsoft.Windows/CSP
    properties: {}
    dependsOn: r0
`;
    const result = parseManifestCanonical(input);
    expect(result!.resources[0]).toHaveProperty('dependson', 'r0');
  });
});

// ── parseManifestCanonical ──────────────────────────────────────────

describe('parseManifestCanonical', () => {
  it('returns null for empty string', () => {
    expect(parseManifestCanonical('')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseManifestCanonical('{{{')).toBeNull();
  });

  it('parses a valid manifest into canonical structure', () => {
    const input = `
name: my-baseline
resources:
  - name: reg1
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\\\Software
`;
    const result = parseManifestCanonical(input);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-baseline');
    expect(result!.resources).toHaveLength(1);
    expect(result!.resources[0].name).toBe('reg1');
    expect(result!.resources[0].type).toBe('Microsoft.Windows/Registry');
  });

  it('drops resources without name or type', () => {
    const input = `
resources:
  - name: valid
    type: Microsoft.Windows/CSP
    properties: {}
  - name: noType
    properties: {}
  - type: noName
    properties: {}
`;
    const result = parseManifestCanonical(input);
    expect(result!.resources).toHaveLength(1);
    expect(result!.resources[0].name).toBe('valid');
  });
});
