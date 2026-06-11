// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Platform detection + theme tracking for the renderer.
 *
 * Phase 6 — Mica backdrop, custom titlebar, and FluentProvider theme
 * switching all consume these helpers. Browser-only fallbacks are
 * provided for vitest / non-Electron contexts (where `window.cfs` is
 * absent) so renderer code can run uniformly.
 *
 * Pattern:
 *   - `is*` functions are SYNC and SAFE to call from JSX (return false
 *     until the IPC info promise resolves; `usePlatform()` re-renders
 *     when it does).
 *   - `usePlatform()` returns the live snapshot (or `null` while the
 *     IPC round-trip is in flight).
 *   - `useTheme()` returns 'light' | 'dark' and re-renders on OS theme
 *     change AND on a user-override toggle.
 *
 * Theme detection order:
 *   1. `localStorage` 'configforge-theme' override (light/dark/system).
 *   2. `cfs.platform.info().prefersDark` (live OS snapshot, authoritative).
 *   3. `window.matchMedia('(prefers-color-scheme: dark)')` browser fallback.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { cfs, isElectron } from './cfs';

export interface PlatformInfo {
  platform: NodeJS.Platform;
  release: string;
  isWindows11: boolean;
  /**
   * True when running inside a Windows Remote Desktop / Azure DevBox /
   * Citrix session. Used to skip translucency-dependent visuals
   * (Mica, acrylic, transparent body) that look broken when
   * DirectComposition surfaces don't transport correctly through the
   * RDP framebuffer channel — see `electron/platform-detection.ts`.
   */
  isRdpSession: boolean;
  prefersDark: boolean;
  arch: string;
}

let _cachedInfo: PlatformInfo | null = null;
let _inflightInfo: Promise<PlatformInfo> | null = null;

/** Fetch platform info once per page lifetime. Subsequent calls hit the cache. */
export async function fetchPlatformInfo(): Promise<PlatformInfo> {
  if (_cachedInfo) return _cachedInfo;
  if (_inflightInfo) return _inflightInfo;

  if (!isElectron()) {
    // Browser fallback — best-effort from userAgent. We can't reliably
    // detect Windows 11 from the UA string, so default to false.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isWin = /Windows/i.test(ua);
    const isLinux = /Linux/i.test(ua);
    _cachedInfo = {
      platform: isWin ? 'win32' : isLinux ? 'linux' : 'darwin',
      release: '',
      isWindows11: false,
      isRdpSession: false,
      prefersDark:
        typeof window !== 'undefined'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
          : false,
      arch: 'unknown',
    };
    return _cachedInfo;
  }

  _inflightInfo = cfs.platform
    .info()
    .then((info) => {
      _cachedInfo = info;
      _inflightInfo = null;
      return info;
    })
    .catch((err) => {
      _inflightInfo = null;
      throw err;
    });
  return _inflightInfo;
}

/**
 * Hook: subscribe to platform info. Initial render returns `null`;
 * re-renders once the IPC round-trip resolves.
 */
