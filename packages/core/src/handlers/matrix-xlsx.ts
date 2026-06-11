// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:diff:matrix-xlsx` (GET /api/diff/matrix.xlsx).
 *
 * Builds an Excel workbook containing the matrix view across N
 * registered manifests with conditional formatting. Returns the raw
 * .xlsx bytes plus a default filename.
 */
import {
  getRegistrationSource,
  parseYamlDocument,
  sanitizeNamespace,
} from '../oscfg';
import { buildMatrix, type MatrixCell } from '../diff/matrix';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../diff/xlsx-builder';
import { HandlerError } from './errors';

export const MATRIX_XLSX_MAX_BASELINES = 10;

const FILL_GREEN = { argb: 'FFC6EFCE' };
const FILL_RED = { argb: 'FFFFC7CE' };
const FILL_YELLOW = { argb: 'FFFFEB9C' };

export interface MatrixXlsxArtifact {
  filename: string;
  contentType: string;
  body: Uint8Array;
}

export async function buildMatrixXlsx(rawNames: string): Promise<MatrixXlsxArtifact> {
  const requested = (rawNames ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of requested) {
    const key = sanitizeNamespace(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length < 2) {
    throw new HandlerError(400, 'At least 2 distinct manifest names are required');
  }
  if (uniqueNames.length > MATRIX_XLSX_MAX_BASELINES) {
    throw new HandlerError(
      400,
      `At most ${MATRIX_XLSX_MAX_BASELINES} manifests can be compared at once`,
    );
  }

  const fetched = await Promise.all(
    uniqueNames.map(async (name) => {
      const ns = sanitizeNamespace(name);
      const yamlText = await getRegistrationSource(ns);
      if (!yamlText) return null;
      return { name, doc: parseYamlDocument(yamlText) as Record<string, unknown> };
    }),
  );
  const present = fetched.filter(
    (f): f is { name: string; doc: Record<string, unknown> } => f !== null,
  );

  if (present.length < 2) {
    throw new HandlerError(400, 'Fewer than 2 of the requested manifests are registered');
  }

  const matrix = buildMatrix(present);
  const baselineNames = present.map((p) => p.name);

  const header: XlsxCell[] = [
    { value: 'Type', bold: true },
    { value: 'Setting', bold: true },
    { value: 'KeyPath', bold: true },
    { value: 'Status', bold: true },
    ...baselineNames.map((n) => ({ value: n, bold: true })),
  ];

  const dataRows: XlsxCell[][] = matrix.map((row) => {
    const valueCells: XlsxCell[] = baselineNames.map((bname) => {
      const cell: MatrixCell = row.values[bname];
      return cellFor(cell);
    });
    return [
      { value: row.type },
      { value: row.name || row.valueName || '' },
      { value: row.keyPath ?? '' },
      { value: row.status },
      ...valueCells,
    ];
  });

  const sheet: XlsxSheet = {
    name: 'Matrix',
    rows: [header, ...dataRows],
  };

  const buf = buildXlsx([sheet]);
  return {
    filename: 'matrix.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: new Uint8Array(buf),
  };
}

function cellFor(cell: MatrixCell | undefined): XlsxCell {
  if (!cell || cell.status === 'missing') {
    return { value: '', fill: FILL_YELLOW };
  }
  const value = formatCellValue(cell.value);
  if (cell.status === 'identical') return { value, fill: FILL_GREEN };
  return { value, fill: FILL_RED };
}

function formatCellValue(v: unknown): string | number | boolean | null {
  if (v === undefined) return '';
  if (v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
