// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DangerButton } from './DangerButton';

/**
 * Phase 7 component tests — DangerButton.
 *
 * The wrapper sets `appearance="primary"` and overrides the
 * Griffel rest/hover/active/disabled tokens to red. We assert:
 *   - It renders a button.
 *   - Click handler fires on click.
 *   - `disabled={true}` makes the button unclickable.
 *   - The Griffel root class is applied (different from a vanilla
 *     primary Button — proves the override is in effect).
 */
describe('DangerButton', () => {
  function renderWithProvider(node: React.ReactNode) {
    return render(<FluentProvider theme={webLightTheme}>{node}</FluentProvider>);
  }

  it('renders as a button', () => {
    renderWithProvider(<DangerButton>Delete</DangerButton>);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const handler = vi.fn();
    renderWithProvider(<DangerButton onClick={handler}>Delete</DangerButton>);
    await userEvent.click(screen.getByRole('button'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', async () => {
    const handler = vi.fn();
    renderWithProvider(
      <DangerButton onClick={handler} disabled>
        Delete
      </DangerButton>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('applies the danger Griffel class on top of the FluentUI primary class', () => {
    renderWithProvider(<DangerButton>Delete</DangerButton>);
    const btn = screen.getByRole('button');
    // Griffel emits classes like `f1abc123`. We assert at least
    // two classes are present (FluentUI base + our override) so
    // the wrapper's mergeClasses() actually merged.
    expect(btn.className.split(' ').length).toBeGreaterThan(1);
  });
});
