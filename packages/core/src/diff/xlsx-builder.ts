// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR23: minimal stdlib-only XLSX writer.
 *
 * NOTE: the PR23 task description references `exceljs`, but it is not
 * actually present in package.json (and node_modules is a junction we
 * can't extend with `npm install`). Rather than block the feature on a
 * dependency change, this module hand-rolls the OOXML format using only
 * Node's built-in `zlib` for the deflate compression — XLSX is just a
 * zip containing well-known XML parts. Excel, LibreOffice, and the
 * Open Office XML viewers all accept the output.
 *
 * If exceljs lands in deps later, swap this for the higher-level API
 * — public function shape is unchanged.
 */

import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

export interface XlsxColor {
  /** ARGB hex (e.g. `FF00FF00` for green) — alpha first. */
  argb: string;
}

export interface XlsxCell {
  value: string | number | boolean | null;
  fill?: XlsxColor;
  bold?: boolean;
}

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

interface ZipEntry {
  path: string;
  data: Buffer;
  /** CRC32 of `data`. */
  crc: number;
  /** Deflated payload (or `data` if storeOnly). */
  payload: Buffer;
  storeOnly: boolean;
}

/** Build an .xlsx as a Buffer from a list of sheets. */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  const parts: Array<{ path: string; xml: string }> = [];

  parts.push({
    path: '[Content_Types].xml',
    xml: contentTypesXml(sheets.length),
  });
  parts.push({ path: '_rels/.rels', xml: relsXml() });
  parts.push({ path: 'xl/workbook.xml', xml: workbookXml(sheets) });
  parts.push({ path: 'xl/_rels/workbook.xml.rels', xml: workbookRelsXml(sheets) });
  parts.push({ path: 'xl/styles.xml', xml: stylesXml() });

  for (let i = 0; i < sheets.length; i++) {
    parts.push({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      xml: sheetXml(sheets[i]),
    });
  }

  // Build each entry with its CRC + deflate payload.
  const entries: ZipEntry[] = parts.map(({ path, xml }) => {
    const data = Buffer.from(xml, 'utf8');
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data);
    // Store-only is only used if deflate would inflate the payload.
    const storeOnly = deflated.length >= data.length;
    return {
      path,
      data,
      crc,
      payload: storeOnly ? data : deflated,
      storeOnly,
    };
  });

  return assembleZip(entries);
}

// ── XML builders ────────────────────────────────────────────────────────────

function contentTypesXml(sheetCount: number): string {
  const overrides: string[] = [];
  for (let i = 0; i < sheetCount; i++) {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overrides.join('\n  ')}
</Types>`;
}

function relsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets: XlsxSheet[]): string {
  const refs = sheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${refs}</sheets>
</workbook>`;
}

function workbookRelsXml(sheets: XlsxSheet[]): string {
  const rels = sheets
    .map(
      (_s, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('');
  // Styles has the next available rId.
  const stylesId = sheets.length + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
  <Relationship Id="rId${stylesId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

/**
 * 6 cellXfs entries:
 *   0 = default
 *   1 = bold (header)
 *   2 = green fill (identical)
 *   3 = red fill (differs)
 *   4 = yellow fill (only-in)
 *   5 = bold + grey fill (header)
 */
function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

const STYLE_DEFAULT = 0;
const STYLE_BOLD = 1;
const STYLE_GREEN = 2;
const STYLE_RED = 3;
const STYLE_YELLOW = 4;
const STYLE_HEADER = 5;

/** @internal — exported for `xlsx-builder` consumers (and tests). */
export const STYLE_INDEX = {
  default: STYLE_DEFAULT,
  bold: STYLE_BOLD,
  green: STYLE_GREEN,
  red: STYLE_RED,
  yellow: STYLE_YELLOW,
  header: STYLE_HEADER,
} as const;

function sheetXml(sheet: XlsxSheet): string {
  const rows: string[] = [];
  for (let r = 0; r < sheet.rows.length; r++) {
    const cells: string[] = [];
    for (let c = 0; c < sheet.rows[r].length; c++) {
      const cell = sheet.rows[r][c];
      cells.push(cellXml(c, r, cell));
    }
    rows.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows.join('')}</sheetData>
</worksheet>`;
}

function cellXml(colIdx: number, rowIdx: number, cell: XlsxCell): string {
  const ref = `${colLetter(colIdx)}${rowIdx + 1}`;
  let style = STYLE_DEFAULT;
  if (cell.bold) style = rowIdx === 0 ? STYLE_HEADER : STYLE_BOLD;
  if (cell.fill) {
    if (cell.fill.argb === 'FFC6EFCE') style = STYLE_GREEN;
    else if (cell.fill.argb === 'FFFFC7CE') style = STYLE_RED;
    else if (cell.fill.argb === 'FFFFEB9C') style = STYLE_YELLOW;
  }
  if (cell.value === null || cell.value === undefined || cell.value === '') {
    return `<c r="${ref}" s="${style}"/>`;
  }
  if (typeof cell.value === 'number') {
    return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
  }
  if (typeof cell.value === 'boolean') {
    return `<c r="${ref}" s="${style}" t="b"><v>${cell.value ? 1 : 0}</v></c>`;
  }
  // Inline string — avoids the shared-strings part entirely.
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell.value))}</t></is></c>`;
}

function colLetter(idx: number): string {
  let s = '';
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Zip + CRC32 ─────────────────────────────────────────────────────────────

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

function assembleZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const method = entry.storeOnly ? 0 : 8;

    // Local file header (30 bytes + name).
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBuf, entry.payload);

    // Central directory entry (46 bytes + name).
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12); // mod time
    cd.writeUInt16LE(0, 14); // mod date
    cd.writeUInt32LE(entry.crc, 16);
    cd.writeUInt32LE(entry.payload.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk #
    cd.writeUInt16LE(0, 36); // internal
    cd.writeUInt32LE(0, 38); // external
    cd.writeUInt32LE(offset, 42);

    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + entry.payload.length;
  }

  const localBlob = Buffer.concat(localParts);
  const centralBlob = Buffer.concat(central);

  // End-of-central-directory.
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBlob, centralBlob, eocd]);
}

/**
 * Stable hash for caching XLSX bytes by sheet content. Useful in tests.
 * @internal
 */
export function xlsxFingerprint(sheets: XlsxSheet[]): string {
  return createHash('sha256').update(JSON.stringify(sheets)).digest('hex').slice(0, 16);
}
