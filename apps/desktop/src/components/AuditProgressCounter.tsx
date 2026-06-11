// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.3 — stable-width audit/deploy progress counter.
 *
 * Rendering `${completed}/${total}` directly inside the Deploy button
 * caused layout jitter: as `completed` went 1-digit → 2-digit → 3-digit
 * the button's width changed, and the parent `flex flex-wrap` action
 * cluster reflowed (sometimes wrapping the button to a second line
 * then snapping back at the next tick).
 *
 * Fix:
 *   - tabular-nums (font-variant-numeric: tabular-nums) so every digit
 *     occupies the same width as every other digit
 *   - left-pad `completed` to the width of `total` using FIGURE SPACE
 *     (U+2007), which has the same width as a digit under tabular-nums
 *   - `inline-block` + reserved `min-width` so the span doesn't shrink
 *     either, and `whitespace-nowrap` so the button never line-breaks
 *     mid-counter
 *
 * Result: the counter span has a single fixed width for the entire
 * audit. The button itself only changes width once (Deploy → counter
 * on start) and once more (counter → Deploy on finish).
 */

import React from 'react';

const FIGURE_SPACE = '\u2007';

export interface AuditProgressCounterProps {
  completed: number;
  total: number;
}

export function AuditProgressCounter({
  completed,
  total,
}: AuditProgressCounterProps): React.ReactElement {
  const totalStr = String(Math.max(total, 0));
  const completedStr = String(Math.max(completed, 0)).padStart(
    totalStr.length,
    FIGURE_SPACE,
  );
  // Width: 2 × totalStr.length digits + 1 slash. Add a tiny buffer (0.1ch)
  // to absorb sub-pixel rounding in WebKit / Blink layout passes.
  const minWidth = `${totalStr.length * 2 + 1.1}ch`;
  return (
    <span
      className="inline-block whitespace-nowrap text-center tabular-nums"
      style={{ minWidth }}
    >
      {completedStr}/{totalStr}
    </span>
  );
}
