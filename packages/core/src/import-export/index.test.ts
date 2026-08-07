// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR17: hardening tests for parseSecurityDefinition.
 *
 * The function previously called `JSON.parse` directly and let the raw
 * SyntaxError bubble up to the API route. PR17 wraps the call so the
 * caller gets a stable, descriptive `Error("Invalid JSON in security
 * definition: …")` and can return a 400 with a useful message instead
 * of a generic 500.
 */
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseLosslessJson, parseLosslessYaml } from '../manifest/lossless';
import {
  exportToJson,
  exportToMof,
  exportToYaml,
  parseOscYaml,
  parseSecurityDefinition,
} from './index';

describe('exportToJson', () => {
  it('serializes unsafe QWord values without rounding', () => {
    const manifest = {
      resources: [
        {
          type: 'Microsoft.Windows/Registry',
          properties: { valueType: 'QWord', value: 18446744073709551615n },
        },
      ],
    };

    const exported = exportToJson(manifest);

    expect(exported).toContain('"value": 18446744073709551615');
    expect(parseLosslessJson(exported)).toEqual(manifest);
  });
});

describe('lossless manifest import and export', () => {
  it('preserves adjacent unsafe QWords through JSON and YAML exports', () => {
    const manifest = {
      resources: [
        {
          name: 'maximum',
          type: 'Microsoft.Windows/Registry',
          properties: { valueType: 'QWord', value: 18446744073709551615n },
        },
        {
          name: 'adjacent',
          type: 'Microsoft.Windows/Registry',
          properties: { valueType: 'QWord', value: 18446744073709551614n },
        },
      ],
    };

    const yaml = exportToYaml(manifest);
    const reparsed = parseLosslessYaml(yaml) as typeof manifest;

    expect(reparsed).toEqual(manifest);
    expect(parseOscYaml(yaml).resources[0].properties.value).toBe(18446744073709551615n);
    expect(parseOscYaml(yaml).resources[1].properties.value).toBe(18446744073709551614n);
  });
});

describe('parseSecurityDefinition (PR17 hardening)', () => {
  it('throws a descriptive Error on malformed JSON', () => {
    expect(() => parseSecurityDefinition('{not json')).toThrowError(
      /Invalid JSON in security definition/i,
    );
  });

  it('throws when document is a JSON primitive (string)', () => {
    expect(() => parseSecurityDefinition('"just a string"')).toThrowError(
      /document must be an object/i,
    );
  });

  it('throws when document is null', () => {
    expect(() => parseSecurityDefinition('null')).toThrowError(/document must be an object/i);
  });

  it('does not throw on otherwise empty but valid object', () => {
    const out = parseSecurityDefinition('{}');
    expect(out.name).toBe('Unknown');
    expect(out.settings).toEqual([]);
  });

  it('tolerates non-array `Settings` field without crashing', () => {
    // Pre-fix this happened to work, but the shape-safety needs a regression
    // test so future edits don't reintroduce a crash on weird payloads.
    const out = parseSecurityDefinition('{"Name":"X","Settings":"not-an-array"}');
    expect(out.name).toBe('X');
    expect(out.settings).toEqual([]);
  });
});

// ── exportToAzurePolicy structural shape (2026-05-19 LAPS-aligned rewrite) ──
//
// Previous emitter wrote a stub policy that was missing every field
// Azure actually needs to deploy / audit a guest configuration:
// requiredProviders, contentType/contentUri/contentHash in metadata,
// configurationParameter mapping (both the metadata object form AND
// the deployment-template array form), per-setting ARM parameters,
// parameterHash existenceCondition, dual VM+Arc deployment resources,
// versions[]. These tests lock the new structural contract — it
// mirrors a real Microsoft-shipped GC baseline (LAPSCustomPolicy.Json)
// so the emitted JSON can be deployed via the Azure Policy REST API.
import { exportToAzurePolicy } from './index';

