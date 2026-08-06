// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
  LOSSLESS_MANIFEST_SCHEMA,
  dumpLosslessYaml,
  parseLosslessJson as parseSharedLosslessJson,
  parseLosslessYaml,
  stringifyLosslessJson as stringifySharedLosslessJson,
} from "@configforge/core/manifest/lossless";

export { LOSSLESS_MANIFEST_SCHEMA };

const GROUP_RESOURCE_TYPE = "Microsoft.OSConfig/Group";
const TEST_RESOURCE_TYPE = "Microsoft.OSConfig/Test";
const MAX_RESOURCE_DEPTH = 50;
const MAX_VISUAL_SCHEMA_DEPTH = 32;
const MAX_VISUAL_SCHEMA_NODES = 256;
const MAX_VISUAL_SCHEMA_ROWS = 128;

/** Internal column key used for the required, non-property setting-name column. */
export const SETTING_NAME_COLUMN = "$setting-name";
/** Internal column key used when at least one row declares a desired state. */
export const DESIRED_VALUE_COLUMN = "$desired-value";

export type VisualSortDirection = "ascending" | "descending";

export interface VisualSortState {
  column: string;
  direction: VisualSortDirection;
}

export interface VisualSetting {
  id: string;
  settingName: string;
  resourceType: string;
  properties: Record<string, unknown>;
  desiredValue?: unknown;
  validationSchema?: unknown;
  sourceOrder: number;
  location: VisualSettingLocation;
  hasExplicitName: boolean;
}

export interface VisualSettingGroup {
  resourceType: string;
  columns: string[];
  settings: VisualSetting[];
}

export type VisualResourcePathSegment = number | "resource";
export type VisualResourcePath = VisualResourcePathSegment[];

export interface VisualValueBinding {
  resourcePath: VisualResourcePath;
  root: "resource" | "properties";
  path: Array<string | number>;
  displayWrapper?: string;
}

export interface VisualSettingLocation {
  resourcePath: VisualResourcePath;
  namePath: VisualResourcePath;
  removePath: VisualResourcePath;
  desiredBinding?: VisualValueBinding;
}

export interface VisualResourceTemplate {
  type: string;
  platform: "windows" | "linux" | "cross-platform";
  descriptionKey: string;
  properties: Record<string, unknown>;
  requiredProperties: string[];
}

