// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase 7 — Vitest setup file for the Electron renderer test suite.
 *
 * Loaded by `vitest.config.ts` (root, project "desktop") via
 * `setupFiles`. Runs once per test worker before any test file.
 *
 * Responsibilities:
 *   1. Install @testing-library/jest-dom matchers globally
 *      (`toBeInTheDocument`, `toHaveClass`, `toHaveAttribute`, etc.)
 *   2. Provide a stub `window.cfs` so renderer modules that read
 *      `cfs.platform.info()` etc. at import time don't blow up.
 *      Tests that need richer behavior should override the stub
 *      via `vi.mocked(window.cfs.platform.info).mockResolvedValue(...)`.
 *   3. Polyfill `matchMedia` (jsdom doesn't ship it but FluentUI
 *      and `useMatchMedia()` from lib/platform.ts use it).
 *
 * Renderer source code MUST work without these polyfills in
 * production — they're only here so the test environment matches
 * the Electron preload bridge surface area.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { initI18n } from './src/locales';
import { __TEST__ as localeTest } from './src/lib/locale';

// 1. Auto-cleanup React Testing Library between tests so the JSDOM
// document isn't polluted by previous renders (RTL 16 dropped the
// auto-cleanup that 15 had on by default in some setups).
afterEach(() => {
  cleanup();
});

// 2. matchMedia polyfill. JSDOM doesn't implement it; FluentUI's
// useMediaQuery + our own useMatchMedia hook in lib/platform.ts
// will throw without it.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// 3. Stub `window.cfs` (preload bridge). Mirrors the shape of
// `apps/desktop/electron/preload.ts` `cfsApi` minus method bodies.
// Each test can override individual methods with vi.mocked(...).
type CfsApiShape = {
  platform: {
    info: () => Promise<{
      platform: NodeJS.Platform;
      release: string;
      isWindows11: boolean;
      isRdpSession: boolean;
      prefersDark: boolean;
      arch: string;
    }>;
    onThemeChanged: (cb: (prefersDark: boolean) => void) => () => void;
  };
  // Phase 11 — auto-update channel. Default stub returns 'idle'
  // so the UpdateBanner renders null in tests that don't override.
  update: {
    getStatus: () => Promise<{ state: string; [k: string]: unknown }>;
    onStatus: (cb: (s: { state: string; [k: string]: unknown }) => void) => () => void;
    check: () => Promise<{ state: string; [k: string]: unknown }>;
    download: () => Promise<{ ok: boolean; error?: string }>;
    quitAndInstall: () => Promise<{ ok: true }>;
  };
  // Other namespaces (manifest, deploy, baseline, etc.) — tests
  // that exercise those paths should mock per-test.
  [key: string]: unknown;
};

const stubCfs: CfsApiShape = {
  platform: {
    info: vi.fn().mockResolvedValue({
      platform: 'win32',
      release: '10.0.26100',
      isWindows11: true,
      isRdpSession: false,
      prefersDark: false,
      arch: 'x64',
    }),
    onThemeChanged: vi.fn(() => () => {}),
  },
  update: {
    getStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
    onStatus: vi.fn(() => () => {}),
    check: vi.fn().mockResolvedValue({ state: 'idle' }),
    download: vi.fn().mockResolvedValue({ ok: true }),
    quitAndInstall: vi.fn().mockResolvedValue({ ok: true }),
  },
  rationale: {
    list: vi.fn().mockResolvedValue({ entries: [] }),
    append: vi.fn().mockResolvedValue({ ok: true, entry: {} }),
  },
  auditResults: {
    get: vi.fn().mockResolvedValue({ snapshot: null }),
  },
  system: {
    isElevated: vi.fn().mockResolvedValue({ isElevated: false }),
    elevate: vi.fn().mockResolvedValue({ status: 'launching', message: 'Relaunching…' }),
  },
};

beforeAll(() => {
  Object.defineProperty(window, 'cfs', {
    writable: true,
    configurable: true,
    value: stubCfs,
  });
});

// 4. ResizeObserver polyfill — FluentUI v9 internals (Tooltip,
// MessageBar overflow) call it.
beforeAll(() => {
  if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  }
});

// 5. v0.3.54 — initialize i18next so components using useTranslation
// don't throw. Pinned to English so the existing 283 tests assert
// against the same strings they always did. Tests that need to
// exercise the localization path call `i18n.changeLanguage('fr')`
// explicitly.
beforeAll(async () => {
  localeTest.reset();
  await initI18n();
});