export function usePlatform(): PlatformInfo | null {
  const [info, setInfo] = useState<PlatformInfo | null>(_cachedInfo);
  useEffect(() => {
    if (_cachedInfo) {
      setInfo(_cachedInfo);
      return;
    }
    let cancelled = false;
    fetchPlatformInfo()
      .then((v) => {
        if (!cancelled) setInfo(v);
      })
      .catch(() => {
        // Swallow — components handle null as "not yet known".
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

// Sync detectors — return false until the cache is populated. Components
// that need the value SYNCHRONOUSLY at render time should call
// `usePlatform()` instead so they re-render once the answer is known.

export function isWindows(): boolean {
  return _cachedInfo?.platform === 'win32';
}

export function isWindows11(): boolean {
  return _cachedInfo?.isWindows11 === true;
}

export function isLinux(): boolean {
  return _cachedInfo?.platform === 'linux';
}

export function isMacOs(): boolean {
  return _cachedInfo?.platform === 'darwin';
}

/**
 * Test-only: reset the module-scope IPC cache. Phase 7 component
 * tests need this so each test can mock a different platform; in
 * production the cache is set once per page lifetime and never
 * needs resetting. Marked with the `__` prefix so reviewers spot
 * any non-test caller and reject it.
 */
export function __resetPlatformCacheForTests(): void {
  _cachedInfo = null;
  _inflightInfo = null;
}

// ── Theme tracking ────────────────────────────────────────────────

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const THEME_STORAGE_KEY = 'configforge-theme';

function readThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function writeThemePreference(pref: ThemePreference): void {
  if (typeof localStorage === 'undefined') return;
  if (pref === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, pref);
}

/** Resolve the active theme given preference + OS state. */
function resolveTheme(pref: ThemePreference, osPrefersDark: boolean): Theme {
  if (pref === 'light' || pref === 'dark') return pref;
  return osPrefersDark ? 'dark' : 'light';
}

// External-store pattern so React can subscribe to the live theme
// (driven by both OS events AND user override events).
type Listener = () => void;
const themeListeners = new Set<Listener>();

let _activeTheme: Theme = 'light';
let _userPreference: ThemePreference = 'system';

function notifyThemeListeners(): void {
  for (const l of themeListeners) l();
}

function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Initialize theme tracking — call ONCE from `main.tsx` BEFORE the React
 * tree mounts so the `.dark` class is set on `<html>` for the first paint.
 */
export function initTheme(): void {
  if (typeof window === 'undefined') return;

  _userPreference = readThemePreference();

  // Initial value from matchMedia (synchronous, no IPC needed).
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  let osPrefersDark = mq.matches;
  _activeTheme = resolveTheme(_userPreference, osPrefersDark);
  applyThemeClass(_activeTheme);

  // Once IPC resolves, override with the authoritative value.
  fetchPlatformInfo()
    .then((info) => {
      osPrefersDark = info.prefersDark;
      const next = resolveTheme(_userPreference, osPrefersDark);
      if (next !== _activeTheme) {
        _activeTheme = next;
        applyThemeClass(_activeTheme);
        notifyThemeListeners();
      }
    })
    .catch(() => {
      /* keep matchMedia value */
    });

  // Listen for OS-level theme changes via IPC (Electron) or matchMedia
  // (browser fallback / Linux without IPC).
  if (isElectron()) {
    cfs.platform.onThemeChanged((prefersDark) => {
      osPrefersDark = prefersDark;
      const next = resolveTheme(_userPreference, osPrefersDark);
      if (next !== _activeTheme) {
        _activeTheme = next;
        applyThemeClass(_activeTheme);
        notifyThemeListeners();
      }
    });
  } else {
    mq.addEventListener('change', (e) => {
      osPrefersDark = e.matches;
      const next = resolveTheme(_userPreference, osPrefersDark);
      if (next !== _activeTheme) {
        _activeTheme = next;
        applyThemeClass(_activeTheme);
        notifyThemeListeners();
      }
    });
  }
}

/** Hook: subscribe to the active theme. Re-renders on OS or override change. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb);
      return () => {
        themeListeners.delete(cb);
      };
    },
    () => _activeTheme,
    () => _activeTheme,
  );
}

/** Hook: read + set the user's theme preference. Re-renders on change. */
export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPrefState] = useState<ThemePreference>(_userPreference);
  useEffect(() => {
    setPrefState(_userPreference);
  }, []);

  const setPref = (next: ThemePreference): void => {
    _userPreference = next;
    writeThemePreference(next);
    setPrefState(next);
    // Trigger re-resolution against the latest OS snapshot.
    fetchPlatformInfo()
      .then((info) => {
        const resolved = resolveTheme(next, info.prefersDark);
        if (resolved !== _activeTheme) {
          _activeTheme = resolved;
          applyThemeClass(_activeTheme);
          notifyThemeListeners();
        }
      })
      .catch(() => {
        if (typeof window === 'undefined') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const resolved = resolveTheme(next, mq.matches);
        if (resolved !== _activeTheme) {
          _activeTheme = resolved;
          applyThemeClass(_activeTheme);
          notifyThemeListeners();
        }
      });
  };

  return [pref, setPref];
}

// ── Accessibility preferences ─────────────────────────────────────

/** Hook: prefers-reduced-motion. Re-renders on change. */
export function usePrefersReducedMotion(): boolean {
  return useMatchMedia('(prefers-reduced-motion: reduce)');
}

/** Hook: forced-colors mode (Windows High Contrast). Re-renders on change. */
export function usePrefersForcedColors(): boolean {
  return useMatchMedia('(forced-colors: active)');
}

function useMatchMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined') return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
    () => false,
  );
}
