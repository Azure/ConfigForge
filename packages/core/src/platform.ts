// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import yaml from 'js-yaml';

export type Platform = 'windows' | 'linux';

export const CROSS_PLATFORM_TYPES = [
  'Microsoft.OSConfig/DeviceInfo',
  'Microsoft.OSConfig/File',
  'Microsoft.OSConfig/FileLine',
  'Microsoft.OSConfig/Test',
  'Microsoft.OSConfig/Firmware',
  'Microsoft.OSConfig/Group',
];

export const WINDOWS_TYPES = [
  'Microsoft.Windows/AccountPolicy',
  'Microsoft.Windows/AuditPolicy',
  'Microsoft.Windows/CSP',
  'Microsoft.Windows/Registry',
  'Microsoft.Windows/UserRightsAssignment',
];

export const LINUX_TYPES = [
  'Linux/FilePermission',
  'Linux/KernelModule',
  'Linux/User',
];

export function getValidTypesForPlatform(platform: Platform): string[] {
  return platform === 'windows'
    ? [...CROSS_PLATFORM_TYPES, ...WINDOWS_TYPES]
    : [...CROSS_PLATFORM_TYPES, ...LINUX_TYPES];
}

export function getPlatformForType(type: string): 'windows' | 'linux' | 'cross-platform' {
  if (WINDOWS_TYPES.includes(type)) return 'windows';
  if (LINUX_TYPES.includes(type)) return 'linux';
  return 'cross-platform';
}

/**
 * Collect every resource `type` string in a manifest resource tree, including
 * nested resources inside `Microsoft.OSConfig/Group` and `Microsoft.OSConfig/Test`
 * wrappers. This is required because ConfigForge baselines frequently wrap
 * Windows/CSP or Linux/KernelModule resources inside OSConfig groups/tests.
 */
export function walkResourceTypes(
  resources: unknown,
): Array<{ type: string; path: string }> {
  const out: Array<{ type: string; path: string }> = [];
  if (!Array.isArray(resources)) return out;
  walkResourcesInternal(resources, 'resources', out);
  return out;
}

/**
 * Maximum nesting depth for Group/Test wrappers. Real-world manifests
 * are 1-3 levels deep; anything past 50 is a malformed/malicious input
 * (the CLI would reject it too). Guards `walkResourcesInternal`,
 * `walkForSummary`, `walkForFull`, `walkForValidation`, and
 * `validateResourceArray` against stack overflow on pathological input.
 */
const MAX_RESOURCE_DEPTH = 50;

function walkResourcesInternal(
  resources: unknown[],
  path: string,
  out: Array<{ type: string; path: string }>,
  depth = 0,
): void {
  if (depth > MAX_RESOURCE_DEPTH) return;
  for (let i = 0; i < resources.length; i++) {
    const r = resources[i] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') continue;

    const type = typeof r.type === 'string' ? r.type : '';
    const here = `${path}[${i}]`;
    if (type) out.push({ type, path: here });

    const props = (r.properties ?? r.Properties) as Record<string, unknown> | undefined;
    if (!props) continue;

    // Group: properties.resources = [ ...nested ]
    if (Array.isArray(props.resources)) {
      walkResourcesInternal(props.resources as unknown[], `${here}.properties.resources`, out, depth + 1);
    }
    // Test: properties.resource = { type, properties }
    const nestedSingle = props.resource as Record<string, unknown> | undefined;
    if (nestedSingle && typeof nestedSingle === 'object') {
      const nestedType = typeof nestedSingle.type === 'string' ? nestedSingle.type : '';
      if (nestedType) out.push({ type: nestedType, path: `${here}.properties.resource` });
      const deeperProps = (nestedSingle.properties ?? nestedSingle.Properties) as Record<string, unknown> | undefined;
      if (deeperProps && Array.isArray(deeperProps.resources)) {
        walkResourcesInternal(
          deeperProps.resources as unknown[],
          `${here}.properties.resource.properties.resources`,
          out,
          depth + 1,
        );
      }
    }
  }
}

export type ManifestPlatform = 'windows' | 'linux' | 'cross-platform' | 'mixed';

export function detectManifestPlatform(resources: { type: string }[] | unknown): ManifestPlatform {
  let hasWindows = false;
  let hasLinux = false;
  for (const { type } of walkResourceTypes(resources)) {
    if (WINDOWS_TYPES.includes(type)) hasWindows = true;
    if (LINUX_TYPES.includes(type)) hasLinux = true;
  }
  if (hasWindows && hasLinux) return 'mixed';
  if (hasWindows) return 'windows';
  if (hasLinux) return 'linux';
  return 'cross-platform';
}

