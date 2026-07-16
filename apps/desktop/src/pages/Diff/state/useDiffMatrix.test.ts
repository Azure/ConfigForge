// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDiffMatrix, MATRIX_MAX_SELECTION } from "./useDiffMatrix";

function makeClient(
  matrix: ReturnType<typeof vi.fn> = vi.fn(),
  matrixXlsxSave: ReturnType<typeof vi.fn> = vi.fn(),
) {
  return { matrix, matrixXlsxSave };
}

describe("useDiffMatrix", () => {
  it("starts with empty selection and no matrix data", () => {
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient() }));
    expect(result.current.matrixSelected.size).toBe(0);
    expect(result.current.matrixData).toBeNull();
    expect(result.current.matrixLoading).toBe(false);
    expect(result.current.matrixError).toBeNull();
  });

  it("safely seeds a unique Matrix selection capped at ten", () => {
    const initialSelected = [
      "alpha",
      "alpha",
      ...Array.from({ length: 15 }, (_, index) => `baseline-${index}`),
    ];
    const { result } = renderHook(() =>
      useDiffMatrix({ diffClient: makeClient(), initialSelected }),
    );

    expect(Array.from(result.current.matrixSelected)).toEqual([
      "alpha",
      "baseline-0",
      "baseline-1",
      "baseline-2",
      "baseline-3",
      "baseline-4",
      "baseline-5",
      "baseline-6",
      "baseline-7",
      "baseline-8",
    ]);
  });

  it("toggleMatrixSelection adds a name on first click and removes it on second", () => {
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient() }));
    act(() => {
      result.current.toggleMatrixSelection("alpha");
    });
    expect(result.current.matrixSelected.has("alpha")).toBe(true);
    expect(result.current.matrixSelected.size).toBe(1);

    act(() => {
      result.current.toggleMatrixSelection("alpha");
    });
    expect(result.current.matrixSelected.has("alpha")).toBe(false);
    expect(result.current.matrixSelected.size).toBe(0);
  });

  it("toggleMatrixSelection enforces the 10-cap and sets a user-visible error", () => {
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient() }));
    act(() => {
      for (let i = 0; i < MATRIX_MAX_SELECTION; i += 1) {
        result.current.toggleMatrixSelection(`m-${i}`);
      }
    });
    expect(result.current.matrixSelected.size).toBe(MATRIX_MAX_SELECTION);
    expect(result.current.matrixError).toBeNull();

    act(() => {
      result.current.toggleMatrixSelection("m-overflow");
    });
    expect(result.current.matrixSelected.size).toBe(MATRIX_MAX_SELECTION);
    expect(result.current.matrixSelected.has("m-overflow")).toBe(false);
    expect(result.current.matrixError).toMatch(/limited to 10 manifests/);

    // Removing one should clear the error
    act(() => {
      result.current.toggleMatrixSelection("m-0");
    });
    expect(result.current.matrixError).toBeNull();
    expect(result.current.matrixSelected.size).toBe(MATRIX_MAX_SELECTION - 1);
  });

  it("prunes missing route selections after the authoritative manifest list loads", () => {
    const initialSelected = [
      "alpha",
      "missing-1",
      "missing-2",
      "beta",
      "missing-3",
      "missing-4",
      "missing-5",
      "missing-6",
      "missing-7",
      "missing-8",
    ];
    const { result } = renderHook(() =>
      useDiffMatrix({ diffClient: makeClient(), initialSelected }),
    );

    act(() => {
      result.current.reconcileMatrixSelection(["alpha", "beta", "gamma"]);
    });

    expect(Array.from(result.current.matrixSelected)).toEqual(["alpha", "beta"]);
    act(() => result.current.toggleMatrixSelection("gamma"));
    expect(Array.from(result.current.matrixSelected)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("runMatrixCompare with fewer than 2 selections is a no-op", async () => {
    const matrix = vi.fn().mockResolvedValue({ baselines: [], missing: [], matrix: [], stats: { identical: 0, differs: 0, partial: 0, totalRows: 0 } });
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient(matrix) }));

    act(() => {
      result.current.toggleMatrixSelection("only-one");
    });

    await act(async () => {
      await result.current.runMatrixCompare();
    });

    expect(matrix).not.toHaveBeenCalled();
    expect(result.current.matrixLoading).toBe(false);
    expect(result.current.matrixData).toBeNull();
  });

  it("runMatrixCompare on success loads matrix data and clears loading flag", async () => {
    const payload = {
      baselines: ["a", "b"],
      missing: [],
      matrix: [],
      stats: { identical: 0, differs: 0, partial: 0, totalRows: 0 },
    };
    const matrix = vi.fn().mockResolvedValue(payload);
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient(matrix) }));

    act(() => {
      result.current.toggleMatrixSelection("a");
      result.current.toggleMatrixSelection("b");
    });

    await act(async () => {
      await result.current.runMatrixCompare();
    });

    expect(matrix).toHaveBeenCalledWith("a,b");
    expect(result.current.matrixData).toEqual(payload);
    expect(result.current.matrixLoading).toBe(false);
    expect(result.current.matrixError).toBeNull();
  });

  it("runMatrixCompare on failure sets matrixError and clears matrixData", async () => {
    const matrix = vi.fn().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient(matrix) }));

    act(() => {
      result.current.toggleMatrixSelection("a");
      result.current.toggleMatrixSelection("b");
    });

    await act(async () => {
      await result.current.runMatrixCompare();
    });

    expect(result.current.matrixError).toBe("network down");
    expect(result.current.matrixData).toBeNull();
    expect(result.current.matrixLoading).toBe(false);
  });

  it("matrixLoadTokenRef race-guard: stale slow fetch does NOT overwrite fresh fast fetch (v0.1.13)", async () => {
    let resolveSlow: ((v: unknown) => void) | null = null;
    const slowPromise = new Promise((res) => {
      resolveSlow = res;
    });
    const fastPayload = {
      baselines: ["fast"],
      missing: [],
      matrix: [],
      stats: { identical: 0, differs: 0, partial: 0, totalRows: 0 },
    };
    const slowPayload = {
      baselines: ["stale"],
      missing: [],
      matrix: [],
      stats: { identical: 0, differs: 0, partial: 0, totalRows: 0 },
    };

    // First call returns slow promise (will resolve LAST), second call returns immediately
    const matrix = vi
      .fn()
      .mockImplementationOnce(() => slowPromise.then(() => slowPayload))
      .mockImplementationOnce(() => Promise.resolve(fastPayload));

    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient(matrix) }));

    act(() => {
      result.current.toggleMatrixSelection("a");
      result.current.toggleMatrixSelection("b");
    });

    // Kick off slow compare (will resolve later)
    let slowDone: Promise<void> = Promise.resolve();
    act(() => {
      slowDone = result.current.runMatrixCompare();
    });

    // Kick off second (fast) compare — this bumps the token and resolves immediately
    await act(async () => {
      await result.current.runMatrixCompare();
    });

    expect(result.current.matrixData).toEqual(fastPayload);

    // Now release the slow promise — its setMatrixData should bail because token doesn't match
    await act(async () => {
      resolveSlow?.(undefined);
      await slowDone;
    });

    // matrixData must still be the fast payload, NOT the stale slow one
    await waitFor(() => {
      expect(result.current.matrixData).toEqual(fastPayload);
      expect(result.current.matrixLoading).toBe(false);
    });
    expect(result.current.matrixData).not.toEqual(slowPayload);
  });

  it("downloadMatrixXlsx with <2 selections is a no-op", async () => {
    const matrixXlsxSave = vi.fn();
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient(vi.fn(), matrixXlsxSave) }));
    await act(async () => {
      await result.current.downloadMatrixXlsx();
    });
    expect(matrixXlsxSave).not.toHaveBeenCalled();
  });

  it("downloadMatrixXlsx calls matrixXlsxSave with comma-joined selection", async () => {
    const matrixXlsxSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDiffMatrix({ diffClient: makeClient(vi.fn(), matrixXlsxSave) }));

    act(() => {
      result.current.toggleMatrixSelection("a");
      result.current.toggleMatrixSelection("b");
    });

    await act(async () => {
      await result.current.downloadMatrixXlsx();
    });

    expect(matrixXlsxSave).toHaveBeenCalledWith("a,b");
  });
});
