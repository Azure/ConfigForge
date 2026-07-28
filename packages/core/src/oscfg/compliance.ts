// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Compliance comparison helpers.
 *
 * The real oscfg CLI (1.3.8-preview18) does NOT return a `compliance` field
 * on resources. `get resource -n <ns>` and `exec resource --mode get` both
 * return the live device state only. Compliance = comparing that live state
 * against the desired state from the source YAML.
 *
 * This module is shared by:
 *   - POST /api/deploy (audit + enforce post-apply summary)
 *   - Any future "test" flow
 */

import { normalizeRegistryValueType } from './registry-types';

export type ComplianceStatus =
  | 'compliant'
  | 'noncompliant'
  /**
   * The CLI could not read the resource (transport / permission / unsupported
   * provider path). We genuinely don't know whether the device is compliant
   * — distinct from `noncompliant`, where we DID read the value and it
   * disagreed with desired. This is the "we don't know" bucket; the UI
   * surfaces it as a yellow warning rather than a red failure.
   */
  | 'indeterminate'
  /**
   * Internal: a Test-resource compliance verdict couldn't be parsed at all.
   * Treated like `indeterminate` for UI roll-ups but kept distinct so that
   * persistent CLI bugs are visible in logs.
   */
  | 'error'
  | 'unknown';

