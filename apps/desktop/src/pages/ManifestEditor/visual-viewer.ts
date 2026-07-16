// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const GROUP_RESOURCE_TYPE = "Microsoft.OSConfig/Group";
const TEST_RESOURCE_TYPE = "Microsoft.OSConfig/Test";
const MAX_RESOURCE_DEPTH = 50;

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
  sourceOrder: number;
}

export interface VisualSettingGroup {
  resourceType: string;
  columns: string[];
  settings: VisualSetting[];
}

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
}

const NO_DESIRED_VALUE: DesiredValue = { present: false };

function presentDesiredValue(value: unknown): DesiredValue {
  return { present: true, value };
}

function unwrapTypedValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const keys = Object.keys(record);
  return keys.length === 1 ? record[keys[0]] : value;
}

function readComplianceDesired(resource: Record<string, unknown>): DesiredValue {
  const compliance = asRecord(resource.compliance ?? resource.Compliance);
  if (!compliance) return NO_DESIRED_VALUE;

  for (const key of ["equals", "Equals"]) {
    if (hasOwn(compliance, key)) return presentDesiredValue(compliance[key]);
  }
  for (const key of ["contains", "matches", "regex"] as const) {
    if (hasOwn(compliance, key)) return presentDesiredValue({ [key]: compliance[key] });
  }
  return NO_DESIRED_VALUE;
}

function readResourceDesired(
  resource: Record<string, unknown>,
  properties: Record<string, unknown>,
): DesiredValue {
  const compliance = readComplianceDesired(resource);
  if (compliance.present) return compliance;

  for (const key of ["value", "Value"]) {
    if (hasOwn(resource, key)) return presentDesiredValue(unwrapTypedValue(resource[key]));
  }
  for (const key of ["value", "data", "desired", "Value", "expectedValue", "desiredValue"]) {
    if (hasOwn(properties, key)) {
      return presentDesiredValue(unwrapTypedValue(properties[key]));
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
function readSchemaDesired(schema: unknown): DesiredValue {
  if (schema === undefined) return NO_DESIRED_VALUE;
  const record = asRecord(schema);
  if (!record) return presentDesiredValue(schema);
  if (Object.keys(record).length === 0) return NO_DESIRED_VALUE;

  for (const key of ["const", "equals"] as const) {
    if (hasOwn(record, key)) return presentDesiredValue(record[key]);
  }

  if (Array.isArray(record.enum) && record.enum.length === 1) {
    return presentDesiredValue(record.enum[0]);
  }

  if (Array.isArray(record.oneOf)) {
    const nonNullBranches = record.oneOf.filter((branch) => !isNullSchemaBranch(branch));
    if (nonNullBranches.length === 1) {
      const concise = readSchemaDesired(nonNullBranches[0]);
      if (concise.present) return concise;
    }
  }

  return presentDesiredValue({ ...record });
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

  const walk = (
    candidate: unknown,
    path: number[],
    nameOverride: string | undefined,
    fallbackName: string | undefined,
    desiredOverride: DesiredValue,
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
          (nameOverride ?? settingName).trim() ||
          fallbackName ||
          `Group ${path.map((index) => index + 1).join(".")}`;
        children.forEach((child, index) => {
          const childRecord = asRecord(child);
          const childType = childRecord ? readString(childRecord, "type", "Type").trim() : "";
          const slash = childType.lastIndexOf("/");
          const childTypeName =
            slash >= 0 && slash < childType.length - 1 ? childType.slice(slash + 1) : childType;
          const childFallback = `${groupName} — ${childTypeName || "Setting"} ${index + 1}`;
          walk(child, [...path, index], undefined, childFallback, desiredOverride, depth + 1);
        });
        return;
      }

      if (resourceType === TEST_RESOURCE_TYPE) {
        const innerResource = properties.resource ?? properties.Resource;
        if (!asRecord(innerResource)) return;
        const wrapperCompliance = readComplianceDesired(resource);
        const wrapperSchema = readSchemaDesired(properties.schema ?? properties.Schema);
        const wrapperDesired = wrapperCompliance.present
          ? wrapperCompliance
          : wrapperSchema.present
            ? wrapperSchema
            : desiredOverride;
        walk(
          innerResource,
          [...path, 0],
          (nameOverride ?? settingName).trim() || fallbackName,
          fallbackName,
          wrapperDesired,
          depth + 1,
        );
        return;
      }

      const desiredValue = desiredOverride.present
        ? desiredOverride
        : readResourceDesired(resource, properties);
      flattened.push({
        id: path.join("."),
        settingName: (nameOverride ?? settingName).trim() || fallbackName || "",
        resourceType,
        properties: { ...properties },
        ...(desiredValue.present ? { desiredValue: desiredValue.value } : {}),
        sourceOrder: flattened.length,
      });
    } finally {
      activePath.delete(resource);
    }
  };

  readResources(document).forEach((resource, index) => {
    walk(resource, [index], undefined, undefined, NO_DESIRED_VALUE, 0);
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
    const seen = new WeakSet<object>();
    try {
      const formatted = JSON.stringify(
        value,
        (_key, nestedValue: unknown) => {
          if (typeof nestedValue === "bigint") return nestedValue.toString();
          if (nestedValue !== null && typeof nestedValue === "object") {
            if (seen.has(nestedValue)) return "[Circular]";
            seen.add(nestedValue);
          }
          return nestedValue;
        },
        2,
      );
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
