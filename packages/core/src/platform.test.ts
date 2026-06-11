// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import {
  walkResourceTypes,
  detectManifestPlatform,
  validateManifestSchema,
  validateManifestPlatform,
  extractResourceSummary,
  extractResourcesFull,
  extractValidationSummary,
  extractValidationSummaryFromYaml,
  hasMixedPlatformResources,
  getPlatformForType,
  getValidTypesForPlatform,
} from './platform';

// ── walkResourceTypes ───────────────────────────────────────────────

describe('walkResourceTypes', () => {
  it('returns empty array for non-array input', () => {
    expect(walkResourceTypes(null)).toEqual([]);
    expect(walkResourceTypes(undefined)).toEqual([]);
    expect(walkResourceTypes('string')).toEqual([]);
    expect(walkResourceTypes({})).toEqual([]);
  });

  it('extracts types from flat resources', () => {
    const resources = [
      { name: 'r1', type: 'Microsoft.Windows/Registry', properties: {} },
      { name: 'r2', type: 'Microsoft.Windows/CSP', properties: {} },
    ];
    const result = walkResourceTypes(resources);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.type)).toEqual(['Microsoft.Windows/Registry', 'Microsoft.Windows/CSP']);
  });

  it('walks into Group.properties.resources', () => {
    const resources = [
      {
        name: 'group1',
        type: 'Microsoft.OSConfig/Group',
        properties: {
          resources: [
            { name: 'inner', type: 'Microsoft.Windows/Registry', properties: {} },
          ],
        },
      },
    ];
    const result = walkResourceTypes(resources);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('Microsoft.OSConfig/Group');
    expect(result[1].type).toBe('Microsoft.Windows/Registry');
    expect(result[1].path).toContain('properties.resources');
  });

  it('walks into Test.properties.resource (single nested)', () => {
    const resources = [
      {
        name: 'test1',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: { type: 'Microsoft.Windows/CSP', properties: { uri: './Device' } },
        },
      },
    ];
    const result = walkResourceTypes(resources);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('Microsoft.Windows/CSP');
    expect(result[1].path).toContain('properties.resource');
  });

  it('handles deeply nested Group inside Test', () => {
    const resources = [
      {
        name: 'test-wrapper',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            type: 'Microsoft.OSConfig/Group',
            properties: {
              resources: [
                { type: 'Microsoft.Windows/Registry' },
              ],
            },
          },
        },
      },
    ];
    const result = walkResourceTypes(resources);
    const types = result.map((r) => r.type);
    expect(types).toContain('Microsoft.OSConfig/Test');
    expect(types).toContain('Microsoft.OSConfig/Group');
    expect(types).toContain('Microsoft.Windows/Registry');
  });

  it('skips entries without type', () => {
    const resources = [{ name: 'noType' }, { name: 'hasType', type: 'Microsoft.Windows/CSP' }];
    const result = walkResourceTypes(resources);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Microsoft.Windows/CSP');
  });

  it('skips null and non-object entries', () => {
    const resources = [null, 42, 'string', { name: 'valid', type: 'Microsoft.Windows/CSP' }];
    const result = walkResourceTypes(resources);
    expect(result).toHaveLength(1);
  });
});

// ── detectManifestPlatform ──────────────────────────────────────────

