// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * E2E — Diff "Select manifest" dropdown freeze regression guard.
 *
 * Repro for the persistent bug where, after rapid navigation that mounts
 * and disposes Monaco editors (the Diff page mounts editors; leaving
 * disposes them), an orphaned position:fixed Monaco overflow widget was
 * left under <body>, sat invisibly over the "Select manifest" <select>,
 * swallowed the click, and froze the dropdown until app restart.
 *
 * The fix hosts overflow widgets in a detached `.monaco-overflow-host` node
 * (created with document.createElement, appended to <body>, removed on the
 * editor's unmount) instead of Monaco's default body parenting. This test
 * churns editors (Diff↔CIS↔Manifests, opening a find widget) then, on the
 * Diff page, switches a side to "from manifest" mode and asserts the reported
 * dropdown:
 *   1. the overflow-host count is stable (no orphan accumulation across visits),
 *   2. nothing overlays the "Select manifest" <select> (elementFromPoint),
 *   3. a real pointer click reaches it (no "intercepts pointer events"),
 *   4. selecting a manifest actually changes its value (operable end-to-end).
 */

const APP_ROOT = path.resolve(__dirname, '..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'electron', 'main.js');
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const electronExecutablePath = requireFromApp('electron') as string;

let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  app = await _electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    executablePath: electronExecutablePath,
    env: { ...process.env, NODE_ENV: 'production', LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate((iso: string) => {
    try {
      window.localStorage.setItem('cfs.welcome.dismissedAt', iso);
    } catch {
      /* ignore */
    }
  }, new Date().toISOString());
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

function nav(name: string): Promise<void> {
  return win.locator('aside').getByRole('link', { name }).click();
}

function hostCount(): Promise<number> {
  return win.evaluate(() => document.querySelectorAll('.monaco-overflow-host').length);
}

test('Diff "Select manifest" stays clickable and operable after rapid editor churn', async () => {
  // Baseline: how many editor hosts the Pairwise Diff view mounts.
  await nav('Diff');
  await expect(win.locator('select').first()).toBeVisible({ timeout: 10_000 });
  const baseline = await hostCount();
  expect(baseline).toBeGreaterThan(0); // proves the overflow host is wired

  // Churn: mount/dispose editors repeatedly, opening an overflow widget
  // (find) before each dispose to stress the orphan-prone path — this is the
  // rapid manifests/edit/CIS↔Diff navigation the freeze was reported under.
  for (let i = 0; i < 5; i++) {
    await nav('CIS Mapping');
    await nav('Manifests');
    await nav('Diff');
    const editor = win.locator('.monaco-editor').first();
    try {
      await editor.click({ timeout: 2000 });
      await win.keyboard.press('Control+F'); // open Monaco find widget (overflow)
      await win.waitForTimeout(80);
      await win.keyboard.press('Escape');
    } catch {
      /* best effort — navigation churn alone still exercises mount/dispose */
    }
  }

  // Land on a clean Diff view (no find widget open).
  await nav('Manifests');
  await nav('Diff');
  await expect(win.locator('select').first()).toBeVisible({ timeout: 10_000 });

  // No host accumulation — each editor's host is torn down on unmount, so the
  // count matches the baseline rather than growing per visit (no orphans).
  expect(await hostCount()).toBe(baseline);

  // Switch the LEFT side to "from manifest" mode so the "Select manifest"
  // dropdown — the exact control the user reported as frozen — is rendered.
  const leftMode = win.locator('select').first();
  await leftMode.selectOption('manifest');

  // After switching, DOM order of <select>s is [left-mode, left-manifest,
  // right-mode]; nth(1) is the manifest dropdown under test.
  const manifestSelect = win.locator('select').nth(1);
  await expect(manifestSelect).toBeVisible({ timeout: 10_000 });
  await expect(manifestSelect).toBeEnabled();

  // 1. Nothing overlays it (the freeze): elementFromPoint at the dropdown's
  //    centre returns the <select>, so a real pointerdown lands on it instead
  //    of an invisible orphaned position:fixed Monaco widget.
  const reachable = await manifestSelect.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
    return !!hit && (el === hit || el.contains(hit) || hit.closest('select') === el);
  });
  expect(reachable).toBe(true);

  // 2. A REAL pointer click must reach it. If an orphan overlay covered the
  //    dropdown, Playwright's actionability check fails here with "intercepts
  //    pointer events" — this is the click that "did nothing" before the fix.
  await manifestSelect.click({ timeout: 5000 });
  await win.keyboard.press('Escape'); // dismiss the native popup the click opened

  // 3. It actually operates end-to-end: picking a real manifest updates the
  //    value (proves the dropdown is live, not frozen). Skipped only if the
  //    test environment seeded no manifests.
  const optionValues = await manifestSelect
    .locator('option')
    .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''));
  if (optionValues.length > 0) {
    await manifestSelect.selectOption(optionValues[0]);
    await expect(manifestSelect).toHaveValue(optionValues[0]);
  }
});
