// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { TintedSpinner } from './TintedSpinner';

/**
 * Phase 7 component tests — TintedSpinner.
 *
 * Verifies that the wrapper renders a Spinner and that the
 * intent-keyed Griffel class is applied to the root element. We
 * can't directly read the resolved `--circle__color` from JSDOM
 * (Griffel emits CSS but JSDOM doesn't compute it), so we assert
 * on class application + presence of the Spinner DOM rather than
 * computed style.
 */
describe('TintedSpinner', () => {
  function renderWithProvider(node: React.ReactNode) {
    return render(<FluentProvider theme={webLightTheme}>{node}</FluentProvider>);
  }

  it('renders the Fluent Spinner with default info intent', () => {
    renderWithProvider(<TintedSpinner size="tiny" />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('passes through size prop', () => {
    renderWithProvider(<TintedSpinner intent="success" size="large" />);
    const sp = screen.getByRole('progressbar');
    expect(sp).toBeInTheDocument();
    // FluentUI Spinner sets a size attribute or class; we just
    // confirm rendering didn't throw.
  });

  it('applies a unique class per intent', () => {
    const { rerender, container } = renderWithProvider(
      <TintedSpinner intent="success" size="tiny" />,
    );
    const successClassList = Array.from(container.querySelectorAll('[role="progressbar"]')[0].classList);

    rerender(
      <FluentProvider theme={webLightTheme}>
        <TintedSpinner intent="danger" size="tiny" />
      </FluentProvider>,
    );
    const dangerClassList = Array.from(container.querySelectorAll('[role="progressbar"]')[0].classList);

    // Both renders include the Spinner's own classes; the wrapper
    // adds a Griffel-generated class for the intent. The two
    // class lists must therefore differ.
    expect(successClassList.join(' ')).not.toBe(dangerClassList.join(' '));
  });

  it('forwards the label prop', () => {
    renderWithProvider(<TintedSpinner intent="warning" size="medium" label="Loading…" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
