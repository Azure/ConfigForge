// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for the v0.2.0 HealthIndicator rewrite. The component drives
 * off useCliPresence() and renders one of four visible states:
 *   loading -> "Verifying…"
 *   error   -> "Cannot reach IPC"
 *   missing -> "Editor mode, CLI not installed" (clickable when onInstallClick provided)
 *   ready   -> "<version>"
 *
 * Strategy: mock window.cfs.health.{check,recheck} per test so
 * useCliPresence resolves into the desired state, then assert the
 * resulting DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HealthIndicator } from './HealthIndicator';
import type { HealthStatus } from '@configforge/core/handlers';

function makeHealth(installed: boolean, version = 'oscfg 1.3.9-preview11'): HealthStatus {
  return {
    status: installed ? 'healthy' : 'degraded',
    installed,
    version: installed ? version : 'OSConfig CLI not found',
    binaryPath: installed ? '/usr/local/bin/oscfg' : '',
    binarySource: installed ? 'path' : '',
    platform: 'linux',
    isAdmin: true,
    serverType: 'WorkstationServer',
    osVersion: 'Ubuntu 22.04',
    requiresAdminForAllOps: false,
    adminBlocked: false,
    adminMessage: '',
  };
}

const fakeHealth = {
  check: vi.fn(),
  recheck: vi.fn(),
};

beforeEach(() => {
  fakeHealth.check.mockReset();
  fakeHealth.recheck.mockReset();
  (window as unknown as { cfs: { health: typeof fakeHealth } }).cfs.health = fakeHealth;
});

describe('HealthIndicator', () => {
  it('renders a concise healthy state and keeps the exact version in the tooltip', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(true));
    render(<HealthIndicator />);

    await waitFor(() => {
      expect(screen.getByText('oscfg')).toBeInTheDocument();
    });
    expect(screen.getByText('oscfg').closest('div')).toHaveAttribute(
      'title',
      'oscfg 1.3.9-preview11',
    );
  });

  it('renders "Editor mode, CLI not installed" when CLI is missing', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));
    render(<HealthIndicator />);

    await waitFor(() => {
      expect(screen.getByText(/Editor mode.*CLI not installed/i)).toBeInTheDocument();
    });
  });

  it('does NOT mention "Drop the oscfg binary" anywhere, that legacy hint is gone', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));
    const { container } = render(<HealthIndicator />);
    await waitFor(() => {
      expect(screen.getByText(/Editor mode/i)).toBeInTheDocument();
    });
    // Banned-string assertion: the legacy hint text must not survive
    // anywhere in the rendered tree.
    expect(container.textContent).not.toMatch(/Drop the oscfg binary/i);
    expect(container.textContent).not.toMatch(/resources\/oscfg/i);
  });

  it('renders as an interactive <button> only when onInstallClick is provided and CLI is missing', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));
    const onInstall = vi.fn();
    render(<HealthIndicator onInstallClick={onInstall} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /CLI not installed/i })).toBeInTheDocument();
    });
  });

  it('does NOT render as a button when onInstallClick is omitted', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));
    render(<HealthIndicator />);

    await waitFor(() => {
      expect(screen.getByText(/Editor mode/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('invokes onInstallClick when the amber button is clicked', async () => {
    fakeHealth.check.mockResolvedValue(makeHealth(false));
    const onInstall = vi.fn();
    render(<HealthIndicator onInstallClick={onInstall} />);

    const btn = await screen.findByRole('button', { name: /CLI not installed/i });
    await userEvent.click(btn);

    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('renders "Cannot reach IPC" when the health probe rejects', async () => {
    fakeHealth.check.mockRejectedValue(new Error('IPC unreachable'));
    render(<HealthIndicator />);

    await waitFor(() => {
      expect(screen.getByText(/Cannot reach IPC/i)).toBeInTheDocument();
    });
  });

  it('surfaces admin-blocked state in the amber pill with the admin hint', async () => {
    fakeHealth.check.mockResolvedValue({
      ...makeHealth(true),
      adminBlocked: true,
      adminMessage: 'Restart ConfigForge from an elevated PowerShell.',
    });
    render(<HealthIndicator />);

    await waitFor(() => {
      expect(screen.getByText('oscfg, admin required')).toBeInTheDocument();
    });
    expect(screen.getByText('oscfg, admin required').closest('div')).toHaveAttribute(
      'title',
      expect.stringContaining('oscfg 1.3.9-preview11'),
    );
  });

  it('shows the minimum version only when the installed CLI is too old', async () => {
    fakeHealth.check.mockResolvedValue({
      ...makeHealth(true, 'oscfg 1.3.8-preview18'),
      status: 'degraded',
      versionMismatch: true,
      expectedVersion: '1.3.9',
    });
    render(<HealthIndicator />);

    await waitFor(() => {
      expect(screen.getByText('oscfg 1.3.9 or newer required')).toBeInTheDocument();
    });
  });
});
