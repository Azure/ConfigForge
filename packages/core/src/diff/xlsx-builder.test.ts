// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { buildXlsx, xlsxFingerprint, type XlsxSheet } from './xlsx-builder';

const sheet: XlsxSheet = {
  name: 'Matrix',
  rows: [
    [
      { value: 'Setting', bold: true },
      { value: 'WS2022', bold: true },
      { value: 'WS2025', bold: true },
    ],
    [
      { value: 'MaxAuthTries' },
      { value: 5, fill: { argb: 'FFC6EFCE' } },
      { value: 3, fill: { argb: 'FFFFC7CE' } },
    ],
    [
      { value: 'NewSetting' },
      { value: '', fill: { argb: 'FFFFEB9C' } },
      { value: 'X', fill: { argb: 'FFFFEB9C' } },
    ],
  ],
};

describe('buildXlsx', () => {
  it('emits a buffer that starts with the zip "PK" magic bytes', () => {
    const buf = buildXlsx([sheet]);
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it('contains an end-of-central-directory record', () => {
    const buf = buildXlsx([sheet]);
    // EOCD signature 0x06054b50 must be present near the end.
    const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const idx = buf.indexOf(sig);
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeGreaterThan(buf.length - 1024); // within last 1KB
  });

  it('embeds the sheet data XML decompressibly', () => {
    const buf = buildXlsx([sheet]);
    // Walk the central directory and find sheet1.xml. Easiest sanity
    // check: scan local file headers for the path string.
    const idx = buf.indexOf(Buffer.from('xl/worksheets/sheet1.xml', 'utf8'));
    expect(idx).toBeGreaterThan(0);
    // Verify deflate-decoding the file data round-trips a known cell
    // value. We pick the first occurrence (local file header) and read
    // the compressed/uncompressed sizes from the preceding header.
    const localHeaderStart = idx - 30; // 30-byte fixed local header
    expect(buf.readUInt32LE(localHeaderStart)).toBe(0x04034b50);
    const method = buf.readUInt16LE(localHeaderStart + 8);
    const compSize = buf.readUInt32LE(localHeaderStart + 18);
    const nameLen = buf.readUInt16LE(localHeaderStart + 26);
    const dataStart = localHeaderStart + 30 + nameLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const decoded =
      method === 0 ? compressed : zlib.inflateRawSync(compressed);
    const text = decoded.toString('utf8');
    expect(text).toContain('MaxAuthTries');
    expect(text).toContain('<v>5</v>');
  });

  it('is deterministic for identical input', () => {
    const a = buildXlsx([sheet]);
    const b = buildXlsx([sheet]);
    expect(a.equals(b)).toBe(true);
    expect(xlsxFingerprint([sheet])).toBe(xlsxFingerprint([sheet]));
  });
});