export const VISUAL_RESOURCE_TEMPLATES: readonly VisualResourceTemplate[] = [
  {
    type: "Microsoft.Windows/Registry",
    platform: "windows",
    descriptionKey: "visual.addSettingsPane.descriptions.registry",
    properties: { keyPath: "", valueName: "", valueType: "String", value: "" },
    requiredProperties: ["keyPath", "valueName", "valueType"],
  },
  {
    type: "Microsoft.Windows/CSP",
    platform: "windows",
    descriptionKey: "visual.addSettingsPane.descriptions.csp",
    properties: { path: "", type: "string", value: "" },
    requiredProperties: ["path", "type"],
  },
  {
    type: "Microsoft.Windows/AccountPolicy",
    platform: "windows",
    descriptionKey: "visual.addSettingsPane.descriptions.accountPolicy",
    properties: { name: "", value: 0 },
    requiredProperties: ["name"],
  },
  {
    type: "Microsoft.Windows/AuditPolicy",
    platform: "windows",
    descriptionKey: "visual.addSettingsPane.descriptions.auditPolicy",
    properties: { subcategory: "", value: 0 },
    requiredProperties: ["subcategory"],
  },
  {
    type: "Microsoft.Windows/UserRightsAssignment",
    platform: "windows",
    descriptionKey: "visual.addSettingsPane.descriptions.userRights",
    properties: { name: "", value: [] },
    requiredProperties: ["name"],
  },
  {
    type: "Linux/FilePermission",
    platform: "linux",
    descriptionKey: "visual.addSettingsPane.descriptions.filePermission",
    properties: { path: "", owner: "", group: "", mode: "" },
    requiredProperties: ["path"],
  },
  {
    type: "Linux/KernelModule",
    platform: "linux",
    descriptionKey: "visual.addSettingsPane.descriptions.kernelModule",
    properties: { name: "", loaded: false },
    requiredProperties: ["name"],
  },
  {
    type: "Linux/User",
    platform: "linux",
    descriptionKey: "visual.addSettingsPane.descriptions.linuxUser",
    properties: { name: "" },
    requiredProperties: ["name"],
  },
  {
    type: "Microsoft.OSConfig/File",
    platform: "cross-platform",
    descriptionKey: "visual.addSettingsPane.descriptions.file",
    properties: { path: "", content: "", exists: true },
    requiredProperties: ["path"],
  },
  {
    type: "Microsoft.OSConfig/FileLine",
    platform: "cross-platform",
    descriptionKey: "visual.addSettingsPane.descriptions.fileLine",
    properties: { path: "", find: "", replace: "", append: true, ignoreCase: false },
    requiredProperties: ["path", "find"],
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, lower: string, upper: string): string {
  const value = record[lower] ?? record[upper];
  return typeof value === "string" ? value : "";
}

function readProperties(resource: Record<string, unknown>): Record<string, unknown> {
  return asRecord(resource.properties ?? resource.Properties) ?? {};
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

interface DesiredValue {
  present: boolean;
  value?: unknown;
  binding?: VisualValueBinding;
}

const NO_DESIRED_VALUE: DesiredValue = { present: false };

function presentDesiredValue(value: unknown, binding?: VisualValueBinding): DesiredValue {
  return { present: true, value, ...(binding ? { binding } : {}) };
}

function unwrapTypedValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const keys = Object.keys(record);
  return keys.length === 1 ? record[keys[0]] : value;
}

function boundDesiredValue(value: unknown, binding: VisualValueBinding): DesiredValue {
  const record = asRecord(value);
  const keys = record ? Object.keys(record) : [];
  if (record && keys.length === 1) {
    return presentDesiredValue(record[keys[0]], {
      ...binding,
      path: [...binding.path, keys[0]],
    });
  }
  return presentDesiredValue(unwrapTypedValue(value), binding);
}

function existingKey(record: Record<string, unknown>, lower: string, upper: string): string {
  if (hasOwn(record, lower)) return lower;
  if (hasOwn(record, upper)) return upper;
  return lower;
}

function readComplianceDesired(
  resource: Record<string, unknown>,
  resourcePath: VisualResourcePath,
): DesiredValue {
  const complianceKey = existingKey(resource, "compliance", "Compliance");
  const compliance = asRecord(resource[complianceKey]);
  if (!compliance) return NO_DESIRED_VALUE;

  for (const key of ["equals", "Equals"]) {
    if (hasOwn(compliance, key)) {
      return presentDesiredValue(compliance[key], {
        resourcePath,
        root: "resource",
        path: [complianceKey, key],
      });
    }
  }
  for (const key of ["contains", "matches", "regex"] as const) {
    if (hasOwn(compliance, key)) {
      return presentDesiredValue(
        { [key]: compliance[key] },
        {
          resourcePath,
          root: "resource",
          path: [complianceKey, key],
          displayWrapper: key,
        },
      );
    }
  }
  return NO_DESIRED_VALUE;
}

function readResourceDesired(
  resource: Record<string, unknown>,
  properties: Record<string, unknown>,
  resourcePath: VisualResourcePath,
): DesiredValue {
  const compliance = readComplianceDesired(resource, resourcePath);
  if (compliance.present) return compliance;

  for (const key of ["value", "Value"]) {
    if (hasOwn(resource, key)) {
      return boundDesiredValue(resource[key], {
        resourcePath,
        root: "resource",
        path: [key],
      });
    }
  }
  for (const key of ["value", "data", "desired", "Value", "expectedValue", "desiredValue"]) {
    if (hasOwn(properties, key)) {
      return boundDesiredValue(properties[key], {
        resourcePath,
        root: "properties",
        path: [key],
      });
    }
  }
  return NO_DESIRED_VALUE;
}

function isNullSchemaBranch(value: unknown): boolean {
  const branch = asRecord(value);
  return branch !== null && branch.type === "null";
}

/**
 * Prefer a scalar from common Test schema shapes. Complex constraints are
 * retained for readable JSON display instead of being silently discarded.
 */
function readSchemaDesired(
  schema: unknown,
  binding: VisualValueBinding,
  activeSchemas = new WeakSet<object>(),
  depth = 0,
): DesiredValue {
  if (schema === undefined) return NO_DESIRED_VALUE;
  const record = asRecord(schema);
  if (!record) return presentDesiredValue(schema, binding);
  if (Object.keys(record).length === 0) return NO_DESIRED_VALUE;
  if (depth > MAX_VISUAL_SCHEMA_DEPTH || activeSchemas.has(record)) {
    return presentDesiredValue({ ...record }, binding);
  }

  activeSchemas.add(record);
  try {
    for (const key of ["const", "equals"] as const) {
      if (hasOwn(record, key)) {
        return presentDesiredValue(record[key], {
          ...binding,
          path: [...binding.path, key],
        });
      }
    }

    if (Array.isArray(record.enum) && record.enum.length === 1) {
      return presentDesiredValue(record.enum[0], {
        ...binding,
        path: [...binding.path, "enum", 0],
      });
    }

    if (Array.isArray(record.oneOf)) {
      const nonNullBranches = record.oneOf
        .map((branch, index) => ({ branch, index }))
        .filter(({ branch }) => !isNullSchemaBranch(branch));
      if (nonNullBranches.length === 1) {
        const [{ branch, index }] = nonNullBranches;
        const concise = readSchemaDesired(
          branch,
          {
            ...binding,
            path: [...binding.path, "oneOf", index],
          },
          activeSchemas,
          depth + 1,
        );
        if (concise.present) return concise;
      }
    }

    return presentDesiredValue({ ...record }, binding);
  } finally {
    activeSchemas.delete(record);
  }
}

export interface VisualSchemaConstraintRow {
  keyword: string;
  values: unknown[];
  enforced?: false;
}

interface VisualSchemaTraversalBudget {
  remaining: number;
}

const VISUAL_SCHEMA_KEYWORDS = [
  "type",
  "const",
  "equals",
  "enum",
  "minimum",
  "maximum",
  "pattern",
] as const;

function appendVisualSchemaConstraintRows(
  schema: unknown,
  rows: VisualSchemaConstraintRow[],
  prefix = "",
  activeSchemas = new WeakSet<object>(),
  visitedSchemas = new WeakSet<object>(),
  budget: VisualSchemaTraversalBudget = { remaining: MAX_VISUAL_SCHEMA_NODES },
  depth = 0,
): void {
  const record = asRecord(schema);
  if (
    !record ||
    rows.length >= MAX_VISUAL_SCHEMA_ROWS ||
    budget.remaining <= 0 ||
    depth > MAX_VISUAL_SCHEMA_DEPTH ||
    activeSchemas.has(record) ||
    visitedSchemas.has(record)
  ) {
    return;
  }

  activeSchemas.add(record);
  visitedSchemas.add(record);
  budget.remaining -= 1;
  try {
    for (const keyword of VISUAL_SCHEMA_KEYWORDS) {
      if (rows.length >= MAX_VISUAL_SCHEMA_ROWS) break;
      if (!hasOwn(record, keyword)) continue;
      const value = record[keyword];
      const enforced =
        keyword !== "pattern" ||
        (typeof value === "string" && compileVisualSchemaPattern(value) !== null);
      rows.push({
        keyword: `${prefix}${keyword}`,
        values:
          (keyword === "enum" || keyword === "type") && Array.isArray(value) ? value : [value],
        ...(enforced ? {} : { enforced: false }),
      });
    }

    for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
      if (rows.length >= MAX_VISUAL_SCHEMA_ROWS) break;
      const branches = record[keyword];
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) {
        if (rows.length >= MAX_VISUAL_SCHEMA_ROWS) break;
        const branchRecord = asRecord(branch);
        const repeatedAlias =
          branchRecord !== null &&
          visitedSchemas.has(branchRecord) &&
          !activeSchemas.has(branchRecord);
        const before = rows.length;
        appendVisualSchemaConstraintRows(
          branch,
          rows,
          `${prefix}${keyword}.`,
          activeSchemas,
          visitedSchemas,
          budget,
          depth + 1,
        );
        if (rows.length === before && rows.length < MAX_VISUAL_SCHEMA_ROWS) {
          rows.push({
            keyword: `${prefix}${keyword}`,
            values: [branch],
            ...(repeatedAlias ? {} : { enforced: false }),
          });
        }
      }
    }
  } finally {
    activeSchemas.delete(record);
  }
}

export function visualSchemaConstraintRows(schema: unknown): VisualSchemaConstraintRow[] {
  const rows: VisualSchemaConstraintRow[] = [];
  appendVisualSchemaConstraintRows(schema, rows);
  return rows;
}

function visualSchemaTypeMatches(value: unknown, expected: unknown): boolean | null {
  if (Array.isArray(expected)) {
    let unsupported = false;
    for (const candidate of expected) {
      const matches = visualSchemaTypeMatches(value, candidate);
      if (matches === true) return true;
      if (matches === null) unsupported = true;
    }
    return unsupported ? null : false;
  }
  switch (expected) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "bigint" || (typeof value === "number" && Number.isInteger(value));
    case "number":
      return typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
    case "object":
      return asRecord(value) !== null;
    default:
      return null;
  }
}

