// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import yaml from 'js-yaml';
import type { SettingConfiguration } from '../types';

export {
  buildBaselineManifest,
  inferRegistryValueType,
  parseComplianceExpression,
  parseExcelBaseline,
  type BaselineManifestBuildResult,
  type BaselineSpreadsheetFormat,
  type ParsedBaselineSetting,
} from './baseline';

// ── Parsed types ────────────────────────────────────────────────────────────

export interface ParsedManifest {
  $schema?: string;
  resources: ParsedResource[];
  raw: string;
}

export interface ParsedResource {
  name: string;
  type: string;
  properties: Record<string, unknown>;
  compliance?: Record<string, unknown>;
}

export interface ParsedSecurityDefinition {
  name: string;
  version?: string;
  description?: string;
  settings: ParsedSDSetting[];
  /**
   * Which JSON field the settings array came from. Used by the importer
   * to decide whether to add a placeholder-baseline header comment and
   * which resource type to map entries to. Defaults to "settings" for
   * the legacy `Settings`/`settings`/`desiredConfiguration` shapes (which
   * usually carry concrete registry/CSP hints) and "settingsReference"
   * for the Azure Policy Guest Configuration baseline shape (which is
   * a catalog of opaque ruleIds with no implementation details).
   */
  origin?: 'settings' | 'settingsReference';
}

export interface ParsedSDSetting {
  name: string;
  keyPath?: string;
  expectedValue?: unknown;
  description?: string;
  /**
   * Stable identifier from the upstream source (Azure Policy ruleId,
   * OVAL definition id, etc.). Preserved so generated resources can
   * carry an audit-trail back to the original baseline catalog.
   */
  ruleId?: string;
  /**
   * Schema-declared value type from the upstream settingsReference
   * ("string" / "integer" / "boolean"). Used to pick a sensible
   * Registry valueType when the importer falls back to the legacy
   * Registry mapping.
   */
  schemaType?: string;
  /** Display severity from the upstream baseline ("Critical" / "High" / ...). */
  severity?: string;
  /**
   * Original `settingName` as it appeared in the source JSON (before
   * suffix stripping). Preserved so the generated resource can carry
   * the exact upstream identifier for round-trip fidelity.
   */
  originalSettingName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Import functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse .osc.yaml content, validate basic schema, return structured manifest.
 */
export function parseOscYaml(content: string): ParsedManifest {
  const doc = yaml.load(content);
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid YAML: document must be an object');
  }

  const obj = doc as Record<string, unknown>;

  if (!Array.isArray(obj.resources)) {
    throw new Error('Invalid manifest: "resources" array is required');
  }

  const resources: ParsedResource[] = (obj.resources as Record<string, unknown>[]).map((r, idx) => {
    if (!r.name || typeof r.name !== 'string') {
      throw new Error(`Resource at index ${idx} is missing a "name" field`);
    }
    if (!r.type || typeof r.type !== 'string') {
      throw new Error(`Resource "${r.name}" is missing a "type" field`);
    }
    return {
      name: r.name as string,
      type: r.type as string,
      properties: (r.properties as Record<string, unknown>) ?? {},
      compliance: r.compliance as Record<string, unknown> | undefined,
    };
  });

  return {
    $schema: obj.$schema as string | undefined,
    resources,
    raw: content,
  };
}

/**
 * Parse /sd/ JSON security definitions into a browsable format.
 *
 * Recognises four settings shapes (in priority order):
 *
 *   1. `settingsReference[]` — Azure Policy Guest Configuration baseline
 *      catalog. Each entry is `{ displayName, settingName, ruleId,
 *      schema:{type}, isEditable, defaultValue, severity }` and carries
 *      only the rule identity, not the implementation. The OSConfig
 *      agent on the target machine evaluates each rule by its ruleId.
 *      Common Azure Policy convention is to append `;DesiredObjectValue`
 *      (or `;DesiredValue` / `;ExpectedValue`) to settingName — that
 *      terminal token is stripped here.
 *
 *   2. `Settings[]` / `settings[]` — the legacy security-definition
 *      shape, typically with `Path`/`registryPath` + `ExpectedValue`
 *      pairs that can be mapped to Registry resources.
 *
 *   3. `desiredConfiguration[]` — same row-shape as #2, alternate field
 *      name.
 *
 * If the document carries `settingsReference[]` we prefer it, even when
 * `Settings`/`settings` is also present (that combination has not been
 * seen in the wild but the explicit catalog shape is the more reliable
 * signal). Origin is recorded in the return value so callers can adapt
 * downstream mapping decisions.
 */
