// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the first-run WelcomeDialog.
 *
 * Covers:
 *   - first launch (no dismissedAt in localStorage) -> dialog renders
 *   - dismissedAt present -> dialog does NOT render
 *   - "Author anywhere" CTA dismisses, persists, and navigates to /library
 *   - "Author + deploy" with CLI installed -> dismisses without modal
 *   - "Author + deploy" without CLI -> opens CliRequiredModal
 *   - "Skip" CTA dismisses + persists, no navigation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter } from 'react-router-dom';
import { WelcomeDialog, hasDismissedWelcome, markWelcomeDismissed } from './WelcomeDialog';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const fakeHealth = {
  check: vi.fn(),
  recheck: vi.fn(),
};

function renderDialog() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <WelcomeDialog />
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  navigateMock.mockReset();
  fakeHealth.check.mockReset();
  fakeHealth.recheck.mockReset();
  (window as unknown as { cfs: { health: typeof fakeHealth } }).cfs.health = fakeHealth;
});

describe('WelcomeDialog persistence helpers', () => {
  it('hasDismissedWelcome returns false on a fresh profile', () => {
    expect(hasDismissedWelcome()).toBe(false);
  });

  it('markWelcomeDismissed writes the timestamp and hasDismissedWelcome flips to true', () => {
    expect(hasDismissedWelcome()).toBe(false);
    markWelcomeDismissed();
    expect(hasDismissedWelcome()).toBe(true);
    // Stored value should be an ISO timestamp (parseable).
    const raw = window.localStorage.getItem('cfs.welcome.dismissedAt');
    expect(raw).toBeTruthy();
    expect(new Date(raw!).toString()).not.toBe('Invalid Date');
  });
});

describe('WelcomeDialog', () => {
  it('renders on a fresh profile (no dismissedAt in localStorage)', async () => {
    fakeHealth.check.mockResolvedValue({ installed: false });
    renderDialog();
    await screen.findByText(/Welcome to ConfigForge/i);
  });

  it('does NOT render when localStorage marks it dismissed', () => {
    markWelcomeDismissed();
    fakeHealth.check.mockResolvedValue({ installed: false });
    renderDialog();
    expect(screen.queryByText(/Welcome to ConfigForge/i)).not.toBeInTheDocument();
  });

  it('"Author baselines anywhere" CTA dismisses, persists, and navigates to /library', async () => {
    fakeHealth.check.mockResolvedValue({ installed: false });
    renderDialog();
    await screen.findByText(/Welcome to ConfigForge/i);

    await userEvent.click(screen.getByText(/Author baselines anywhere/i));

    expect(hasDismissedWelcome()).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith('/library');
    await waitFor(() => {
      expect(screen.queryByText(/Welcome to ConfigForge/i)).not.toBeInTheDocument();
    });
  });

  it('"Author + deploy" with CLI already installed dismisses without opening the install modal', async () => {
    fakeHealth.check.mockResolvedValue({ installed: true, version: 'oscfg 1.3.9' });
    renderDialog();
    await screen.findByText(/Welcome to ConfigForge/i);

    await userEvent.click(screen.getByText(/Author \+ deploy on this machine/i));

    await waitFor(() => {
      expect(hasDismissedWelcome()).toBe(true);
    });
    // CliRequiredModal must NOT have rendered, CLI is present.
    expect(screen.queryByText(/OSConfig CLI required/i)).not.toBeInTheDocument();
  });

  it('"Author + deploy" without CLI opens the CliRequiredModal', async () => {
    fakeHealth.check.mockResolvedValue({ installed: false });
    renderDialog();
    await screen.findByText(/Welcome to ConfigForge/i);

    await userEvent.click(screen.getByText(/Author \+ deploy on this machine/i));

    await screen.findByText(/OSConfig CLI required/i);
  });

  it('"Skip" CTA dismisses + persists without navigating', async () => {
    fakeHealth.check.mockResolvedValue({ installed: false });
    renderDialog();
    await screen.findByText(/Welcome to ConfigForge/i);

    await userEvent.click(screen.getByRole('button', { name: /Skip/i }));

    expect(hasDismissedWelcome()).toBe(true);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