function compareVisualSchemaNumbers(left: unknown, right: unknown): number | null {
  if (typeof left === "bigint" && typeof right === "bigint") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof left === "number" && typeof right === "number") {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof left === "bigint" && typeof right === "number" && Number.isSafeInteger(right)) {
    const comparable = BigInt(right);
    return left === comparable ? 0 : left < comparable ? -1 : 1;
  }
  if (typeof left === "number" && Number.isSafeInteger(left) && typeof right === "bigint") {
    const comparable = BigInt(left);
    return comparable === right ? 0 : comparable < right ? -1 : 1;
  }
  return null;
}

function visualSchemaValuesEqual(
  left: unknown,
  right: unknown,
  seenPairs = new WeakMap<object, WeakSet<object>>(),
  depth = 0,
): boolean {
  const numericComparison = compareVisualSchemaNumbers(left, right);
  if (numericComparison !== null) return numericComparison === 0;
  if (Object.is(left, right)) return true;
  if (depth > MAX_VISUAL_SCHEMA_DEPTH) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    const seenRight = seenPairs.get(left);
    if (seenRight?.has(right)) return true;
    const nextSeenRight = seenRight ?? new WeakSet<object>();
    nextSeenRight.add(right);
    seenPairs.set(left, nextSeenRight);
    return left.every((value, index) =>
      visualSchemaValuesEqual(value, right[index], seenPairs, depth + 1),
    );
  }

  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) return false;
  const seenRight = seenPairs.get(leftRecord);
  if (seenRight?.has(rightRecord)) return true;
  const nextSeenRight = seenRight ?? new WeakSet<object>();
  nextSeenRight.add(rightRecord);
  seenPairs.set(leftRecord, nextSeenRight);
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        visualSchemaValuesEqual(
          leftRecord[key],
          rightRecord[rightKeys[index]],
          seenPairs,
          depth + 1,
        ),
    )
  );
}

type VisualSchemaEvaluation = "match" | "mismatch" | "unsupported";

const VISUAL_SCHEMA_ANNOTATION_KEYWORDS = new Set([
  "$comment",
  "$defs",
  "$id",
  "$schema",
  "default",
  "definitions",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);

const VISUAL_SCHEMA_SUPPORTED_KEYWORDS = new Set([
  ...VISUAL_SCHEMA_KEYWORDS,
  "allOf",
  "anyOf",
  "oneOf",
]);

function isSafeVisualSchemaPattern(pattern: string): boolean {
  if (pattern.length > 256) return false;
  let escaped = false;
  let inCharacterClass = false;
  let quantifiers = 0;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]") {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;
    if (character === "(" || character === ")") return false;
    if (character === "*" || character === "+" || character === "?") {
      quantifiers += 1;
    }
    if (quantifiers > 1 || character === "{") return false;
  }
  return true;
}