const SETTING_NAME_VALUE_SUFFIX = /;(DesiredObjectValue|DesiredValue|ExpectedValue)$/i;

function stripSettingNameSuffix(raw: string): string {
  return raw.replace(SETTING_NAME_VALUE_SUFFIX, '');
}

export function parseSecurityDefinition(jsonStr: string): ParsedSecurityDefinition {
  let doc: unknown;
  try {
    doc = JSON.parse(jsonStr);
  } catch (err) {
    const m = err instanceof Error ? err.message : 'parse failed';
    throw new Error(`Invalid JSON in security definition: ${m}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid JSON: document must be an object');
  }
  const docObj = doc as Record<string, unknown>;

  const name = docObj.Name ?? docObj.name ?? docObj.scenarioName ?? 'Unknown';
  const settings: ParsedSDSetting[] = [];

  // Priority order: settingsReference (Azure Policy GC baseline shape)
  // wins over the legacy Settings/settings/desiredConfiguration shapes.
  let origin: 'settings' | 'settingsReference' | undefined;
  let rawSettings: unknown = undefined;
  if (Array.isArray(docObj.settingsReference)) {
    rawSettings = docObj.settingsReference;
    origin = 'settingsReference';
  } else if (Array.isArray(docObj.Settings)) {
    rawSettings = docObj.Settings;
    origin = 'settings';
  } else if (Array.isArray(docObj.settings)) {
    rawSettings = docObj.settings;
    origin = 'settings';
  } else if (Array.isArray(docObj.desiredConfiguration)) {
    rawSettings = docObj.desiredConfiguration;
    origin = 'settings';
  }

  if (Array.isArray(rawSettings)) {
    for (const s of rawSettings) {
      if (typeof s === 'string') {
        settings.push({ name: s, originalSettingName: s });
      } else if (typeof s === 'object' && s !== null) {
        const so = s as Record<string, unknown>;

        if (origin === 'settingsReference') {
          const rawSettingName = String(so.settingName ?? so.SettingName ?? '');
          const displayName = (so.displayName ?? so.DisplayName) as string | undefined;
          const stripped = stripSettingNameSuffix(rawSettingName);
          // Prefer displayName for the user-facing name (it's the
          // shorter, more readable label), fall back to the stripped
          // settingName, then to a sentinel.
          const friendlyName = displayName?.trim() || stripped || 'Unknown';
          const schemaObj = so.schema as { type?: unknown } | undefined;
          const schemaType =
            schemaObj && typeof schemaObj.type === 'string' ? schemaObj.type : undefined;
          const rawDefault = so.defaultValue ?? so.DefaultValue;
          // For settingsReference entries, an empty-string defaultValue
          // almost always means "no expected value" (OVAL-style
          // presence checks). Don't promote that to a compliance.equals
          // — it would force the editor to flag every rule as
          // misconfigured.
          const expectedValue =
            rawDefault === '' || rawDefault === undefined ? undefined : rawDefault;
          settings.push({
            name: friendlyName,
            originalSettingName: rawSettingName || friendlyName,
            ruleId: (so.ruleId ?? so.RuleId) as string | undefined,
            schemaType,
            severity: (so.severity ?? so.Severity) as string | undefined,
            description: displayName,
            expectedValue,
          });
        } else {
          // Legacy security-definition shape: usually carries an
          // explicit Path/registryPath + ExpectedValue. Keep the
          // original parsing behaviour for backward compatibility.
          settings.push({
            name: String(so.Name ?? so.name ?? so.settingName ?? 'Unknown'),
            originalSettingName: (so.Name ?? so.name ?? so.settingName) as string | undefined,
            keyPath: (so.Path ?? so.path ?? so.registryPath) as string | undefined,
            expectedValue: so.ExpectedValue ?? so.expectedValue ?? so.value,
            description: (so.Description ?? so.description) as string | undefined,
          });
        }
      }
    }
  }

  return {
    name: String(name),
    version: (docObj.Version ?? docObj.version) as string | undefined,
    description: (docObj.Description ?? docObj.description) as string | undefined,
    settings,
    origin,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Export functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Serialize a manifest object to .osc.yaml string.
 */
export function exportToYaml(manifest: object): string {
  return yaml.dump(manifest, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Serialize a manifest object to pretty JSON.
 */
export function exportToJson(manifest: object): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Escape a string for MOF (backslash-escape `\`, `"`, and newlines).
 * Mirrors the internal PS module's `ConvertTo-MofString`.
 */
function mofEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\r\\n');
}

/**
 * Serialize a manifest's resources to Machine-Configuration MOF.
 *
 * Output is byte-compatible with the internal PS module's `ConvertTo-Mof`:
 *   - `instance of OSConfig` (not DSC class names)
 *   - `Name`, `Type`, `Properties` fields (Properties is MOF-escaped JSON)
 *   - Test-wrapped resources are unwrapped: inner resource's Type+Properties
 *     are emitted, and Expression/Schema/Template are preserved as MOF fields.
 *   - Footer is `instance of OMI_ConfigurationDocument`.
 *
 * The oscfg CLI has no MOF export command; this replicates what the PS module
 * does via `Get-OscManifest -Format Mof` → `ConvertTo-Mof`.
 */
export function exportToMof(
  manifestName: string,
  resources: Array<
    { name?: string; type?: string; properties?: Record<string, unknown> } | unknown
  >,
): string {
  const instances: string[] = [];
  const configurationName = crypto?.randomUUID?.() ?? manifestName.replace(/[^a-zA-Z0-9_.-]/g, '_');

  for (const raw of Array.isArray(resources) ? resources : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;

    let name = typeof r.name === 'string' ? r.name : 'Resource';
    let type = typeof r.type === 'string' ? r.type : '';
    let props = (r.properties ?? {}) as Record<string, unknown>;
    let expression: string | undefined;
    let schema: unknown | undefined;
    let template: string | undefined;

    // Test-wrapped resources: unwrap to the inner resource (mirrors PS module
    // ConvertTo-Mof lines 1979-1992).
    if (
      type === 'Microsoft.OSConfig/Test' &&
      props.resource &&
      typeof props.resource === 'object'
    ) {
      const inner = props.resource as Record<string, unknown>;
      if (!name && typeof inner.name === 'string') name = inner.name;
      type = typeof inner.type === 'string' ? inner.type : type;
      props = (inner.properties ?? {}) as Record<string, unknown>;
      expression = typeof props.expression === 'string' ? props.expression : undefined;
      // Schema and Template come from the OUTER Test properties, not inner
      const outerProps = (r.properties ?? {}) as Record<string, unknown>;
      if (typeof outerProps.expression === 'string') expression = outerProps.expression;
      if (outerProps.schema !== undefined) schema = outerProps.schema;
      if (typeof outerProps.template === 'string') template = outerProps.template;
    }

    const propsJson = JSON.stringify(props);

    const lines: string[] = [];
    lines.push(`instance of OSConfig as $OSConfig${instances.length}ref`);
    lines.push('{');
    lines.push(`    ResourceID = "${mofEscape(name)}";`);
    // The DSC resource *class* is `OSConfig` (see the `instance of OSConfig`
    // line above), but that class ships in the `Microsoft.OSConfig` PowerShell
    // module on PSGallery. `New-GuestConfigurationPackage` resolves the module
    // by `ModuleName` to bundle it into the Machine Configuration package, so
    // this MUST be the real module id `Microsoft.OSConfig` (not `OSConfig`).
    // `ModuleVersion` is intentionally OMITTED: the packaging cmdlet requires it
    // to match an *installed* version exactly, and customers install whatever
    // `Microsoft.OSConfig` is current. Omitting it lets the cmdlet bind to the
    // installed module (1.2.0+); pinning a version would break packaging the
    // moment the customer's installed version differs.
    lines.push(`    ModuleName = "Microsoft.OSConfig";`);
    lines.push(`    ConfigurationName = "${mofEscape(configurationName)}";`);
    lines.push(`    Name = "${mofEscape(name)}";`);
    lines.push(`    Type = "${mofEscape(type)}";`);
    lines.push(`    Properties = "${mofEscape(propsJson)}";`);
    if (expression) {
      lines.push(`    Expression = "${mofEscape(expression)}";`);
    }
    if (schema !== undefined) {
      lines.push(`    Schema = "${mofEscape(JSON.stringify(schema))}";`);
    }
    if (template) {
      lines.push(`    Template = "${mofEscape(template)}";`);
    }
    lines.push('};');
    lines.push('');

    instances.push(lines.join('\n'));
  }

  const footer = [
    'instance of OMI_ConfigurationDocument',
    '{',
    '    Version = "2.0.0";',
    '    MinimumCompatibleVersion = "1.0.0";',
    '    CompatibleVersionAdditionalProperties = {"Omi_BaseResource:ConfigurationName"};',
    '    Name = "AzureOSBaseline";',
    '};',
    '',
  ].join('\n');

  return instances.join('\n') + '\n' + footer;
}

/**
 * Generate a CSV file from an array of SettingConfiguration objects.
 */
export function exportToExcel(settings: SettingConfiguration[]): string {
  const headers = ['Name', 'Description', 'DataType', 'Default', 'Value', 'Compliance'];

  const escapeCSV = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = settings.map((s) =>
    [
      escapeCSV(s.Name),
      escapeCSV(s.Description),
      escapeCSV(s.DataType),
      escapeCSV(s.Default),
      escapeCSV(s.Value),
      escapeCSV(s.Compliance),
    ].join(','),
  );

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Generate an Azure Policy definition JSON for Machine Configuration.
 *
 * This produces the policy-definition half of an Azure Policy Guest
 * Configuration deployment. The other half is the .zip Machine
 * Configuration package (containing the MOF + metadata) — generate
 * the MOF via `exportToMof`, zip it with package metadata, upload to
 * Azure Storage, then replace the `REPLACE_WITH_*` placeholders in
 * the emitted policy JSON with the storage URI and SHA256 hash.
 *
 * # Structural shape
 *
 * Mirrors a real Microsoft-shipped GC baseline policy (e.g.
 * LAPSCustomPolicy.Json). The bare-minimum fields Azure Policy
 * needs to actually deploy / audit a guest configuration are:
 *
 *   metadata.requiredProviders          — ["Microsoft.GuestConfiguration"]
 *   metadata.guestConfiguration.contentType   — "Custom"
 *   metadata.guestConfiguration.contentUri    — URL of the package .zip
 *   metadata.guestConfiguration.contentHash   — SHA256 of the .zip
 *   metadata.guestConfiguration.configurationParameter — OBJECT mapping
 *     ARM policy-parameter name → MOF parameter name (the OSConfig
 *     agent reads this to wire policy values into the resource config)
 *   parameters[ARMParamName]            — one ARM parameter per setting
 *                                          the manifest declares, with
 *                                          the manifest's current value
 *                                          as `defaultValue` so the
 *                                          policy ships ready-to-assign
 *   policyRule.then.details.existenceCondition — TWO checks: compliance
 *     status AND a base64-encoded parameterHash so the assignment is
 *     re-applied when ARM parameter values drift
 *   deployment.template.resources       — TWO resource entries (one
 *     for Microsoft.Compute/virtualMachines, one for Microsoft.HybridCompute/
 *     machines), each gated by a `condition` on the `type` parameter.
 *     Both reference the same MOF package; the dual-resource pattern
 *     is required because Azure Compute and Arc use different ARM
 *     resource-type paths for GC assignments.
 *
 * # Targeting
 *
 * A Guest Configuration package is single-OS (one MOF runs on one
 * platform — the OSConfig agent is platform-specific). The policy
 * matches one OS family across Azure VMs AND Arc-enabled servers
 * (Arc inclusion is gated by the `IncludeArcMachines` parameter,
 * defaulting to "false" so the policy only hits Azure-hosted VMs
 * unless the operator opts in — matches the real LAPS policy's
 * default).
 *
 * We deliberately do NOT narrow by image publisher. The osDisk.osType
 * / osName fields are the canonical Azure indicators of OS family.
 * Filtering by publisher would silently exclude corporate gold
 * images, custom VHDs, and smaller-publisher marketplace images. If
 * a VM doesn't match the OS, Azure marks the policy as N/A — that's
 * exactly what a self-service tool should do.
 */

interface PolicySettingParam {
  /** ARM parameter name (sanitized resource name). */
  armName: string;
  /** Human-readable display name (original resource name). */
  displayName: string;
  /** MOF parameter name (the OSConfig agent reads this from the MOF). */
  mofParamName: string;
  /** Default value, stringified per ARM convention. */
  defaultValue: string;
  /** Description for the ARM parameter metadata block. */
  description: string;
}

/**
 * Extract one ARM parameter spec per top-level setting from the
 * manifest's resources. Each ARM parameter lets operators tune the
 * baseline at policy-assignment time without re-publishing the MOF.
 *
 * Mapping convention (matches what `exportToMof` writes; the agent
 * keys on the `Name` field of each MOF instance):
 *   ARM param name = sanitized resource.name (alphanumeric + underscore)
 *   MOF param name = "<resource.name>;Value"
 *   defaultValue   = current value from compliance.equals (preferred)
 *                    or properties.value (typed-unwrapped) or empty
 *   displayName    = resource.name
 *   description    = "<type> at <keyPath>\\<valueName>" when registry,
 *                    otherwise just the type
 */
function extractPolicySettingParams(resources: unknown): PolicySettingParam[] {
  if (!Array.isArray(resources)) return [];

  const out: PolicySettingParam[] = [];
  const seen = new Map<string, string>();

  for (const raw of resources) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const outerName = typeof r.name === 'string' ? r.name : '';
    const outerType = typeof r.type === 'string' ? r.type : '';
    const outerProps = (r.properties ?? {}) as Record<string, unknown>;

    // Unwrap Test wrappers so the underlying registry/CSP info is
    // visible. The outer name is preserved as the ARM param label
    // because that's typically what users see in the editor.
    let innerType = outerType;
    let innerProps = outerProps;
    if (
      outerType === 'Microsoft.OSConfig/Test' &&
      outerProps.resource &&
      typeof outerProps.resource === 'object'
    ) {
      const inner = outerProps.resource as Record<string, unknown>;
      if (typeof inner.type === 'string') innerType = inner.type;
      innerProps = (inner.properties ?? {}) as Record<string, unknown>;
    }

    if (!outerName) continue;

    // Sanitize for ARM param name (alphanumeric + underscore only;
    // can't start with a digit per ARM spec).
    let armName = outerName.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^\d/.test(armName)) armName = `p_${armName}`;
    if (!armName) continue;
    const collisionKey = armName.toLowerCase();
    const existingName = seen.get(collisionKey);
    if (existingName !== undefined) {
      throw new Error(
        `Azure Policy parameter name collision: resources "${existingName}" and "${outerName}" both normalize to "${armName}". Rename one resource before export.`,
      );
    }
    seen.set(collisionKey, outerName);

    // Pull the current value. compliance.equals wins over inline
    // properties.value (matches the matrix-diff `extractEnforcementValue`
    // contract).
    let defaultValue: unknown = undefined;
    const compliance = (r.compliance ?? {}) as Record<string, unknown>;
    if ('equals' in compliance) {
      defaultValue = compliance.equals;
    } else if ('value' in innerProps) {
      const v = innerProps.value;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const obj = v as Record<string, unknown>;
        const keys = Object.keys(obj);
        if (keys.length === 1) defaultValue = obj[keys[0]];
        else defaultValue = v;
      } else {
        defaultValue = v;
      }
    }

    // ARM string parameters expect string-typed defaultValue. Coerce
    // numbers / booleans without losing information.
    const defaultStr =
      defaultValue === undefined || defaultValue === null
        ? ''
        : typeof defaultValue === 'string'
          ? defaultValue
          : typeof defaultValue === 'object'
            ? JSON.stringify(defaultValue)
            : String(defaultValue);

    // Build a description. Registry/CSP get keyPath+valueName context;
    // everything else just gets the type.
    let description = innerType;
    const keyPath = typeof innerProps.keyPath === 'string' ? innerProps.keyPath : undefined;
    const valueName = typeof innerProps.valueName === 'string' ? innerProps.valueName : undefined;
    const path = typeof innerProps.path === 'string' ? innerProps.path : undefined;
    if (keyPath && valueName) {
      description = `${innerType} at ${keyPath}\\${valueName}`;
    } else if (path) {
      description = `${innerType} at ${path}`;
    }

    out.push({
      armName,
      displayName: outerName,
      mofParamName: `${outerName};Value`,
      defaultValue: defaultStr,
      description,
    });
  }
  return out;
}

