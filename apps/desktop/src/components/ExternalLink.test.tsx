// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExternalLink } from './ExternalLink';

/**
 * Tests for the H4 fix. ExternalLink is the single point that
 * routes external `http(s)` URLs through `electron.shell.openExternal`.
 * The contract:
 *   - Renders a real `<a>` so screen readers and right-click → "Copy
 *     link address" still work.
 *   - When `window.cfs.shell.openExternal` is present, a plain
 *     left-click is intercepted (preventDefault + IPC call) so we
 *     don't open an in-app frameless BrowserWindow.
 *   - When the bridge is missing (Vite dev, Storybook, Vitest with
 *     no preload mock), the native target=_blank fallback fires.
 *   - Modifier-clicks (Cmd/Ctrl/Shift/middle) bypass the IPC path
 *     so the user's "open in new tab" intent is respected.
 *   - `rel="noopener noreferrer"` is always set.
 */
describe('ExternalLink', () => {
  type CfsShell = { shell?: { openExternal: (u: string) => Promise<void> } };
  let originalCfs: CfsShell | undefined;

  beforeEach(() => {
    originalCfs = (window as unknown as { cfs?: CfsShell }).cfs;
  });

  afterEach(() => {
    if (originalCfs === undefined) {
      delete (window as unknown as { cfs?: CfsShell }).cfs;
    } else {
      (window as unknown as { cfs?: CfsShell }).cfs = originalCfs;
    }
    vi.restoreAllMocks();
  });

  it('renders an anchor with the supplied href and children', () => {
    render(
      <ExternalLink href="https://example.com" className="link-cls">
        Example
      </ExternalLink>,
    );
    const a = screen.getByRole('link', { name: 'Example' });
    expect(a).toHaveAttribute('href', 'https://example.com');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a.className).toContain('link-cls');
  });

  it('calls cfs.shell.openExternal on click and prevents default navigation', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { cfs: CfsShell }).cfs = {
      shell: { openExternal },
    };

    render(
      <ExternalLink href="https://learn.microsoft.com">Docs</ExternalLink>,
    );
    const a = screen.getByRole('link', { name: 'Docs' });

    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    const dispatched = a.dispatchEvent(evt);

    expect(openExternal).toHaveBeenCalledWith('https://learn.microsoft.com');
    // dispatchEvent returns false when preventDefault was called.
    expect(dispatched).toBe(false);
  });

  it('falls back to native target=_blank when the cfs bridge is missing', () => {
    delete (window as unknown as { cfs?: CfsShell }).cfs;

    render(
      <ExternalLink href="https://github.com/microsoft/osconfig">
        Repo
      </ExternalLink>,
    );
    const a = screen.getByRole('link', { name: 'Repo' });

    // No bridge → click should NOT preventDefault; the browser
    // (or jsdom) handles navigation natively.
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    const dispatched = a.dispatchEvent(evt);
    expect(dispatched).toBe(true);
  });

  it('does not intercept modifier-clicks (Cmd/Ctrl/Shift)', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { cfs: CfsShell }).cfs = {
      shell: { openExternal },
    };

    render(<ExternalLink href="https://example.com">Ex</ExternalLink>);
    const a = screen.getByRole('link', { name: 'Ex' });

    fireEvent.click(a, { ctrlKey: true });
    fireEvent.click(a, { metaKey: true });
    fireEvent.click(a, { shiftKey: true });

    expect(openExternal).not.toHaveBeenCalled();
  });

  it('logs a warning if openExternal rejects but does not throw', async () => {
    const err = new Error('renderer denied');
    const openExternal = vi.fn().mockRejectedValue(err);
    (window as unknown as { cfs: CfsShell }).cfs = {
      shell: { openExternal },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<ExternalLink href="https://example.com">Boom</ExternalLink>);
    fireEvent.click(screen.getByRole('link', { name: 'Boom' }));

    // Wait a microtask for the rejection handler.
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });
});
