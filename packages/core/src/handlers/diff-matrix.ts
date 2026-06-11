// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:diff:matrix` and `GET /api/diff/matrix?names=…`.
 *
 * N-way master-matrix diff (PR23). Caps at 10 baselines so the UI
 * doesn't break visually. Reads each manifest's source YAML, parses,
 * builds the matrix in pure JS.
 */
import {
  getRegistrationSource,
  parseYamlDocument,
  sanitizeNamespace,
} from '../oscfg';
import { buildMatrix, type MatrixRow } from '../diff/matrix';
import { HandlerError } from './errors';

export const MAX_BASELINES = 10;

export interface DiffMatrixResult {
  baselines: string[];
  missing: string[];
  matrix: MatrixRow[];
  stats: {
    identical: number;
    differs: number;
    partial: number;
    totalRows: number;
  };
}

export async function getDiffMatrix(rawNames: string): Promise<DiffMatrixResult> {
  const requested = (rawNames ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Dedup case-insensitively while preserving the first-seen order.
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of requested) {
    const key = sanitizeNamespace(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length < 2) {
    throw new HandlerError(
      400,
      'At least 2 distinct manifest names are required (?names=a,b)',
    );
  }
  if (uniqueNames.length > MAX_BASELINES) {
    throw new HandlerError(
      400,
      `At most ${MAX_BASELINES} manifests can be compared at once`,
    );
  }

  const fetched = await Promise.all(
    uniqueNames.map(async (name) => {
      const ns = sanitizeNamespace(name);
      const yamlText = await getRegistrationSource(ns);
      if (!yamlText) {
        return { name, doc: null, missing: true } as const;
      }
      const doc = parseYamlDocument(yamlText) as Record<string, unknown>;
      return { name, doc, missing: false } as const;
    }),
  );

  const present = fetched.filter(
    (f): f is { name: string; doc: Record<string, unknown>; missing: false } => !f.missing,
  );
  const missing = fetched.filter((f) => f.missing).map((f) => f.name);

  if (present.length < 2) {
    throw new HandlerError(400, 'Fewer than 2 of the requested manifests are registered', {
      data: { missing },
    });
  }

  const matrix = buildMatrix(
    present.map(({ name, doc }) => ({ name, doc })),
  );
  const stats = computeStats(matrix);

  return {
    baselines: present.map((p) => p.name),
    missing,
    matrix,
    stats,
  };
}

function computeStats(matrix: MatrixRow[]) {
  let identical = 0;
  let differs = 0;
  let partial = 0;
  for (const row of matrix) {
    if (row.status === 'identical') identical++;
    else if (row.status === 'differs') differs++;
    else partial++;
  }
  return { identical, differs, partial, totalRows: matrix.length };
}
