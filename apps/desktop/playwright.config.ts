// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { defineConfig } from '@playwright/test';
import path from 'node:path';

/**
 * Phase 7 — Playwright Electron E2E configuration.
 *
 * Runs against the BUILT Electron app (not the Vite dev server)
 * because the production code path is what we ship, and dev-mode
 * has Vite HMR + dev-CSP-strip middleware that we don't want
 * polluting smoke results.
 *
 * Pre-test contract:
 *   - `apps/desktop/dist/electron/main.js` exists
 *   - `apps/desktop/dist/index.html` exists with renderer assets
 *
 * The root npm script `desktop:e2e` chains `desktop:build` first
 * so this contract holds.
 *
 * Why we don't auto-launch via webServer: Electron isn't a web
 * server, it's a desktop app launched via `_electron.launch()`
 * inside each spec. Setup happens in test fixtures, not at the
 * Playwright config layer.
 */

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  testMatch: '**/*.spec.ts',
  // Each Electron spec spawns a full app, which is heavy. Don't
  // parallelize: we want deterministic output and the dev box
  // doesn't have the cores to support parallel Electron processes.
  fullyParallel: false,
  workers: 1,
  // Retry once locally to absorb the very-occasional first-frame
  // race; CI gets 2 retries (Phase 9 work).
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Generous timeout — Electron cold-start on Windows can take 10s+
  // in worst case (antivirus scanning the freshly written main.js).
  timeout: 60_000,
  expect: {
    // FluentUI v9 components mount asynchronously (Griffel CSS
    // injection happens on first render) so initial assertions
    // sometimes need extra time on slower hardware.
    timeout: 10_000,
  },
});
