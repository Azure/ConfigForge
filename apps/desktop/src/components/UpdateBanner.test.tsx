// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { UpdateBanner } from './UpdateBanner';
import { getI18n } from '../locales';

/**
 * Phase 11 component tests — UpdateBanner.
 *
 * The banner is a state machine driven by `cfs.update.onStatus`
 * events. We exercise each rendered state by setting the initial
 * `getStatus` return + simulating an event push via the
 * subscriber callback the component registers.
 */

interface UpdateChannel {
  getStatus: ReturnType<typeof vi.fn>;
  onStatus: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
}

function getCfsUpdate(): UpdateChannel {
  return (window as unknown as { cfs: { update: UpdateChannel } }).cfs.update;
}

function renderBanner() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <UpdateBanner />
    </FluentProvider>,
  );
}

describe('UpdateBanner', () => {
  beforeEach(async () => {
    await getI18n().changeLanguage('en');
    const update = getCfsUpdate();
    update.getStatus.mockResolvedValue({ state: 'idle' });
    update.onStatus.mockImplementation(() => () => {});
    update.check.mockResolvedValue({ state: 'idle' });
    update.download.mockResolvedValue({ ok: true });
    update.quitAndInstall.mockResolvedValue({ ok: true });
  });

  afterEach(async () => {
    await getI18n().changeLanguage('en');
  });

  it('renders nothing in idle state', async () => {
    const { container } = renderBanner();
    // Banner should never render any visible MessageBar in idle.
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/Update available/);
  });

  it('renders Download CTA when state=available', async () => {
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'available',
      info: { version: '0.2.0' },
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.getByText(/Update available/)).toBeInTheDocument();
    });
    expect(screen.getByText(/v0\.2\.0 is ready/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument();
  });

  it('calls cfs.update.download() when Download is clicked', async () => {
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'available',
      info: { version: '0.2.0' },
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.getByText(/Update available/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(getCfsUpdate().download).toHaveBeenCalledOnce();
  });

  it('formats download progress with the active locale', async () => {
    const i18n = getI18n();
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'downloading',
      progress: { percent: 12.3, bytesPerSecond: 1.5 * 1024 * 1024 },
    });

    const { rerender } = renderBanner();
    await waitFor(() => {
      expect(screen.getByText(/12% · 1\.5 MB\/s/)).toBeInTheDocument();
    });

    await i18n.changeLanguage('de');
    rerender(
      <FluentProvider theme={webLightTheme}>
        <UpdateBanner />
      </FluentProvider>,
    );

    expect(screen.getByText(/12% · 1,5 MB\/s/)).toBeInTheDocument();
  });

  it('renders Restart CTA when state=downloaded', async () => {
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'downloaded',
      info: { version: '0.2.0' },
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.getByText(/Update ready/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Restart to install/ })).toBeInTheDocument();
  });

  it('calls cfs.update.quitAndInstall() when Restart is clicked', async () => {
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'downloaded',
      info: { version: '0.2.0' },
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.getByText(/Update ready/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /Restart to install/ }));
    expect(getCfsUpdate().quitAndInstall).toHaveBeenCalledOnce();
  });

  it('renders error state with Retry button', async () => {
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'error',
      message: 'Network unreachable',
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.getByText(/Update check failed/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Network unreachable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('renders nothing in unsupported state', async () => {
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'unsupported',
      reason: 'auto-update disabled in dev',
    });
    const { container } = renderBanner();
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent ?? '').not.toMatch(/Update/);
  });

  it('hides itself after the dismiss button is clicked', async () => {
    getCfsUpdate().getStatus.mockResolvedValue({
      state: 'available',
      info: { version: '0.2.0' },
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.getByText(/Update available/)).toBeInTheDocument();
    });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    await userEvent.click(dismiss);
    await waitFor(() => {
      expect(screen.queryByText(/Update available/)).toBeNull();
    });
  });
});