function compileVisualSchemaPattern(pattern: string): RegExp | null {
  if (!isSafeVisualSchemaPattern(pattern)) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

interface VisualSchemaEvaluationContext {
  activeSchemas: WeakSet<object>;
  memo: WeakMap<object, VisualSchemaEvaluation>;
  budget: VisualSchemaTraversalBudget;
}

function evaluateVisualSchemaRecord(
  value: unknown,
  record: Record<string, unknown>,
  context: VisualSchemaEvaluationContext,
  depth: number,
): VisualSchemaEvaluation {
  let unsupported = Object.keys(record).some(
    (keyword) =>
      !VISUAL_SCHEMA_SUPPORTED_KEYWORDS.has(keyword) &&
      !VISUAL_SCHEMA_ANNOTATION_KEYWORDS.has(keyword),
  );

  if (hasOwn(record, "const") && !visualSchemaValuesEqual(value, record.const)) {
    return "mismatch";
  }
  if (hasOwn(record, "equals") && !visualSchemaValuesEqual(value, record.equals)) {
    return "mismatch";
  }
  if (hasOwn(record, "enum")) {
    if (!Array.isArray(record.enum)) unsupported = true;
    else if (!record.enum.some((candidate) => visualSchemaValuesEqual(value, candidate))) {
      return "mismatch";
    }
  }
  if (hasOwn(record, "type")) {
    const typeMatches = visualSchemaTypeMatches(value, record.type);
    if (typeMatches === false) return "mismatch";
    if (typeMatches === null) unsupported = true;
  }

  if (hasOwn(record, "minimum")) {
    if (
      (typeof record.minimum !== "number" || !Number.isFinite(record.minimum)) &&
      typeof record.minimum !== "bigint"
    ) {
      unsupported = true;
    } else {
      const minimumComparison = compareVisualSchemaNumbers(value, record.minimum);
      if (minimumComparison !== null && minimumComparison < 0) return "mismatch";
    }
  }
  if (hasOwn(record, "maximum")) {
    if (
      (typeof record.maximum !== "number" || !Number.isFinite(record.maximum)) &&
      typeof record.maximum !== "bigint"
    ) {
      unsupported = true;
    } else {
      const maximumComparison = compareVisualSchemaNumbers(value, record.maximum);
      if (maximumComparison !== null && maximumComparison > 0) return "mismatch";
    }
  }

  if (hasOwn(record, "pattern")) {
    if (typeof record.pattern !== "string") unsupported = true;
    else if (typeof value === "string") {
      const pattern = compileVisualSchemaPattern(record.pattern);
      if (!pattern) unsupported = true;
      else if (!pattern.test(value)) return "mismatch";
    }
  }

  if (hasOwn(record, "oneOf") && !Array.isArray(record.oneOf)) unsupported = true;
  else if (Array.isArray(record.oneOf)) {
    let matchingBranches = 0;
    let unsupportedBranch = false;
    for (const branch of record.oneOf) {
      const result = evaluateVisualSchema(value, branch, context, depth + 1);
      if (result === "match") matchingBranches += 1;
      if (result === "unsupported") unsupportedBranch = true;
    }
    if (matchingBranches > 1) return "mismatch";
    if (unsupportedBranch) unsupported = true;
    else if (matchingBranches !== 1) return "mismatch";
  }

  if (hasOwn(record, "anyOf") && !Array.isArray(record.anyOf)) unsupported = true;
  else if (Array.isArray(record.anyOf)) {
    const results = record.anyOf.map((branch) =>
      evaluateVisualSchema(value, branch, context, depth + 1),
    );
    if (!results.includes("match")) {
      if (results.includes("unsupported")) unsupported = true;
      else return "mismatch";
    }
  }

  if (hasOwn(record, "allOf") && !Array.isArray(record.allOf)) unsupported = true;
  else if (Array.isArray(record.allOf)) {
    for (const branch of record.allOf) {
      const result = evaluateVisualSchema(value, branch, context, depth + 1);
      if (result === "mismatch") return "mismatch";
      if (result === "unsupported") unsupported = true;
    }
  }

  return unsupported ? "unsupported" : "match";
}

function evaluateVisualSchema(
  value: unknown,
  schema: unknown,
  context: VisualSchemaEvaluationContext = {
    activeSchemas: new WeakSet<object>(),
    memo: new WeakMap<object, VisualSchemaEvaluation>(),
    budget: { remaining: MAX_VISUAL_SCHEMA_NODES },
  },
  depth = 0,
): VisualSchemaEvaluation {
  if (schema === true) return "match";
  if (schema === false) return "mismatch";
  const record = asRecord(schema);
  if (!record) return "unsupported";
  if (Object.keys(record).length === 0) return "match";
  const cached = context.memo.get(record);
  if (cached) return cached;
  if (
    context.budget.remaining <= 0 ||
    depth > MAX_VISUAL_SCHEMA_DEPTH ||
    context.activeSchemas.has(record)
  ) {
    return "unsupported";
  }

  context.activeSchemas.add(record);
  context.budget.remaining -= 1;
  let result: VisualSchemaEvaluation;
  try {
    result = evaluateVisualSchemaRecord(value, record, context, depth);
  } finally {
    context.activeSchemas.delete(record);
  }
  context.memo.set(record, result);
  return result;
}

export function visualValueSatisfiesSchema(value: unknown, schema: unknown): boolean {
  return evaluateVisualSchema(value, schema) !== "mismatch";
}

function readResources(document: unknown): unknown[] {
  if (Array.isArray(document)) return document;
  const record = asRecord(document);
  if (!record) return [];
  const resources = record.resources ?? record.Resources;
  return Array.isArray(resources) ? resources : [];
}

/**
 * Flatten displayable manifest settings without changing the parsed document.
 * Group containers are structural and omitted. Test containers contribute their
 * outer setting name while their inner resource supplies the type and properties.
 */
export function flattenVisualSettings(document: unknown): VisualSetting[] {
  const flattened: VisualSetting[] = [];
  const activePath = new WeakSet<object>();

  interface NameOverride {
    value: string;
    resourcePath: VisualResourcePath;
    explicit: boolean;
  }

  const walk = (
    candidate: unknown,
    path: VisualResourcePath,
    nameOverride: NameOverride | undefined,
    fallbackName: string | undefined,
    desiredOverride: DesiredValue,
    validationSchema: unknown | undefined,
    removePath: VisualResourcePath,
    depth: number,
  ): void => {
    if (depth > MAX_RESOURCE_DEPTH) return;
    const resource = asRecord(candidate);
    if (!resource || activePath.has(resource)) return;

    activePath.add(resource);
    try {
      const resourceType = readString(resource, "type", "Type").trim();
      if (!resourceType) return;

      const settingName = readString(resource, "name", "Name");
      const properties = readProperties(resource);

      if (resourceType === GROUP_RESOURCE_TYPE) {
        const children = properties.resources ?? properties.Resources;
        if (!Array.isArray(children)) return;
        const groupName =
          (nameOverride?.value ?? settingName).trim() ||
          fallbackName ||
          `Group ${path
            .filter((segment): segment is number => typeof segment === "number")
            .map((index) => index + 1)
            .join(".")}`;
        children.forEach((child, index) => {
          const childRecord = asRecord(child);
          const childType = childRecord ? readString(childRecord, "type", "Type").trim() : "";
          const slash = childType.lastIndexOf("/");
          const childTypeName =
            slash >= 0 && slash < childType.length - 1 ? childType.slice(slash + 1) : childType;
          const childFallback = `${groupName} — ${childTypeName || "Setting"} ${index + 1}`;
          const childPath: VisualResourcePath = [...path, index];
          walk(
            child,
            childPath,
            undefined,
            childFallback,
            desiredOverride,
            validationSchema,
            childPath,
            depth + 1,
          );
        });
        return;
      }

      if (resourceType === TEST_RESOURCE_TYPE) {
        const innerResource = properties.resource ?? properties.Resource;
        if (!asRecord(innerResource)) return;
        const wrapperCompliance = readComplianceDesired(resource, path);
        const schemaKey = existingKey(properties, "schema", "Schema");
        const rawWrapperSchema = properties[schemaKey];
        const wrapperSchema = readSchemaDesired(rawWrapperSchema, {
          resourcePath: path,
          root: "properties",
          path: [schemaKey],
        });
        const wrapperDesired = wrapperCompliance.present
          ? wrapperCompliance
          : wrapperSchema.present
            ? wrapperSchema
            : desiredOverride;
        const wrapperSchemaRecord = asRecord(rawWrapperSchema);
        const nextValidationSchema =
          wrapperSchemaRecord && Object.keys(wrapperSchemaRecord).length > 0
            ? rawWrapperSchema
            : validationSchema;
        const wrapperName: NameOverride = nameOverride ?? {
          value: settingName.trim() || fallbackName || "",
          resourcePath: path,
          explicit: settingName.trim().length > 0,
        };
        walk(
          innerResource,
          [...path, "resource"],
          wrapperName,
          fallbackName,
          wrapperDesired,
          nextValidationSchema,
          removePath,
          depth + 1,
        );
        return;
      }

      const desiredValue = desiredOverride.present
        ? desiredOverride
        : readResourceDesired(resource, properties, path);
      flattened.push({
        id: path.map((segment) => (segment === "resource" ? "$resource" : segment)).join("."),
        settingName: (nameOverride?.value ?? settingName).trim() || fallbackName || "",
        resourceType,
        properties: { ...properties },
        ...(desiredValue.present ? { desiredValue: desiredValue.value } : {}),
        ...(validationSchema !== undefined ? { validationSchema } : {}),
        sourceOrder: flattened.length,
        hasExplicitName: nameOverride?.explicit ?? settingName.trim().length > 0,
        location: {
          resourcePath: [...path],
          namePath: [...(nameOverride?.resourcePath ?? path)],
          removePath: [...removePath],
          ...(desiredValue.binding ? { desiredBinding: desiredValue.binding } : {}),
        },
      });
    } finally {
      activePath.delete(resource);
    }
  };

  readResources(document).forEach((resource, index) => {
    walk(resource, [index], undefined, undefined, NO_DESIRED_VALUE, undefined, [index], 0);
  });

  return flattened;
}

export function unionVisualColumns(settings: readonly VisualSetting[]): string[] {
  const seen = new Set<string>([SETTING_NAME_COLUMN, DESIRED_VALUE_COLUMN]);
  const columns = [SETTING_NAME_COLUMN];
  if (
    settings.some((setting) =>
      hasOwn(setting as unknown as Record<string, unknown>, "desiredValue"),
    )
  ) {
    columns.push(DESIRED_VALUE_COLUMN);
  }
  for (const setting of settings) {
    for (const key of Object.keys(setting.properties)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

/** Group settings by effective resource type in first-seen manifest order. */
export function groupVisualSettings(document: unknown): VisualSettingGroup[] {
  const grouped = new Map<string, VisualSetting[]>();
  for (const setting of flattenVisualSettings(document)) {
    const settings = grouped.get(setting.resourceType);
    if (settings) settings.push(setting);
    else grouped.set(setting.resourceType, [setting]);
  }

  return Array.from(grouped, ([resourceType, settings]) => ({
    resourceType,
    settings,
    columns: unionVisualColumns(settings),
  }));
}

/** Format the entire cell value for visible and accessible display. */
export function formatVisualValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === undefined) return "";

  if (typeof value === "object") {
    try {
      const formatted = stringifyLosslessJson(value, 2);
      if (formatted !== undefined) return formatted;
    } catch {
      // Fall through to a safe string representation for unusual values.
    }
  }

  return String(value);
}

export function nextVisualSort(
  current: VisualSortState | null,
  column: string,
): VisualSortState | null {
  if (!current || current.column !== column) {
    return { column, direction: "ascending" };
  }
  if (current.direction === "ascending") {
    return { column, direction: "descending" };
  }
  return null;
}

function valueForColumn(setting: VisualSetting, column: string): unknown {
  if (column === SETTING_NAME_COLUMN) return setting.settingName;
  if (column === DESIRED_VALUE_COLUMN) return setting.desiredValue;
  return setting.properties[column];
}

function visualValueTypeRank(value: unknown): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "bigint") return 3;
  if (typeof value === "string") return 4;
  if (Array.isArray(value)) return 5;
  if (typeof value === "object") return 6;
  if (value === undefined) return 7;
  if (typeof value === "symbol") return 8;
  return 9;
}

