// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import zlib from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_XLSX_XML_BYTES = 40 * 1024 * 1024;
const MAX_XLSX_TOTAL_XML_BYTES = 64 * 1024 * 1024;
const MAX_EXCEL_COLUMNS = 16_384;
const MAX_EXCEL_ROWS = 1_048_576;
const MAX_XLSX_ROWS = 100_000;
const MAX_XLSX_OUTPUT_CELLS = 1_000_000;
const MAX_XLSX_OUTPUT_CHARACTERS = 40 * 1024 * 1024;
const MAX_XLSX_SHARED_STRINGS = 100_000;
const MAX_XLSX_TEXT_NODES = 200_000;
const MAX_XLSX_STRING_CHARACTERS = 32_767;
const MAX_XLSX_TOTAL_TEXT_CHARACTERS = 8 * 1024 * 1024;
const XML_ATTRIBUTE_PATTERNS = new Map<string, RegExp>();
const XML_ENTITY_PATTERN = /&#([^;]*);|&(lt|gt|quot|apos|amp);/g;
const XML_NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

interface ZipEntry {
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface XlsxBudget {
  decompressedXmlBytes: number;
  textNodeCount: number;
  textCharacters: number;
}

export function xlsxToDelimitedText(bytes: Uint8Array): string {
  const archive = Buffer.from(bytes);
  const entries = readCentralDirectory(archive);
  const budget: XlsxBudget = {
    decompressedXmlBytes: 0,
    textNodeCount: 0,
    textCharacters: 0,
  };
  const worksheetPath = resolveFirstWorksheetPath(archive, entries, budget);
  const worksheet = readXmlEntry(archive, entries, worksheetPath, budget);
  const sharedStrings = entries.has('xl/sharedStrings.xml')
    ? parseSharedStrings(readXmlEntry(archive, entries, 'xl/sharedStrings.xml', budget), budget)
    : [];
  const rows = parseWorksheet(worksheet, sharedStrings, budget);

  if (rows.length < 2) {
    throw new Error('Excel workbook must have at least a header row and one data row');
  }

  return rowsToDelimitedText(rows);
}

function readCentralDirectory(archive: Buffer): Map<string, ZipEntry> {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error('Excel workbook is not a valid ZIP archive');
  }

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let offset = archive.readUInt32LE(endOffset + 16);
  const entries = new Map<string, ZipEntry>();

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error('Excel workbook has an invalid central directory');
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > archive.length) {
      throw new Error('Excel workbook contains an invalid file entry');
    }
    if ((flags & 0x1) !== 0) {
      throw new Error('Password-protected Excel workbooks are not supported');
    }

    const fileName = archive.subarray(nameStart, nameEnd).toString('utf8').replaceAll('\\', '/');
    entries.set(fileName, {
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function resolveFirstWorksheetPath(
  archive: Buffer,
  entries: Map<string, ZipEntry>,
  budget: XlsxBudget,
): string {
  if (entries.has('xl/workbook.xml')) {
    const workbook = readXmlEntry(archive, entries, 'xl/workbook.xml', budget);
    const firstSheetAttributes = /<sheet\b([^>]*)\/?>/i.exec(workbook)?.[1];
    const firstRelationship = firstSheetAttributes
      ? readXmlAttribute(firstSheetAttributes, 'r:id')
      : undefined;
    if (firstRelationship !== undefined) {
      if (!entries.has('xl/_rels/workbook.xml.rels')) {
        throw unresolvedWorksheetRelationship(firstRelationship);
      }

      const relationships = readXmlEntry(archive, entries, 'xl/_rels/workbook.xml.rels', budget);
      for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
        const attributes = match[1];
        const relationshipId = readXmlAttribute(attributes, 'Id');
        if (relationshipId !== firstRelationship) continue;

        const target = readXmlAttribute(attributes, 'Target');
        if (target) {
          const normalized = normalizeWorkbookTarget(target);
          if (entries.has(normalized)) return normalized;
        }
        break;
      }
      throw unresolvedWorksheetRelationship(firstRelationship);
    }
  }

  const fallback = [...entries.keys()]
    .filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/i.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0];
  if (!fallback) {
    throw new Error('Excel workbook does not contain a worksheet');
  }
  return fallback;
}

