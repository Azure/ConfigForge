// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.1.0 hot-fix: this component is now a no-op and renders null.
 *
 * Phase 6 introduced a frameless Windows titlebar
 * (`titleBarStyle: 'hidden'` + `titleBarOverlay` + a custom
 * `<TitleBar>` React drag strip). The visual outcome was nice
 * (modern Win11 Mica + clean app-name strip) but it had
 * resize/minimize/restore reliability problems on Win11 — clicking
 * near edges sometimes ate cursor input, restoring from minimized
 * occasionally rendered with stale Mica composite, and the
 * overlay symbol-color theme update had race conditions on
 * wake-from-sleep.
 *
 * For v0.1.0 we use the native Windows frame instead (Electron
 * default `titleBarStyle`). Mica backdrop still works through
 * the OS-drawn frame on Win11 22000+.
 *
 * Kept as a stub component so re-enabling the custom-titlebar
 * approach in Phase 12+ is a one-line change in Layout.tsx
 * (just remove the early return below).
 */
export function TitleBar() {
  return null;
}
