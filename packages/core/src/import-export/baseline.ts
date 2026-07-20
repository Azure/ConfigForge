// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export type BaselineSpreadsheetFormat = 'generic' | 'osconfig';

export interface ParsedBaselineSetting {
  settingName: string;
  controlName?: string;
  description?: string;
  format: BaselineSpreadsheetFormat;
  rowNumber: number;
  selectedProfile?: string;
  registryPath?: string;
  registryValueName?: string;
  registryValueType?: string;
  cspName?: string;
  cspPath?: string;
  cspValueType?: string;
  defaultValue?: string;
  expectedValue?: string;
  currentValue?: string;
  columns: Record<string, string>;
}

export interface BaselineManifestBuildResult {
  manifest: {
    $schema: string;
    resources: Record<string, unknown>[];
  };
  includedSettings: ParsedBaselineSetting[];
  skippedSettings: ParsedBaselineSetting[];
  profile?: string;
}

interface ParsedTable {
  headers: string[];
  normalizedHeaders: string[];
  rows: string[][];
}

type ComplianceNode =
  | { kind: 'call'; name: string; args: ComplianceNode[] }
  | { kind: 'literal'; value: unknown };

const DOCUMENT_SCHEMA = 'https://aka.ms/osc/schemas/prerelease/document.json';
const DELIMITER_CANDIDATES = [',', '\t', ';', '|'] as const;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITER_CANDIDATES.map((item) => [item, 0]));
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && (ch === '\r' || ch === '\n')) break;
    if (!inQuotes && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }

  let selected = ',';
  let selectedCount = -1;
  for (const candidate of DELIMITER_CANDIDATES) {
    const count = counts.get(candidate) ?? 0;
    if (count > selectedCount) {
      selected = candidate;
      selectedCount = count;
    }
  }
  return selected;
}

function parseDelimitedTable(text: string): ParsedTable {
  const input = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(input);
  const parsedRows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = (): void => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    if (row.some((cell) => cell.length > 0)) parsedRows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\r' || ch === '\n') {
      pushRow();
      if (ch === '\r' && input[i + 1] === '\n') i++;
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new Error(`Spreadsheet row ${parsedRows.length + 1} has an unterminated quoted field`);
  }
  if (field.length > 0 || row.length > 0) pushRow();

  if (parsedRows.length < 2) {
    throw new Error('Spreadsheet must have at least a header row and one data row');
  }

  const headers = parsedRows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  return {
    headers,
    normalizedHeaders: headers.map(normalizeHeader),
    rows: parsedRows.slice(1),
  };
}

