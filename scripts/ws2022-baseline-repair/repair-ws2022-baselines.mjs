// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
//
// Repairs the three bundled Windows Server 2022 security baselines so a
// standalone (non-MDM-enrolled) machine can actually read every setting.
//
// WHY
// ---
// The generated WS2022 profiles address 71-73 rules per profile through
// `./Vendor/MSFT/Policy/Result/...` (the Policy CSP). On a standalone box the
// rules that declare `type: array` fail the OMA-DM read with 0x86000011 and
// surface in ConfigForge as "unread". WS2025 had the same defect and was
// repaired in PRs #82/#93 by moving those rules onto dedicated providers.
// WS2022 was left in the old generated form. This script applies the same,
// already reviewed conversion to WS2022.
//
// POLICY
// ------
//  * WS2022 desired values are AUTHORITATIVE. Only the mechanism (provider +
//    addressing) is borrowed from the reviewed WS2025 repair. A value is only
//    ever reshaped to satisfy the destination provider's contract (scalar ->
//    list for UserRightsAssignment, 0/1 -> false/true for AccountPolicy,
//    array -> REG_MULTI_SZ / delimited REG_SZ for Registry), never retargeted.
//  * Conversion preference: Registry > AuditPolicy > UserRightsAssignment >
//    AccountPolicy > keep CSP. The preference is already encoded per OMA-URI
//    in `csp-provider-map.json`; anything absent from that table stays CSP and
//    is reported.
//  * `schema: {}` is NOT turned into an invented assertion. It becomes the
//    WS2025 informational form (`expression: 'true'` plus a template that says
//    so). Any real schema that cannot survive a provider value reshape is
//    downgraded to informational and reported, never silently reinterpreted.
//
// Usage:
//   node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs           # write
//   node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs --check   # verify
//   node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs --report  # print

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const BASELINES = path.join(REPO, 'public', '_baselines');

/**
 * The conversion input is pinned to the full SHA of the last commit that
 * carries the original generated WS2022 profiles, so the repair stays
 * reproducible and `--check` keeps working after the repaired files are
 * committed on top. Full SHA (not an abbreviation, not a branch) so the input
 * cannot drift; reachable from `origin/main`.
 */
export const SOURCE_COMMIT = '173177e9eaa34d0b910b44d0749192859831fd50';

/**
 * Reviewer-supplied live audit of the workgroup-member profile, recorded as
 * evidence for the read-failure claim. NOT a native WS2022 validation: the run
 * was performed against a Windows Server 2025 host, because that is the only
 * platform OSConfig supports the security-baseline scenario on.
 */
export const LIVE_SMOKE = {
  profile: 'ws2022-workgroup-member.osc.yaml',
  host: 'Windows Server 2025 (not Windows Server 2022)',
  oscfgVersion: '1.3.12-preview5',
  shipped: { compliant: 171, readErrors: 29 },
  repaired: { compliant: 200, nonCompliant: 2, readErrors: 0 },
  caveat:
    'Executed on Windows Server 2025 hardware, so it demonstrates that the repaired '
    + 'provider addressing reads on a standalone machine. It is NOT native Windows '
    + 'Server 2022 validation, and the 2 non-compliant results are genuine findings '
    + 'on that host rather than read failures.',
};

const CSP = 'Microsoft.Windows/CSP';
const REGISTRY = 'Microsoft.Windows/Registry';
const URA = 'Microsoft.Windows/UserRightsAssignment';
const ACCOUNT = 'Microsoft.Windows/AccountPolicy';
const TEST = 'Microsoft.OSConfig/Test';
const GROUP = 'Microsoft.OSConfig/Group';

export const PROFILES = [
  'ws2022-domain-member.osc.yaml',
  'ws2022-domain-controller.osc.yaml',
  'ws2022-workgroup-member.osc.yaml',
];

const cspProviderMap = JSON.parse(readFileSync(path.join(HERE, 'csp-provider-map.json'), 'utf8'));
const schemaExpressionMap = JSON.parse(
  readFileSync(path.join(HERE, 'schema-expression-map.json'), 'utf8'),
);