function readXmlAttribute(attributes: string, name: string): string | undefined {
  let pattern = XML_ATTRIBUTE_PATTERNS.get(name);
  if (!pattern) {
    pattern = new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
    XML_ATTRIBUTE_PATTERNS.set(name, pattern);
  }
  const match = pattern.exec(attributes);
  return match?.[1] ?? match?.[2];
}

function unresolvedWorksheetRelationship(relationshipId: string): Error {
  return new Error(
    `Excel workbook cannot resolve first worksheet relationship ${relationshipId || '(empty)'}`,
  );
}

function readXmlEntry(
  archive: Buffer,
  entries: Map<string, ZipEntry>,
  path: string,
  budget: XlsxBudget,
): string {
  const entry = entries.get(path);
  if (!entry) {
    throw new Error(`Excel workbook is missing ${path}`);
  }
  if (entry.uncompressedSize > MAX_XLSX_XML_BYTES) {
    throw new Error(`Excel worksheet is too large to import (${path})`);
  }
  const remainingXmlBytes = MAX_XLSX_TOTAL_XML_BYTES - budget.decompressedXmlBytes;
  if (remainingXmlBytes <= 0 || entry.uncompressedSize > remainingXmlBytes) {
    throw aggregateXmlBudgetError();
  }
  if (
    entry.localHeaderOffset + 30 > archive.length ||
    archive.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_HEADER
  ) {
    throw new Error(`Excel workbook has an invalid local entry for ${path}`);
  }

  const fileNameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.length) {
    throw new Error(`Excel workbook has a truncated entry for ${path}`);
  }

  const payload = archive.subarray(dataStart, dataEnd);
  let output: Buffer;
  if (entry.compression === 0) {
    output = payload;
  } else if (entry.compression === 8) {
    output = zlib.inflateRawSync(payload, {
      maxOutputLength: Math.min(MAX_XLSX_XML_BYTES, remainingXmlBytes),
    });
  } else {
    throw new Error(`Excel workbook uses unsupported ZIP compression ${entry.compression}`);
  }
  if (output.length > MAX_XLSX_XML_BYTES) {
    throw new Error(`Excel worksheet is too large to import (${path})`);
  }
  if (output.length > remainingXmlBytes) {
    throw aggregateXmlBudgetError();
  }
  budget.decompressedXmlBytes += Math.max(entry.uncompressedSize, output.length);
  return output.toString('utf8');
}

function aggregateXmlBudgetError(): Error {
  return new Error('Excel workbook exceeds the aggregate decompressed XML budget');
}

function parseSharedStrings(xml: string, budget: XlsxBudget): string[] {
  const sharedStrings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*(?:\/>|>([\s\S]*?)<\/si>)/gi)) {
    if (sharedStrings.length >= MAX_XLSX_SHARED_STRINGS) {
      throw new Error('Excel shared string count exceeds the supported limit');
    }
    sharedStrings.push(extractTextNodes(match[1] ?? '', budget));
  }
  return sharedStrings;
}

function parseWorksheet(xml: string, sharedStrings: string[], budget: XlsxBudget): string[][] {
  const rows: string[][] = [];
  let parsedRowCount = 0;
  let outputCellCount = 0;

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    parsedRowCount += 1;
    if (parsedRowCount > MAX_XLSX_ROWS) {
      throw new Error(`Excel worksheet exceeds the ${MAX_XLSX_ROWS.toLocaleString()} row limit`);
    }

    const row: string[] = [];
    const rowXml = rowMatch[1];
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attributes = cellMatch[1];
      const cellXml = cellMatch[2] ?? '';
      const reference = readXmlAttribute(attributes, 'r');
      const column = reference ? columnIndexFromCellReference(reference, row.length) : row.length;
      if (column >= MAX_EXCEL_COLUMNS) {
        throw new Error("Excel worksheet exceeds Excel's XFD column limit");
      }
      const type = readXmlAttribute(attributes, 't') ?? '';
      const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellXml)?.[1] ?? '';
      let value = '';

      if (type === 'inlineStr') {
        value = extractTextNodes(cellXml, budget);
      } else if (type === 's') {
        const sharedIndex = Number.parseInt(rawValue, 10);
        value = Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? '') : '';
      } else if (type === 'b') {
        value = rawValue === '1' ? 'true' : 'false';
      } else {
        value = decodeXml(rawValue);
      }

      if (outputCellCount + column + 1 > MAX_XLSX_OUTPUT_CELLS) {
        throw new Error(
          `Excel worksheet output dimensions exceed the ${MAX_XLSX_OUTPUT_CELLS.toLocaleString()} cell limit`,
        );
      }
      while (row.length <= column) row.push('');
      row[column] = value;
    }
    outputCellCount += row.length;
    rows.push(row);
  }

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