export function hasMixedPlatformResources(resources: unknown): boolean {
  let hasWindows = false;
  let hasLinux = false;
  for (const { type } of walkResourceTypes(resources)) {
    if (WINDOWS_TYPES.includes(type)) hasWindows = true;
    if (LINUX_TYPES.includes(type)) hasLinux = true;
  }
  return hasWindows && hasLinux;
}

export function validateManifestPlatform(
  resources: { type: string }[] | unknown,
  platform: Platform,
): string[] {
  const errors: string[] = [];
  const validTypes = new Set(getValidTypesForPlatform(platform));
  const allKnown = new Set([...CROSS_PLATFORM_TYPES, ...WINDOWS_TYPES, ...LINUX_TYPES]);

  if (hasMixedPlatformResources(resources)) {
    errors.push('Manifest mixes Windows and Linux resource types, which is not supported');
  }

  for (const { type, path } of walkResourceTypes(resources)) {
    // Unknown type: don't block (forward-compat)
    if (!allKnown.has(type)) continue;
    if (!validTypes.has(type)) {
      const wrongPlatform = platform === 'windows' ? 'Linux' : 'Windows';
      errors.push(`${path}: "${type}" is a ${wrongPlatform}-only resource and cannot be deployed on ${platform}`);
    }
  }
  return errors;
}

/**
 * Full manifest-shape validator that mirrors what oscfg 1.3.8-preview18
 * actually enforces at parse time:
 *
 *   resources:              # REQUIRED — top-level array, not a map
 *     - name: <string>      # REQUIRED
 *       type: <string>      # REQUIRED
 *       properties: {...}   # per-type schema (not validated here)
 *
 * Returns a list of blocking errors (empty = valid).
 */
export function validateManifestSchema(manifest: unknown): string[] {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push('Manifest must be a YAML/JSON object with a `resources` field');
    return errors;
  }
  const m = manifest as Record<string, unknown>;
  if (!('resources' in m)) {
    errors.push('Manifest is missing required field `resources`');
    return errors;
  }
  if (!Array.isArray(m.resources)) {
    errors.push('`resources` must be an array (sequence), not a map');
    return errors;
  }
  validateResourceArray(m.resources, 'resources', errors);
  return errors;
}

