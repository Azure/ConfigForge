// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export const DIFF_MATRIX_PRESELECTION_MAX = 10;

export interface MatrixDiffLocationState {
  configForgeDiff: {
    version: 1;
    tab: "matrix";
    baselineNames: string[];
  };
}

export interface PairwiseDiffLocationState {
  configForgeDiff: {
    version: 1;
    tab: "pairwise";
    baselineNames: [string, string];
  };
}

function normalizeBaselineNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length === DIFF_MATRIX_PRESELECTION_MAX) break;
  }
  return names;
}

export function createMatrixDiffLocationState(
  baselineNames: Iterable<string>,
): MatrixDiffLocationState {
  return {
    configForgeDiff: {
      version: 1,
      tab: "matrix",
      baselineNames: normalizeBaselineNames(Array.from(baselineNames)),
    },
  };
}

export function createPairwiseDiffLocationState(
  baselineNames: Iterable<string>,
): PairwiseDiffLocationState | null {
  const names = normalizeBaselineNames(Array.from(baselineNames));
  if (names.length !== 2) return null;
  return {
    configForgeDiff: {
      version: 1,
      tab: "pairwise",
      baselineNames: [names[0], names[1]],
    },
  };
}

export function readMatrixDiffLocationState(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const envelope = (state as Record<string, unknown>).configForgeDiff;
  if (!envelope || typeof envelope !== "object") return [];
  const value = envelope as Record<string, unknown>;
  if (value.version !== 1 || value.tab !== "matrix") return [];
  return normalizeBaselineNames(value.baselineNames);
}

export function readPairwiseDiffLocationState(
  state: unknown,
): [string, string] | [] {
  if (!state || typeof state !== "object") return [];
  const envelope = (state as Record<string, unknown>).configForgeDiff;
  if (!envelope || typeof envelope !== "object") return [];
  const value = envelope as Record<string, unknown>;
  if (value.version !== 1 || value.tab !== "pairwise") return [];
  const names = normalizeBaselineNames(value.baselineNames);
  return names.length === 2 ? [names[0], names[1]] : [];
}

export function clearMatrixDiffLocationState(state: unknown): {
  consumed: boolean;
  state: unknown;
} {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { consumed: false, state };
  }
  const current = state as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(current, "configForgeDiff")) {
    return { consumed: false, state };
  }
  const next = { ...current };
  delete next.configForgeDiff;
  return {
    consumed: true,
    state: Object.keys(next).length > 0 ? next : null,
  };
}
