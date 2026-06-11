// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the CliRequiredModal, covers the 4 user paths:
 *   1. Install button opens upstream URL via cfs.shell.openExternal
 *   2. Recheck while CLI still missing -> shows "Still not detected"
 *   3. Recheck after user installs -> dialog auto-dismisses
 *   4. "Continue in editor mode" -> onDismiss fires, no other side effects
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CliRequiredModal, OSCONFIG_INSTALL_URL } from './CliRequiredModal';
import type { CliPresence } from '../hooks/useCliPresence';

function makePresence(overrides: Partial<CliPresence> = {}): CliPresence {
  return {
    installed: false,
    version: '',
    loading: false,
    error: false,
    health: null,
    recheck: vi.fn(),
    ...overrides,
  };
}

function renderInProvider(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

const fakeShell = { openExternal: vi.fn() };

beforeEach(() => {
  fakeShell.openExternal.mockReset();
  fakeShell.openExternal.mockResolvedValue(undefined);
  (window as unknown as { cfs: { shell: typeof fakeShell } }).cfs.shell = fakeShell;
});

describe('CliRequiredModal', () => {
  it('renders the feature label and OSConfig install affordance when open', async () => {
    renderInProvider(
      <CliRequiredModal
        open
        feature="Deploy"
        onDismiss={vi.fn()}
        presence={makePresence()}
      />,
    );

    // The dialog body content has portal-rendering quirks under jsdom;
    // accessible-name lookups may need a moment. Use findBy* to wait.
    await screen.findByText(/OSConfig CLI required/i);
    // The descriptive copy contains both <strong>Deploy</strong> and
    // the install link. Verify the title + the install URL anchor.
    const link = await screen.findByText('Install OSConfig');
    expect(link.tagName.toLowerCase()).toBe('a');
    expect(link).toHaveAttribute('href', OSCONFIG_INSTALL_URL);
  });

  it('does not render when open is false', () => {
    renderInProvider(
      <CliRequiredModal
        open={false}
        feature="Deploy"
        onDismiss={vi.fn()}
        presence={makePresence()}
      />,
    );
    expect(screen.queryByText('OSConfig CLI required')).not.toBeInTheDocument();
  });

  it('routes the Install OSConfig link through cfs.shell.openExternal (no in-app frameless window)', async () => {
    renderInProvider(
      <CliRequiredModal
        open
        feature="Audit"
        onDismiss={vi.fn()}
        presence={makePresence()}
      />,
    );

    const link = await screen.findByText('Install OSConfig');
    await userEvent.click(link);

    expect(fakeShell.openExternal).toHaveBeenCalledWith(OSCONFIG_INSTALL_URL);
  });

  it('auto-dismisses when the recheck finds the CLI is now installed', async () => {
    const onDismiss = vi.fn();
    const recheck = vi.fn().mockResolvedValue(makePresence({ installed: true, version: 'oscfg 1.3.9' }));
    renderInProvider(
      <CliRequiredModal
        open
        feature="Deploy"
        onDismiss={onDismiss}
        presence={makePresence({ recheck })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /recheck/i }));

    await waitFor(() => {
      expect(recheck).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the "Still not detected" warning when the recheck reports the CLI is still missing', async () => {
    const recheck = vi.fn().mockResolvedValue(makePresence({ installed: false }));
    renderInProvider(
      <CliRequiredModal
        open
        feature="Deploy"
        onDismiss={vi.fn()}
        presence={makePresence({ recheck })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /recheck/i }));

    await waitFor(() => {
      expect(screen.getByText(/Still not detected/i)).toBeInTheDocument();
    });
  });

  it('dismisses via the "Continue in editor mode" button without calling recheck or openExternal', async () => {
    const onDismiss = vi.fn();
    const recheck = vi.fn();
    renderInProvider(
      <CliRequiredModal
        open
        feature="Deploy"
        onDismiss={onDismiss}
        presence={makePresence({ recheck })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Continue in editor mode/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(recheck).not.toHaveBeenCalled();
    expect(fakeShell.openExternal).not.toHaveBeenCalled();
  });
});
