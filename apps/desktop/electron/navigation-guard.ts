// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-001 — production navigation guard.
 *
 * The renderer must never navigate the BrowserWindow to anything
 * outside the bundled UI. The previous `startsWith('file://')` allowlist
 * was too broad — it allowed `file:///etc/passwd`, `file://share/...`,
 * etc. With contextIsolation + sandbox the impact is bounded, but
 * arbitrary local-file navigation still weakens the trust boundary
 * unnecessarily.
 *
 * Allow:
 *   - dev server (exact origin)
 *   - `cfs-blob://...` (custom protocol; its handler enforces its own
 *     allowlist of routes)
 *   - production packaged `index.html` (exact path match) with an
 *     optional `#/<route>` SPA fragment.
 *
 * Reject everything else, including:
 *   - other `file://` URLs (system files, network shares)
 *   - http(s) other than the dev server
 *   - `data:` / `javascript:` / unknown schemes
 *   - any URL carrying a `?query` — we don't use them and they're a
 *     useful tell for someone trying to smuggle state into the renderer
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface NavigationGuardOptions {
  /** Absolute directory containing the packaged `main.js` (Electron
   * `__dirname` at runtime). */
  electronDir: string;
  /** Whether the app is running against the Vite dev server. */
  isDev: boolean;
  /** Vite dev server origin (e.g. `http://localhost:5173`). */
  devServerUrl: string;
}

export function buildShouldAllowRendererNavigation(
  opts: NavigationGuardOptions,
): (navigationUrl: string) => boolean {
  const packagedIndexFileUrl = pathToFileURL(
    path.join(opts.electronDir, '..', 'index.html'),
  ).toString();
  const expected = new URL(packagedIndexFileUrl);

  return function shouldAllowRendererNavigation(navigationUrl: string): boolean {
    if (typeof navigationUrl !== 'string' || navigationUrl.length === 0) return false;

    // Dev server: exact-origin allowlist. Hash routes are inherent
    // to the URL parser and don't need special handling here.
    if (opts.isDev) {
      try {
        const u = new URL(navigationUrl);
        if (u.origin === opts.devServerUrl) return true;
      } catch {
        /* fall through */
      }
    }

    // Custom protocol: cfs-blob:// is handled by registerCfsBlobProtocol,
    // which enforces its own path-segment + format allowlist.
    if (navigationUrl.startsWith('cfs-blob://')) return true;

    // Production packaged HTML: must match the packaged index.html
    // file URL exactly, optionally with a `#/route` SPA fragment.
    try {
      const u = new URL(navigationUrl);
      if (u.protocol !== 'file:') return false;
      if (u.search.length > 0) return false;
      return u.protocol === expected.protocol && u.pathname === expected.pathname;
    } catch {
      return false;
    }
  };
}