// ── registry contract normalisation ───────────────────────────────────────
// `Microsoft.Windows/Registry` only resolves a hive token when it is followed
// by a colon: `HKEY_LOCAL_MACHINE\...` silently reads back null. The WS2025
// repair normalised every keyPath; do the same here so the manifest is correct
// on its own instead of relying on the audit-path normaliser.
const HIVES = [
  'HKEY_LOCAL_MACHINE', 'HKEY_CURRENT_USER', 'HKEY_CLASSES_ROOT',
  'HKEY_USERS', 'HKEY_CURRENT_CONFIG', 'HKLM', 'HKCU', 'HKCR', 'HKU', 'HKCC',
];

const REG_TYPE_ALIASES = {
  dword: 'REG_DWORD',
  qword: 'REG_QWORD',
  string: 'REG_SZ',
  expandstring: 'REG_EXPAND_SZ',
  multistring: 'REG_MULTI_SZ',
  binary: 'REG_BINARY',
  reg_dword: 'REG_DWORD',
  reg_qword: 'REG_QWORD',
  reg_sz: 'REG_SZ',
  reg_expand_sz: 'REG_EXPAND_SZ',
  reg_multi_sz: 'REG_MULTI_SZ',
  reg_binary: 'REG_BINARY',
};

const REG_INT_TYPES = new Set(['REG_DWORD', 'REG_QWORD']);
const REG_STRING_TYPES = new Set(['REG_SZ', 'REG_EXPAND_SZ', 'REG_BINARY']);

/**
 * WS2022 rules whose declared Registry contract cannot hold their own value
 * (an array parked in a Dword). Each repair is the shape the reviewed WS2025
 * baseline ships for the identical keyPath/valueName, so the desired state is
 * unchanged; only the declared type and the payload shape are corrected.
 */
const REGISTRY_SHAPE_REPAIRS = {
  NetworkProviderHardenedPathsNETLOGON: {
    valueType: 'REG_SZ',
    reshape: (value) => value.map(String).join(', '),
    evidence: 'ws2025-member-server:NetworkProviderHardenedPathsNETLOGON',
  },
  NetworkProviderHardenedPathsSYSVOL: {
    valueType: 'REG_SZ',
    reshape: (value) => value.map(String).join(', '),
    evidence: 'ws2025-member-server:NetworkProviderHardenedPathsSYSVOL',
  },
  RemotelyAccessibleRegistryPaths: {
    valueType: 'REG_MULTI_SZ',
    reshape: (value) => value.map(String),
    evidence: 'ws2025-member-server:RemotelyAccessibleRegistryPaths',
  },
  RemotelyAccessibleRegistryPathsAndSubpaths: {
    valueType: 'REG_MULTI_SZ',
    reshape: (value) => value.map(String),
    evidence: 'ws2025-member-server:RemotelyAccessibleRegistryPathsAndSubpaths',
  },
  SharesThatCanBeAccessedAnonymously: {
    valueType: 'REG_MULTI_SZ',
    reshape: (value) => value.map(String),
    evidence: 'ws2025-member-server:SharesThatCanBeAccessedAnonymously',
  },
};

/**
 * The one composite rule in WS2022: a single DeviceLock CSP node carries three
 * independent account-lockout policies as a delimited string. AccountPolicy
 * addresses them individually, so the rule expands into three. Same expansion
 * and same `_<PolicyName>` suffix convention as the shipped WS2025 baselines.
 */
const LOCKOUT_CSP_PATH = './Vendor/MSFT/Policy/Result/DeviceLock/AccountLockoutPolicy';
const LOCKOUT_POLICIES = [
  ['AccountLockoutDuration', 'LockoutDuration'],
  ['AccountLockoutThreshold', 'LockoutThreshold'],
  ['ResetAccountLockoutCounterAfter', 'LockoutReset'],
];

// ── small helpers ─────────────────────────────────────────────────────────
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const isInteger = (value) => typeof value === 'string' && /^-?\d+$/.test(value.trim());