describe('exportToAzurePolicy structural shape', () => {
  const lapsResources = [
    {
      name: 'PasswordBackup',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath:
              'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\LAPS',
            valueName: 'BackupDirectory',
            valueType: 'Dword',
            value: 1,
          },
        },
      },
      compliance: { equals: 1 },
    },
    {
      name: 'PasswordLength',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath:
              'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\LAPS',
            valueName: 'PasswordLength',
            valueType: 'Dword',
            value: 15,
          },
        },
      },
      compliance: { equals: 15 },
    },
  ];

  function policyOf(resources: unknown, options?: Parameters<typeof exportToAzurePolicy>[2]) {
    return JSON.parse(exportToAzurePolicy('TestPolicy', resources, options)) as {
      properties: {
        metadata: {
          requiredProviders: string[];
          guestConfiguration: {
            name: string;
            version: string;
            contentType: string;
            contentUri: string;
            contentHash: string;
            configurationParameter: Record<string, string>;
          };
        };
        parameters: Record<
          string,
          { type: string; defaultValue?: string; allowedValues?: string[] }
        >;
        policyRule: {
          if: { anyOf: unknown[] };
          then: {
            details: {
              name: string;
              existenceCondition: { allOf: Array<{ field: string; equals: string }> };
              roleDefinitionIds?: string[];
              deployment?: {
                properties: {
                  template: {
                    parameters: Record<string, unknown>;
                    resources: Array<{
                      condition: string;
                      type: string;
                      properties: {
                        guestConfiguration: {
                          configurationParameter: Array<{ name: string; value: string }>;
                        };
                      };
                    }>;
                  };
                };
              };
            };
          };
        };
        versions: string[];
      };
    };
  }

  it('emits the required GuestConfiguration metadata shape', () => {
    const p = policyOf(lapsResources, { effect: 'DeployIfNotExists' });
    expect(p.properties.metadata.requiredProviders).toEqual(['Microsoft.GuestConfiguration']);
    expect(p.properties.metadata.guestConfiguration.contentType).toBe('Custom');
    // We intentionally leave contentUri / contentHash as placeholders
    // so the operator must replace them with their actual MOF .zip URL
    // and SHA256 hash. Shipping a default URL would silently deploy a
    // bogus package.
    expect(p.properties.metadata.guestConfiguration.contentUri).toBe(
      'REPLACE_WITH_YOUR_MOF_PACKAGE_URI',
    );
    expect(p.properties.metadata.guestConfiguration.contentHash).toBe(
      'REPLACE_WITH_SHA256_OF_PACKAGE_ZIP',
    );
  });

  it('emits one ARM parameter per manifest setting + scaffolding params', () => {
    const p = policyOf(lapsResources);
    const paramNames = Object.keys(p.properties.parameters);
    // Scaffolding always present.
    expect(paramNames).toContain('IncludeArcMachines');
    expect(paramNames).toContain('effect');
    // One per resource.
    expect(paramNames).toContain('PasswordBackup');
    expect(paramNames).toContain('PasswordLength');
    // ARM parameters default to the manifest's current value.
    expect(p.properties.parameters.PasswordBackup.defaultValue).toBe('1');
    expect(p.properties.parameters.PasswordLength.defaultValue).toBe('15');
  });

  it('IncludeArcMachines defaults to "false" so the policy ships Azure-only by default', () => {
    const p = policyOf(lapsResources);
    expect(p.properties.parameters.IncludeArcMachines.defaultValue).toBe('false');
    expect(p.properties.parameters.IncludeArcMachines.allowedValues).toEqual(['true', 'false']);
  });

  it('rejects sanitized ARM parameter-name collisions instead of dropping a setting', () => {
    const colliding = [
      {
        name: 'Foo-Bar',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM\\A', valueName: 'A', value: 1 },
      },
      {
        name: 'Foo_Bar',
        type: 'Microsoft.Windows/Registry',
        properties: { keyPath: 'HKLM\\B', valueName: 'B', value: 0 },
      },
    ];

    expect(() => exportToAzurePolicy('collision', colliding)).toThrow(
      /parameter name collision.*Foo-Bar.*Foo_Bar.*Foo_Bar/i,
    );
  });

  it('rejects case-only ARM parameter-name collisions', () => {
    const colliding = [
      { name: 'SettingName', type: 'T', properties: { value: 1 } },
      { name: 'settingname', type: 'T', properties: { value: 2 } },
    ];

    expect(() => exportToAzurePolicy('collision', colliding)).toThrow(/parameter name collision/i);
  });

  it('configurationParameter (metadata) maps ARM names to MOF parameter names', () => {
    const p = policyOf(lapsResources);
    const cp = p.properties.metadata.guestConfiguration.configurationParameter;
    expect(cp.PasswordBackup).toBe('PasswordBackup;Value');
    expect(cp.PasswordLength).toBe('PasswordLength;Value');
    expect(Object.keys(cp)).toHaveLength(2);
  });

  it('existenceCondition checks both complianceStatus AND parameterHash', () => {
    const p = policyOf(lapsResources);
    const cond = p.properties.policyRule.then.details.existenceCondition;
    expect(cond.allOf).toHaveLength(2);
    const fields = cond.allOf.map((c) => c.field);
    expect(fields).toContain(
      'Microsoft.GuestConfiguration/guestConfigurationAssignments/complianceStatus',
    );
    expect(fields).toContain(
      'Microsoft.GuestConfiguration/guestConfigurationAssignments/parameterHash',
    );
    const hashClause = cond.allOf.find((c) => c.field.includes('parameterHash'));
    // Hash expression references every setting's ARM parameter so any
    // drift triggers reassignment.
    expect(hashClause!.equals).toContain("parameters('PasswordBackup')");
    expect(hashClause!.equals).toContain("parameters('PasswordLength')");
    expect(hashClause!.equals).toContain('PasswordBackup;Value');
  });

  it('emits assignment name with uniqueString() so multiple policy assignments coexist', () => {
    const p = policyOf(lapsResources);
    const name = p.properties.policyRule.then.details.name;
    expect(name).toMatch(/^\[concat\('TestPolicy\$pid', uniqueString/);
  });

  it('deployment template has TWO resources (VM + Arc) gated by condition', () => {
    const p = policyOf(lapsResources, { effect: 'DeployIfNotExists' });
    const resources =
      p.properties.policyRule.then.details.deployment!.properties.template.resources;
    expect(resources).toHaveLength(2);
    const vm = resources.find((r) => r.type.startsWith('Microsoft.Compute/'));
    const arc = resources.find((r) => r.type.startsWith('Microsoft.HybridCompute/'));
    expect(vm).toBeDefined();
    expect(arc).toBeDefined();
    expect(vm!.condition).toContain('Microsoft.Compute/virtualMachines');
    expect(arc!.condition).toContain('Microsoft.HybridCompute/machines');
  });

  it('deployment-template configurationParameter is an ARRAY of {name, value} per setting', () => {
    const p = policyOf(lapsResources, { effect: 'DeployIfNotExists' });
    const vm = p.properties.policyRule.then.details.deployment!.properties.template.resources.find(
      (r) => r.type.startsWith('Microsoft.Compute/'),
    )!;
    const cp = vm.properties.guestConfiguration.configurationParameter;
    expect(cp).toHaveLength(2);
    expect(cp[0]).toEqual({
      name: 'PasswordBackup;Value',
      value: "[parameters('PasswordBackup')]",
    });
    expect(cp[1]).toEqual({
      name: 'PasswordLength;Value',
      value: "[parameters('PasswordLength')]",
    });
  });

  it('AINE (audit-only) effect omits deployment and roleDefinitionIds', () => {
    const p = policyOf(lapsResources, { effect: 'AuditIfNotExists' });
    expect(p.properties.policyRule.then.details.deployment).toBeUndefined();
    expect(p.properties.policyRule.then.details.roleDefinitionIds).toBeUndefined();
    // existenceCondition still applies for AINE so drift detection works.
    expect(p.properties.policyRule.then.details.existenceCondition.allOf).toHaveLength(2);
  });

  it('emits a versions[] array so Azure Policy can track policy revisions', () => {
    const p = policyOf(lapsResources, { version: '2.1.0' });
    expect(p.properties.versions).toEqual(['2.1.0']);
    expect(p.properties.metadata.version).toBe('2.1.0');
    expect(p.properties.metadata.guestConfiguration.version).toBe('2.1.0');
  });

  it('handles an empty manifest (no resources) gracefully', () => {
    const p = policyOf([]);
    // Scaffolding params still present.
    expect(Object.keys(p.properties.parameters)).toEqual(['IncludeArcMachines', 'effect']);
    // configurationParameter is an empty object, not undefined.
    expect(p.properties.metadata.guestConfiguration.configurationParameter).toEqual({});
    // parameterHash still defined (base64 of empty string).
    const hashClause = p.properties.policyRule.then.details.existenceCondition.allOf.find((c) =>
      c.field.includes('parameterHash'),
    );
    expect(hashClause).toBeDefined();
  });

  it('unwraps Test wrappers to read inner Registry properties (compliance.equals first)', () => {
    // Mirrors the LAPS pattern: Microsoft.OSConfig/Test wrapping
    // Microsoft.Windows/Registry. Default value should come from
    // compliance.equals when present, not from properties.resource.value.
    const wrapped = [
      {
        name: 'TestedSetting',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            type: 'Microsoft.Windows/Registry',
            properties: { keyPath: 'HKLM:\\X', valueName: 'Y', value: { dword: 99 } },
          },
        },
        compliance: { equals: 7 }, // wins over the inner value
      },
    ];
    const p = policyOf(wrapped);
    expect(p.properties.parameters.TestedSetting.defaultValue).toBe('7');
  });
});

