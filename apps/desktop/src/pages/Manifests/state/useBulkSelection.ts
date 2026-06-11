// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Bulk-selection state for the Manifests page (checkbox column).
 *
 * Pure state container — toggle, select-all, clear, has-selection
 * predicates. No IPC, no async.
 */
import { useCallback, useMemo, useState } from "react";

export interface BulkSelectionState {
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSelect: (name: string) => void;
  /** Either select every name in `pool`, or clear if all of `pool` is
   * already selected (so "select all" doubles as "deselect all"). */
  toggleSelectAll: (pool: { Name: string }[]) => void;
  clear: () => void;
  /** Drop a single name from the selection (e.g. when the user
   * deletes that manifest individually). Idempotent — no-op if not
   * present. Prevents v0.1.13-style ghost selections that broke the
   * "Select all" toggle math + bulk-delete counts. */
  removeFromSelection: (name: string) => void;
}

export function useBulkSelection(): BulkSelectionState {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((pool: { Name: string }[]) => {
    setSelected((prev) => {
      if (prev.size === pool.length && pool.every((m) => prev.has(m.Name))) {
        return new Set();
      }
      return new Set(pool.map((m) => m.Name));
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const removeFromSelection = useCallback((name: string) => {
    setSelected((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      selected,
      setSelected,
      toggleSelect,
      toggleSelectAll,
      clear,
      removeFromSelection,
    }),
    [selected, toggleSelect, toggleSelectAll, clear, removeFromSelection],
  );
}
