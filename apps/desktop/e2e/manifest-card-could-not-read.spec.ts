// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * E2E — Manifests list card "Could not read" stat.
 *
 * Regression guard for the bug where the list card showed
 * Resources / Compliant / Issues but dropped the amber
 * "Could not read" (indeterminate + error) bucket, so the card
 * numbers didn't add up versus the manifest detail / audit view.
 *
 * Drives the real built Electron app: registers a throwaway
 * manifest, seeds the renderer's per-manifest compliance cache (the
 * same `configforge-compliance-<name>` sessionStorage entry the list
 * page reads), navigates to the list, and asserts all four buckets
 * render with the right counts. Cleans up the manifest in afterAll.
 */

const APP_ROOT = path.resolve(__dirname, '..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'electron', 'main.js');
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const electronExecutablePath = requireFromApp('electron') as string;

const MANIFEST_NAME = 'e2e-could-not-read-card';
const MANIFEST_YAML = [
  'resources:',
  '  - name: SampleSetting',
  '    type: Microsoft.Windows/Registry',
  '    properties:',
  '      keyPath: HKLM:\\Software\\ConfigForgeE2E',
  '      valueName: CnrTest',
  '      valueType: Dword',
  '      value: 1',
].join('\n');

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

  // Dismiss the first-run Welcome dialog so it doesn't overlay the UI.
  await win.evaluate((iso: string) => {
    try {
      window.localStorage.setItem('cfs.welcome.dismissedAt', iso);
    } catch {
      /* ignore */
    }
  }, new Date().toISOString());
  await win.reload();
  await win.waitForLoadState('domcontentloaded');

  // Register the throwaway manifest so it appears in cfs.manifests.list.
  const reg = await win.evaluate(
    async ({ n, c }: { n: string; c: string }) => {
      const cfs = (
        window as unknown as {
          cfs: { manifests: { register: (req: { name: string; content: string }) => Promise<unknown> } };
        }
      ).cfs;
      return await cfs.manifests.register({ name: n, content: c });
    },
    { n: MANIFEST_NAME, c: MANIFEST_YAML },
  );
  const env = reg as { ok?: boolean; error?: string };
  if (env && env.ok === false) {
    throw new Error(`register(${MANIFEST_NAME}) failed: ${env.error ?? 'unknown'}`);
  }

  // Seed the per-manifest compliance cache the list page reads when a
  // manifest carries no inline compliance: 2 compliant, 1 non-compliant,
  // and 3 in the "could not read" bucket (could-not-read / indeterminate /
  // error). 2 + 1 + 3 = 6 resources.
  await win.evaluate((name: string) => {
    const resources = [
      { name: 'A', type: 'Microsoft.Windows/Registry', compliance: { status: 'Compliant' } },
      { name: 'B', type: 'Microsoft.Windows/Registry', compliance: { status: 'Compliant' } },
      { name: 'C', type: 'Microsoft.Windows/Registry', compliance: { status: 'NonCompliant' } },
      { name: 'D', type: 'Microsoft.Windows/Registry', compliance: { status: 'Could not read' } },
      { name: 'E', type: 'Microsoft.Windows/Registry', compliance: { status: 'Indeterminate' } },
      { name: 'F', type: 'Microsoft.Windows/Registry', compliance: { status: 'Error' } },
    ];
    window.sessionStorage.setItem(
      `configforge-compliance-${name}`,
      JSON.stringify({ name, resources }),
    );
  }, MANIFEST_NAME);
});

test.afterAll(async () => {
  // Best-effort cleanup; never let teardown mask a real failure.
  try {
    await win.evaluate(async (name: string) => {
      const cfs = (window as unknown as { cfs: { manifests: { delete: (n: string) => Promise<unknown> } } }).cfs;
      try {
        await cfs.manifests.delete(name);
      } catch {
        /* ignore */
      }
    }, MANIFEST_NAME);
  } catch {
    /* ignore */
  }
  await app?.close();
});

test('manifest card surfaces the amber "Could not read" bucket so totals add up', async () => {
  // Navigate to the Manifests page (a fresh mount reads the seeded cache).
  await win.locator('aside').getByRole('link', { name: 'My Baselines' }).click();

  // Filter down to our throwaway manifest so we assert a single card.
  await win.getByPlaceholder('Search baselines…').fill(MANIFEST_NAME);

  const heading = win.getByRole('heading', { name: MANIFEST_NAME });
  await expect(heading).toBeVisible({ timeout: 10_000 });

  const card = win.locator('div.group', { has: heading });

  // All four buckets render, and they add up to the resource total:
  // Resources 6 = Compliant 2 + Issues 1 + Could not read 3.
  await expect(card.locator('.bg-slate-50 > p').first()).toHaveText('6');
  await expect(card.locator('.bg-emerald-50 > p').first()).toHaveText('2');
  await expect(card.locator('.bg-red-50 > p').first()).toHaveText('1');
  await expect(card.getByText('Could not read', { exact: true })).toBeVisible();
  await expect(card.locator('.bg-amber-50 > p').first()).toHaveText('3');
});
