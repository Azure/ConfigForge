// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import { buildXlsx } from '../diff/xlsx-builder';
import { parseExcelBaseline } from '../import-export';
import { xlsxToDelimitedText } from './xlsx-import';

interface StoredZipEntry {
  path: string;
  xml: string;
  uncompressedSize?: number;
}

function buildStoredZip(entries: StoredZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.from(entry.xml, 'utf8');
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const localBlob = Buffer.concat(localParts);
  const centralBlob = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBlob.length, 12);
  end.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, end]);
}

function workbookWithWorksheet(
  worksheet: string,
  additionalEntries: StoredZipEntry[] = [],
): Buffer {
  return buildStoredZip([
    {
      path: 'xl/workbook.xml',
      xml: '<workbook><sheets><sheet name="Baseline" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      xml: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      path: 'xl/worksheets/sheet1.xml',
      xml: `<worksheet><sheetData>${worksheet}</sheetData></worksheet>`,
    },
    ...additionalEntries,
  ]);
}

function sharedStringsXml(values: string[]): string {
  return `<sst>${values.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`;
}

function baselineRows(settingName: string): string {
  return `
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Setting Name</t></is></c>
      <c r="B1" t="inlineStr"><is><t>Registry Path</t></is></c>
      <c r="C1" t="inlineStr"><is><t>Expected Value</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>${settingName}</t></is></c>
      <c r="B2" t="inlineStr"><is><t>HKLM\\Software\\Example</t></is></c>
      <c r="C2"><v>1</v></c>
    </row>`;
}

function baselineWorksheet(settingName: string): string {
  return `<worksheet><sheetData>${baselineRows(settingName)}</sheetData></worksheet>`;
}