export interface DesiredResource {
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface ComplianceResult {
  name: string;
  type: string;
  status: ComplianceStatus;
  reason: string;
  /** The desired property values declared in the source YAML. */
  desired: Record<string, unknown>;
  /** The actual property values reported by the device, when available. */
  actual: Record<string, unknown> | null;
}

/**
 * Hive normalization for Microsoft.Windows/Registry.
 *
 * The CLI requires a colon after the hive token (`HKLM:\Software\...`). If
 * the source YAML omits the colon (as the Defender baseline does —
 * `HKEY_LOCAL_MACHINE\SOFTWARE\...`), the CLI silently returns a null value
 * and we'd incorrectly mark every resource as non-compliant due to "value
 * missing" when really we never actually read the registry.
 *
 * We normalize once here and pass the colon form to the CLI.
 */
const HIVE_PREFIXES = [
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
];

export function normalizeRegistryKeyPath(keyPath: string): string {
  if (typeof keyPath !== 'string' || keyPath.length === 0) return keyPath;
  // Already colon-prefixed → leave alone.
  const firstSegmentEnd = keyPath.indexOf('\\');
  const head = firstSegmentEnd === -1 ? keyPath : keyPath.slice(0, firstSegmentEnd);
  if (head.endsWith(':')) return keyPath;

  const upper = head.toUpperCase();
  if (!HIVE_PREFIXES.includes(upper)) return keyPath;
  const rest = firstSegmentEnd === -1 ? '' : keyPath.slice(firstSegmentEnd);
  return `${head}:${rest}`;
}

/**
 * Normalize a resource's properties for CLI invocation. Currently only
 * rewrites registry keyPaths, but centralized so we can add more providers
 * later without touching callers.
 */
export function normalizePropertiesForCli(
  type: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  // Direct Registry resource — normalize the top-level keyPath.
  if (type === 'Microsoft.Windows/Registry') {
    const out: Record<string, unknown> = { ...properties };
    if (typeof out.keyPath === 'string') {
      out.keyPath = normalizeRegistryKeyPath(out.keyPath);
    }
    return out;
  }

  // Microsoft.OSConfig/Test wrapper — the nested resource may be a Registry
  // resource whose keyPath needs the colon-hive form (`HKLM:\...`). The CLI
  // silently returns value=null for `HKEY_LOCAL_MACHINE\...` inside a Test
  // wrapper, even when the key exists — causing false noncompliance.
  if (type === 'Microsoft.OSConfig/Test') {
    const res = properties.resource as Record<string, unknown> | undefined;
    if (res && typeof res === 'object') {
      const innerType = typeof res.type === 'string' ? res.type : '';
      if (innerType === 'Microsoft.Windows/Registry') {
        const innerProps = res.properties as Record<string, unknown> | undefined;
        if (innerProps && typeof innerProps.keyPath === 'string') {
          return {
            ...properties,
            resource: {
              ...res,
              properties: {
                ...innerProps,
                keyPath: normalizeRegistryKeyPath(innerProps.keyPath),
              },
            },
          };
        }
      }
    }
    return properties;
  }

  return properties;
}

/**
 * Compare a desired resource against actual device state and return a
 * classification.
 *
 * Rules:
 *   - If `actual` is null (CLI query failed or returned empty) → error.
 *   - If any key we care about differs → noncompliant.
 *   - If every comparable key matches → compliant.
 *
 * "Keys we care about" are the properties declared in the source YAML,
 * excluding identity-only fields that the CLI echoes back unchanged
 * (keyPath, valueName, moniker, subcategory, policy). Those are address
 * fields, not state fields.
 *
 * For some resource types, certain desired properties are "write-only" —
 * they tell the CLI what to SET but aren't returned on GET. For example,
 * `Microsoft.OSConfig/File` desired `content` is not echoed; only `exists`
 * and `path` come back. We skip desired keys that the actual doesn't have
 * when they are known write-only properties.
 */
const IDENTITY_KEYS = new Set([
  'keyPath',
  'valueName',
  'valueType',
  'moniker',
  'subcategory',
  'policy',
  'path', // address field for File, FileLine, FilePermission, CSP
  'name', // address field for KernelModule, AccountPolicy, User, UserRightsAssignment
]);

// Properties that are only meaningful for SET, not returned on GET.
// If the CLI doesn't echo these back, don't treat them as "missing".
const WRITE_ONLY_KEYS = new Set([
  'content', // Microsoft.OSConfig/File — file content to write
  'search', // Microsoft.OSConfig/FileLine — search pattern (CLI uses 'find')
  'find', // Microsoft.OSConfig/FileLine — alias for search
  'line', // Microsoft.OSConfig/FileLine — replacement line
  'replace', // Microsoft.OSConfig/FileLine — replacement text
]);

export function compareDesiredActual(
  desired: DesiredResource,
  actual: Record<string, unknown> | null,
): ComplianceResult {
  if (actual === null) {
    return {
      name: desired.name,
      type: desired.type,
      status: 'indeterminate',
      reason: 'Resource could not be read from the device.',
      desired: desired.properties,
      actual: null,
    };
  }

  const actualProps = (actual.properties as Record<string, unknown> | undefined) ?? actual;

  // `Microsoft.OSConfig/Test` has authoritative compliance built in — the
  // CLI evaluates the schema/expression against the nested resource's
  // actual state and returns {compliance:{status,reason}} on the response.
  // We defer to that verdict instead of running our own comparator.
  // See OSConfig.ps1 line 275 / 277 for the equivalent PS flow.
  if (desired.type === 'Microsoft.OSConfig/Test') {
    const compliance = (actualProps as Record<string, unknown>).compliance as
      | Record<string, unknown>
      | undefined;
    if (compliance && typeof compliance === 'object') {
      const status = String(compliance.status ?? '').toLowerCase();
      // Extract the actual value from the nested resource response so we
      // can build a human-readable reason like "0 is equal to 0" or
      // "4 is within the allowed range: 1 to 4" — matching the PS module.
      const innerResource = (actualProps as Record<string, unknown>).resource as
        | Record<string, unknown>
        | undefined;
      const actualValue = innerResource
        ? ((innerResource.properties as Record<string, unknown> | undefined)?.value ?? null)
        : null;
      const schema = (desired.properties.schema ??
        (actualProps as Record<string, unknown>).schema) as Record<string, unknown> | undefined;
      const cliReason = typeof compliance.reason === 'string' ? compliance.reason.trim() : '';

      // Schema-backed Tests can use our richer local humanizer. Expression-
      // backed Tests have no schema to interpret, so preserve the authoritative
      // CLI reason (including the Test template's actual-vs-required detail)
      // instead of collapsing it to "does not meet the requirement".
      const reason =
        schema && Object.keys(schema).length > 0
          ? humanizeComplianceReason(status, actualValue, schema)
          : cliReason || humanizeComplianceReason(status, actualValue, schema);

      if (status === 'compliant') {
        return {
          name: desired.name,
          type: desired.type,
          status: 'compliant',
          reason,
          desired: desired.properties,
          actual: actualProps as Record<string, unknown>,
        };
      }
      return {
        name: desired.name,
        type: desired.type,
        status: 'noncompliant',
        reason,
        desired: desired.properties,
        actual: actualProps as Record<string, unknown>,
      };
    }
    // Fallthrough: the CLI didn't emit a compliance verdict for this
    // Test resource. v0.2.21: rather than surface a useless
    // 'indeterminate' / "Could not read" when we have ALL the
    // information we need to decide ourselves (the schema is in the
    // manifest, the actual state was reported by the CLI), evaluate
    // the schema locally against the reported value and emit a
    // verdict marked "computed locally" so the user knows our tool
    // — not the CLI — made the call.
    //
    // This is faithful to user intent in the LAPS scenario where the
    // CLI was emitting verdicts for some Test resources but not
    // others (`PasswordComplexity` and `PasswordLength` came back
    // with no compliance field while their siblings did), leaving
    // the auditor staring at "Could not read" rows that they were
    // perfectly capable of evaluating from the data on screen.
    const localFallbackSchema = (desired.properties.schema ??
      (actualProps as Record<string, unknown>).schema) as Record<string, unknown> | undefined;
    const localInner = (actualProps as Record<string, unknown>).resource as
      | Record<string, unknown>
      | undefined;
    const localActualValue = localInner
      ? ((localInner.properties as Record<string, unknown> | undefined)?.value ?? null)
      : null;
    if (localFallbackSchema) {
      const localVerdict = evaluateSchemaLocally(localFallbackSchema, localActualValue);
      if (localVerdict !== null) {
        return {
          name: desired.name,
          type: desired.type,
          status: localVerdict.status,
          reason: `${localVerdict.reason} (computed locally — CLI did not return a verdict)`,
          desired: desired.properties,
          actual: actualProps as Record<string, unknown>,
        };
      }
    }
    return {
      name: desired.name,
      type: desired.type,
      status: 'indeterminate',
      reason: 'CLI did not return a compliance verdict for this Test resource.',
      desired: desired.properties,
      actual: actualProps as Record<string, unknown>,
    };
  }

  const mismatches: string[] = [];
  const missing: string[] = [];
  // v0.1.1 fix: count how many state properties we actually compared.
  // If zero (because the desired YAML declared only identity fields like
  // keyPath/valueName/valueType with no `valueData`, OR all comparable
  // values were undefined/null), we cannot determine compliance and must
  // NOT default to compliant. Reported as a false-positive on a fake
  // `examplesetting` Microsoft.Windows/Registry resource that had no
  // valueData — which previously fell through the loop with 0 mismatches
  // and 0 missing, returning compliant.
  //
  // For Microsoft.Windows/Registry specifically, the authoritative state
  // is `valueData` (or its `value` alias). The CLI echoes back the
  // REQUESTED `valueType` even for non-existent registry values, so a
  // valueType-only match is NOT proof that the registry rule is
  // satisfied — `registryValueChecked` tracks whether we compared the
  // value content itself.
  let comparedCount = 0;
  let registryValueChecked = false;

  // Registry-specific: surface `valueType` mismatches between manifest and
  // device. valueType is in IDENTITY_KEYS for the generic loop because for
  // most providers it's an addressing field — but for a Microsoft.Windows/
  // Registry resource it's also a state field. The CLI happily returns the
  // ACTUAL on-disk type regardless of what we asked it for: a manifest that
  // declares `valueType: REG_SZ value: '1'` against a registry holding a
  // REG_DWORD `1` would silently pass via the loose `valuesEqual('1', 1)`
  // path. That's wrong — types are part of the rule.
  //
  // Canonicalize both sides via normalizeRegistryValueType so REG_SZ vs
  // String, REG_DWORD vs Dword, REG_DWORD_LITTLE_ENDIAN vs Dword all
  // compare equal (the spelling differences are CLI-flavor variance,
  // not real type differences).
  //
  // NB: this check intentionally does NOT increment `comparedCount` —
  // valueType is necessary-but-not-sufficient. A real registry audit
  // requires comparing the value content (`valueData` / `value`).
  if (desired.type === 'Microsoft.Windows/Registry') {
    const desiredVT = (desired.properties as Record<string, unknown>).valueType;
    const actualVT = (actualProps as Record<string, unknown>).valueType;
    if (
      desiredVT !== undefined &&
      desiredVT !== null &&
      actualVT !== undefined &&
      actualVT !== null
    ) {
      const dN = normalizeRegistryValueType(desiredVT);
      const aN = normalizeRegistryValueType(actualVT);
      if (dN !== aN) {
        mismatches.push(
          `valueType: ${formatVal(actualVT)} is not equal to ${formatVal(desiredVT)} (expected ${formatVal(desiredVT)})`,
        );
      }
    }
  }

  for (const [key, desiredVal] of Object.entries(desired.properties)) {
    if (IDENTITY_KEYS.has(key)) continue;
    if (desiredVal === undefined || desiredVal === null) continue;
    const actualVal = (actualProps as Record<string, unknown>)[key];
    if (actualVal === undefined || actualVal === null) {
      // Skip write-only properties the CLI doesn't return on GET.
      if (WRITE_ONLY_KEYS.has(key)) continue;
      missing.push(key);
      continue;
    }
    comparedCount++;
    if (key === 'valueData' || key === 'value') {
      registryValueChecked = true;
    }
    if (!valuesEqual(desiredVal, actualVal)) {
      mismatches.push(
        `${key}: ${formatVal(actualVal)} is not equal to ${formatVal(desiredVal)} (expected ${formatVal(desiredVal)})`,
      );
    }
  }

  if (missing.length === 0 && mismatches.length === 0) {
    // Registry-specific: a Microsoft.Windows/Registry resource is only
    // meaningfully checked when we compared the actual value content
    // (valueData or value). A type-only or identity-only YAML cannot
    // produce a green pass — the CLI echoes valueType back even for
    // non-existent registry values, so trusting that as evidence of
    // compliance was the source of the false-positive.
    if (desired.type === 'Microsoft.Windows/Registry' && !registryValueChecked) {
      return {
        name: desired.name,
        type: desired.type,
        status: 'indeterminate',
        reason:
          'Microsoft.Windows/Registry resources need a `valueData` (or `value`) declared to be auditable. ' +
          'Only identity/address fields were declared, so the actual registry value was never read.',
        desired: desired.properties,
        actual: actualProps as Record<string, unknown>,
      };
    }
    if (comparedCount === 0) {
      // The desired YAML had no comparable state to check — only identity
      // fields, or all state values were null/undefined. Returning
      // `compliant` here would be a dangerous false positive (the audit
      // checked nothing). Surface as `indeterminate` so the UI flags it.
      return {
        name: desired.name,
        type: desired.type,
        status: 'indeterminate',
        reason:
          'Resource has no comparable state to check. ' +
          'The desired YAML declared only identity/address fields with no state values.',
        desired: desired.properties,
        actual: actualProps as Record<string, unknown>,
      };
    }
    return {
      name: desired.name,
      type: desired.type,
      status: 'compliant',
      reason: 'Device state matches desired configuration.',
      desired: desired.properties,
      actual: actualProps as Record<string, unknown>,
    };
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`not set on device: ${missing.join(', ')}`);
  if (mismatches.length > 0) parts.push(mismatches.join('; '));
  return {
    name: desired.name,
    type: desired.type,
    status: 'noncompliant',
    reason: parts.join(' | ') || 'Device state differs from desired.',
    desired: desired.properties,
    actual: actualProps as Record<string, unknown>,
  };
}

/** @internal Exported for unit testing only. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Numeric coercion: YAML `value: 1` vs CLI "1". Guard against
  // `Number("999999999999999999999")` collapsing to Infinity, which
  // would silently say two huge but-different strings are equal.
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '') {
    const n = Number(b);
    if (!Number.isFinite(n)) return false;
    return n === a;
  }
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '') {
    const n = Number(a);
    if (!Number.isFinite(n)) return false;
    return n === b;
  }
  // Case-insensitive string compare for REG types
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  // Structural compare for nested objects/arrays
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Transform the CLI's raw schema reason into a human-readable message that
 * matches the PowerShell module's output style:
 *   - "0 is equal to 0"
 *   - "4 is within the allowed range: 1 to 4"
 *   - "5 is one of the allowed values: [5, 6]"
 *   - "Value is not set on the device"
 */
function humanizeComplianceReason(
  status: string,
  actualValue: unknown,
  schema: Record<string, unknown> | undefined,
): string {
  const av = actualValue === null || actualValue === undefined ? 'not set' : String(actualValue);
  const isCompliant = status === 'compliant';

  if (!schema || Object.keys(schema).length === 0) {
    return isCompliant ? `${av} meets the requirement` : `${av} does not meet the requirement`;
  }

  // oneOf: [{const: N}, {type: "null"}] — our null-aware const wrapper
  if (Array.isArray(schema.oneOf)) {
    const constEntry = (schema.oneOf as Record<string, unknown>[]).find(
      (s) => s.const !== undefined,
    );
    if (constEntry) {
      const expected = constEntry.const;
      if (actualValue === null || actualValue === undefined) {
        return isCompliant
          ? `Value is not set (default matches expected ${expected})`
          : `Value is not set on the device (expected ${expected})`;
      }
      return isCompliant
        ? `${av} is equal to ${expected}`
        : `${av} is not equal to ${expected} (expected ${expected})`;
    }
  }

  // const: N — simple equality
  if (schema.const !== undefined) {
    const expected = schema.const;
    if (actualValue === null || actualValue === undefined) {
      return `Value is not set on the device (expected ${expected})`;
    }
    return isCompliant
      ? `${av} is equal to ${expected}`
      : `${av} is not equal to ${expected} (expected ${expected})`;
  }

  // enum: [N, M, ...] — allowed values list
  if (Array.isArray(schema.enum)) {
    const allowed = (schema.enum as unknown[]).join(', ');
    if (actualValue === null || actualValue === undefined) {
      return `Value is not set on the device (allowed values: [${allowed}])`;
    }
    return isCompliant
      ? `${av} is one of the allowed values: [${allowed}]`
      : `${av} is not one of the allowed values: [${allowed}]`;
  }

  // minimum / maximum — range check
  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    const min = schema.minimum;
    const max = schema.maximum;
    if (actualValue === null || actualValue === undefined) {
      const rangeStr =
        min !== undefined && max !== undefined
          ? `${min} to ${max}`
          : min !== undefined
            ? `≥ ${min}`
            : `≤ ${max}`;
      return `Value is not set on the device (allowed range: ${rangeStr})`;
    }
    const rangeStr =
      min !== undefined && max !== undefined
        ? `${min} to ${max}`
        : min !== undefined
          ? `≥ ${min}`
          : `≤ ${max}`;
    return isCompliant
      ? `${av} is within the allowed range: ${rangeStr}`
      : `${av} is outside the allowed range: ${rangeStr}`;
  }