function validateResourceArray(
  arr: unknown[],
  path: string,
  errors: string[],
  opts?: { nameRequired?: boolean; depth?: number },
): void {
  const nameRequired = opts?.nameRequired ?? true;
  const depth = opts?.depth ?? 0;
  if (depth > MAX_RESOURCE_DEPTH) {
    errors.push(`${path}: nesting too deep (>${MAX_RESOURCE_DEPTH} levels) — refusing to validate further`);
    return;
  }
  arr.forEach((r, i) => {
    const here = `${path}[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      errors.push(`${here} must be an object`);
      return;
    }
    const res = r as Record<string, unknown>;
    if (nameRequired && (typeof res.name !== 'string' || res.name.trim() === '')) {
      errors.push(`${here}.name must be a non-empty string`);
    }
    if (typeof res.type !== 'string' || res.type.trim() === '') {
      errors.push(`${here}.type must be a non-empty string`);
    }
    const props = (res.properties ?? res.Properties) as unknown;
    if (props === undefined) return;
    if (typeof props !== 'object' || props === null || Array.isArray(props)) {
      errors.push(`${here}.properties must be an object if present`);
      return;
    }
    const p = props as Record<string, unknown>;
    // Group: properties.resources = [ ...nested ]. Nested resources inside a
    // Group inherit their identity from the parent — they typically don't have
    // their own `name` field (e.g. SFF Linux baseline).
    if (p.resources !== undefined) {
      if (!Array.isArray(p.resources)) {
        errors.push(`${here}.properties.resources must be an array`);
      } else {
        validateResourceArray(p.resources as unknown[], `${here}.properties.resources`, errors, { nameRequired: false, depth: depth + 1 });
      }
    }
    // Test / wrapper: properties.resource = { ...single nested }. The wrapped
    // resource inherits its name from the parent, so only `type` is required.
    if (p.resource !== undefined) {
      if (!p.resource || typeof p.resource !== 'object' || Array.isArray(p.resource)) {
        errors.push(`${here}.properties.resource must be an object`);
      } else {
        validateResourceArray([p.resource], `${here}.properties.resource`, errors, { nameRequired: false, depth: depth + 1 });
      }
    }
  });
}

/**
 * Extract a flat {name, type} summary of the resource tree — used for fast
 * manifest-list enrichment so we don't need to spawn `oscfg` to render
 * resource counts and platform badges for registered manifests.
 */
export function extractResourceSummary(resources: unknown): Array<{ name: string; type: string }> {
  const out: Array<{ name: string; type: string }> = [];
  if (!Array.isArray(resources)) return out;
  walkForSummary(resources, out);
  return out;
}

function walkForSummary(arr: unknown[], out: Array<{ name: string; type: string }>, depth = 0): void {
  if (depth > MAX_RESOURCE_DEPTH) return;
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const res = r as Record<string, unknown>;
    const name = typeof res.name === 'string' ? res.name : '';
    const type = typeof res.type === 'string' ? res.type : '';
    if (name && type) out.push({ name, type });
    const props = (res.properties ?? res.Properties) as Record<string, unknown> | undefined;
    if (!props) continue;
    if (Array.isArray(props.resources)) walkForSummary(props.resources as unknown[], out, depth + 1);
    const nested = props.resource as Record<string, unknown> | undefined;
    if (nested && typeof nested === 'object') walkForSummary([nested], out, depth + 1);
  }
}

/**
 * Extract each resource in the tree with its full declared properties.
 * Used by the audit endpoint to run per-resource `exec resource --mode get`
 * calls and compare actual device state with desired state.
 */
export function extractResourcesFull(
  resources: unknown,
): Array<{ name: string; type: string; properties: Record<string, unknown> }> {
  const out: Array<{ name: string; type: string; properties: Record<string, unknown> }> = [];
  if (!Array.isArray(resources)) return out;
  walkForFull(resources, out);
  return out;
}

function walkForFull(
  arr: unknown[],
  out: Array<{ name: string; type: string; properties: Record<string, unknown> }>,
  depth = 0,
): void {
  if (depth > MAX_RESOURCE_DEPTH) return;
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const res = r as Record<string, unknown>;
    const name = typeof res.name === 'string' ? res.name : '';
    const type = typeof res.type === 'string' ? res.type : '';
    const props = (res.properties ?? res.Properties) as Record<string, unknown> | undefined;

    // `Microsoft.OSConfig/Test` is a compliance wrapper. Its `properties`
    // include the nested resource to inspect PLUS a `schema` (or
    // `expression`) that declares what makes the live state compliant. The
    // oscfg CLI evaluates that schema itself when called with
    // `--type Microsoft.OSConfig/Test`, so we MUST preserve the Test
    // wrapper all the way through to the CLI rather than unwrapping it.
    // Mirrors the internal Microsoft.OSConfig PS module (OSConfig.ps1
    // lines 269-278) which always calls `exec resource --type
    // Microsoft.OSConfig/Test --properties <full Test props>`.
    if (type === 'Microsoft.OSConfig/Test' && props && name) {
      const testProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        testProps[k] = v;
      }
      out.push({ name, type, properties: testProps });
      continue;
    }

    // `Microsoft.OSConfig/Group` is a structural wrapper — not directly
    // readable by `oscfg exec`. Recurse into its nested resources and
    // give each one the parent Group's name so audit can read them
    // individually. Don't push the Group itself.
    if (type === 'Microsoft.OSConfig/Group' && props && Array.isArray(props.resources)) {
      const nested = props.resources as unknown[];
      for (let j = 0; j < nested.length; j++) {
        const nr = nested[j] as Record<string, unknown> | null;
        if (!nr || typeof nr !== 'object') continue;
        const nrType = typeof nr.type === 'string' ? nr.type : '';
        const nrName = typeof nr.name === 'string' && nr.name ? nr.name : `${name}[${j}]`;
        const nrProps = (nr.properties ?? nr.Properties) as Record<string, unknown> | undefined;
        if (nrType) {
          const leaf: Record<string, unknown> = {};
          if (nrProps) {
            for (const [k, v] of Object.entries(nrProps)) {
              if (k === 'resources' || k === 'resource') continue;
              leaf[k] = v;
            }
          }
          out.push({ name: nrName, type: nrType, properties: leaf });
        }
      }
      continue;
    }

    if (name && type) {
      // Shallow-clone properties, stripping any `resources`/`resource` grouping
      // keys so the provider-level call only sees the leaf properties.
      const leaf: Record<string, unknown> = {};
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          if (k === 'resources' || k === 'resource') continue;
          leaf[k] = v;
        }
      }
      out.push({ name, type, properties: leaf });
    }
    if (!props) continue;
    if (Array.isArray(props.resources)) walkForFull(props.resources as unknown[], out, depth + 1);
    const nested = props.resource as Record<string, unknown> | undefined;
    if (nested && typeof nested === 'object') walkForFull([nested], out, depth + 1);
  }
}

