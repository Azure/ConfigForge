// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'electron', 'main.js');
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const electronExecutablePath = requireFromApp('electron') as string;
const BASELINE_NAME = 'VisualSchemaRules';
const BASELINE_YAML = `resources:
  - name: AllowedMode
    type: Microsoft.OSConfig/Test
    properties:
      schema:
        enum:
          - 1
          - 2
          - 99
      resource:
        type: Microsoft.Windows/Registry
        properties:
          keyPath: HKEY_LOCAL_MACHINE\\SOFTWARE\\ConfigForge\\SchemaRules
          valueName: AllowedMode
          valueType: Dword
          value: '1'
`;

let app: ElectronApplication | null = null;
let page: Page;
let configHome = '';
let browserProfile = '';
let publicRoot = '';

test.beforeAll(async () => {
  configHome = await mkdtemp(path.join(os.tmpdir(), 'configforge-schema-home-'));
  browserProfile = await mkdtemp(path.join(os.tmpdir(), 'configforge-schema-profile-'));
  publicRoot = await mkdtemp(path.join(os.tmpdir(), 'configforge-schema-public-'));
  app = await _electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${browserProfile}`],
    cwd: APP_ROOT,
    executablePath: electronExecutablePath,
    env: {
      ...process.env,
      CONFIGFORGE_HOME: configHome,
      CONFIGFORGE_PUBLIC_ROOT: publicRoot,
      CONFIGFORGE_TEST_MODE: '1',
      NODE_ENV: 'production',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    localStorage.setItem('cfs.welcome.dismissedAt', new Date().toISOString());
  });
  await page.evaluate(
    async ({ name, content }) => {
      await window.cfs!.manifests.register({ name, content });
    },
    { name: BASELINE_NAME, content: BASELINE_YAML },
  );
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try {
    await app?.close();
  } catch {
    // Preserve the original test failure when Electron already exited.
  } finally {
    await Promise.allSettled(
      [configHome, browserProfile, publicRoot]
        .filter(Boolean)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  }
});

test('shows schema rules, rejects invalid edits, and saves numeric YAML', async () => {
  await page
    .locator('aside')
    .getByRole('link', { name: /My Baselines/ })
    .click();
  await expect(page.getByRole('heading', { name: 'My Baselines' })).toBeVisible();
  await page.getByRole('button', { name: `Open baseline ${BASELINE_NAME}` }).click();
  const baselineTab = page
    .getByRole('tablist', { name: 'Open baselines' })
    .getByRole('tab', { name: BASELINE_NAME });
  await expect(baselineTab).toBeVisible();
  await baselineTab.click();
  await expect(page.getByText('Viewing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Visual', exact: true }).click();

  const visual = page.getByRole('region', { name: 'Visual baseline settings' });
  const rules = visual.getByTestId('visual-schema-rules');
  await expect(rules.locator('[data-schema-keyword="enum"]')).toContainText('enum');
  for (const allowed of ['1', '2', '99']) {
    await expect(rules.getByText(allowed, { exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Edit' }).click();
  const save = page.getByTestId('manifest-detail-footer').getByRole('button', { name: 'Save' });
  await visual.getByRole('button', { name: 'Edit Applied value for AllowedMode' }).click();
  const editor = visual.getByRole('textbox', {
    name: 'Edit Applied value for AllowedMode',
  });

  await editor.fill('3');
  await expect(visual.getByRole('alert')).toHaveText(
    'Enter a value that satisfies the rules shown under Expected value.',
  );
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await expect(save).toBeDisabled();

  await editor.fill('99');
  await expect(visual.getByRole('alert')).toHaveCount(0);
  await expect(save).toBeEnabled();
  await editor.press('Tab');
  await expect(
    visual.getByRole('button', { name: 'Edit Applied value for AllowedMode' }),
  ).toHaveText('99');

  await save.click();
  const rationale = page.getByRole('dialog', { name: 'Why this change?' });
  await expect(rationale).toBeVisible();
  await rationale.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText('Viewing', { exact: true })).toBeVisible();

  await expect
    .poll(async () => {
      const saved = await page.evaluate(async (name) => {
        return window.cfs!.manifests.getSource(name);
      }, BASELINE_NAME);
      return saved.data;
    })
    .toContain('value: 99');
  const saved = await page.evaluate(async (name) => {
    return window.cfs!.manifests.getSource(name);
  }, BASELINE_NAME);
  expect(saved.data).not.toContain("value: '99'");
});