  // pattern — regex match
  if (typeof schema.pattern === 'string') {
    return isCompliant
      ? `${av} matches the required pattern`
      : `${av} does not match the required pattern "${schema.pattern}"`;
  }

  // Fallback
  return isCompliant
    ? `${av} meets the compliance requirement`
    : `${av} does not meet the compliance requirement`;
}

/**
 * v0.2.21: locally evaluate a manifest's Test-resource schema against
 * the CLI-reported `actualValue` when the CLI didn't emit its own
 * compliance verdict.
 *
 * Returns `null` if the schema shape isn't one we recognize — caller
 * should fall back to `indeterminate` in that case.
 *
 * Returns `{ status, reason }` for the recognized shapes:
 *
 *   - `const: X`                  → compliant iff actual === X
 *   - `oneOf: [{const}, {type}]`  → compliant if actual matches either branch
 *   - `enum: [...]`               → compliant if actual is in the list
 *   - `minimum/maximum`           → compliant if actual is in range
 *
 * Null/undefined actual values: only compliant against `oneOf` that
 * explicitly includes `{ type: 'null' }`. Everywhere else null is
 * non-compliant — i.e., "value not set" against a strict const/enum/
 * range is a real audit failure, not a tie.
 */
function evaluateSchemaLocally(
  schema: Record<string, unknown>,
  actualValue: unknown,
): { status: ComplianceStatus; reason: string } | null {
  if (!schema || typeof schema !== 'object') return null;

  const actualIsNullish = actualValue === null || actualValue === undefined;
  const av = actualIsNullish ? 'not set' : String(actualValue);

  // oneOf: [{const: X}, {type: 'null'}, ...] — common LAPS/Defender pattern.
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as Record<string, unknown>[];
    const allowsNull = branches.some((b) => b && (b.type === 'null' || b.type === null));
    const constBranch = branches.find((b) => b && b.const !== undefined);
    const expected = constBranch?.const;
    if (actualIsNullish) {
      if (allowsNull) {
        return {
          status: 'compliant',
          reason:
            expected !== undefined
              ? `Value is not set (default matches expected ${expected})`
              : 'Value is not set (schema allows null)',
        };
      }
      return {
        status: 'noncompliant',
        reason:
          expected !== undefined
            ? `Value is not set on the device (expected ${expected})`
            : 'Value is not set on the device',
      };
    }
    if (constBranch && actualValue === expected) {
      return { status: 'compliant', reason: `${av} is equal to ${expected}` };
    }
    return {
      status: 'noncompliant',
      reason:
        expected !== undefined
          ? `${av} is not equal to ${expected} (expected ${expected})`
          : `${av} does not match any allowed schema branch`,
    };
  }

  // const: N
  if (schema.const !== undefined) {
    const expected = schema.const;
    if (actualIsNullish) {
      return {
        status: 'noncompliant',
        reason: `Value is not set on the device (expected ${expected})`,
      };
    }
    if (actualValue === expected) {
      return { status: 'compliant', reason: `${av} is equal to ${expected}` };
    }
    return {
      status: 'noncompliant',
      reason: `${av} is not equal to ${expected} (expected ${expected})`,
    };
  }

  // enum: [a, b, ...]
  if (Array.isArray(schema.enum)) {
    const allowed = schema.enum as unknown[];
    const allowedStr = allowed.join(', ');
    if (actualIsNullish) {
      return {
        status: 'noncompliant',
        reason: `Value is not set on the device (allowed values: [${allowedStr}])`,
      };
    }
    if (allowed.includes(actualValue)) {
      return {
        status: 'compliant',
        reason: `${av} is one of the allowed values: [${allowedStr}]`,
      };
    }
    return {
      status: 'noncompliant',
      reason: `${av} is not one of the allowed values: [${allowedStr}]`,
    };
  }

  // minimum / maximum (covers PasswordLength etc.).
  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    const min = schema.minimum as number | undefined;
    const max = schema.maximum as number | undefined;
    const rangeStr =
      min !== undefined && max !== undefined
        ? `${min} to ${max}`
        : min !== undefined
          ? `≥ ${min}`
          : `≤ ${max}`;
    if (actualIsNullish) {
      return {
        status: 'noncompliant',
        reason: `Value is not set on the device (allowed range: ${rangeStr})`,
      };
    }
    const n = typeof actualValue === 'number' ? actualValue : Number(actualValue);
    if (Number.isNaN(n)) {
      return null;
    }
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      return {
        status: 'noncompliant',
        reason: `${av} is outside the allowed range: ${rangeStr}`,
      };
    }
    return {
      status: 'compliant',
      reason: `${av} is within the allowed range: ${rangeStr}`,
    };
  }

  // pattern — regex.
  if (typeof schema.pattern === 'string') {
    if (actualIsNullish) {
      return {
        status: 'noncompliant',
        reason: `Value is not set on the device (required pattern: ${schema.pattern})`,
      };
    }
    if (typeof actualValue !== 'string') return null;
    try {
      const re = new RegExp(schema.pattern);
      if (re.test(actualValue)) {
        return { status: 'compliant', reason: `${av} matches the required pattern` };
      }
      return {
        status: 'noncompliant',
        reason: `${av} does not match the required pattern "${schema.pattern}"`,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Roll a list of ComplianceResults into counts for the UI summary.
 *
 * `indeterminate` is counted separately from `noncompliant` so the UI can
 * tell "47 truly noncompliant" apart from "44 noncompliant + 3 we couldn't
 * read". Pre-existing callers that only consume `errors` continue to see
 * indeterminate folded in there for backwards compatibility.
 */
export function summarizeCompliance(results: ComplianceResult[]): {
  compliant: number;
  noncompliant: number;
  indeterminate: number;
  errors: number;
} {
  let compliant = 0;
  let noncompliant = 0;
  let indeterminate = 0;
  let errors = 0;
  for (const r of results) {
    if (r.status === 'compliant') compliant++;
    else if (r.status === 'noncompliant') noncompliant++;
    else if (r.status === 'indeterminate') indeterminate++;
    else errors++;
  }
  return { compliant, noncompliant, indeterminate, errors };
}