/**
 * Compare visual cell values with a fixed cross-type precedence. Never mix a
 * numeric comparison on one pair with a lexical comparison on another pair:
 * Array.sort requires a transitive comparator for deterministic results.
 */
export function compareVisualValues(left: unknown, right: unknown): number {
  const leftRank = visualValueTypeRank(left);
  const rightRank = visualValueTypeRank(right);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;

  if (typeof left === "number" && typeof right === "number") {
    const leftNaN = Number.isNaN(left);
    const rightNaN = Number.isNaN(right);
    if (leftNaN || rightNaN) {
      if (leftNaN && rightNaN) return 0;
      return leftNaN ? 1 : -1;
    }
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return left === right ? 0 : left ? 1 : -1;
  }
  if (typeof left === "bigint" && typeof right === "bigint") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (left === null && right === null) return 0;
  if (left === undefined && right === undefined) return 0;

  const leftText = formatVisualValue(left);
  const rightText = formatVisualValue(right);
  const leftFolded = leftText.toLowerCase();
  const rightFolded = rightText.toLowerCase();
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

/** Return a deterministic stable sort; null restores source manifest order. */
export function sortVisualSettings(
  settings: readonly VisualSetting[],
  sort: VisualSortState | null,
): VisualSetting[] {
  if (!sort) {
    return [...settings].sort((left, right) => left.sourceOrder - right.sourceOrder);
  }

  return settings
    .map((setting, index) => ({ setting, index }))
    .sort((left, right) => {
      const leftValue = valueForColumn(left.setting, sort.column);
      const rightValue = valueForColumn(right.setting, sort.column);
      const leftMissing = leftValue === undefined;
      const rightMissing = rightValue === undefined;
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return left.index - right.index;
        return leftMissing ? 1 : -1;
      }

      const compared = compareVisualValues(leftValue, rightValue);
      if (compared === 0) return left.index - right.index;
      return sort.direction === "ascending" ? compared : -compared;
    })
    .map(({ setting }) => setting);
}

export function parseVisualManifest(source: string): unknown {
  return parseLosslessYaml(source);
}

export function stringifyLosslessJson(value: unknown, space = 2): string | undefined {
  return stringifySharedLosslessJson(value, space);
}

export function parseLosslessJson(source: string): unknown {
  return parseSharedLosslessJson(source);
}

export function dumpVisualManifest(document: unknown): string {
  return dumpLosslessYaml(document, {
    indent: 2,
    lineWidth: 120,
    noRefs: false,
    sortKeys: false,
  });
}

export function visualResourceTemplatesForPlatform(
  platform: "windows" | "linux" | undefined,
): VisualResourceTemplate[] {
  if (!platform) return [...VISUAL_RESOURCE_TEMPLATES];
  return VISUAL_RESOURCE_TEMPLATES.filter(
    (template) => template.platform === platform || template.platform === "cross-platform",
  );
}

export interface VisualValidationIssue {
  settingId: string;
  column: string;
}

function isMissingRequiredValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

export function validateVisualSettings(
  settings: readonly VisualSetting[],
): VisualValidationIssue[] {
  const issues: VisualValidationIssue[] = [];
  for (const setting of settings) {
    // Top-level settings require a real source name. Nested Group children in
    // shipped baselines may intentionally rely on deterministic display names.
    if (setting.location.removePath.length === 1 && !setting.hasExplicitName) {
      issues.push({ settingId: setting.id, column: SETTING_NAME_COLUMN });
    }

    const template = VISUAL_RESOURCE_TEMPLATES.find(
      (candidate) => candidate.type === setting.resourceType,
    );
    if (!template) continue;
    for (const property of template.requiredProperties) {
      const actualProperty = Object.keys(setting.properties).find(
        (key) => key.toLowerCase() === property.toLowerCase(),
      );
      if (
        actualProperty === undefined ||
        isMissingRequiredValue(setting.properties[actualProperty])
      ) {
        issues.push({ settingId: setting.id, column: property });
      }
    }
  }
  return issues;
}

function readResourceArray(record: Record<string, unknown>): unknown[] | null {
  const resources = record.resources ?? record.Resources;
  return Array.isArray(resources) ? resources : null;
}

function rootResourceArray(document: unknown): unknown[] | null {
  if (Array.isArray(document)) return document;
  const record = asRecord(document);
  return record ? readResourceArray(record) : null;
}

function ensureProperties(resource: Record<string, unknown>): Record<string, unknown> {
  const key = existingKey(resource, "properties", "Properties");
  const properties = asRecord(resource[key]);
  if (properties) return properties;
  const created: Record<string, unknown> = {};
  resource[key] = created;
  return created;
}

