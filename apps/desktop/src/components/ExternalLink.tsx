// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type React from "react";

/**
 * H4 fix — drop-in replacement for `<a target="_blank">` that routes
 * through Electron's `shell.openExternal` when running inside the
 * desktop app. With `nodeIntegration: false` and Chromium's popup
 * blocker, a bare external `<a>` may either open in a frameless
 * BrowserWindow (no address bar, no chrome) or be silently
 * blocked. Forwarding to `shell.openExternal` launches the user's
 * default OS browser, which is the right behavior for docs / CSV
 * / repo links.
 *
 * When `window.cfs.shell.openExternal` isn't available — running
 * the renderer in plain Vite (`npm run desktop:dev:vite`), in
 * Storybook, or under Vitest with no preload — we fall through to
 * native anchor semantics so smoke tests and component snapshots
 * keep working without an Electron mock.
 *
 * Always renders `rel="noopener noreferrer"` regardless of which
 * path handles the click; even if `openExternal` is missing we
 * don't want to leak window.opener.
 */
export interface ExternalLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
}

export function ExternalLink({
  href,
  children,
  className,
  title,
  "aria-label": ariaLabel,
}: ExternalLinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Respect modifier-clicks (Cmd/Ctrl/Shift/middle) — let the
    // native anchor handle them so the user can keep their
    // intent (background tab, new window, etc).
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
      return;
    }
    const cfs = (
      window as unknown as {
        cfs?: { shell?: { openExternal: (u: string) => Promise<void> } };
      }
    ).cfs;
    if (cfs?.shell?.openExternal) {
      e.preventDefault();
      void cfs.shell.openExternal(href).catch((err: unknown) => {
        // Renderer can't surface a toast here; log and let the
        // user try again. We deliberately don't fall back to
        // window.open() — under Electron that would open an
        // in-app frameless window, the exact bug we're fixing.
        console.warn('[ExternalLink] openExternal failed', err);
      });
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  );
}
