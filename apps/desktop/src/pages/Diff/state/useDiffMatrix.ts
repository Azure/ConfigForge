// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useCallback, useRef, useState } from "react";
import type { MatrixRow } from "@configforge/core/diff/matrix";
import { cfs } from "../../../lib/cfs";

export interface MatrixApiResponse {
  baselines: string[];
  missing: string[];
  matrix: MatrixRow[];
  stats: { identical: number; differs: number; partial: number; totalRows: number };
}

export const MATRIX_MAX_SELECTION = 10;

export interface UseDiffMatrixOptions {
  /** Optional IPC override for tests. */
  diffClient?: { matrix: (names: string) => Promise<unknown>; matrixXlsxSave?: (names: string) => Promise<unknown> };
  /** Validated baseline names supplied by route navigation state. */
  initialSelected?: Iterable<string>;
}

function normalizeInitialSelection(value: Iterable<string> | undefined): Set<string> {
  const selected = new Set<string>();
  if (!value) return selected;
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (!name) continue;
    selected.add(name);
    if (selected.size === MATRIX_MAX_SELECTION) break;
  }
  return selected;
}

/**
 * Owns Matrix-tab state for the Diff page: which manifests are selected,
 * the loaded matrix data, loading/error UI flags, and a token-ref
 * race-guard so a stale slow fetch can't overwrite a fresh fast one.
 *
 * Critical regression: v0.1.13 introduced matrixLoadTokenRef after a
 * support thread where rapid Matrix Compare clicks would render stale
 * data — the test below locks this in. Also v0.1.14 surfaces the
 * 10-cap with a user-visible message instead of silent no-op.
 */
export function useDiffMatrix(options: UseDiffMatrixOptions = {}) {
  const diffClient = options.diffClient ?? cfs.diff;

  const [matrixSelected, setMatrixSelected] = useState<Set<string>>(() =>
    normalizeInitialSelection(options.initialSelected),
  );
  const [matrixData, setMatrixData] = useState<MatrixApiResponse | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  // v0.1.13 fix — token ref so rapid Matrix Compare clicks don't race.
  // Previously a slow fetch for selection A could resolve AFTER a fast
  // fetch for selection B and overwrite matrixData with the wrong rows.
  const matrixLoadTokenRef = useRef(0);

  const reconcileMatrixSelection = useCallback(
    (availableNames: Iterable<string>) => {
      const available = new Set(
        Array.from(availableNames)
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean),
      );
      setMatrixSelected((previous) => {
        const next = new Set(
          Array.from(previous).filter((name) => available.has(name)),
        );
        if (
          next.size === previous.size &&
          Array.from(next).every((name) => previous.has(name))
        ) {
          return previous;
        }

        // Pruning invalidates results based on a missing registration and
        // cancels any compare response that was already in flight.
        matrixLoadTokenRef.current += 1;
        setMatrixData(null);
        setMatrixLoading(false);
        setMatrixError(null);
        return next;
      });
    },
    [],
  );

  const toggleMatrixSelection = useCallback((name: string) => {
    setMatrixSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        setMatrixError(null);
        return next;
      }
      if (next.size < MATRIX_MAX_SELECTION) {
        next.add(name);
        setMatrixError(null);
        return next;
      }
      // v0.1.14: surface the 10-cap to the user. Without this, clicking
      // an 11th manifest to add to the matrix silently no-ops; the user
      // gets no feedback that their click did nothing.
      setMatrixError(
        `Matrix compare is limited to ${MATRIX_MAX_SELECTION} manifests. Deselect one before adding another.`,
      );
      return prev;
    });
  }, []);

  const runMatrixCompare = useCallback(async () => {
    if (matrixSelected.size < 2) return;
    setMatrixLoading(true);
    setMatrixError(null);
    setMatrixData(null);
    const token = ++matrixLoadTokenRef.current;
    try {
      const names = Array.from(matrixSelected).join(",");
      const json = await diffClient.matrix(names);
      if (token !== matrixLoadTokenRef.current) return;
      setMatrixData(json as MatrixApiResponse);
    } catch (err) {
      if (token !== matrixLoadTokenRef.current) return;
      const e = err as { message?: string; data?: { missing?: string[] } };
      setMatrixError(e?.message ?? "Failed to compute matrix");
    } finally {
      if (token === matrixLoadTokenRef.current) setMatrixLoading(false);
    }
  }, [diffClient, matrixSelected]);

  const downloadMatrixXlsx = useCallback(async () => {
    if (matrixSelected.size < 2) return;
    const names = Array.from(matrixSelected).join(",");
    try {
      await diffClient.matrixXlsxSave?.(names);
    } catch (err) {
      setMatrixError(err instanceof Error ? err.message : "Save failed");
    }
  }, [diffClient, matrixSelected]);

  return {
    matrixSelected,
    setMatrixSelected,
    matrixData,
    matrixLoading,
    matrixError,
    setMatrixError,
    toggleMatrixSelection,
    reconcileMatrixSelection,
    runMatrixCompare,
    downloadMatrixXlsx,
    MATRIX_MAX_SELECTION,
  };
}