function resolveResourceAtPath(
  document: unknown,
  path: readonly VisualResourcePathSegment[],
): Record<string, unknown> | null {
  if (path.length === 0 || typeof path[0] !== "number") return null;
  const root = rootResourceArray(document);
  if (!root) return null;
  let current = asRecord(root[path[0]]);
  if (!current) return null;

  for (let index = 1; index < path.length; index += 1) {
    const segment = path[index];
    const properties = readProperties(current);
    if (segment === "resource") {
      current = asRecord(properties.resource ?? properties.Resource);
    } else {
      const children = properties.resources ?? properties.Resources;
      current = Array.isArray(children) ? asRecord(children[segment]) : null;
    }
    if (!current) return null;
  }
  return current;
}

function parseBooleanInput(input: string): boolean | null {
  const normalized = input.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return null;
}

function parseStructuredInput(input: string): unknown {
  return parseVisualManifest(input);
}

function registryValueKind(setting: VisualSetting, column: string): string | null {
  if (setting.resourceType !== "Microsoft.Windows/Registry" || column.toLowerCase() !== "value") {
    return null;
  }
  const valueType = String(setting.properties.valueType ?? setting.properties.ValueType ?? "")
    .trim()
    .toLowerCase();
  if (["dword", "reg_dword"].includes(valueType)) return "integer";
  if (["qword", "reg_qword"].includes(valueType)) return "bigint";
  if (["multistring", "reg_multi_sz"].includes(valueType)) return "array";
  if (valueType) return "string";
  return null;
}

function cspValueKind(setting: VisualSetting, column: string): string | null {
  if (setting.resourceType !== "Microsoft.Windows/CSP" || column.toLowerCase() !== "value") {
    return null;
  }
  const declaredType = String(setting.properties.type ?? setting.properties.Type ?? "")
    .trim()
    .toLowerCase();
  return ["integer", "boolean", "array", "string"].includes(declaredType) ? declaredType : null;
}

function inferredBlankKind(setting: VisualSetting, column: string): string | null {
  const normalizedColumn = column.toLowerCase();
  const registryKind = registryValueKind(setting, column);
  if (registryKind) return registryKind;
  const cspKind = cspValueKind(setting, column);
  if (cspKind) return cspKind;
  if (["append", "exists", "ignorecase", "loaded"].includes(normalizedColumn)) return "boolean";
  if (
    normalizedColumn === "gid" ||
    (normalizedColumn === "value" &&
      ["Microsoft.Windows/AccountPolicy", "Microsoft.Windows/AuditPolicy"].includes(
        setting.resourceType,
      ))
  ) {
    return "integer";
  }
  return null;
}

export type VisualCellParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: VisualEditError };

export type VisualEditError =
  | "boolean"
  | "desiredPath"
  | "desiredReadOnly"
  | "invalidYaml"
  | "missingSetting"
  | "number"
  | "object"
  | "objectDocument"
  | "schemaConstraint"
  | "serialize"
  | "structured"
  | "wholeNumber";

export function visualCellSchemaError(
  setting: VisualSetting,
  column: string,
  value: unknown,
): VisualEditError | null {
  if (
    column.toLowerCase() !== "value" ||
    setting.validationSchema === undefined ||
    visualValueSatisfiesSchema(value, setting.validationSchema)
  ) {
    return null;
  }
  return "schemaConstraint";
}

export function parseVisualCellInput(
  input: string,
  existing: unknown,
  setting: VisualSetting,
  column: string,
): VisualCellParseResult {
  const kind = inferredBlankKind(setting, column);

  if (kind === "string") return { ok: true, value: input };
  if (kind === "boolean" || (kind === null && typeof existing === "boolean")) {
    const value = parseBooleanInput(input);
    return value === null ? { ok: false, error: "boolean" } : { ok: true, value };
  }
  if (kind === "bigint" || (kind === null && typeof existing === "bigint")) {
    if (!YAML_INTEGER_PATTERN.test(input.trim())) {
      return { ok: false, error: "wholeNumber" };
    }
    try {
      return { ok: true, value: constructLosslessInteger(input.trim()) };
    } catch {
      return { ok: false, error: "wholeNumber" };
    }
  }
  if (kind === "integer" || (kind === null && typeof existing === "number")) {
    const value = Number(input.trim());
    if (input.trim() === "" || !Number.isFinite(value)) {
      return { ok: false, error: "number" };
    }
    if ((kind === "integer" || Number.isInteger(existing)) && !Number.isInteger(value)) {
      return { ok: false, error: "wholeNumber" };
    }
    return { ok: true, value };
  }
  if (kind === "array" || (kind === null && Array.isArray(existing))) {
    const registryStringArray = registryValueKind(setting, column) === "array";
    if (input.trim() === "") return { ok: true, value: [] };
    try {
      const parsed = parseStructuredInput(input);
      if (Array.isArray(parsed)) {
        return {
          ok: true,
          value: registryStringArray
            ? parsed.map((item) => (typeof item === "string" ? item : formatVisualValue(item)))
            : parsed,
        };
      }
    } catch {
      // Fall back to a comma-delimited list for quick spreadsheet entry.
    }
    return {
      ok: true,
      value: input
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    };
  }
  if (kind === null && asRecord(existing)) {
    try {
      const parsed = parseStructuredInput(input);
      return asRecord(parsed) ? { ok: true, value: parsed } : { ok: false, error: "object" };
    } catch {
      return { ok: false, error: "structured" };
    }
  }
  if (typeof existing === "string") return { ok: true, value: input };
  if (input.trim() === "") return { ok: true, value: "" };

  try {
    return { ok: true, value: parseStructuredInput(input) };
  } catch {
    return { ok: true, value: input };
  }
}

function setNestedValue(
  root: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): boolean {
  if (path.length === 0) return false;
  let current: unknown = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) return false;
      current = current[segment];
    } else {
      const record = asRecord(current);
      if (!record || !hasOwn(record, segment)) return false;
      current = record[segment];
    }
  }

  const finalSegment = path[path.length - 1];
  if (typeof finalSegment === "number") {
    if (!Array.isArray(current) || finalSegment < 0 || finalSegment >= current.length) return false;
    current[finalSegment] = value;
    return true;
  }
  const record = asRecord(current);
  if (!record) return false;
  record[finalSegment] = value;
  return true;
}

function getNestedValue(
  root: Record<string, unknown>,
  path: readonly (string | number)[],
): { found: true; value: unknown } | { found: false } {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return { found: false };
      }
      current = current[segment];
    } else {
      const record = asRecord(current);
      if (!record || !hasOwn(record, segment)) return { found: false };
      current = record[segment];
    }
  }
  return { found: true, value: current };
}