function extractTextNodes(xml: string, budget: XlsxBudget): string {
  let result = '';
  let stringCharacters = 0;

  for (const match of xml.matchAll(/<t\b[^>]*(?:\/>|>([\s\S]*?)<\/t>)/gi)) {
    budget.textNodeCount += 1;
    if (budget.textNodeCount > MAX_XLSX_TEXT_NODES) {
      throw new Error('Excel text node count exceeds the supported limit');
    }

    const text = decodeXml(match[1] ?? '');
    stringCharacters += text.length;
    if (stringCharacters > MAX_XLSX_STRING_CHARACTERS) {
      throw new Error('Excel cell exceeds the per-string text limit');
    }
    budget.textCharacters += text.length;
    if (budget.textCharacters > MAX_XLSX_TOTAL_TEXT_CHARACTERS) {
      throw new Error('Excel workbook exceeds the aggregate text limit');
    }
    result += text;
  }

  return result;
}

function decodeXml(value: string): string {
  return value.replace(
    XML_ENTITY_PATTERN,
    (reference: string, numericBody: string | undefined, namedEntity: string | undefined) => {
      if (namedEntity !== undefined) {
        return XML_NAMED_ENTITIES[namedEntity];
      }

      const isHex = numericBody?.startsWith('x') || numericBody?.startsWith('X');
      const digits = isHex ? numericBody?.slice(1) : numericBody;
      const validDigits = isHex ? /^[0-9a-f]+$/i : /^\d+$/;
      if (!digits || !validDigits.test(digits)) {
        throw malformedXmlCharacterReference(reference);
      }

      const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
      if (!isValidXmlCodePoint(codePoint)) {
        throw malformedXmlCharacterReference(reference);
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function isValidXmlCodePoint(codePoint: number): boolean {
  return (
    Number.isInteger(codePoint) &&
    (codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff))
  );
}

function malformedXmlCharacterReference(reference: string): Error {
  const preview = reference.length <= 32 ? reference : `${reference.slice(0, 29)}...`;
  return new Error(`Excel workbook contains a malformed XML character reference: ${preview}`);
}

function columnIndexFromCellReference(reference: string, fallbackColumn: number): number {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference);
  if (!match) return fallbackColumn;

  const rowNumber = Number(match[2]);
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_EXCEL_ROWS) {
    throw new Error(`Excel worksheet cell reference ${reference} exceeds Excel's row limit`);
  }

  let oneBasedIndex = 0;
  for (const character of match[1].toUpperCase()) {
    oneBasedIndex = oneBasedIndex * 26 + character.charCodeAt(0) - 64;
    if (oneBasedIndex > MAX_EXCEL_COLUMNS) {
      throw new Error(
        `Excel worksheet cell reference ${reference} exceeds Excel's XFD column limit`,
      );
    }
  }
  return oneBasedIndex - 1;
}

function rowsToDelimitedText(rows: string[][]): string {
  const lines: string[] = [];
  let outputCharacters = Math.max(0, rows.length - 1);

  for (const row of rows) {
    const escapedRow: string[] = [];
    for (let index = 0; index < row.length; index += 1) {
      const escaped = escapeDelimitedCell(row[index]);
      outputCharacters += escaped.length + (index === 0 ? 0 : 1);
      if (outputCharacters > MAX_XLSX_OUTPUT_CHARACTERS) {
        throw new Error('Excel worksheet output is too large to import');
      }
      escapedRow.push(escaped);
    }
    lines.push(escapedRow.join('\t'));
  }

  return lines.join('\n');
}

function normalizeWorkbookTarget(target: string): string {
  const parts = target.replaceAll('\\', '/').split('/');
  const normalized = target.startsWith('/') ? [] : ['xl'];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }

  return normalized.join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeDelimitedCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ');
  return /[\t"]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}