// ── exportToMof: Machine Configuration module binding (v0.3.67) ──
//
// Regression guard for the Export → MOF → New-GuestConfigurationPackage flow.
// The emitted MOF must reference the real `Microsoft.OSConfig` PSGallery module
// (NOT the bare `OSConfig`, which fails to resolve) and uses the portable
// `0.0.0` Machine Configuration placeholder. The packaging workflow resolves
// it to the customer's newest installed Microsoft.OSConfig version immediately
// before New-GuestConfigurationPackage runs.
describe('exportToMof — Machine Configuration module binding', () => {
  const resources = [
    {
      name: 'PasswordBackup',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath: 'HKLM:\\SOFTWARE\\X',
            valueName: 'BackupDirectory',
            valueType: 'REG_DWORD',
            value: 1,
          },
        },
        schema: { const: 2 },
      },
    },
    {
      name: 'NetworkLogon',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/UserRightsAssignment',
          properties: {
            name: 'SeNetworkLogonRight',
            value: ['*S-1-5-32-544', '*S-1-5-11'],
          },
        },
        expression: 'value.size() == 2',
      },
    },
    {
      name: 'GuestAccount',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/AccountPolicy',
          properties: { name: 'EnableGuestAccount', value: false },
        },
        expression: 'value == false',
      },
    },
    {
      name: 'AdministratorName',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/AccountPolicy',
          properties: { name: 'AdministratorAccountName', value: null },
        },
        expression: 'value != null',
      },
    },
    {
      name: 'EmptyBanner',
      type: 'Microsoft.OSConfig/Test',
      properties: {
        resource: {
          type: 'Microsoft.Windows/Registry',
          properties: {
            keyPath: 'HKLM:\\SOFTWARE\\X',
            valueName: 'Banner',
            valueType: 'REG_SZ',
            value: '',
          },
        },
        expression: 'value == ""',
      },
    },
  ];

  it('references the real Microsoft.OSConfig module so New-GuestConfigurationPackage can resolve it', () => {
    const mof = exportToMof('LapsBaseline', resources);
    expect(mof).toContain('ModuleName = "Microsoft.OSConfig";');
  });

  it('does NOT emit the bare "OSConfig" module name (the pre-fix value that failed packaging)', () => {
    const mof = exportToMof('LapsBaseline', resources);
    expect(mof).not.toContain('ModuleName = "OSConfig";');
  });

  it('emits portable ModuleVersion 0.0.0 for package-time version resolution', () => {
    const mof = exportToMof('LapsBaseline', resources);
    expect(mof).toContain('ModuleVersion = "0.0.0";');
    expect(mof.match(/ModuleVersion = "0\.0\.0";/g)).toHaveLength(resources.length);
  });

  it('emits one shared correlation group so AuditAndSet remediation can call OSConfig.Set', () => {
    const mof = exportToMof('LapsBaseline', resources);
    const groups = Array.from(
      mof.matchAll(/CorrelationGroup = "(\{[0-9a-f-]{36}\})";/gi),
      (match) => match[1],
    );
    expect(groups).toHaveLength(resources.length);
    expect(new Set(groups).size).toBe(1);
  });

  it('moves desired values into canonical MOF Value fields for remediation', () => {
    const mof = exportToMof('LapsBaseline', resources);
    const propertyLines = mof.match(/    Properties = ".*";/g) ?? [];
    expect(propertyLines).toHaveLength(resources.length);
    expect(propertyLines.filter((line) => line.includes('\\"value\\"'))).toHaveLength(1);
    expect(mof).toContain('    Value = "1";\n    ValueName = "value";\n    ValueType = "integer";');
    expect(mof).toContain(
      '    Value = "*S-1-5-32-544,*S-1-5-11";\n    ValueName = "value";\n    ValueType = "string[]";',
    );
    expect(mof).toContain('    Value = "0";\n    ValueName = "value";\n    ValueType = "boolean";');
    expect(mof).toContain('    Value = null;\n    ValueName = "value";\n    ValueType = "string";');
    expect(mof).toContain('    Value = "";\n    ValueName = "value";\n    ValueType = "string";');
  });

  it('normalizes legacy Registry syntax before serializing the Machine Configuration package', () => {
    const mof = exportToMof('LegacyRegistryBaseline', [
      {
        name: 'LegacyRegistry',
        type: 'Microsoft.OSConfig/Test',
        properties: {
          resource: {
            type: 'Microsoft.Windows/Registry',
            properties: {
              keyPath: 'HKLM\\SOFTWARE\\ConfigForge',
              valueName: 'Enabled',
              valueType: 'Dword',
              value: 1,
            },
          },
          schema: { const: 1 },
        },
      },
    ]);

    expect(mof).toContain(
      'Properties = "{\\"keyPath\\":\\"HKLM:\\\\\\\\SOFTWARE\\\\\\\\ConfigForge\\",\\"valueName\\":\\"Enabled\\",\\"valueType\\":\\"REG_DWORD\\"}";',
    );
    expect(mof).not.toContain('\\"valueType\\":\\"Dword\\"');
  });

  it('exports every shipped Windows baseline with canonical writable Registry properties', async () => {
    const baselineDirectory = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'public',
      '_baselines',
    );
    const baselineFiles = (await readdir(baselineDirectory))
      .filter((name) => /^ws20(?:16|19|22|25)-.*\.osc\.yaml$/i.test(name))
      .sort();

    expect(baselineFiles).toHaveLength(12);

    for (const filename of baselineFiles) {
      const source = await readFile(path.join(baselineDirectory, filename), 'utf8');
      const manifest = parseOscYaml(source);
      const mof = exportToMof(filename, manifest.resources);
      const blocks = mof.match(/instance of OSConfig[\s\S]*?\n};/g) ?? [];

      expect(blocks, filename).toHaveLength(manifest.resources.length);

      for (const block of blocks) {
        if (!block.includes('Type = "Microsoft.Windows/Registry";')) continue;
        const propertiesLine = block.match(/^\s*Properties = "(.*)";$/m)?.[1];
        expect(propertiesLine, filename).toBeDefined();
        const propertiesJson = JSON.parse(`"${propertiesLine}"`) as string;
        const properties = parseLosslessJson(propertiesJson) as Record<string, unknown>;

        expect(
          [
            'REG_NONE',
            'REG_SZ',
            'REG_EXPAND_SZ',
            'REG_BINARY',
            'REG_DWORD',
            'REG_MULTI_SZ',
            'REG_QWORD',
          ],
          `${filename}: ${String(properties.valueName ?? '')}`,
        ).toContain(properties.valueType);

        if (typeof properties.keyPath === 'string') {
          expect(
            properties.keyPath,
            `${filename}: ${String(properties.valueName ?? '')}`,
          ).not.toMatch(
            /^(?:HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS|HKEY_CLASSES_ROOT|HKEY_CURRENT_CONFIG|HKLM|HKCU|HKU|HKCR|HKCC)\\/i,
          );
        }
      }
    }
  });

  it('still emits the OSConfig DSC resource class and the configuration footer', () => {
    const mof = exportToMof('LapsBaseline', resources);
    expect(mof).toContain('instance of OSConfig as $OSConfig0ref');
    expect(mof).toContain('instance of OMI_ConfigurationDocument');
    // The inner Registry resource survived unwrapping into the MOF Properties.
    expect(mof).toContain('BackupDirectory');
  });
});