describe('detectManifestPlatform', () => {
  it('returns cross-platform for empty resources', () => {
    expect(detectManifestPlatform([])).toBe('cross-platform');
  });

  it('detects windows-only manifest', () => {
    const resources = [
      { name: 'r1', type: 'Microsoft.Windows/Registry' },
      { name: 'r2', type: 'Microsoft.Windows/CSP' },
    ];
    expect(detectManifestPlatform(resources)).toBe('windows');
  });

  it('detects linux-only manifest', () => {
    const resources = [
      { name: 'r1', type: 'Linux/FilePermission' },
      { name: 'r2', type: 'Linux/KernelModule' },
    ];
    expect(detectManifestPlatform(resources)).toBe('linux');
  });

  it('detects mixed manifest (Windows + Linux types)', () => {
    const resources = [
      { name: 'r1', type: 'Microsoft.Windows/Registry' },
      { name: 'r2', type: 'Linux/FilePermission' },
    ];
    expect(detectManifestPlatform(resources)).toBe('mixed');
  });

  it('returns cross-platform for OSConfig-only types', () => {
    const resources = [
      { name: 'r1', type: 'Microsoft.OSConfig/DeviceInfo' },
      { name: 'r2', type: 'Microsoft.OSConfig/File' },
    ];
    expect(detectManifestPlatform(resources)).toBe('cross-platform');
  });

  it('detects platform from nested Group resources', () => {
    const resources = [
      {
        name: 'group',
        type: 'Microsoft.OSConfig/Group',
        properties: {
          resources: [{ type: 'Linux/KernelModule' }],
        },
      },
    ];
    expect(detectManifestPlatform(resources)).toBe('linux');
  });

  it('detects mixed from nested resources across platforms', () => {
    const resources = [
      {
        name: 'winGroup',
        type: 'Microsoft.OSConfig/Group',
        properties: { resources: [{ type: 'Microsoft.Windows/Registry' }] },
      },
      {
        name: 'linuxTest',
        type: 'Microsoft.OSConfig/Test',
        properties: { resource: { type: 'Linux/FilePermission' } },
      },
    ];
    expect(detectManifestPlatform(resources)).toBe('mixed');
  });
});

// ── validateManifestSchema ──────────────────────────────────────────

