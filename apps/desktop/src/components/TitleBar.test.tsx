// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TitleBar } from './TitleBar';

/**
 * v0.1.0 hot-fix: TitleBar is now a no-op stub. The Phase 6
 * frameless titlebar approach had Win11 reliability problems
 * (see TitleBar.tsx + main.ts comments). Re-enabling Phase 6
 * styling will require restoring its body — at which point
 * the previous test cases (renders strip on win32, returns
 * null on linux/darwin, applies cfs-drag) become relevant
 * again.
 *
 * For now, just verify the no-op contract: regardless of
 * platform, the component renders nothing.
 */
describe('TitleBar (no-op stub)', () => {
  it('renders null', () => {
    const { container } = render(<TitleBar />);
    expect(container.firstChild).toBeNull();
  });
});