function firstHeaderIndex(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function nonEmptyCell(row: string[], index: number): string | undefined {
  if (index < 0) return undefined;
  const value = row[index]?.trim();
  return value ? value : undefined;
}

function chooseProfile(
  headers: string[],
  normalizedHeaders: string[],
): { expectedIndex: number; defaultIndex: number; profile?: string } {
  const expectedIndex = firstHeaderIndex(normalizedHeaders, [
    'expectedvalue',
    'expected',
    'desiredvalue',
    'desired',
    'baseline',
  ]);
  if (expectedIndex >= 0) {
    return {
      expectedIndex,
      defaultIndex: firstHeaderIndex(normalizedHeaders, ['defaultvalue', 'default']),
    };
  }

  const roleExpected = headers
    .map((header, index) => {
      const match = header.match(/^expected\s+value\s*:\s*(.+)$/i);
      return match ? { index, profile: match[1].trim() } : undefined;
    })
    .filter((item): item is { index: number; profile: string } => item !== undefined);

  if (roleExpected.length === 0) return { expectedIndex: -1, defaultIndex: -1 };
  const selected =
    roleExpected.find((item) => normalizeHeader(item.profile) === 'memberserver') ??
    roleExpected[0];
  const defaultHeader = `defaultvalue${normalizeHeader(selected.profile)}`;
  return {
    expectedIndex: selected.index,
    defaultIndex: normalizedHeaders.indexOf(defaultHeader),
    profile: selected.profile,
  };
}

/**
 * Parse a CSV/TSV/semicolon/pipe-delimited baseline spreadsheet.
 *
 * OSConfig security baseline CSVs are detected from their Registry/CSP columns.
 * Multi-profile server baselines default to the Member Server value columns.
 */
export function parseExcelBaseline(text: string): ParsedBaselineSetting[] {
  const table = parseDelimitedTable(text);
  const headerSet = new Set(table.normalizedHeaders);
  const isOsConfig =
    headerSet.has('registrykey') ||
    headerSet.has('registryvalue') ||
    headerSet.has('csppath') ||
    headerSet.has('cspname');

  if (
    !isOsConfig &&
    headerSet.has('datatype') &&
    headerSet.has('compliance') &&
    headerSet.has('description') &&
    headerSet.has('value')
  ) {
    throw new Error(
      'This CSV is a flattened report/export and does not contain the inner Registry or CSP resource fields needed to rebuild a manifest. Import the source .osc.yaml/.yaml/.json file, or use an OSConfig baseline CSV with Registry Key or CSP Path columns.',
    );
  }

  const nameIndex = firstHeaderIndex(table.normalizedHeaders, [
    'settingname',
    'name',
    'setting',
    'policyname',
  ]);
  const controlNameIndex = firstHeaderIndex(table.normalizedHeaders, ['controlname']);
  const descriptionIndex = firstHeaderIndex(table.normalizedHeaders, ['description']);
  const registryPathIndex = firstHeaderIndex(table.normalizedHeaders, [
    'registrykey',
    'registrypath',
    'regpath',
    'path',
    'key',
  ]);
  const registryValueNameIndex = firstHeaderIndex(table.normalizedHeaders, [
    'registryvalue',
    'registryvaluename',
    'valuename',
  ]);
  const registryValueTypeIndex = firstHeaderIndex(table.normalizedHeaders, [
    'registryvaluetype',
    'valuetype',
  ]);
  const cspNameIndex = firstHeaderIndex(table.normalizedHeaders, ['cspname']);
  const cspPathIndex = firstHeaderIndex(table.normalizedHeaders, ['csppath']);
  const cspValueTypeIndex = firstHeaderIndex(table.normalizedHeaders, ['cspvaluetype']);
  const currentIndex = firstHeaderIndex(table.normalizedHeaders, [
    'currentvalue',
    'current',
    'actualvalue',
    'actual',
  ]);
  const profile = chooseProfile(table.headers, table.normalizedHeaders);
  const genericExpectedIndex =
    profile.expectedIndex >= 0
      ? profile.expectedIndex
      : firstHeaderIndex(table.normalizedHeaders, ['value']);
  const genericDefaultIndex = firstHeaderIndex(table.normalizedHeaders, [
    'defaultvalue',
    'default',
  ]);

  const results: ParsedBaselineSetting[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    const row = table.rows[rowIndex];
    const settingName = nonEmptyCell(row, nameIndex >= 0 ? nameIndex : 0);
    if (!settingName) continue;

    const columns: Record<string, string> = {};
    table.normalizedHeaders.forEach((header, index) => {
      if (header) columns[header] = row[index]?.trim() ?? '';
    });

    results.push({
      settingName,
      controlName: nonEmptyCell(row, controlNameIndex),
      description: nonEmptyCell(row, descriptionIndex),
      format: isOsConfig ? 'osconfig' : 'generic',
      rowNumber: rowIndex + 2,
      selectedProfile: profile.profile,
      registryPath: nonEmptyCell(row, registryPathIndex),
      registryValueName: nonEmptyCell(row, registryValueNameIndex),
      registryValueType: nonEmptyCell(row, registryValueTypeIndex),
      cspName: nonEmptyCell(row, cspNameIndex),
      cspPath: nonEmptyCell(row, cspPathIndex),
      cspValueType: nonEmptyCell(row, cspValueTypeIndex),
      defaultValue: nonEmptyCell(row, isOsConfig ? profile.defaultIndex : genericDefaultIndex),
      expectedValue: nonEmptyCell(row, isOsConfig ? profile.expectedIndex : genericExpectedIndex),
      currentValue: nonEmptyCell(row, currentIndex),
      columns,
    });
  }

  if (results.length === 0) {
    throw new Error('Spreadsheet does not contain any named baseline settings');
  }
  return results;
}

class ComplianceExpressionParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): ComplianceNode {
    const result = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.input.length) {
      throw new Error(`Unexpected token at character ${this.index + 1}`);
    }
    return result;
  }

  private parseValue(): ComplianceNode {
    this.skipWhitespace();
    const ch = this.input[this.index];
    if (ch === "'" || ch === '"') {
      return { kind: 'literal', value: this.parseQuotedString(ch) };
    }

    const start = this.index;
    while (this.index < this.input.length && !/[\s(),]/.test(this.input[this.index])) {
      this.index++;
    }
    const token = this.input.slice(start, this.index);
    if (!token) throw new Error(`Expected a value at character ${this.index + 1}`);

    this.skipWhitespace();
    if (this.input[this.index] === '(' && /^[A-Za-z][A-Za-z0-9]*$/.test(token)) {
      this.index++;
      const args: ComplianceNode[] = [];
      this.skipWhitespace();
      if (this.input[this.index] !== ')') {
        while (true) {
          if (this.input[this.index] === ',') {
            args.push({ kind: 'literal', value: null });
            this.index++;
            this.skipWhitespace();
            continue;
          }
          args.push(this.parseValue());
          this.skipWhitespace();
          if (this.input[this.index] === ',') {
            this.index++;
            this.skipWhitespace();
            if (this.input[this.index] === ')') {
              args.push({ kind: 'literal', value: null });
              break;
            }
            continue;
          }
          break;
        }
      }
      if (this.input[this.index] !== ')') {
        throw new Error(`Expected ")" at character ${this.index + 1}`);
      }
      this.index++;
      return { kind: 'call', name: token, args };
    }
    return { kind: 'literal', value: parseLiteral(token) };
  }

  private parseQuotedString(quote: string): string {
    this.index++;
    let value = '';
    while (this.index < this.input.length) {
      const ch = this.input[this.index++];
      if (ch === quote) return value;
      if (ch === '\\' && this.index < this.input.length) {
        const next = this.input[this.index++];
        if (next === quote || next === '\\') value += next;
        else value += `\\${next}`;
      } else {
        value += ch;
      }
    }
    throw new Error('Unterminated quoted string');
  }

  private skipWhitespace(): void {
    while (this.index < this.input.length && /\s/.test(this.input[this.index])) {
      this.index++;
    }
  }
}

