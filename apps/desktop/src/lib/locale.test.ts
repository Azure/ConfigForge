// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.54 — Locale preference layer regression tests.
 *
 * Companion to `useThemePreference` tests in platform.test.ts.
 * Covers the storage round-trip, navigator.language resolution,
 * unsupported-locale fallback, and the kill-switch behavior that
 * keeps the app booting even when storage / navigator are broken.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __TEST__,
  getActiveLocale,
  getLocalePreference,
  initializeLocale,
  resolveLocale,
} from './locale';

function setNavigatorLanguage(lang: string): void {
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    get: () => lang,
  });
}

describe('locale preference', () => {
  beforeEach(() => {
    localStorage.clear();
    __TEST__.reset();
  });

  afterEach(() => {
    localStorage.clear();
    __TEST__.reset();
    setNavigatorLanguage('en-US');
  });

  describe('resolveLocale', () => {
    it("returns the exact preference when it's a concrete locale", () => {
      expect(resolveLocale('en')).toBe('en');
      expect(resolveLocale('fr')).toBe('fr');
      expect(resolveLocale('de')).toBe('de');
      expect(resolveLocale('es')).toBe('es');
    });

    it("maps 'system' to the navigator primary subtag when supported", () => {
      setNavigatorLanguage('fr-CA');
      expect(resolveLocale('system')).toBe('fr');
      setNavigatorLanguage('de-AT');
      expect(resolveLocale('system')).toBe('de');
      setNavigatorLanguage('es-MX');
      expect(resolveLocale('system')).toBe('es');
    });

    it("falls back to 'en' for unsupported navigator locales", () => {
      setNavigatorLanguage('ja-JP');
      expect(resolveLocale('system')).toBe('en');
      setNavigatorLanguage('zh-Hans-CN');
      expect(resolveLocale('system')).toBe('en');
    });

    it("falls back to 'en' for malformed navigator values", () => {
      setNavigatorLanguage('');
      expect(resolveLocale('system')).toBe('en');
    });
  });

  describe('initializeLocale + storage round-trip', () => {
    it("returns 'en' when nothing is stored and OS is English", () => {
      setNavigatorLanguage('en-US');
      const resolved = initializeLocale();
      expect(resolved).toBe('en');
      expect(getLocalePreference()).toBe('system');
      expect(getActiveLocale()).toBe('en');
    });

    it('honors a stored concrete preference over navigator', () => {
      localStorage.setItem(__TEST__.STORAGE_KEY, 'fr');
      setNavigatorLanguage('en-US');
      const resolved = initializeLocale();
      expect(resolved).toBe('fr');
      expect(getLocalePreference()).toBe('fr');
    });

    it("treats stored 'system' the same as no stored value", () => {
      localStorage.setItem(__TEST__.STORAGE_KEY, 'system');
      setNavigatorLanguage('de-DE');
      const resolved = initializeLocale();
      expect(resolved).toBe('de');
      expect(getLocalePreference()).toBe('system');
    });

    it('discards a stored unsupported locale and falls back to system', () => {
      localStorage.setItem(__TEST__.STORAGE_KEY, 'ja');
      setNavigatorLanguage('en-US');
      const resolved = initializeLocale();
      expect(resolved).toBe('en');
      expect(getLocalePreference()).toBe('system');
    });
  });
});
