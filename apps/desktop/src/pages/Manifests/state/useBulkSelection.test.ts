// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase E.1 — unit tests for `useBulkSelection`.
 *
 * Locks in the v0.1.13 fix where deleting a single manifest must
 * also drop it from the bulk-selection Set (otherwise the count
 * badge + select-all toggle math + bulk-delete report all drift).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBulkSelection } from './useBulkSelection';

const pool = [{ Name: 'a' }, { Name: 'b' }, { Name: 'c' }];

describe('useBulkSelection — toggleSelect', () => {
  it('adds a name not in the set and removes a name that is', () => {
    const { result } = renderHook(() => useBulkSelection());
    expect(result.current.selected.size).toBe(0);

    act(() => result.current.toggleSelect('a'));
    expect(result.current.selected.has('a')).toBe(true);

    act(() => result.current.toggleSelect('a'));
    expect(result.current.selected.has('a')).toBe(false);
  });
});

describe('useBulkSelection — toggleSelectAll', () => {
  it('selects every name in the pool', () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggleSelectAll(pool));
    expect(result.current.selected.size).toBe(3);
    expect(result.current.selected.has('a')).toBe(true);
    expect(result.current.selected.has('b')).toBe(true);
    expect(result.current.selected.has('c')).toBe(true);
  });

  it('clears the selection when called with a pool that is already fully selected', () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggleSelectAll(pool));
    act(() => result.current.toggleSelectAll(pool));
    expect(result.current.selected.size).toBe(0);
  });

  it('selects or deselects only the supplied filtered rows', () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggleSelect('c'));
    act(() => result.current.toggleSelectAll(pool.slice(0, 2)));
    expect(Array.from(result.current.selected).sort()).toEqual(['a', 'b', 'c']);

    act(() => result.current.toggleSelectAll(pool.slice(0, 2)));
    expect(Array.from(result.current.selected)).toEqual(['c']);
  });
});

describe('useBulkSelection — removeFromSelection (v0.1.13)', () => {
  it('drops a name from the set when called (no-op if not present)', () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggleSelectAll(pool));
    expect(result.current.selected.size).toBe(3);

    act(() => result.current.removeFromSelection('b'));
    expect(result.current.selected.size).toBe(2);
    expect(result.current.selected.has('b')).toBe(false);

    // Idempotent — already removed
    act(() => result.current.removeFromSelection('b'));
    expect(result.current.selected.size).toBe(2);

    // Name never selected — also a no-op
    act(() => result.current.removeFromSelection('zzz'));
    expect(result.current.selected.size).toBe(2);
  });
});

describe('useBulkSelection — clear', () => {
  it('empties the selection', () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggleSelectAll(pool));
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
  });
});