function parseLiteral(token: string): unknown {
  const normalized = token.trim();
  if (/^null$/i.test(normalized)) return null;
  if (/^true$/i.test(normalized)) return true;
  if (/^false$/i.test(normalized)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  return normalized;
}

function requireLiteral(node: ComplianceNode, operation: string): unknown {
  if (node.kind !== 'literal') {
    throw new Error(`${operation} requires literal arguments`);
  }
  return node.value;
}

function complianceNodeToSchema(node: ComplianceNode): Record<string, unknown> {
  if (node.kind !== 'call') {
    throw new Error('Compliance criteria must be a function expression');
  }

  const operation = node.name.toLowerCase();
  switch (operation) {
    case 'equals':
      if (node.args.length !== 1) throw new Error('Equals requires one argument');
      return { const: requireLiteral(node.args[0], 'Equals') };
    case 'range': {
      if (node.args.length !== 2) throw new Error('Range requires two arguments');
      const minimum = requireLiteral(node.args[0], 'Range');
      const maximum = requireLiteral(node.args[1], 'Range');
      const schema: Record<string, unknown> = {};
      if (minimum !== null) schema.minimum = minimum;
      if (maximum !== null) schema.maximum = maximum;
      return schema;
    }
    case 'oneof':
      return { oneOf: node.args.map(complianceNodeToSchema) };
    case 'allof':
      return { allOf: node.args.map(complianceNodeToSchema) };
    case 'not':
      if (node.args.length !== 1) throw new Error('Not requires one argument');
      return { not: complianceNodeToSchema(node.args[0]) };
    case 'pattern':
      if (node.args.length !== 1) throw new Error('Pattern requires one argument');
      return { pattern: String(requireLiteral(node.args[0], 'Pattern')) };
    case 'contains':
      if (node.args.length !== 1) throw new Error('Contains requires one argument');
      return { pattern: String(requireLiteral(node.args[0], 'Contains')) };
    case 'containsatleast': {
      const values = node.args.map((arg) => requireLiteral(arg, 'ContainsAtLeast'));
      return { allOf: values.map((value) => ({ contains: { const: value } })) };
    }
    case 'containsatmost': {
      const values = node.args.map((arg) => requireLiteral(arg, 'ContainsAtMost'));
      return { items: { enum: values } };
    }
    case 'containsexactly': {
      const values = node.args.map((arg) => requireLiteral(arg, 'ContainsExactly'));
      return {
        allOf: values.map((value) => ({ contains: { const: value } })),
        items: { enum: values },
        minItems: values.length,
        maxItems: values.length,
        uniqueItems: true,
      };
    }
    default:
      throw new Error(`Unsupported compliance expression "${node.name}"`);
  }
}

export function parseComplianceExpression(expression: string): Record<string, unknown> {
  return complianceNodeToSchema(new ComplianceExpressionParser(expression.trim()).parse());
}

function deriveDesiredValue(node: ComplianceNode): unknown {
  if (node.kind !== 'call') return undefined;
  const operation = node.name.toLowerCase();
  if (operation === 'equals' && node.args.length === 1 && node.args[0].kind === 'literal') {
    return node.args[0].value;
  }
  if (operation === 'range' && node.args[0]?.kind === 'literal') {
    return node.args[0].value;
  }
  if (operation === 'oneof') {
    for (const branch of node.args) {
      const value = deriveDesiredValue(branch);
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

export function inferRegistryValueType(expectedValue: unknown): string {
  if (typeof expectedValue === 'number' && Number.isInteger(expectedValue)) {
    return 'Dword';
  }
  if (typeof expectedValue === 'string') {
    const trimmed = expectedValue.trim();
    if (trimmed !== '' && /^-?\d+$/.test(trimmed)) {
      return 'Dword';
    }
  }
  return 'String';
}

function normalizeRegistryValueType(raw: string | undefined, value: unknown): string {
  const normalized = raw
    ?.trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'DWORD':
    case 'REG_DWORD':
    case 'INTEGER':
      return 'REG_DWORD';
    case 'QWORD':
    case 'REG_QWORD':
      return 'REG_QWORD';
    case 'MULTISTRING':
    case 'MULTI_STRING':
    case 'REG_MULTI_SZ':
      return 'REG_MULTI_SZ';
    case 'EXPANDSTRING':
    case 'EXPAND_STRING':
    case 'REG_EXPAND_SZ':
      return 'REG_EXPAND_SZ';
    case 'BINARY':
    case 'REG_BINARY':
      return 'REG_BINARY';
    case 'STRING':
    case 'REG_SZ':
      return 'REG_SZ';
    default:
      if (Array.isArray(value)) return 'REG_MULTI_SZ';
      if (typeof value === 'number' && Number.isInteger(value)) return 'REG_DWORD';
      return 'REG_SZ';
  }
}

function normalizeEmptyMarker(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === "''" ? '' : value;
}

function parseSafeInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) throw new Error(`${label} must be an integer, found "${text}"`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} is outside JavaScript's safe integer range`);
  }
  return parsed;
}

