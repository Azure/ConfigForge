// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { useEffect } from 'react';

/**
 * v0.1.15: in-app navigation guard that works with the legacy
 * `<HashRouter>` we use throughout the desktop renderer.
 *
 * Why this exists: react-router-dom 6.x's `useBlocker` only works
 * when the router is constructed via the Data Router API
 * (`createHashRouter` + `<RouterProvider>`). Inside the legacy
 * declarative `<HashRouter>` we use here, `useBlocker` throws via
 * `useDataRouterContext`'s invariant on first render, blowing
 * away the entire React tree (rootChildren=0).
 *
 * v0.1.13 ManifestEditor and v0.1.15 ManifestNew both reached for
 * `useBlocker` to implement an unsaved-changes prompt and both
 * silently crashed the route. This hook is the drop-in replacement
 * that actually works.
 *
 * What it catches:
 *   1. Clicks on in-app anchor links (e.g. Sidebar `<Link>` items)
 *      via a capture-phase document listener that runs BEFORE
 *      react-router-dom's own click handler. If the user cancels
 *      the prompt we stopImmediatePropagation so react-router never
 *      sees the event.
 *   2. Native `window.beforeunload` (X button, Alt+F4, OS quit) —
 *      Chromium shows its own "Reload site?" dialog wired to the
 *      handler.
 *
 * What it does NOT catch:
 *   - Browser back/forward (`popstate`). By the time popstate
 *     fires the URL has already changed and there's no clean way
 *     to roll back via the legacy router. Acceptable trade-off vs.
 *     the alternative (crashing the app).
 *   - Programmatic `navigate()` calls from within the same page.
 *     Pages that need to bypass the guard for their own redirect
 *     (e.g. ManifestNew's success-path redirect to /manifests)
 *     should clear the `active` flag immediately before the
 *     navigate() call.
 */
export function useNavigationGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const anchor = target?.closest?.('a') ?? null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('#/')) return;
      if (href === window.location.hash) return;
      const ok = window.confirm(message);
      if (!ok) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active, message]);
}