export function valueKind(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

const schemaKey = (schema, kind) => `${JSON.stringify(canonical(schema))}\u0000${kind}`;

export function normalizeKeyPath(keyPath) {
  const text = String(keyPath ?? '');
  const separator = text.indexOf('\\');
  if (separator < 0) return text;
  const head = text.slice(0, separator);
  if (head.endsWith(':')) return text;
  if (!HIVES.includes(head.toUpperCase())) return text;
  return `${head}:${text.slice(separator)}`;
}

export function normalizeRegistryValueType(valueType) {
  const alias = REG_TYPE_ALIASES[String(valueType ?? '').toLowerCase()];
  return alias ?? String(valueType ?? '');
}

// ── schema -> CEL ─────────────────────────────────────────────────────────
const INFORMATIONAL = {
  expression: 'true',
  template: 'The value {value} is informational for this control.',
};

const literal = (value) => (typeof value === 'string' ? JSON.stringify(value) : String(value));
const list = (values) => `[${values.map(literal).join(',')}]`;

const goldenSchemaTranslations = new Map(
  schemaExpressionMap.entries.map((entry) => [
    schemaKey(entry.schema, entry.valueKind),
    { expression: entry.expression, template: entry.template, evidence: entry.evidence },
  ]),
);

/**
 * Generic translation of the JSON-Schema shapes the generated baselines use.
 * Deliberately narrow: an unrecognised shape throws rather than guessing, so a
 * new shape has to be reviewed instead of silently degrading to `true`.
 */
export function translateSchema(schema, kind) {
  if (schema === undefined || schema === null) return { ...INFORMATIONAL };
  const keys = Object.keys(schema);
  if (keys.length === 0) return { ...INFORMATIONAL };

  if (Array.isArray(schema.oneOf)) {
    const nullable = schema.oneOf.some((branch) => branch?.type === 'null');
    const consts = schema.oneOf
      .filter((branch) => branch && Object.prototype.hasOwnProperty.call(branch, 'const'))
      .map((branch) => branch.const);
    if (nullable && consts.length === 1) {
      return {
        expression: `((((value == ${literal(consts[0])})) || ((value == null))))`,
        template: `The value {value} must be one of ${literal(consts[0])}, (not set).`,
      };
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && keys.length === 1) {
    return {
      expression: `(value == ${literal(schema.const)})`,
      template: `The value {value} must be ${literal(schema.const)}.`,
    };
  }

  if (Array.isArray(schema.enum) && keys.length === 1) {
    return {
      expression: `(${list(schema.enum)}.exists(item, value == item))`,
      template: `The value {value} must be one of ${list(schema.enum)}.`,
    };
  }

  if (typeof schema.pattern === 'string' && keys.length === 1) {
    return {
      expression: `(value != null && value.matches(${JSON.stringify(schema.pattern)}))`,
      template: `The value {value} must match the pattern ${JSON.stringify(schema.pattern)}.`,
    };
  }

  const hasMin = typeof schema.minimum === 'number';
  const hasMax = typeof schema.maximum === 'number';
  if ((hasMin || hasMax) && keys.every((key) => key === 'minimum' || key === 'maximum')) {
    // A string-typed desired value has to be coerced before it can be compared
    // numerically; this is the exact form the reviewed WS2025 repair uses.
    const operand = kind === 'string' ? 'int(value)' : 'value';
    const guard = kind === 'string' ? ' && value.matches("^-?[0-9]+$")' : '';
    const bounds = [];
    if (hasMin) bounds.push(`${operand} >= ${schema.minimum}`);
    if (hasMax) bounds.push(`${operand} <= ${schema.maximum}`);
    let template;
    if (hasMin && hasMax) template = `The value {value} must be between ${schema.minimum} and ${schema.maximum}.`;
    else if (hasMin) template = `The value {value} must be greater than or equal to ${schema.minimum}.`;
    else template = `The value {value} must be less than or equal to ${schema.maximum}.`;
    return { expression: `(value != null${guard} && ${bounds.join(' && ')})`, template };
  }

  throw new Error(`unsupported compliance schema shape: ${JSON.stringify(schema)}`);
}

function compileSchema(schema, kind) {
  const golden = goldenSchemaTranslations.get(schemaKey(schema, kind));
  if (golden) {
    return { expression: golden.expression, template: golden.template, source: 'ws2025-reviewed' };
  }
  return { ...translateSchema(schema, kind), source: 'derived' };
}

/**
 * `Microsoft.Windows/UserRightsAssignment` reads back a list of principals, so
 * the generated scalar schema has to be restated over a list rather than
 * dropped. The only scalar shape the WS2022 profiles use on a user right is
 * "empty string or not set", which is exactly "no principals are assigned":
 *
 *   {"oneOf":[{"const":""},{"type":"null"}]}   ->   value == null || value.size() == 0
 *
 * `size()` on a list is standard CEL and is already exercised against a
 * `UserRightsAssignment` resource in this repo
 * (`packages/core/src/import-export/index.test.ts`, `expression: 'value.size() == 2'`).
 * CEL's `||` short-circuits, so the null branch is evaluated before `size()`
 * is ever applied to a missing value.
 *
 * Returns `null` for any other shape so an unreviewed schema still surfaces as
 * an explicit downgrade instead of being silently reinterpreted.
 */
export function translatePrincipalListSchema(schema, beforeValue, afterList) {
  if (!schema || typeof schema !== 'object') return null;
  if (!Array.isArray(afterList) || afterList.length !== 0) return null;
  if (beforeValue !== '' && beforeValue !== null) return null;

  const keys = Object.keys(schema);
  const isEmptyOrNull = keys.length === 1
    && Array.isArray(schema.oneOf)
    && schema.oneOf.length === 2
    && schema.oneOf.some((branch) => branch?.type === 'null')
    && schema.oneOf.some(
      (branch) => branch
        && Object.prototype.hasOwnProperty.call(branch, 'const')
        && branch.const === '',
    );
  if (!isEmptyOrNull) return null;

  return {
    expression: 'value == null || value.size() == 0',
    template: 'The value {value} must be unassigned (no principals).',
    source: 'principal-list-restatement',
  };
}

/** Re-type schema constants after a provider-mandated value cast (0 -> false). */
function retypeSchema(schema, before, after) {
  if (!schema || typeof schema !== 'object' || before === after) return schema;
  const next = clone(schema);
  const cast = (entry) => {
    if (String(entry) !== String(before)) return entry;
    return after;
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'const')) node.const = cast(node.const);
    if (Array.isArray(node.enum)) node.enum = node.enum.map(cast);
    for (const key of ['oneOf', 'anyOf', 'allOf']) {
      if (Array.isArray(node[key])) node[key].forEach(walk);
    }
  };
  walk(next);
  return next;
}