function splitListValue(value: unknown): string[] {
  const normalized = normalizeEmptyMarker(value);
  if (normalized === '' || normalized === undefined || normalized === null) return [];
  if (Array.isArray(normalized)) return normalized.map((item) => String(item));

  const input = String(normalized);
  const result: string[] = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result.filter((item) => item.length > 0);
}

function coerceRegistryValue(value: unknown, valueType: string): unknown {
  const normalized = normalizeEmptyMarker(value);
  switch (valueType) {
    case 'REG_DWORD':
    case 'REG_QWORD':
      return parseSafeInteger(normalized, valueType);
    case 'REG_MULTI_SZ':
      return splitListValue(normalized);
    default:
      return normalized === undefined || normalized === null ? '' : String(normalized);
  }
}

function normalizeCspValueType(raw: string | undefined, value: unknown): string {
  switch (raw?.trim().toLowerCase()) {
    case 'integer':
    case 'int':
      return 'integer';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'multistring':
    case 'array':
      return 'array';
    case 'binary':
    case 'string':
      return 'string';
    default:
      if (Array.isArray(value)) return 'array';
      if (typeof value === 'number') return 'integer';
      if (typeof value === 'boolean') return 'boolean';
      return 'string';
  }
}

function coerceCspValue(value: unknown, valueType: string): unknown {
  const normalized = normalizeEmptyMarker(value);
  switch (valueType) {
    case 'integer':
      return parseSafeInteger(normalized, 'CSP Integer');
    case 'boolean': {
      if (typeof normalized === 'boolean') return normalized;
      const text = String(normalized).trim().toLowerCase();
      if (text === 'true' || text === '1') return true;
      if (text === 'false' || text === '0') return false;
      throw new Error(`CSP Boolean must be true, false, 1, or 0, found "${normalized}"`);
    }
    case 'array':
      return splitListValue(normalized);
    default:
      return normalized === undefined || normalized === null ? '' : String(normalized);
  }
}

