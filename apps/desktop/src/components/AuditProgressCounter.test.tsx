// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AuditProgressCounter } from './AuditProgressCounter';

describe('AuditProgressCounter', () => {
  it('renders completed/total', () => {
    const { container } = render(<AuditProgressCounter completed={47} total={326} />);
    // FIGURE SPACE doesn't matter for the matched text — padStart with
    // U+2007 still equals "47" when reading char-by-char if we strip
    // the spaces. We check the trailing "47/326" substring.
    expect(container.textContent).toContain('47/326');
  });

  it('left-pads completed to total width', () => {
    const { container } = render(<AuditProgressCounter completed={5} total={326} />);
    // U+2007 figure space precedes "5".
    expect(container.textContent).toBe('\u2007\u20075/326');
  });

  it('uses tabular-nums + min-width to lock the counter width', () => {
    const { container } = render(<AuditProgressCounter completed={5} total={326} />);
    const span = container.querySelector('span');
    expect(span).toBeTruthy();
    expect(span!.className).toContain('tabular-nums');
    expect(span!.className).toContain('whitespace-nowrap');
    expect(span!.style.minWidth).toMatch(/ch$/);
  });

  it('clamps negative values to zero', () => {
    const { container } = render(<AuditProgressCounter completed={-3} total={-1} />);
    expect(container.textContent).toBe('0/0');
  });

  it('renders single-digit total without padding', () => {
    const { container } = render(<AuditProgressCounter completed={3} total={5} />);
    expect(container.textContent).toBe('3/5');
  });
});