function rawValueForVisualColumn(setting: VisualSetting, column: string): unknown {
  if (column === SETTING_NAME_COLUMN) return setting.settingName;
  if (column === DESIRED_VALUE_COLUMN) return setting.desiredValue;
  return setting.properties[column];
}

export type VisualSourceEditResult =
  | { ok: true; source: string }
  | { ok: false; error: VisualEditError };

function applyVisualCellValue(
  document: unknown,
  setting: VisualSetting,
  column: string,
  value: unknown,
): VisualEditError | null {
  if (column === SETTING_NAME_COLUMN) {
    const nameResource = resolveResourceAtPath(document, setting.location.namePath);
    if (!nameResource) return "missingSetting";
    const nameKey = existingKey(nameResource, "name", "Name");
    nameResource[nameKey] = String(value);
    return null;
  }

  if (column === DESIRED_VALUE_COLUMN) {
    const binding = setting.location.desiredBinding;
    if (!binding) return "desiredReadOnly";
    const resource = resolveResourceAtPath(document, binding.resourcePath);
    if (!resource) return "missingSetting";
    const root = binding.root === "properties" ? ensureProperties(resource) : resource;
    let boundValue = value;
    if (binding.displayWrapper) {
      const wrapper = asRecord(boundValue);
      if (wrapper && hasOwn(wrapper, binding.displayWrapper)) {
        boundValue = wrapper[binding.displayWrapper];
      }
    }
    return setNestedValue(root, binding.path, boundValue) ? null : "desiredPath";
  }

  const resource = resolveResourceAtPath(document, setting.location.resourcePath);
  if (!resource) return "missingSetting";
  const properties = ensureProperties(resource);
  properties[column] = value;
  return null;
}

function readVisualCellValue(
  document: unknown,
  setting: VisualSetting,
  column: string,
): { ok: true; value: unknown } | { ok: false; error: VisualEditError } {
  if (column === SETTING_NAME_COLUMN) {
    const nameResource = resolveResourceAtPath(document, setting.location.namePath);
    if (!nameResource) return { ok: false, error: "missingSetting" };
    const nameKey = existingKey(nameResource, "name", "Name");
    return { ok: true, value: nameResource[nameKey] };
  }

  if (column === DESIRED_VALUE_COLUMN) {
    const binding = setting.location.desiredBinding;
    if (!binding) return { ok: false, error: "desiredReadOnly" };
    const resource = resolveResourceAtPath(document, binding.resourcePath);
    if (!resource) return { ok: false, error: "missingSetting" };
    const root = binding.root === "properties" ? ensureProperties(resource) : resource;
    const boundValue = getNestedValue(root, binding.path);
    if (!boundValue.found) return { ok: false, error: "desiredPath" };
    return {
      ok: true,
      value: binding.displayWrapper
        ? { [binding.displayWrapper]: boundValue.value }
        : boundValue.value,
    };
  }

  const resource = resolveResourceAtPath(document, setting.location.resourcePath);
  if (!resource) return { ok: false, error: "missingSetting" };
  const properties = ensureProperties(resource);
  return hasOwn(properties, column)
    ? { ok: true, value: properties[column] }
    : { ok: false, error: "missingSetting" };
}

function settingMetadataForDocument(
  document: unknown,
  setting: VisualSetting,
): VisualSetting | null {
  const resource = resolveResourceAtPath(document, setting.location.resourcePath);
  if (!resource) return null;
  const resourceType = readString(resource, "type", "Type").trim();
  if (!resourceType) return null;
  const currentSetting: VisualSetting = {
    ...setting,
    resourceType,
    properties: { ...readProperties(resource) },
  };
  let validationSchema: unknown | undefined;
  for (let length = 1; length <= setting.location.resourcePath.length; length += 1) {
    const ancestor = resolveResourceAtPath(
      document,
      setting.location.resourcePath.slice(0, length),
    );
    if (!ancestor || readString(ancestor, "type", "Type").trim() !== TEST_RESOURCE_TYPE) continue;
    const ancestorProperties = readProperties(ancestor);
    const schema = ancestorProperties[existingKey(ancestorProperties, "schema", "Schema")];
    const schemaRecord = asRecord(schema);
    if (schemaRecord && Object.keys(schemaRecord).length > 0) validationSchema = schema;
  }
  if (validationSchema === undefined) delete currentSetting.validationSchema;
  else currentSetting.validationSchema = validationSchema;
  return currentSetting;
}

function updateParsedVisualCellValue(
  document: unknown,
  setting: VisualSetting,
  column: string,
  value: unknown,
): VisualSourceEditResult {
  const schemaError = visualCellSchemaError(setting, column, value);
  if (schemaError) return { ok: false, error: schemaError };

  const error = applyVisualCellValue(document, setting, column, value);
  if (error) return { ok: false, error };

  try {
    return { ok: true, source: dumpVisualManifest(document) };
  } catch {
    return { ok: false, error: "serialize" };
  }
}

export function updateVisualCellValueSource(
  source: string,
  setting: VisualSetting,
  column: string,
  value: unknown,
): VisualSourceEditResult {
  let document: unknown;
  try {
    document = parseVisualManifest(source);
  } catch {
    return { ok: false, error: "invalidYaml" };
  }
  return updateParsedVisualCellValue(document, setting, column, value);
}

export function updateVisualCellSource(
  source: string,
  setting: VisualSetting,
  column: string,
  input: string,
): VisualSourceEditResult {
  const parsed = parseVisualCellInput(
    input,
    rawValueForVisualColumn(setting, column),
    setting,
    column,
  );
  if (!parsed.ok) return parsed;
  return updateVisualCellValueSource(
    source,
    setting,
    column,
    column === SETTING_NAME_COLUMN ? input : parsed.value,
  );
}

function visualArrayItemKind(
  setting: VisualSetting | undefined,
  column: string | undefined,
): "string" | null {
  if (!setting || !column) return null;
  return registryValueKind(setting, column) === "array" ? "string" : null;
}

export function parseVisualArrayItemInput(
  input: string,
  existing: unknown,
  setting?: VisualSetting,
  column?: string,
): VisualCellParseResult {
  if (visualArrayItemKind(setting, column) === "string") {
    return { ok: true, value: input };
  }
  if (typeof existing === "boolean") {
    const value = parseBooleanInput(input);
    return value === null ? { ok: false, error: "boolean" } : { ok: true, value };
  }
  if (typeof existing === "bigint") {
    if (!YAML_INTEGER_PATTERN.test(input.trim())) {
      return { ok: false, error: "wholeNumber" };
    }
    try {
      return { ok: true, value: constructLosslessInteger(input.trim()) };
    } catch {
      return { ok: false, error: "wholeNumber" };
    }
  }
  if (typeof existing === "number") {
    const value = Number(input.trim());
    if (input.trim() === "" || !Number.isFinite(value)) {
      return { ok: false, error: "number" };
    }
    if (Number.isInteger(existing) && !Number.isInteger(value)) {
      return { ok: false, error: "wholeNumber" };
    }
    return { ok: true, value };
  }
  if (Array.isArray(existing) || asRecord(existing)) {
    try {
      return { ok: true, value: parseStructuredInput(input) };
    } catch {
      return { ok: false, error: "structured" };
    }
  }
  return { ok: true, value: input };
}