function normalizeRegistryPath(raw: string): string {
  const value = raw.trim();
  const hives = [
    ['HKLM', 'HKEY_LOCAL_MACHINE'],
    ['HKCU', 'HKEY_CURRENT_USER'],
    ['HKCR', 'HKEY_CLASSES_ROOT'],
    ['HKU', 'HKEY_USERS'],
    ['HKCC', 'HKEY_CURRENT_CONFIG'],
  ] as const;
  const upper = value.toUpperCase();

  for (const [shortName, fullName] of hives) {
    for (const prefix of [shortName, fullName]) {
      if (upper === prefix || upper === `${prefix}:`) return fullName;
      if (upper.startsWith(`${prefix}:`) || upper.startsWith(`${prefix}\\`)) {
        const rest = value.slice(prefix.length).replace(/^:\\?/, '').replace(/^\\+/, '');
        return rest ? `${fullName}\\${rest}` : fullName;
      }
    }
  }
  return value;
}

function joinCspPath(name: string | undefined, path: string): string {
  const trimmedPath = path.trim();
  if (/^\.\//.test(trimmedPath)) return trimmedPath;
  const base = name?.trim().replace(/\/+$/, '') ?? '';
  return base ? `${base}/${trimmedPath.replace(/^\/+/, '')}` : trimmedPath;
}

function safeResourceName(raw: string): string {
  const safe = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || 'rule';
}

function buildInnerOsConfigResource(
  setting: ParsedBaselineSetting,
  desiredValue: unknown,
  hasDesiredValue: boolean,
): Record<string, unknown> {
  if (setting.cspPath) {
    const valueType = normalizeCspValueType(setting.cspValueType, desiredValue);
    return {
      type: 'Microsoft.Windows/CSP',
      properties: {
        path: joinCspPath(setting.cspName, setting.cspPath),
        type: valueType,
        ...(hasDesiredValue ? { value: coerceCspValue(desiredValue, valueType) } : {}),
      },
    };
  }

  if (!setting.registryPath || !setting.registryValueName) {
    throw new Error(
      `row ${setting.rowNumber} (${setting.settingName}) has no complete Registry or CSP resource definition`,
    );
  }
  const valueType = normalizeRegistryValueType(setting.registryValueType, desiredValue);
  return {
    type: 'Microsoft.Windows/Registry',
    properties: {
      keyPath: normalizeRegistryPath(setting.registryPath),
      valueName: setting.registryValueName,
      valueType,
      ...(hasDesiredValue ? { value: coerceRegistryValue(desiredValue, valueType) } : {}),
    },
  };
}

function buildOsConfigResource(setting: ParsedBaselineSetting): Record<string, unknown> | null {
  if (
    setting.selectedProfile &&
    setting.defaultValue === undefined &&
    setting.expectedValue === undefined
  ) {
    return null;
  }

  let complianceNode: ComplianceNode | undefined;
  let schema: Record<string, unknown> | undefined;
  if (setting.expectedValue !== undefined) {
    try {
      complianceNode = new ComplianceExpressionParser(setting.expectedValue).parse();
      schema = complianceNodeToSchema(complianceNode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid compliance expression';
      throw new Error(`row ${setting.rowNumber} (${setting.settingName}): ${message}`);
    }
  }

  const derivedValue = complianceNode ? deriveDesiredValue(complianceNode) : undefined;
  const desiredValue = setting.defaultValue ?? derivedValue;
  const hasDesiredValue = setting.defaultValue !== undefined || derivedValue !== undefined;
  const inner = buildInnerOsConfigResource(setting, desiredValue, hasDesiredValue);
  const name = safeResourceName(setting.settingName);

  if (!schema) return { name, ...inner };
  return {
    name,
    type: 'Microsoft.OSConfig/Test',
    properties: {
      resource: inner,
      schema,
    },
  };
}

function buildGenericResource(setting: ParsedBaselineSetting): Record<string, unknown> {
  if (!setting.registryPath) {
    throw new Error(`row ${setting.rowNumber} (${setting.settingName}) is missing a Registry Path`);
  }

  const rawValue = setting.defaultValue ?? setting.expectedValue;
  const valueType = inferRegistryValueType(rawValue);
  const typedValue =
    rawValue === undefined
      ? undefined
      : valueType === 'Dword'
        ? parseSafeInteger(rawValue, 'Dword')
        : String(normalizeEmptyMarker(rawValue));
  const expectedValue =
    setting.expectedValue === undefined
      ? undefined
      : valueType === 'Dword'
        ? parseSafeInteger(setting.expectedValue, 'Dword')
        : String(normalizeEmptyMarker(setting.expectedValue));
  return {
    name: safeResourceName(setting.settingName),
    type: 'Microsoft.Windows/Registry',
    properties: {
      keyPath: normalizeRegistryPath(setting.registryPath),
      valueName: setting.registryValueName ?? setting.settingName,
      valueType,
      ...(typedValue !== undefined ? { value: typedValue } : {}),
    },
    ...(expectedValue !== undefined ? { compliance: { equals: expectedValue } } : {}),
  };
}

function uniqueResourceName(
  resource: Record<string, unknown>,
  counts: Map<string, number>,
): Record<string, unknown> {
  const base = String(resource.name ?? 'rule');
  const nextCount = (counts.get(base) ?? 0) + 1;
  counts.set(base, nextCount);
  return nextCount === 1 ? resource : { ...resource, name: `${base}-${nextCount}` };
}

export function buildBaselineManifest(
  settings: ParsedBaselineSetting[],
): BaselineManifestBuildResult {
  const resources: Record<string, unknown>[] = [];
  const includedSettings: ParsedBaselineSetting[] = [];
  const skippedSettings: ParsedBaselineSetting[] = [];
  const nameCounts = new Map<string, number>();

  for (const setting of settings) {
    const resource =
      setting.format === 'osconfig'
        ? buildOsConfigResource(setting)
        : buildGenericResource(setting);
    if (!resource) {
      skippedSettings.push(setting);
      continue;
    }
    resources.push(uniqueResourceName(resource, nameCounts));
    includedSettings.push(setting);
  }

  if (resources.length === 0) {
    throw new Error('Spreadsheet does not contain any applicable baseline resources');
  }

  return {
    manifest: { $schema: DOCUMENT_SCHEMA, resources },
    includedSettings,
    skippedSettings,
    profile: settings.find((setting) => setting.selectedProfile)?.selectedProfile,
  };
}