describe('validateManifestSchema', () => {
  it('rejects null', () => {
    expect(validateManifestSchema(null)).toHaveLength(1);
  });

  it('rejects an array', () => {
    expect(validateManifestSchema([])).toHaveLength(1);
  });

  it('rejects missing resources field', () => {
    expect(validateManifestSchema({ name: 'test' })).toHaveLength(1);
  });

  it('rejects resources as a map instead of array', () => {
    const errors = validateManifestSchema({ resources: { r1: {} } });
    expect(errors[0]).toContain('array');
  });

  it('accepts a valid minimal manifest', () => {
    const manifest = {
      resources: [{ name: 'r1', type: 'Microsoft.Windows/CSP' }],
    };
    expect(validateManifestSchema(manifest)).toHaveLength(0);
  });

  it('rejects resource with missing name', () => {
    const manifest = { resources: [{ type: 'Microsoft.Windows/CSP' }] };
    const errors = validateManifestSchema(manifest);
    expect(errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('rejects resource with missing type', () => {
    const manifest = { resources: [{ name: 'r1' }] };
    const errors = validateManifestSchema(manifest);
    expect(errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('rejects resource with empty name', () => {
    const manifest = { resources: [{ name: '', type: 'Microsoft.Windows/CSP' }] };
    expect(validateManifestSchema(manifest).length).toBeGreaterThan(0);
  });

  it('accepts resource with properties object', () => {
    const manifest = {
      resources: [{ name: 'r1', type: 'Microsoft.Windows/Registry', properties: { keyPath: 'HKLM:\\Test' } }],
    };
    expect(validateManifestSchema(manifest)).toHaveLength(0);
  });

  it('rejects resource with properties as non-object', () => {
    const manifest = { resources: [{ name: 'r1', type: 'Microsoft.Windows/CSP', properties: 'bad' }] };
    expect(validateManifestSchema(manifest).length).toBeGreaterThan(0);
  });

  it('validates nested Group resources', () => {
    const manifest = {
      resources: [
        {
          name: 'group1',
          type: 'Microsoft.OSConfig/Group',
          properties: {
            resources: [{ type: 'Microsoft.Windows/Registry' }], // name not required inside Group
          },
        },
      ],
    };
    expect(validateManifestSchema(manifest)).toHaveLength(0);
  });

  it('validates nested Test resource', () => {
    const manifest = {
      resources: [
        {
          name: 'test1',
          type: 'Microsoft.OSConfig/Test',
          properties: {
            resource: { type: 'Microsoft.Windows/CSP', properties: { uri: './Device' } },
          },
        },
      ],
    };
    expect(validateManifestSchema(manifest)).toHaveLength(0);
  });

  it('rejects non-array nested Group resources', () => {
    const manifest = {
      resources: [
        {
          name: 'group1',
          type: 'Microsoft.OSConfig/Group',
          properties: { resources: 'not-an-array' },
        },
      ],
    };
    expect(validateManifestSchema(manifest).length).toBeGreaterThan(0);
  });

  it('rejects non-object nested Test resource', () => {
    const manifest = {
      resources: [
        {
          name: 'test1',
          type: 'Microsoft.OSConfig/Test',
          properties: { resource: 'not-an-object' },
        },
      ],
    };
    expect(validateManifestSchema(manifest).length).toBeGreaterThan(0);
  });

  it('reports multiple errors at once', () => {
    const manifest = {
      resources: [
        { name: '', type: '' },
        { name: 'ok', type: '' },
      ],
    };
    const errors = validateManifestSchema(manifest);
    expect(errors.length).toBeGreaterThanOrEqual(3); // 2 × empty name/type on first + 1 empty type on second
  });

  it('refuses pathologically deep nesting instead of stack-overflowing', () => {
    // Build a Group nested 100 levels deep — well past the 50-depth cap.
    let nested: Record<string, unknown> = {
      name: 'leaf',
      type: 'Microsoft.Windows/Registry',
      properties: { regKey: 'X' },
    };
    for (let i = 0; i < 100; i++) {
      nested = {
        name: `g${i}`,
        type: 'Microsoft.OSConfig/Group',
        properties: { resources: [nested] },
      };
    }
    const manifest = { resources: [nested] };
    const errors = validateManifestSchema(manifest);
    // Should NOT throw RangeError. Should return a "too deep" error.
    expect(errors.some((e) => /too deep/i.test(e))).toBe(true);
  });
});

// ── validateManifestPlatform ────────────────────────────────────────

describe('validateManifestPlatform', () => {
  it('returns no errors for matching platform', () => {
    const resources = [{ name: 'r1', type: 'Microsoft.Windows/Registry' }];
    expect(validateManifestPlatform(resources, 'windows')).toHaveLength(0);
  });

  it('errors when deploying Linux types on Windows', () => {
    const resources = [{ name: 'r1', type: 'Linux/FilePermission' }];
    const errors = validateManifestPlatform(resources, 'windows');
    expect(errors.some((e) => e.includes('Linux'))).toBe(true);
  });

  it('errors when deploying Windows types on Linux', () => {
    const resources = [{ name: 'r1', type: 'Microsoft.Windows/Registry' }];
    const errors = validateManifestPlatform(resources, 'linux');
    expect(errors.some((e) => e.includes('Windows'))).toBe(true);
  });

  it('allows cross-platform types on either platform', () => {
    const resources = [{ name: 'r1', type: 'Microsoft.OSConfig/File' }];
    expect(validateManifestPlatform(resources, 'windows')).toHaveLength(0);
    expect(validateManifestPlatform(resources, 'linux')).toHaveLength(0);
  });

  it('detects mixed-platform manifests', () => {
    const resources = [
      { name: 'r1', type: 'Microsoft.Windows/Registry' },
      { name: 'r2', type: 'Linux/FilePermission' },
    ];
    const errors = validateManifestPlatform(resources, 'windows');
    expect(errors.some((e) => e.includes('mixes'))).toBe(true);
  });

  it('ignores unknown types (forward-compat)', () => {
    const resources = [{ name: 'r1', type: 'Future/NewProvider' }];
    expect(validateManifestPlatform(resources, 'windows')).toHaveLength(0);
    expect(validateManifestPlatform(resources, 'linux')).toHaveLength(0);
  });

  it('catches wrong-platform types nested inside Groups', () => {
    const resources = [
      {
        name: 'group',
        type: 'Microsoft.OSConfig/Group',
        properties: {
          resources: [{ type: 'Linux/KernelModule' }],
        },
      },
    ];
    const errors = validateManifestPlatform(resources, 'windows');
    expect(errors.some((e) => e.includes('Linux'))).toBe(true);
  });
});

// ── hasMixedPlatformResources ───────────────────────────────────────

describe('hasMixedPlatformResources', () => {
  it('returns false for single-platform', () => {
    expect(hasMixedPlatformResources([{ type: 'Microsoft.Windows/CSP' }])).toBe(false);
  });

  it('returns true for Windows + Linux types', () => {
    const resources = [{ type: 'Microsoft.Windows/CSP' }, { type: 'Linux/User' }];
    expect(hasMixedPlatformResources(resources)).toBe(true);
  });

  it('returns false for cross-platform-only types', () => {
    expect(hasMixedPlatformResources([{ type: 'Microsoft.OSConfig/File' }])).toBe(false);
  });
});

// ── extractResourceSummary ──────────────────────────────────────────

describe('extractResourceSummary', () => {
  it('returns empty array for non-array input', () => {
    expect(extractResourceSummary(null)).toEqual([]);
  });

  it('extracts name and type from flat resources', () => {
    const resources = [
      { name: 'r1', type: 'Microsoft.Windows/Registry', properties: {} },
      { name: 'r2', type: 'Microsoft.Windows/CSP', properties: {} },
    ];
    const result = extractResourceSummary(resources);
    expect(result).toEqual([
      { name: 'r1', type: 'Microsoft.Windows/Registry' },
      { name: 'r2', type: 'Microsoft.Windows/CSP' },
    ]);
  });

  it('walks into nested Group resources', () => {
    const resources = [
      {
        name: 'group1',
        type: 'Microsoft.OSConfig/Group',
        properties: {
          resources: [{ name: 'inner', type: 'Microsoft.Windows/Registry' }],
        },
      },
    ];
    const result = extractResourceSummary(resources);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ name: 'inner', type: 'Microsoft.Windows/Registry' });
  });

  it('skips entries without name or type', () => {
    const resources = [
      { name: 'r1' }, // no type
      { type: 'Microsoft.Windows/CSP' }, // no name
      { name: 'r3', type: 'Microsoft.Windows/Registry' },
    ];
    const result = extractResourceSummary(resources);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('r3');
  });
});

// ── extractResourcesFull ────────────────────────────────────────────

describe('extractResourcesFull', () => {
  it('returns empty array for non-array input', () => {
    expect(extractResourcesFull(null)).toEqual([]);
  });

  it('extracts leaf resources with properties', () => {
    const resources = [
      { name: 'r1', type: 'Microsoft.Windows/Registry', properties: { keyPath: 'HKLM:\\Test' } },
    ];
    const result = extractResourcesFull(resources);
    expect(result).toHaveLength(1);
    expect(result[0].properties.keyPath).toBe('HKLM:\\Test');
  });

  it('preserves Test wrappers intact (does not unwrap)', () => {
    const resources = [
      {
        name: 'test1',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: { type: 'Microsoft.Windows/CSP', properties: { uri: './Device' } },
          expression: '$.value == 1',
        },
      },
    ];
    const result = extractResourcesFull(resources);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Microsoft.OSConfig/Test');
    expect(result[0].properties.expression).toBe('$.value == 1');
    expect(result[0].properties.resource).toBeDefined();
  });

  it('unwraps Group into individual child resources', () => {
    const resources = [
      {
        name: 'group1',
        type: 'Microsoft.OSConfig/Group',
        properties: {
          resources: [
            { name: 'child1', type: 'Microsoft.Windows/Registry', properties: { keyPath: 'HKLM:\\A' } },
            { name: 'child2', type: 'Microsoft.Windows/CSP', properties: { uri: './B' } },
          ],
        },
      },
    ];
    const result = extractResourcesFull(resources);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('child1');
    expect(result[0].type).toBe('Microsoft.Windows/Registry');
    expect(result[1].name).toBe('child2');
  });

  it('assigns parent name to unnamed Group children', () => {
    const resources = [
      {
        name: 'myGroup',
        type: 'Microsoft.OSConfig/Group',
        properties: {
          resources: [
            { type: 'Microsoft.Windows/Registry', properties: { keyPath: 'HKLM:\\A' } },
          ],
        },
      },
    ];
    const result = extractResourcesFull(resources);
    expect(result[0].name).toBe('myGroup[0]');
  });
});

// ── getPlatformForType / getValidTypesForPlatform ───────────────────

describe('getPlatformForType', () => {
  it('returns windows for Windows types', () => {
    expect(getPlatformForType('Microsoft.Windows/Registry')).toBe('windows');
  });

  it('returns linux for Linux types', () => {
    expect(getPlatformForType('Linux/FilePermission')).toBe('linux');
  });

  it('returns cross-platform for OSConfig types', () => {
    expect(getPlatformForType('Microsoft.OSConfig/File')).toBe('cross-platform');
  });

  it('returns cross-platform for unknown types', () => {
    expect(getPlatformForType('Unknown/Type')).toBe('cross-platform');
  });
});

describe('getValidTypesForPlatform', () => {
  it('includes cross-platform types for both platforms', () => {
    const win = getValidTypesForPlatform('windows');
    const lin = getValidTypesForPlatform('linux');
    expect(win).toContain('Microsoft.OSConfig/File');
    expect(lin).toContain('Microsoft.OSConfig/File');
  });

  it('includes Windows types only for windows', () => {
    const win = getValidTypesForPlatform('windows');
    const lin = getValidTypesForPlatform('linux');
    expect(win).toContain('Microsoft.Windows/Registry');
    expect(lin).not.toContain('Microsoft.Windows/Registry');
  });

  it('includes Linux types only for linux', () => {
    const win = getValidTypesForPlatform('windows');
    const lin = getValidTypesForPlatform('linux');
    expect(lin).toContain('Linux/FilePermission');
    expect(win).not.toContain('Linux/FilePermission');
  });
});

// ── extractValidationSummary ────────────────────────────────────────────────

describe('extractValidationSummary', () => {
  it('returns issues for non-object input', () => {
    expect(extractValidationSummary(null).issues.length).toBeGreaterThan(0);
    expect(extractValidationSummary([]).issues.length).toBeGreaterThan(0);
    expect(extractValidationSummary('not a manifest').issues.length).toBeGreaterThan(0);
  });

  it('flags an empty manifest', () => {
    const r = extractValidationSummary({ $schema: 'https://x', resources: [] });
    expect(r.hasSchema).toBe(true);
    expect(r.issues).toContain('Manifest has no resources defined');
  });

  it('flags missing $schema as informational issue but everything else clean', () => {
    const r = extractValidationSummary({
      resources: [
        {
          name: 'r1',
          type: 'Microsoft.Windows/Registry',
          properties: { keyPath: 'HKLM:\\Software\\App', valueName: 'v', value: { dword: 1 } },
        },
      ],
    });
    expect(r.hasSchema).toBe(false);
    expect(r.issues.some((i) => i.toLowerCase().includes('$schema'))).toBe(true);
    // No structural issues since the resource is well-formed.
    expect(r.issues.filter((i) => !i.toLowerCase().includes('$schema'))).toEqual([]);
    expect(r.hasEnforcementValues).toBe(true);
  });

  it('does NOT report "missing properties" for valid resources (the original bug)', () => {
    // Pre-fix: every resource was tagged "missing properties" because the
    // listing payload didn't carry properties at all. With server-side
    // computation against the source YAML, well-formed manifests are clean.
    const r = extractValidationSummary({
      $schema: 'https://x',
      resources: [
        {
          name: 'r1',
          type: 'Microsoft.Windows/Registry',
          properties: { keyPath: 'HKLM:\\Software\\App', valueName: 'v', value: { dword: 1 } },
        },
        {
          name: 'r2',
          type: 'Microsoft.Windows/Registry',
          properties: { keyPath: 'HKLM:\\Software\\Other', valueName: 'w', value: { dword: 0 } },
        },
      ],
    });
    expect(r.issues).toEqual([]);
    expect(r.hasSchema).toBe(true);
    expect(r.hasEnforcementValues).toBe(true);
  });

  it('detects enforcement values inside Group wrappers (recursive)', () => {
    // SFF Linux baseline shape: a single top-level Group whose properties.resources
    // contain the actual enforcement entries.
    const r = extractValidationSummary({
      $schema: 'https://x',
      resources: [
        {
          name: 'sff-linux',
          type: 'Microsoft.OSConfig/Group',
          properties: {
            resources: [
              {
                type: 'Microsoft.OSConfig/File',
                properties: { path: '/etc/motd', value: 'banner' },
              },
              {
                type: 'Microsoft.OSConfig/FileLine',
                properties: { path: '/etc/sshd_config', value: 'PermitRootLogin no' },
              },
            ],
          },
        },
      ],
    });
    expect(r.hasEnforcementValues).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('detects enforcement inside Test wrappers (single nested resource)', () => {
    const r = extractValidationSummary({
      $schema: 'https://x',
      resources: [
        {
          name: 'audit-passwordmaxage',
          type: 'Microsoft.OSConfig/Test',
          properties: {
            resource: {
              type: 'Microsoft.OSConfig/File',
              properties: { path: '/etc/login.defs', value: 'PASS_MAX_DAYS 90' },
            },
            schema: { '$ref': '#/definitions/equals' },
          },
        },
      ],
    });
    expect(r.hasEnforcementValues).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('detects compliance criteria at the resource root', () => {
    const r = extractValidationSummary({
      $schema: 'https://x',
      resources: [
        {
          name: 'r1',
          type: 'Microsoft.Windows/Registry',
          properties: { keyPath: 'HKLM:\\Software\\App', valueName: 'v' },
          compliance: { equals: { dword: 1 } },
        },
      ],
    });
    expect(r.hasComplianceCriteria).toBe(true);
  });

  it('still surfaces real schema errors (e.g. resource without name/type)', () => {
    const r = extractValidationSummary({
      $schema: 'https://x',
      resources: [{ properties: {} } as Record<string, unknown>],
    });
    expect(r.issues.some((i) => i.includes('name'))).toBe(true);
    expect(r.issues.some((i) => i.includes('type'))).toBe(true);
  });

  it('does NOT require name on Group-nested children (matches schema validator)', () => {
    // Group children may inherit identity from the parent and omit `name`.
    const r = extractValidationSummary({
      $schema: 'https://x',
      resources: [
        {
          name: 'parent',
          type: 'Microsoft.OSConfig/Group',
          properties: {
            resources: [
              {
                type: 'Microsoft.OSConfig/File',
                properties: { path: '/etc/motd', value: 'banner' },
              },
            ],
          },
        },
      ],
    });
    expect(r.issues).toEqual([]);
  });

  it('counts a manifest with `data` enforcement field as having enforcement', () => {
    const r = extractValidationSummary({
      $schema: 'https://x',
      resources: [
        { name: 'r', type: 'Microsoft.Windows/Service', properties: { name: 'spooler', data: 'Disabled' } },
      ],
    });
    expect(r.hasEnforcementValues).toBe(true);
  });
});

// ── extractValidationSummaryFromYaml ────────────────────────────────────────

describe('extractValidationSummaryFromYaml', () => {
  it('parses YAML and produces the same summary as the parsed-doc variant', () => {
    const y = `\
$schema: https://aka.ms/osc/schemas/prerelease/document.json
resources:
  - name: r1
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\\\Software\\\\App
      valueName: v
      value:
        dword: 1
`;
    const r = extractValidationSummaryFromYaml(y);
    expect(r.hasSchema).toBe(true);
    expect(r.hasEnforcementValues).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('returns a fatal-parse summary on invalid YAML', () => {
    const r = extractValidationSummaryFromYaml('this: is: not: valid: yaml: : :');
    expect(r.issues[0]).toMatch(/YAML parse failed/i);
    expect(r.hasSchema).toBe(false);
    expect(r.hasEnforcementValues).toBe(false);
  });

  it('handles legacy security-definition-shaped JSON as "no resources" rather than a parser crash', () => {
    // The page is defensive about non-manifest shapes — make sure we don't
    // throw on them; just emit the appropriate validation issues.
    const r = extractValidationSummaryFromYaml(JSON.stringify({ Name: 'x', Settings: [] }));
    expect(r.issues.length).toBeGreaterThan(0);
  });
});