// ── value reshaping for a destination provider ────────────────────────────
function toUserRightsList(value, ruleName, report) {
  if (Array.isArray(value)) return value.map(String);
  if (value === '' || value === null) {
    report.reshaped.push(`${ruleName}: "" -> [] (UserRightsAssignment takes a list of principals)`);
    return [];
  }
  const parts = String(value).split(',').map((part) => part.trim()).filter(Boolean);
  report.reshaped.push(`${ruleName}: "${value}" -> ${JSON.stringify(parts)} (delimited string -> list)`);
  return parts;
}

function toAccountPolicyValue(value, sampleKind, ruleName, report) {
  if (sampleKind === 'boolean' && typeof value !== 'boolean') {
    const next = value === 1 || value === '1';
    report.reshaped.push(
      `${ruleName}: ${JSON.stringify(value)} -> ${next} (AccountPolicy returns booleans)`,
    );
    return next;
  }
  if (sampleKind === 'number' && isInteger(value)) return Number(String(value).trim());
  return value;
}

function toRegistryValue(value, valueType, ruleName, report) {
  if (value === undefined) return undefined;
  if (valueType === 'REG_MULTI_SZ') {
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
  }
  if (REG_INT_TYPES.has(valueType) && isInteger(value)) {
    report.reshaped.push(`${ruleName}: "${value}" -> ${Number(value)} (${valueType})`);
    return Number(String(value).trim());
  }
  if (REG_STRING_TYPES.has(valueType) && typeof value === 'number') {
    report.reshaped.push(`${ruleName}: ${value} -> "${value}" (${valueType})`);
    return String(value);
  }
  return value;
}

// ── conversion ────────────────────────────────────────────────────────────
const cspTargets = new Map(cspProviderMap.entries.map((entry) => [entry.cspPath, entry]));