/**
 * Build the `metadata.guestConfiguration.configurationParameter`
 * object — maps each ARM parameter name to the MOF parameter name
 * the agent looks for inside the MOF.
 */
function buildConfigurationParameterMap(params: PolicySettingParam[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of params) out[p.armName] = p.mofParamName;
  return out;
}

/**
 * Build the existenceCondition `parameterHash` expression. Azure
 * recomputes this hash from the assigned policy parameter values
 * and compares against the hash stored on the GC assignment. When
 * the user changes a parameter via the portal, the hash diverges,
 * the existenceCondition fails, and the assignment is re-applied
 * with the new values. Without this, parameter changes silently
 * never propagate.
 */
function buildParameterHashExpression(params: PolicySettingParam[]): string {
  if (params.length === 0) return "[base64('')]";
  const concatArgs: string[] = [];
  for (let i = 0; i < params.length; i++) {
    if (i > 0) concatArgs.push("','");
    concatArgs.push(`'${params[i].mofParamName}'`);
    concatArgs.push("'='");
    concatArgs.push(`parameters('${params[i].armName}')`);
  }
  return `[base64(concat(${concatArgs.join(', ')}))]`;
}

/**
 * Build the deployment template parameter entries `{ value: ... }`
 * — one for each ARM param plus the fixed scaffolding params (vmName,
 * location, type, assignmentName).
 */
