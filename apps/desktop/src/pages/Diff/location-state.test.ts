// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import {
  clearMatrixDiffLocationState,
  createMatrixDiffLocationState,
  createPairwiseDiffLocationState,
  readMatrixDiffLocationState,
  readPairwiseDiffLocationState,
} from './location-state';

describe('Diff matrix location state', () => {
  it('round-trips unique baseline names and caps untrusted input at ten', () => {
    const names = ['alpha', 'alpha', ...Array.from({ length: 15 }, (_, i) => `b-${i}`)];
    const state = createMatrixDiffLocationState(names);

    expect(readMatrixDiffLocationState(state)).toEqual([
      'alpha',
      'b-0',
      'b-1',
      'b-2',
      'b-3',
      'b-4',
      'b-5',
      'b-6',
      'b-7',
      'b-8',
    ]);
  });

  it('rejects malformed, wrong-version, and wrong-tab state safely', () => {
    expect(readMatrixDiffLocationState(null)).toEqual([]);
    expect(readMatrixDiffLocationState({ configForgeDiff: 'bad' })).toEqual([]);
    expect(
      readMatrixDiffLocationState({
        configForgeDiff: { version: 2, tab: 'matrix', baselineNames: ['alpha'] },
      }),
    ).toEqual([]);
    expect(
      readMatrixDiffLocationState({
        configForgeDiff: { version: 1, tab: 'pairwise', baselineNames: ['alpha'] },
      }),
    ).toEqual([]);
  });

  it('round-trips exactly two unique pairwise baseline names', () => {
    const state = createPairwiseDiffLocationState(['before', 'after']);
    expect(readPairwiseDiffLocationState(state)).toEqual(['before', 'after']);
    expect(createPairwiseDiffLocationState(['only-one'])).toBeNull();
    expect(createPairwiseDiffLocationState(['same', 'same'])).toBeNull();
    expect(
      readPairwiseDiffLocationState({
        configForgeDiff: {
          version: 1,
          tab: 'pairwise',
          baselineNames: ['before', 'after', 'extra'],
        },
      }),
    ).toEqual([]);
  });

  it('consumes only ConfigForge Diff state and preserves unrelated route state', () => {
    expect(
      clearMatrixDiffLocationState({
        configForgeDiff: {
          version: 1,
          tab: 'matrix',
          baselineNames: ['alpha'],
        },
        returnFocus: 'baseline-table',
      }),
    ).toEqual({
      consumed: true,
      state: { returnFocus: 'baseline-table' },
    });
    expect(clearMatrixDiffLocationState({ returnFocus: 'baseline-table' })).toEqual({
      consumed: false,
      state: { returnFocus: 'baseline-table' },
    });
    expect(clearMatrixDiffLocationState({ configForgeDiff: 'stale' })).toEqual({
      consumed: true,
      state: null,
    });
  });
});