export function updateVisualArrayItemSource(
  source: string,
  setting: VisualSetting,
  column: string,
  index: number,
  input: string,
): VisualSourceEditResult {
  const current = rawValueForVisualColumn(setting, column);
  if (!Array.isArray(current) || index < 0 || index >= current.length) {
    return { ok: false, error: "missingSetting" };
  }
  const parsed = parseVisualArrayItemInput(input, current[index], setting, column);
  if (!parsed.ok) return parsed;
  const next = [...current];
  next[index] = parsed.value;
  return updateVisualCellValueSource(source, setting, column, next);
}

function placeholderForVisualArrayItem(
  existing: unknown,
  setting: VisualSetting,
  column: string,
): unknown {
  if (visualArrayItemKind(setting, column) === "string") return "";
  if (typeof existing === "boolean") return false;
  if (typeof existing === "bigint") return existing;
  if (typeof existing === "number") return Number.isInteger(existing) ? 0 : existing;
  if (Array.isArray(existing)) return [];
  if (asRecord(existing)) return {};
  return "";
}

export function appendVisualArrayItemSource(
  source: string,
  setting: VisualSetting,
  column: string,
): VisualSourceEditResult {
  let document: unknown;
  try {
    document = parseVisualManifest(source);
  } catch {
    return { ok: false, error: "invalidYaml" };
  }
  const currentSetting = settingMetadataForDocument(document, setting);
  if (!currentSetting) return { ok: false, error: "missingSetting" };
  const currentValue = readVisualCellValue(document, currentSetting, column);
  if (!currentValue.ok) return currentValue;
  const current = currentValue.value;
  if (!Array.isArray(current)) {
    return { ok: false, error: "structured" };
  }
  const placeholder =
    current.length > 0
      ? placeholderForVisualArrayItem(current[current.length - 1], currentSetting, column)
      : "";
  return updateParsedVisualCellValue(document, currentSetting, column, [...current, placeholder]);
}

function pathKey(path: readonly VisualResourcePathSegment[]): string {
  return path.map((segment) => (segment === "resource" ? "$resource" : segment)).join(".");
}

function isPathPrefix(
  prefix: readonly VisualResourcePathSegment[],
  candidate: readonly VisualResourcePathSegment[],
): boolean {
  return (
    prefix.length < candidate.length &&
    prefix.every((segment, index) => segment === candidate[index])
  );
}

function resourceChildrenArray(
  document: unknown,
  parentPath: readonly VisualResourcePathSegment[],
): unknown[] | null {
  if (parentPath.length === 0) return rootResourceArray(document);
  const parent = resolveResourceAtPath(document, parentPath);
  if (!parent) return null;
  const properties = readProperties(parent);
  const children = properties.resources ?? properties.Resources;
  return Array.isArray(children) ? children : null;
}

export function removeVisualSettingsSource(
  source: string,
  settings: readonly VisualSetting[],
): VisualSourceEditResult {
  let document: unknown;
  try {
    document = parseVisualManifest(source);
  } catch {
    return { ok: false, error: "invalidYaml" };
  }

  const uniquePaths = Array.from(
    new Map(
      settings.map((setting) => [
        pathKey(setting.location.removePath),
        setting.location.removePath,
      ]),
    ).values(),
  ).filter(
    (candidate, _index, all) =>
      !all.some((possibleParent) => isPathPrefix(possibleParent, candidate)),
  );

  const grouped = new Map<string, { parent: VisualResourcePath; indexes: number[] }>();
  for (const path of uniquePaths) {
    const index = path[path.length - 1];
    if (typeof index !== "number") continue;
    const parent = path.slice(0, -1);
    const key = pathKey(parent);
    const entry = grouped.get(key) ?? { parent, indexes: [] };
    entry.indexes.push(index);
    grouped.set(key, entry);
  }

  const groups = Array.from(grouped.values()).sort(
    (left, right) => right.parent.length - left.parent.length,
  );
  for (const group of groups) {
    const resources = resourceChildrenArray(document, group.parent);
    if (!resources) continue;
    for (const index of [...new Set(group.indexes)].sort((left, right) => right - left)) {
      if (index >= 0 && index < resources.length) resources.splice(index, 1);
    }
  }

  try {
    return { ok: true, source: dumpVisualManifest(document) };
  } catch {
    return { ok: false, error: "serialize" };
  }
}

function templateForType(type: string): VisualResourceTemplate | undefined {
  return VISUAL_RESOURCE_TEMPLATES.find((template) => template.type === type);
}

export type VisualSourceAddResult =
  | { ok: true; source: string; settingId: string }
  | { ok: false; error: VisualEditError };

export function addVisualSettingSource(
  source: string,
  type: string,
  columns: readonly string[] = [],
): VisualSourceAddResult {
  let document: unknown;
  try {
    document = parseVisualManifest(source);
  } catch {
    return { ok: false, error: "invalidYaml" };
  }

  const documentRecord = asRecord(document);
  if (!documentRecord) {
    return { ok: false, error: "objectDocument" };
  }
  let resources = readResourceArray(documentRecord);
  if (!resources) {
    const resourcesKey = existingKey(documentRecord, "resources", "Resources");
    resources = [];
    documentRecord[resourcesKey] = resources;
  }

  const template = templateForType(type);
  const properties: Record<string, unknown> = template ? structuredClone(template.properties) : {};
  for (const column of columns) {
    if (
      column !== SETTING_NAME_COLUMN &&
      column !== DESIRED_VALUE_COLUMN &&
      !hasOwn(properties, column)
    ) {
      properties[column] = "";
    }
  }
  const resource: Record<string, unknown> = { name: "", type, properties };
  if (
    columns.includes(DESIRED_VALUE_COLUMN) &&
    !["value", "data", "desired", "Value", "expectedValue", "desiredValue"].some((key) =>
      hasOwn(properties, key),
    )
  ) {
    resource.compliance = { equals: "" };
  }

  const settingId = String(resources.length);
  resources.push(resource);
  try {
    return { ok: true, source: dumpVisualManifest(document), settingId };
  } catch {
    return { ok: false, error: "serialize" };
  }
}