function buildDeploymentParameters(
  params: PolicySettingParam[],
  configurationName: string,
): Record<string, { value: string }> {
  const out: Record<string, { value: string }> = {
    vmName: { value: "[field('name')]" },
    location: { value: "[field('location')]" },
    type: { value: "[field('type')]" },
    assignmentName: {
      value: `[concat('${configurationName}$pid', uniqueString(policy().assignmentId, policy().definitionReferenceId))]`,
    },
  };
  for (const p of params) {
    out[p.armName] = { value: `[parameters('${p.armName}')]` };
  }
  return out;
}

/**
 * Build the per-platform deployment-template resource entry. One
 * entry for Azure VMs (`Microsoft.Compute/virtualMachines/.../assignments`)
 * and one for Arc (`Microsoft.HybridCompute/machines/.../assignments`);
 * which one fires depends on the `condition` matching the `type`
 * parameter at deploy time.
 */
function buildDeploymentResource(
  platform: 'compute' | 'hybridcompute',
  configurationName: string,
  configVersion: string,
  effect: 'AuditIfNotExists' | 'DeployIfNotExists',
  params: PolicySettingParam[],
): Record<string, unknown> {
  const resourceType =
    platform === 'compute'
      ? 'Microsoft.Compute/virtualMachines/providers/guestConfigurationAssignments'
      : 'Microsoft.HybridCompute/machines/providers/guestConfigurationAssignments';
  const conditionTarget =
    platform === 'compute'
      ? 'Microsoft.Compute/virtualMachines'
      : 'Microsoft.HybridCompute/machines';
  return {
    condition: `[equals(toLower(parameters('type')), toLower('${conditionTarget}'))]`,
    apiVersion: '2024-04-05',
    type: resourceType,
    name: `[concat(parameters('vmName'), '/Microsoft.GuestConfiguration/', parameters('assignmentName'))]`,
    location: "[parameters('location')]",
    properties: {
      guestConfiguration: {
        name: configurationName,
        version: configVersion,
        contentType: 'Custom',
        contentUri: 'REPLACE_WITH_YOUR_MOF_PACKAGE_URI',
        contentHash: 'REPLACE_WITH_SHA256_OF_PACKAGE_ZIP',
        assignmentType: effect === 'DeployIfNotExists' ? 'ApplyAndAutoCorrect' : 'Audit',
        configurationParameter: params.map((p) => ({
          name: p.mofParamName,
          value: `[parameters('${p.armName}')]`,
        })),
      },
    },
  };
}