function convertCsp(rule, report) {
  const inner = rule.properties.resource;
  const cspPath = String(inner.properties?.path ?? '');
  const hasValue = Object.prototype.hasOwnProperty.call(inner.properties ?? {}, 'value');
  const value = inner.properties?.value;
  const schema = rule.properties.schema;
  const entry = cspTargets.get(cspPath);

  if (!entry) {
    report.residualCsp.push({ name: rule.name, cspPath, reason: 'no reviewed provider mapping' });
    return [rule];
  }

  if (cspPath === LOCKOUT_CSP_PATH) {
    const parts = new Map(
      String(value ?? '')
        .split(',')
        .map((part) => part.split(':').map((token) => token.trim()))
        .filter((pair) => pair.length === 2),
    );
    const produced = [];
    for (const [cspKey, policyName] of LOCKOUT_POLICIES) {
      if (!parts.has(cspKey)) continue;
      const raw = parts.get(cspKey);
      produced.push({
        name: produced.length === 0 ? rule.name : `${rule.name}_${policyName}`,
        type: TEST,
        properties: {
          resource: {
            type: ACCOUNT,
            properties: { name: policyName, value: isInteger(raw) ? Number(raw) : raw },
          },
          ...INFORMATIONAL,
        },
      });
    }
    if (produced.length !== LOCKOUT_POLICIES.length) {
      throw new Error(`${rule.name}: expected ${LOCKOUT_POLICIES.length} lockout policies, got ${produced.length}`);
    }
    report.converted.push({
      name: rule.name, cspPath, to: ACCOUNT, expandedInto: produced.map((r) => r.name),
      evidence: entry.evidence,
    });
    report.expansionExtra += produced.length - 1;
    return produced;
  }

  const properties = clone(entry.target.properties) ?? {};
  let nextValue = value;
  let compiledSchema = schema;
  let restated = null;
  let downgrade = null;

  if (entry.target.type === URA) {
    if (hasValue) {
      const before = valueKind(value);
      nextValue = toUserRightsList(value, rule.name, report);
      if (before !== 'array' && schema && Object.keys(schema).length > 0) {
        restated = translatePrincipalListSchema(schema, value, nextValue);
        if (restated) {
          report.assertionRestatements.push({
            name: rule.name,
            cspPath,
            from: schema,
            to: restated.expression,
            reason:
              'the scalar "empty or not set" schema is restated over the principal list the '
              + 'UserRightsAssignment provider returns',
          });
        } else {
          downgrade = `scalar compliance schema ${JSON.stringify(schema)} does not apply to a principal list`;
          compiledSchema = {};
        }
      }
    }
  } else if (entry.target.type === ACCOUNT) {
    if (hasValue) {
      const before = nextValue;
      nextValue = toAccountPolicyValue(value, valueKind(entry.ws2025Value), rule.name, report);
      compiledSchema = retypeSchema(schema, before, nextValue);
    }
  } else if (entry.target.type === REGISTRY) {
    properties.valueType = normalizeRegistryValueType(properties.valueType);
    properties.keyPath = normalizeKeyPath(properties.keyPath);
    if (hasValue) nextValue = toRegistryValue(value, properties.valueType, rule.name, report);
  } else if (hasValue && typeof value === 'string' && isInteger(value)) {
    nextValue = Number(value.trim());
  }

  if (hasValue) properties.value = nextValue;

  if (downgrade) {
    report.assertionDowngrades.push({ name: rule.name, cspPath, reason: downgrade });
  }
  report.converted.push({
    name: rule.name, cspPath, to: entry.target.type, evidence: entry.evidence,
  });

  const compiled = restated
    ?? compileSchema(compiledSchema, valueKind(hasValue ? nextValue : undefined));
  return [{
    name: rule.name,
    type: TEST,
    properties: {
      resource: { type: entry.target.type, properties },
      expression: compiled.expression,
      template: compiled.template,
    },
  }];
}

function convertRegistry(rule, report) {
  const inner = rule.properties.resource;
  const properties = clone(inner.properties) ?? {};
  const before = properties.keyPath;
  properties.keyPath = normalizeKeyPath(properties.keyPath);
  if (properties.keyPath !== before) report.keyPathNormalized += 1;
  properties.valueType = normalizeRegistryValueType(properties.valueType);

  let schema = rule.properties.schema;
  const hasValue = Object.prototype.hasOwnProperty.call(properties, 'value');

  if (hasValue && Array.isArray(properties.value) && REG_INT_TYPES.has(properties.valueType)) {
    const repair = REGISTRY_SHAPE_REPAIRS[rule.name];
    if (!repair) {
      throw new Error(`${rule.name}: array value declared as ${properties.valueType} with no reviewed repair`);
    }
    report.shapeRepairs.push({
      name: rule.name,
      from: { valueType: properties.valueType, value: properties.value },
      to: { valueType: repair.valueType, value: repair.reshape(properties.value) },
      evidence: repair.evidence,
    });
    properties.value = repair.reshape(properties.value);
    properties.valueType = repair.valueType;
  }

  if (hasValue && !Array.isArray(properties.value)) {
    const coerced = toRegistryValue(properties.value, properties.valueType, rule.name, report);
    if (coerced !== properties.value) {
      schema = retypeSchema(schema, properties.value, coerced);
      properties.value = coerced;
    }
  }

  const compiled = compileSchema(schema, valueKind(hasValue ? properties.value : undefined));
  return [{
    name: rule.name,
    type: TEST,
    properties: {
      resource: { type: REGISTRY, properties },
      expression: compiled.expression,
      template: compiled.template,
    },
  }];
}

