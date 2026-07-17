// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCisAvailableCacheForTests, useCisAvailable } from "./use-cis-available";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  Object.assign(window.cfs as Record<string, unknown>, {
    cis: {
      status: vi.fn(),
      warmup: vi.fn().mockResolvedValue(undefined),
    },
  });
  _resetCisAvailableCacheForTests();
});

describe("useCisAvailable", () => {
  it("does not expose detected XCCDF without OVAL", async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      available: true,
      xccdfFiles: [{ hasOval: false }],
    });
    const { result } = renderHook(() => useCisAvailable());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("exposes usable positive-rule Azure data and schedules warmup", async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      available: true,
      azurePolicyCisFiles: [{ ruleCount: 3 }],
    });
    const { result } = renderHook(() => useCisAvailable());
    await waitFor(() => expect(result.current).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(window.cfs!.cis.warmup).toHaveBeenCalledTimes(1);
  });

  it("requires mappings plus rules for legacy JSON", async () => {
    vi.mocked(window.cfs!.cis.status).mockResolvedValue({
      available: true,
      source: "json",
      legacyMappingsLoaded: true,
      legacyRuleCatalogCount: 0,
    });
    const { result } = renderHook(() => useCisAvailable());
    await waitFor(() => expect(result.current).toBe(false));
  });
});