describe('xlsxToDelimitedText', () => {
  it('reads the first worksheet from a real XLSX archive', () => {
    const workbook = buildXlsx([
      {
        name: 'Baseline',
        rows: [
          [{ value: 'Setting Name' }, { value: 'Registry Path' }, { value: 'Expected Value' }],
          [
            { value: 'PasswordHistory' },
            { value: 'HKLM\\Software\\Policies\\Example' },
            { value: 24 },
          ],
        ],
      },
    ]);

    const settings = parseExcelBaseline(xlsxToDelimitedText(workbook));

    expect(settings).toEqual([
      expect.objectContaining({
        settingName: 'PasswordHistory',
        registryPath: 'HKLM\\Software\\Policies\\Example',
        expectedValue: '24',
      }),
    ]);
  });

  it('rejects data that is not an XLSX ZIP archive', () => {
    expect(() => xlsxToDelimitedText(Buffer.from('not-a-workbook'))).toThrow(/valid ZIP archive/);
  });

  it.each(['XFE1', 'ZZZZZZZZ1'])(
    'rejects worksheet cell reference %s beyond Excel column XFD',
    (reference) => {
      const workbook = workbookWithWorksheet(
        `<row r="1"><c r="${reference}" t="inlineStr"><is><t>value</t></is></c></row>`,
      );

      expect(() => xlsxToDelimitedText(workbook)).toThrow(/XFD column limit/);
    },
  );

  it('accepts cells at the Excel XFD column boundary', () => {
    const workbook = workbookWithWorksheet(`
      <row r="1"><c r="XFD1" t="inlineStr"><is><t>Header</t></is></c></row>
      <row r="2"><c r="XFD2" t="inlineStr"><is><t>Value</t></is></c></row>
    `);

    const [header, value] = xlsxToDelimitedText(workbook).split('\n');

    expect(header.endsWith('Header')).toBe(true);
    expect(value.endsWith('Value')).toBe(true);
  });

  it('caps expanded worksheet output dimensions', () => {
    const rows = Array.from(
      { length: 62 },
      (_, index) =>
        `<row r="${index + 1}"><c r="XFD${index + 1}" t="inlineStr"><is><t>value</t></is></c></row>`,
    ).join('');

    expect(() => xlsxToDelimitedText(workbookWithWorksheet(rows))).toThrow(/output dimensions/);
  });

  it('caps the number of worksheet rows processed', () => {
    const rows = '<row></row>'.repeat(100_001);

    expect(() => xlsxToDelimitedText(workbookWithWorksheet(rows))).toThrow(/row limit/);
  });

  it('selects the declared first sheet when relationship attributes are reordered', () => {
    const workbook = buildStoredZip([
      {
        path: 'xl/workbook.xml',
        xml: `<workbook><sheets>
          <sheet name="Selected" sheetId="2" r:id="rId2"/>
          <sheet name="Not selected" sheetId="1" r:id="rId1"/>
        </sheets></workbook>`,
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        xml: `<Relationships>
          <Relationship Target="worksheets/sheet1.xml" Id="rId1"/>
          <Relationship Target="worksheets/sheet2.xml" Id="rId2"/>
        </Relationships>`,
      },
      {
        path: 'xl/worksheets/sheet1.xml',
        xml: baselineWorksheet('WrongSheet'),
      },
      {
        path: 'xl/worksheets/sheet2.xml',
        xml: baselineWorksheet('DeclaredFirstSheet'),
      },
    ]);

    const settings = parseExcelBaseline(xlsxToDelimitedText(workbook));

    expect(settings[0]?.settingName).toBe('DeclaredFirstSheet');
  });

  it('supports single-quoted workbook relationship attributes', () => {
    const workbook = buildStoredZip([
      {
        path: 'xl/workbook.xml',
        xml: `<workbook><sheets>
          <sheet name='Selected' sheetId='2' r:id='rId2'/>
          <sheet name='Not selected' sheetId='1' r:id='rId1'/>
        </sheets></workbook>`,
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        xml: `<Relationships>
          <Relationship Target='worksheets/sheet1.xml' Id='rId1'/>
          <Relationship Target='worksheets/sheet2.xml' Id='rId2'/>
        </Relationships>`,
      },
      {
        path: 'xl/worksheets/sheet1.xml',
        xml: baselineWorksheet('WrongSheet'),
      },
      {
        path: 'xl/worksheets/sheet2.xml',
        xml: baselineWorksheet('SingleQuotedFirstSheet'),
      },
    ]);

    const settings = parseExcelBaseline(xlsxToDelimitedText(workbook));

    expect(settings[0]?.settingName).toBe('SingleQuotedFirstSheet');
  });

  it('rejects an unresolved declared first-sheet relationship', () => {
    const workbook = buildStoredZip([
      {
        path: 'xl/workbook.xml',
        xml: '<workbook><sheets><sheet name="Missing" sheetId="2" r:id="rId2"/></sheets></workbook>',
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        xml: '<Relationships><Relationship Id="rId2" Target="worksheets/missing.xml"/></Relationships>',
      },
      {
        path: 'xl/worksheets/sheet1.xml',
        xml: baselineWorksheet('FallbackMustNotBeUsed'),
      },
    ]);

    expect(() => xlsxToDelimitedText(workbook)).toThrow(/cannot resolve.*rId2/i);
  });

  it('supports single-quoted worksheet cell reference and type attributes', () => {
    const workbook = workbookWithWorksheet(
      `<row r="1">
        <c t='s' r='C1'><v>2</v></c>
        <c r='A1' t='s'><v>0</v></c>
        <c t='s' r='B1'><v>1</v></c>
      </row>
      <row r="2">
        <c t='s' r='A2'><v>3</v></c>
        <c r='B2' t='s'><v>4</v></c>
        <c t='s' r='C2'><v>5</v></c>
      </row>`,
      [
        {
          path: 'xl/sharedStrings.xml',
          xml: sharedStringsXml([
            'Setting Name',
            'Registry Path',
            'Expected Value',
            'SingleQuotedCell',
            'HKLM\\Software\\SingleQuoted',
            '1',
          ]),
        },
      ],
    );

    const settings = parseExcelBaseline(xlsxToDelimitedText(workbook));

    expect(settings[0]).toEqual(
      expect.objectContaining({
        settingName: 'SingleQuotedCell',
        registryPath: 'HKLM\\Software\\SingleQuoted',
        expectedValue: '1',
      }),
    );
  });

  it('caps the number of shared strings parsed', () => {
    const workbook = workbookWithWorksheet(baselineRows('CountLimit'), [
      {
        path: 'xl/sharedStrings.xml',
        xml: `<sst>${'<si></si>'.repeat(100_001)}</sst>`,
      },
    ]);

    expect(() => xlsxToDelimitedText(workbook)).toThrow(/shared string count/i);
  });

  it('caps the number of text nodes parsed', () => {
    const workbook = workbookWithWorksheet(baselineRows('TextNodeLimit'), [
      {
        path: 'xl/sharedStrings.xml',
        xml: `<sst><si>${'<t></t>'.repeat(200_001)}</si></sst>`,
      },
    ]);

    expect(() => xlsxToDelimitedText(workbook)).toThrow(/text node count/i);
  });

  it('caps text length for each shared string', () => {
    const workbook = workbookWithWorksheet(baselineRows('StringLimit'), [
      {
        path: 'xl/sharedStrings.xml',
        xml: `<sst><si><t>${'x'.repeat(32_768)}</t></si></sst>`,
      },
    ]);

    expect(() => xlsxToDelimitedText(workbook)).toThrow(/per-string text limit/i);
  });

  it('caps aggregate shared-string text', () => {
    const maxLengthString = `<si><t>${'x'.repeat(32_767)}</t></si>`;
    const workbook = workbookWithWorksheet(baselineRows('AggregateLimit'), [
      {
        path: 'xl/sharedStrings.xml',
        xml: `<sst>${maxLengthString.repeat(257)}</sst>`,
      },
    ]);

    expect(() => xlsxToDelimitedText(workbook)).toThrow(/aggregate text limit/i);
  });

  it('caps aggregate decompressed XML across workbook parts', () => {
    const mebibyte = 1024 * 1024;
    const workbook = buildStoredZip([
      {
        path: 'xl/workbook.xml',
        xml: '<workbook><sheets><sheet name="Baseline" sheetId="1" r:id="rId1"/></sheets></workbook>',
        uncompressedSize: 30 * mebibyte,
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        xml: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        uncompressedSize: 30 * mebibyte,
      },
      {
        path: 'xl/worksheets/sheet1.xml',
        xml: baselineWorksheet('XmlBudget'),
        uncompressedSize: 8 * mebibyte,
      },
    ]);

    expect(() => xlsxToDelimitedText(workbook)).toThrow(/aggregate decompressed XML budget/i);
  });

  it('does not decode replacement text as another XML entity', () => {
    const workbook = workbookWithWorksheet(`
      <row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>&#38;lt;</t></is></c></row>
    `);

    expect(xlsxToDelimitedText(workbook)).toBe('Header\n&lt;');
  });

  it.each(['&#x110000;', '&#xD800;', '&#0;', '&#xZZ;'])(
    'rejects invalid XML character reference %s',
    (reference) => {
      const workbook = workbookWithWorksheet(`
        <row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>${reference}</t></is></c></row>
      `);

      expect(() => xlsxToDelimitedText(workbook)).toThrow(/malformed XML character reference/i);
    },
  );
});