function convertOther(rule) {
  const inner = rule.properties.resource;
  const hasValue = Object.prototype.hasOwnProperty.call(inner.properties ?? {}, 'value');
  const compiled = compileSchema(
    rule.properties.schema,
    valueKind(hasValue ? inner.properties.value : undefined),
  );
  return [{
    name: rule.name,
    type: TEST,
    properties: {
      resource: clone(inner),
      expression: compiled.expression,
      template: compiled.template,
    },
  }];
}

function convertList(resources, report) {
  const out = [];
  for (const rule of resources) {
    if (rule?.type === GROUP && Array.isArray(rule.properties?.resources)) {
      out.push({
        ...rule,
        properties: { ...rule.properties, resources: convertList(rule.properties.resources, report) },
      });
      continue;
    }
    if (rule?.type !== TEST || !rule.properties?.resource) {
      throw new Error(`${rule?.name ?? '<unnamed>'}: expected a Microsoft.OSConfig/Test wrapper`);
    }
    report.sourceRules += 1;
    report.sourceRuleNames.push(rule.name);
    const innerProps = rule.properties.resource.properties ?? {};
    if (Object.prototype.hasOwnProperty.call(innerProps, 'value')) {
      report.sourceValues[rule.name] = clone(innerProps.value) ?? innerProps.value;
    }
    const innerType = rule.properties.resource.type;
    if (innerType === CSP) {
      report.sourceCsp += 1;
      out.push(...convertCsp(rule, report));
    } else if (innerType === REGISTRY) {
      out.push(...convertRegistry(rule, report));
    } else {
      out.push(...convertOther(rule));
    }
  }
  return out;
}

export function repairProfile(filename) {
  const source = yaml.load(execFileSync(
    'git',
    ['show', `${SOURCE_COMMIT}:public/_baselines/${filename}`],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ));
  const report = {
    profile: filename,
    sourceRules: 0,
    sourceCsp: 0,
    expansionExtra: 0,
    keyPathNormalized: 0,
    converted: [],
    residualCsp: [],
    assertionDowngrades: [],
    assertionRestatements: [],
    shapeRepairs: [],
    reshaped: [],
    sourceRuleNames: [],
    sourceValues: {},
  };
  const resources = convertList(source.resources ?? [], report);
  report.outputRules = resources.length;
  report.providerCounts = {};
  for (const rule of resources) {
    const type = rule.properties.resource.type;
    report.providerCounts[type] = (report.providerCounts[type] ?? 0) + 1;
  }

  // Every desired value that is not byte-identical to the source, with the
  // provider-contract reason it had to change. Anything outside this list is a
  // regression, and the test suite asserts exactly that.
  const outputByName = new Map(resources.map((rule) => [rule.name, rule]));
  report.valueChanges = [];
  for (const [name, sourceValue] of Object.entries(report.sourceValues)) {
    const produced = outputByName.get(name)?.properties?.resource?.properties;
    const outputValue = produced && Object.prototype.hasOwnProperty.call(produced, 'value')
      ? produced.value
      : undefined;
    if (JSON.stringify(sourceValue) === JSON.stringify(outputValue)) continue;
    report.valueChanges.push({ name, from: sourceValue, to: outputValue });
  }
  report.expansions = report.converted
    .filter((entry) => entry.expandedInto)
    .map((entry) => ({ name: entry.name, into: entry.expandedInto }));
  const reconciled = report.sourceRules + report.expansionExtra === report.outputRules
    && report.converted.length + report.residualCsp.length === report.sourceCsp;
  if (!reconciled) {
    throw new Error(
      `${filename}: rule reconciliation failed `
      + `(source ${report.sourceRules} + expansion ${report.expansionExtra} != output ${report.outputRules})`,
    );
  }
  const text = yaml.dump({ ...source, resources }, {
    indent: 2, lineWidth: 120, noRefs: true, sortKeys: false, quotingType: "'",
  });
  return { text, report };
}

