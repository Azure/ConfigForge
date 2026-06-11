// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './lib/platform';
import { initI18n } from './locales';
import './design/foundation.css';

/**
 * v0.1.14/16 splash removal.
 *
 * The branded boot splash (#cfs-boot-splash) lives as a sibling of
 * #root in index.html. React renders into #root behind it; once
 * React has committed its first frame AND the splash has been
 * visible for at least MIN_SPLASH_VISIBLE_MS, we add `.cfs-hide`
 * to trigger the opacity transition, then remove the element after
 * the transition completes.
 *
 * v0.1.5-0.1.13 had the splash nested inside #root and let React
 * wipe it implicitly. On fast machines React mounted within ~30ms
 * of script load — before Electron's window-appear animation
 * finished — so users never saw the splash, just a brief black
 * flash. Hoisting the splash out of #root + explicit timed removal
 * guarantees it's visible during the full window-appear window.
 *
 * v0.1.14 first-cut anchored the hold to `bootStart = performance.now()`
 * captured at module-load time. That worked in dev, but in the
 * packaged Windows build the user reported "I didn't see the
 * loading page" — the script could load + dismiss BEFORE the
 * window's appear animation finished, so the 500ms timer was
 * already 300ms into its hold by the time the user saw anything.
 *
 * v0.1.16 fix: anchor the hold to the FIRST PAINT timestamp
 * (= the timestamp the first rAF callback receives), not to
 * script-load. The first rAF callback fires AFTER the renderer
 * has committed its first frame, which is also the trigger for
 * Electron's `ready-to-show` event (= when `win.show()` is
 * called). Add a small buffer to account for the OS
 * window-appear animation finishing AFTER win.show().
 *
 * Also bumped MIN_SPLASH_VISIBLE_MS from 500 to 800. 500ms felt
 * "blink and miss" especially on dark mode where the splash
 * background blends with surrounding chrome; 800ms is the sweet
 * spot per UX research on boot splashes (long enough to register
 * as branded loading, short enough to not feel sluggish).
 */
const MIN_SPLASH_VISIBLE_MS = 800;
const SPLASH_FADE_MS = 220; // must match CSS `transition: opacity 220ms` in index.html

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found in index.html');
}

// Apply the .dark class to <html> before the first React render so the
// initial paint uses the correct theme.
initTheme();

// v0.3.54 — Localization bootstrap. Kill-switch wrapped: if i18next
// fails to initialize (corrupt locale JSON, storage failure, etc.)
// the app still boots with raw English keys visible. Reverting to
// English-only is one localStorage delete away — the app never
// refuses to render because of localization plumbing.
initI18n().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[cfs] i18n init failed, falling back to raw keys', err);
});

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * Schedule splash teardown. We use a double-rAF to land after React's
 * first commit + first paint, then enforce the minimum-visible window
 * relative to the FIRST PAINT timestamp passed to the rAF callback.
 *
 * The first rAF callback receives a `DOMHighResTimeStamp` that
 * represents "the time the user agent began running the current
 * frame's tasks" — essentially first paint. Using that as the anchor
 * (instead of script-load time) guarantees the splash is visible for
 * MIN_SPLASH_VISIBLE_MS after the user can ACTUALLY see the window,
 * not just after the renderer started executing scripts.
 *
 * React 18's concurrent renderer can defer the first commit past
 * `createRoot().render()` returning, so the double-rAF is what
 * actually waits for React to settle before scheduling teardown.
 */
function dismissSplash(firstPaintTs: number): void {
  const splash = document.getElementById('cfs-boot-splash');
  if (!splash) return;
  const elapsed = performance.now() - firstPaintTs;
  const wait = Math.max(0, MIN_SPLASH_VISIBLE_MS - elapsed);
  setTimeout(() => {
    splash.classList.add('cfs-hide');
    splash.setAttribute('aria-hidden', 'true');
    setTimeout(() => splash.remove(), SPLASH_FADE_MS + 20);
  }, wait);
}

requestAnimationFrame((firstPaintTs) => {
  // Inner rAF lands after React's first commit. Pass the FIRST rAF
  // timestamp (= first paint) down so the hold is anchored correctly
  // even if React's commit takes meaningful time.
  requestAnimationFrame(() => dismissSplash(firstPaintTs));
});


