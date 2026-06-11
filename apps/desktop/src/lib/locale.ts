// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.54 — UI locale preference.
 *
 * Deliberately mirrors `useThemePreference` in `./platform.ts`:
 *   - localStorage-backed enum (system | en | fr | de | es)
 *   - `system` resolves via `navigator.language` at boot AND on every
 *     hook re-read so an OS-level locale change is honored without a
 *     restart (Electron + jsdom both keep `navigator.language` live).
 *   - English is the universal fallback. Any unrecognized navigator
 *     locale resolves to `en` so the UI never goes blank.
 *
 * Why no IPC: the only locale signal we need is `navigator.language`,
 * which the Electron renderer inherits from the OS via Chromium.
 * If we ever need finer control (e.g. user picked French in OS but
 * Spanish in Windows app-language pack), we can layer in
 * `cfs.platform.getOsLocale()` later without changing this hook's
 * shape — same incremental upgrade path theme tracking took.
 *
 * Kill-switch behavior: every public function in this module is
 * wrapped to never throw. If `localStorage` is unavailable (some
 * jsdom paths), if `navigator.language` returns junk, etc. — we
 * fall back to `en` silently. Logged to `electron-log` only in dev
 * to avoid spamming the production console.
 */

import { useEffect, useState } from 'react';

export type SupportedLocale = 'en' | 'fr' | 'de' | 'es';
export type LocalePreference = SupportedLocale | 'system';

const LOCALE_STORAGE_KEY = 'configforge-locale';
const SUPPORTED: readonly SupportedLocale[] = ['en', 'fr', 'de', 'es'];
const DEFAULT_LOCALE: SupportedLocale = 'en';

function isSupportedLocale(v: string): v is SupportedLocale {
  return (SUPPORTED as readonly string[]).includes(v);
}

function readLocalePreference(): LocalePreference {
  try {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'system') return 'system';
    if (stored && isSupportedLocale(stored)) return stored;
    return 'system';
  } catch {
    return 'system';
  }
}

function writeLocalePreference(pref: LocalePreference): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (pref === 'system') localStorage.removeItem(LOCALE_STORAGE_KEY);
    else localStorage.setItem(LOCALE_STORAGE_KEY, pref);
  } catch {
    // Silent: storage write failure should never break the UI.
  }
}

/**
 * Resolve a preference into a concrete supported locale.
 *
 * `system` walks navigator.language → primary subtag → SUPPORTED match
 * → DEFAULT_LOCALE. `fr-CA` → `fr`, `de-AT` → `de`, `es-MX` → `es`,
 * anything outside SUPPORTED → `en`.
 */
export function resolveLocale(pref: LocalePreference): SupportedLocale {
  if (pref !== 'system') return pref;
  try {
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
    const raw = navigator.language || DEFAULT_LOCALE;
    const primary = raw.toLowerCase().split(/[-_]/)[0];
    if (isSupportedLocale(primary)) return primary;
    return DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// External-store pattern so consumers can subscribe to the active
// locale (driven by user override events). i18next has its own
// `languageChanged` event that we wire into in `locales/index.ts`;
// this is the renderer-side preference layer that drives it.
type Listener = () => void;
const localeListeners = new Set<Listener>();

let _userPreference: LocalePreference = 'system';
let _activeLocale: SupportedLocale = DEFAULT_LOCALE;

function notifyLocaleListeners(): void {
  for (const l of localeListeners) l();
}

/**
 * Initialize locale tracking. Call ONCE from `main.tsx` BEFORE
 * i18next.init() so the initial namespace load uses the correct
 * language. Safe to call multiple times (idempotent re-read).
 *
 * Returns the resolved locale so the caller can pass it to i18next
 * without a round-trip through the hook.
 */
export function initializeLocale(): SupportedLocale {
  try {
    _userPreference = readLocalePreference();
    _activeLocale = resolveLocale(_userPreference);
    return _activeLocale;
  } catch {
    _userPreference = 'system';
    _activeLocale = DEFAULT_LOCALE;
    return DEFAULT_LOCALE;
  }
}

/** Read the currently active resolved locale (no React subscription). */
export function getActiveLocale(): SupportedLocale {
  return _activeLocale;
}

/** Read the currently set preference (no React subscription). */
export function getLocalePreference(): LocalePreference {
  return _userPreference;
}

/**
 * Hook: read + set the user's locale preference. Re-renders on change.
 * The setter is responsible for (a) persisting the preference,
 * (b) updating the in-memory active locale, and (c) notifying
 * subscribers — typically `locales/index.ts` listens here and calls
 * `i18n.changeLanguage()` to flip the actual translation table.
 */
export function useLocalePreference(): [LocalePreference, (pref: LocalePreference) => void] {
  const [pref, setPrefState] = useState<LocalePreference>(_userPreference);

  useEffect(() => {
    setPrefState(_userPreference);
    const listener = (): void => setPrefState(_userPreference);
    localeListeners.add(listener);
    return () => {
      localeListeners.delete(listener);
    };
  }, []);

  const setPref = (next: LocalePreference): void => {
    _userPreference = next;
    writeLocalePreference(next);
    _activeLocale = resolveLocale(next);
    setPrefState(next);
    notifyLocaleListeners();
  };

  return [pref, setPref];
}

/**
 * Subscribe to active-locale changes from outside React (used by
 * `locales/index.ts` to sync i18next without a hook).
 */
export function subscribeLocale(cb: () => void): () => void {
  localeListeners.add(cb);
  return () => {
    localeListeners.delete(cb);
  };
}

export const __TEST__ = {
  reset(): void {
    _userPreference = 'system';
    _activeLocale = DEFAULT_LOCALE;
    localeListeners.clear();
  },
  STORAGE_KEY: LOCALE_STORAGE_KEY,
  SUPPORTED,
  DEFAULT_LOCALE,
};