export function exportToAzurePolicy(
  manifestName: string,
  resources: unknown,
  options?: {
    displayName?: string;
    description?: string;
    effect?: 'AuditIfNotExists' | 'DeployIfNotExists';
    /**
     * OS family the manifest targets. Single-OS by definition (a
     * Guest Configuration MOF can only run on one platform). Default
     * 'Windows'; the export handler auto-detects from the manifest's
     * resource types when possible and overrides this default.
     */
    osType?: 'Windows' | 'Linux';
    category?: string;
    /**
     * Optional version string to surface in `metadata.version` and
     * `guestConfiguration.version`. Carried forward from the source
     * manifest when available (e.g. imported Guest Configuration
     * baselines have their own version string).
     */
    version?: string;
    /**
     * Optional original baselineId from the imported source.
     * Round-tripped into metadata.baselineId so the policy can be
     * traced back to its upstream catalog entry.
     */
    baselineId?: string;
  },
): string {
  const {
    displayName = `[ConfigForge] ${manifestName}`,
    description = `Security baseline configuration: ${manifestName}. Generated by ConfigForge.`,
    effect = 'AuditIfNotExists',
    osType = 'Windows',
    category = 'Guest Configuration',
    version,
    baselineId,
  } = options ?? {};

  const configurationName = manifestName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const configVersion = version ?? '1.0.0';
  const params = extractPolicySettingParams(resources);

  // Two targeting clauses for one OS — Azure VM (always) and Arc
  // (opt-in via the IncludeArcMachines parameter, defaulting to false
  // to match the real LAPS policy). Real Microsoft-published GC
  // baseline policies use these exact field paths.
  const osLike = osType === 'Windows' ? 'Windows*' : 'Linux*';
  const arcOsName = osType === 'Windows' ? 'Windows' : 'Linux';
  const azureVmClause = {
    allOf: [
      { field: 'type', equals: 'Microsoft.Compute/virtualMachines' },
      {
        field: 'Microsoft.Compute/virtualMachines/storageProfile.osDisk.osType',
        like: osLike,
      },
    ],
  };
  const arcClause = {
    allOf: [
      { value: "[parameters('IncludeArcMachines')]", equals: 'true' },
      { field: 'type', equals: 'Microsoft.HybridCompute/machines' },
      { field: 'Microsoft.HybridCompute/machines/osName', equals: arcOsName },
    ],
  };

  // ARM parameters: scaffolding (effect, IncludeArcMachines) + one
  // per manifest setting so operators can tune defaults at policy
  // assignment time without re-publishing the MOF.
  const settingParams: Record<string, unknown> = {};
  for (const p of params) {
    settingParams[p.armName] = {
      type: 'string',
      metadata: {
        displayName: p.displayName,
        description: p.description,
      },
      defaultValue: p.defaultValue,
    };
  }

  const policyDefinition = {
    properties: {
      displayName,
      description,
      policyType: 'Custom',
      mode: 'Indexed',
      metadata: {
        category,
        version: configVersion,
        requiredProviders: ['Microsoft.GuestConfiguration'],
        guestConfiguration: {
          name: configurationName,
          version: configVersion,
          contentType: 'Custom',
          contentUri: 'REPLACE_WITH_YOUR_MOF_PACKAGE_URI',
          contentHash: 'REPLACE_WITH_SHA256_OF_PACKAGE_ZIP',
          configurationParameter: buildConfigurationParameterMap(params),
        },
        ...(baselineId ? { baselineId } : {}),
        generatedBy: 'ConfigForge',
      },
      version: configVersion,
      parameters: {
        IncludeArcMachines: {
          type: 'string',
          metadata: {
            displayName: 'Include Arc connected machines',
            description:
              'When "true", this policy also targets Arc-enabled servers (on-prem, multi-cloud, Azure Local). Note: Azure Policy bills per Arc-managed machine.',
          },
          allowedValues: ['true', 'false'],
          defaultValue: 'false',
        },
        effect: {
          type: 'string',
          metadata: {
            displayName: 'Effect',
            description:
              "Enable or disable the execution of this policy. 'AuditIfNotExists' reports compliance; 'DeployIfNotExists' applies the guest configuration.",
          },
          allowedValues: ['AuditIfNotExists', 'DeployIfNotExists', 'Disabled'],
          defaultValue: effect,
        },
        ...settingParams,
      },
      policyRule: {
        if: {
          anyOf: [azureVmClause, arcClause],
        },
        then: {
          effect: "[parameters('effect')]",
          details: {
            type: 'Microsoft.GuestConfiguration/guestConfigurationAssignments',
            name: `[concat('${configurationName}$pid', uniqueString(policy().assignmentId, policy().definitionReferenceId))]`,
            existenceCondition: {
              allOf: [
                {
                  field:
                    'Microsoft.GuestConfiguration/guestConfigurationAssignments/complianceStatus',
                  equals: 'Compliant',
                },
                {
                  field: 'Microsoft.GuestConfiguration/guestConfigurationAssignments/parameterHash',
                  equals: buildParameterHashExpression(params),
                },
              ],
            },
            ...(effect === 'DeployIfNotExists'
              ? {
                  roleDefinitionIds: [
                    '/providers/Microsoft.Authorization/roleDefinitions/088ab73d-1256-47ae-bea9-9de8e7131f31',
                  ],
                  deployment: {
                    properties: {
                      mode: 'incremental',
                      parameters: buildDeploymentParameters(params, configurationName),
                      template: {
                        $schema:
                          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
                        contentVersion: '1.0.0.0',
                        parameters: {
                          vmName: { type: 'string' },
                          location: { type: 'string' },
                          type: { type: 'string' },
                          assignmentName: { type: 'string' },
                          ...Object.fromEntries(params.map((p) => [p.armName, { type: 'string' }])),
                        },
                        resources: [
                          buildDeploymentResource(
                            'compute',
                            configurationName,
                            configVersion,
                            effect,
                            params,
                          ),
                          buildDeploymentResource(
                            'hybridcompute',
                            configurationName,
                            configVersion,
                            effect,
                            params,
                          ),
                        ],
                      },
                    },
                  },
                }
              : {}),
          },
        },
      },
      versions: [configVersion],
    },
  };

  return JSON.stringify(policyDefinition, null, 2);
}