// ── Validation summary ──────────────────────────────────────────────────────

export interface ValidationSummary {
  hasSchema: boolean;
  hasEnforcementValues: boolean;
  hasComplianceCriteria: boolean;
  /**
   * Human-readable issues. Combines `validateManifestSchema` errors with
   * a few cheap heuristics (empty resources, missing $schema reference).
   * If empty, the manifest is considered "ready to export".
   */
  issues: string[];
}

/**
 * Build a validation summary from a parsed manifest document. This is what
 * the Validation & Export page renders. Use `extractValidationSummaryFromYaml`
 * if you only have the source string.
 *
 * The summary intentionally walks Group/Test wrappers (matching
 * `walkForFull`/`walkForSummary`) so a manifest like the SFF Linux baseline
 * is not flagged "no enforcement" just because all enforcement lives inside
 * a top-level Group.
 */
export function extractValidationSummary(doc: unknown): ValidationSummary {
  const issues: string[] = [];
  const docObj = (doc && typeof doc === 'object' && !Array.isArray(doc)
    ? (doc as Record<string, unknown>)
    : null);

  // Defer the heavy validation to the existing schema validator. It already
  // handles Group/Test wrappers, name/type requirements, and emits one
  // human-readable error per problem.
  for (const e of validateManifestSchema(doc)) issues.push(e);

  const hasSchema = !!(docObj && typeof docObj.$schema === 'string' && docObj.$schema);
  if (!hasSchema) {
    issues.push('Missing $schema reference (recommended for IDE/CLI validation)');
  }

  const resourcesRaw = docObj && Array.isArray(docObj.resources) ? (docObj.resources as unknown[]) : [];
  if (resourcesRaw.length === 0) {
    issues.push('Manifest has no resources defined');
  }

  let hasEnforcementValues = false;
  let hasComplianceCriteria = false;
  walkForValidation(resourcesRaw, (r) => {
    if (r.compliance != null && typeof r.compliance === 'object') {
      hasComplianceCriteria = true;
    }
    const props = (r.properties ?? r.Properties) as Record<string, unknown> | undefined;
    if (props) {
      // Common shapes: { value: ... } direct, { value: { dword: 1 } } typed
      if (props.value !== undefined || props.Value !== undefined) hasEnforcementValues = true;
      if (props.data !== undefined) hasEnforcementValues = true;
      if (props.desired !== undefined || props.desiredState !== undefined) hasEnforcementValues = true;
    }
  });

  return { hasSchema, hasEnforcementValues, hasComplianceCriteria, issues };
}

/**
 * Convenience helper: parse YAML and produce a validation summary. Returns
 * a "fatal-parse" summary if the YAML is malformed.
 */
export function extractValidationSummaryFromYaml(yamlText: string): ValidationSummary {
  let doc: unknown = null;
  try {
    doc = yaml.load(yamlText);
  } catch (err) {
    return {
      hasSchema: false,
      hasEnforcementValues: false,
      hasComplianceCriteria: false,
      issues: [`YAML parse failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  return extractValidationSummary(doc);
}

/**
 * Walk the resource tree (including Group / Test wrappers) and call `fn`
 * with each addressable resource — i.e. the same set that `walkForFull`
 * audits. Used by `extractValidationSummary` to detect enforcement /
 * compliance signals anywhere in the tree.
 */
function walkForValidation(
  arr: unknown[],
  fn: (r: Record<string, unknown>) => void,
  depth = 0,
): void {
  if (depth > MAX_RESOURCE_DEPTH) return;
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const res = r as Record<string, unknown>;
    fn(res);
    const props = (res.properties ?? res.Properties) as Record<string, unknown> | undefined;
    if (!props) continue;
    if (Array.isArray(props.resources)) walkForValidation(props.resources as unknown[], fn, depth + 1);
    const nested = props.resource as Record<string, unknown> | undefined;
    if (nested && typeof nested === 'object') walkForValidation([nested], fn, depth + 1);
  }
}