// ── entry point ───────────────────────────────────────────────────────────
function main() {
  const check = process.argv.includes('--check');
  const wantReport = process.argv.includes('--report');
  // `--check` verifies and `--report` prints; only a bare invocation writes.
  const write = !check && !wantReport;
  const reports = [];
  let drift = 0;
  // `* text=auto` + core.autocrlf checks the YAML out with CRLF on Windows, so
  // --check compares content, not line endings.
  const sameContent = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

  for (const filename of PROFILES) {
    const { text, report } = repairProfile(filename);
    reports.push(report);
    const dest = path.join(BASELINES, filename);
    if (check) {
      if (!sameContent(readFileSync(dest, 'utf8'), text)) {
        drift += 1;
        console.error(`DRIFT: ${filename} does not match the deterministic repair output`);
      } else {
        console.log(`ok: ${filename}`);
      }
      continue;
    }
    if (!write) continue;
    writeFileSync(dest, text, 'utf8');
    console.log(`wrote: ${filename}`);
  }

  const conversionReport = `${JSON.stringify({
    _provenance: {
      description:
        'Per-profile provenance for the WS2022 Policy CSP repair. Committed so the '
        + 'shipped baselines can be validated without git history (CI checks out shallow).',
      sourceCommit: SOURCE_COMMIT,
      source: `${SOURCE_COMMIT}:public/_baselines/ws2022-*.osc.yaml`,
      regenerate: 'node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs',
      verify: 'node scripts/ws2022-baseline-repair/repair-ws2022-baselines.mjs --check',
      liveSmoke: LIVE_SMOKE,
    },
    profiles: reports.map((report) => ({
      profile: report.profile,
      sourceRules: report.sourceRules,
      outputRules: report.outputRules,
      sourceCsp: report.sourceCsp,
      convertedCsp: report.converted.length,
      residualCsp: report.residualCsp,
      keyPathNormalized: report.keyPathNormalized,
      providerCounts: report.providerCounts,
      expansions: report.expansions,
      registryShapeRepairs: report.shapeRepairs,
      assertionRestatements: report.assertionRestatements,
      assertionDowngrades: report.assertionDowngrades,
      valueChanges: report.valueChanges,
      conversions: report.converted.map(({ name, cspPath, to, evidence }) => ({
        name, cspPath, to, evidence,
      })),
      sourceRuleNames: report.sourceRuleNames,
      sourceValues: report.sourceValues,
    })),
  }, null, 2)}\n`;
  const reportPath = path.join(HERE, 'conversion-report.json');
  if (check) {
    if (!sameContent(readFileSync(reportPath, 'utf8'), conversionReport)) {
      drift += 1;
      console.error('DRIFT: conversion-report.json does not match the deterministic repair output');
    } else {
      console.log('ok: conversion-report.json');
    }
  } else if (write) {
    writeFileSync(reportPath, conversionReport, 'utf8');
    console.log('wrote: conversion-report.json');
  }

  if (wantReport) console.log('--report is read-only: nothing was written.');

  for (const report of reports) {
    console.log('');
    console.log(`${report.profile}: ${report.sourceRules} -> ${report.outputRules} rules`);
    console.log(`  CSP in source         : ${report.sourceCsp}`);
    console.log(`  converted             : ${report.converted.length}`);
    console.log(`  residual CSP          : ${report.residualCsp.length}`);
    console.log(`  keyPath normalised    : ${report.keyPathNormalized}`);
    console.log(`  registry shape repair : ${report.shapeRepairs.length}`);
    console.log(`  assertion restatements: ${report.assertionRestatements.length}`);
    console.log(`  assertion downgrades  : ${report.assertionDowngrades.length}`);
    console.log(`  providers             : ${JSON.stringify(report.providerCounts)}`);
    if (wantReport) {
      for (const item of report.residualCsp) console.log(`   residual: ${item.name} (${item.cspPath})`);
      for (const item of report.assertionRestatements) console.log(`   restated: ${item.name} -> ${item.to}`);
      for (const item of report.assertionDowngrades) console.log(`   downgraded: ${item.name} — ${item.reason}`);
      for (const line of report.reshaped) console.log(`   reshaped: ${line}`);
    }
  }

  if (check && drift) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
