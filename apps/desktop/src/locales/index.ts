// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.54 — i18next bootstrap for the renderer.
 *
 * Responsibilities:
 *   1. Load every namespace JSON for every supported locale via Vite's
 *      eager glob import (no async fetches at runtime — bundled).
 *   2. Initialize i18next with the active locale resolved from the
 *      preference layer in `lib/locale.ts`.
 *   3. Subscribe to preference changes so a user toggling the language
 *      in Settings flips i18next without a page reload.
 *
 * Kill-switch behavior: `initI18n()` is wrapped in try/catch by the
 * caller (`main.tsx`). If anything in here throws, the app boots with
 * the raw English JSON keys visible — ugly, but functional. Reverting
 * to English-only is one localStorage delete away.
 *
 * Why eager glob (vs lazy import per namespace): the entire catalog
 * for all 4 locales is ~60 KB gzipped. Lazy-loading would save bytes
 * but cost a flash-of-untranslated-content when the user navigates.
 * We can revisit if bundle size grows past ~500 KB.
 */

import i18n, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  initializeLocale,
  resolveLocale,
  getLocalePreference,
  subscribeLocale,
  type SupportedLocale,
} from '../lib/locale';

const NAMESPACES = [
  'common',
  'sidebar',
  'settings',
  'home',
  'manifests',
  'manifest-editor',
  'diff',
  'history',
  'compliance',
  'cis-catalog',
  'audit-pack',
  'welcome',
  'dialogs',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

const SUPPORTED: readonly SupportedLocale[] = ['en', 'fr', 'de', 'es'];

/**
 * Vite-only: glob-imports every locale JSON at build time. The
 * resulting `modules` map looks like:
 *   { '/src/locales/en/common.json': { default: {...} }, ... }
 *
 * `eager: true` inlines them into the bundle (no dynamic import
 * boundary). `import: 'default'` strips the ESM-default wrapper so
 * values are raw JSON objects.
 */
const modules = import.meta.glob('./*/*.json', { eager: true, import: 'default' }) as Record<
  string,
  Record<string, unknown>
>;

function buildResources(): Record<string, Record<string, Record<string, unknown>>> {
  const resources: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const locale of SUPPORTED) {
    resources[locale] = {};
    for (const ns of NAMESPACES) {
      const key = `./${locale}/${ns}.json`;
      const payload = modules[key];
      // Missing files resolve to empty objects so i18next falls back
      // to English without throwing. This keeps Phase 0 shippable
      // even when only a handful of namespaces are translated.
      resources[locale][ns] = (payload as Record<string, unknown> | undefined) ?? {};
    }
  }
  return resources;
}

let _initialized = false;
let _subscription: (() => void) | null = null;

/**
 * Initialize i18next. Call once from `main.tsx` BEFORE React renders.
 * Idempotent — repeated calls are no-ops.
 *
 * Returns the i18next instance for callers that want to inspect or
 * extend it (e.g. tests). The instance is also re-exported as the
 * module's default `i18n`.
 */
export async function initI18n(): Promise<I18nInstance> {
  if (_initialized) return i18n;

  const initialLocale = initializeLocale();

  await i18n.use(initReactI18next).init({
    resources: buildResources(),
    lng: initialLocale,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: NAMESPACES as unknown as string[],
    interpolation: { escapeValue: false },
    returnNull: false,
    // Don't spam the console in dev for missing keys — `t('foo')`
    // returning 'foo' is the expected behavior during the multi-wave
    // string extraction.
    saveMissing: false,
    missingKeyHandler: undefined,
    // Helps i18next match `fr-CA` → `fr` even if a future locale
    // detector hands us a region-tagged value.
    nonExplicitSupportedLngs: true,
    supportedLngs: SUPPORTED as unknown as string[],
  });

  // Wire preference-layer changes into i18next so user toggles flip
  // the active language without a reload.
  _subscription?.();
  _subscription = subscribeLocale(() => {
    const next = resolveLocale(getLocalePreference());
    if (i18n.language !== next) void i18n.changeLanguage(next);
  });

  _initialized = true;
  return i18n;
}

export function getI18n(): I18nInstance {
  return i18n;
}

export const __TEST__ = {
  reset(): void {
    _initialized = false;
    _subscription?.();
    _subscription = null;
  },
  NAMESPACES,
  SUPPORTED,
};

export default i18n;
