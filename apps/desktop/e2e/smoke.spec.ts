// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Phase 7 — Electron smoke E2E.
 *
 * Launches the BUILT Electron app, waits for the first window,
 * asserts the renderer mounted and basic navigation works, and
 * captures any console errors.
 *
 * This is a smoke spec — its job is to catch catastrophic
 * regressions (renderer fails to mount, IPC bridge throws, theme
 * provider crashes, etc.) before they hit a human tester. It is
 * NOT a feature test — feature behavior is covered by vitest +
 * RTL component tests.
 *
 * To run:
 *   npm run desktop:e2e
 *
 * To debug (headed browser, slow):
 *   PWDEBUG=1 npm run desktop:e2e
 */

const APP_ROOT = path.resolve(__dirname, '..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'electron', 'main.js');

// Electron lives in `apps/desktop/node_modules/electron` (not
// hoisted to the workspace root because Electron's binary download
// is per-package). Resolve it from the apps/desktop scope so
// Playwright can launch it from a root-level test runner.
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const electronExecutablePath = requireFromApp('electron') as string;

let app: ElectronApplication;
let firstWindow: Page;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  app = await _electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    executablePath: electronExecutablePath,
    // Force English locale so text-content assertions are stable
    // regardless of the dev box / CI runner locale.
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
    },
  });

  firstWindow = await app.firstWindow();

  // Capture console errors as they happen so each test can assert
  // they're empty without the test having to hold open a listener.
  firstWindow.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  firstWindow.on('pageerror', (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  await firstWindow.waitForLoadState('domcontentloaded');

  // v0.2.0 — pre-dismiss the first-run WelcomeDialog so it doesn't
  // overlay the dashboard before the smoke assertions can run.
  // The dialog persists its dismissal via localStorage; setting the
  // key + reloading restores the "returning user" path which is
  // what the rest of the suite assumes. Without this, the FluentUI
  // modalType="alert" dialog covers the dashboard h1 and intercepts
  // sidebar clicks.
  await firstWindow.evaluate((iso: string) => {
    try {
      window.localStorage.setItem('cfs.welcome.dismissedAt', iso);
    } catch {
      // localStorage write can fail in unusual sandboxes; the
      // dialog will then render and downstream tests will fail
      // with a more useful error than this silent catch.
    }
  }, new Date().toISOString());
  await firstWindow.reload();
  await firstWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('renderer mounts and the dashboard is visible', async () => {
  // App.tsx routes "/" to the Dashboard page which renders
  // `<h1>Dashboard</h1>` (per Phase 5 port). HashRouter means
  // the URL is `file:///.../index.html#/` after first paint.
  await expect(firstWindow.locator('h1', { hasText: 'Dashboard' })).toBeVisible();
});

test('sidebar shows all six nav items', async () => {
  const labels = ['Dashboard', 'Manifests', 'Validation', 'Library', 'Diff', 'CIS Mapping', 'Settings'];
  for (const label of labels) {
    await expect(firstWindow.locator('aside').getByText(label, { exact: true })).toBeVisible();
  }
});

test('navigates from Dashboard to Library', async () => {
  await firstWindow.locator('aside').getByRole('link', { name: 'Library' }).click();
  // Library page renders <h1>Baseline Library</h1>; the sidebar
  // label is "Library" (shorter form) and the page heading is the
  // full "Baseline Library" descriptor.
  await expect(firstWindow.locator('h1', { hasText: /Baseline Library/ })).toBeVisible();
});

test('navigates from Library to Validation', async () => {
  await firstWindow.locator('aside').getByRole('link', { name: 'Validation' }).click();
  // Validation page renders <h1>Validation & Export Readiness</h1>.
  // Sidebar was renamed in v0.2.15 (Compliance -> Validation).
  await expect(
    firstWindow.locator('h1', { hasText: /Validation/ }),
  ).toBeVisible();
});

test('renderer reports the configured platform via cfs.platform.info', async () => {
  // Drive the live preload bridge from inside the renderer.
  // This implicitly verifies the IPC path: preload.ts ↔ ipc-handlers.ts ↔ nativeTheme.
  const info = await firstWindow.evaluate(async () => {
    const cfs = (window as unknown as { cfs: { platform: { info: () => Promise<unknown> } } }).cfs;
    return cfs.platform.info();
  });
  expect(info).toMatchObject({
    platform: expect.any(String),
    isWindows11: expect.any(Boolean),
    arch: expect.any(String),
  });
});

test('FluentProvider mounted (Griffel CSS injected)', async () => {
  // FluentProvider injects a <style data-make-styles-bucket> tag
  // into <head> on first paint. If the provider didn't wrap the
  // tree, no Griffel-styled component would render.
  const fluentStyleTagCount = await firstWindow.evaluate(() => {
    return document.querySelectorAll('style[data-make-styles-bucket]').length;
  });
  expect(fluentStyleTagCount).toBeGreaterThan(0);
});

test('no uncaught console errors after navigation', async () => {
  // Some errors are tolerable (e.g. devtools warnings about a
  // CSP source) — filter them rather than blanket-fail. Anything
  // else is a real bug we want to surface.
  const realErrors = consoleErrors.filter((err) => {
    if (err.includes('Electron Security Warning')) return false;
    // React Router v6 future-flag warnings aren't errors but get
    // logged at warn level; harmless.
    if (err.includes('React Router')) return false;
    return true;
  });
  expect(realErrors).toEqual([]);
});
