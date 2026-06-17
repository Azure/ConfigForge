// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * E2E CDP spec for the Diff page's semantic-identity fix.
 *
 * Drives the LIVE Diff UI end-to-end:
 *   1. Registers two real bundled baselines (WS2019 + WS2025 workgroup
 *      member) via the `cfs.manifests.register` IPC (using the
 *      `content` field — `source` is just an origin tag).
 *   2. Navigates to /Diff, selects the two manifests, clicks Compare.
 *   3. Scrolls down to the AI analysis section.
 *   4. Verifies NO rule appears in both the Added and Removed lists
 *      via normalized name (the original user-reported bug:
 *      "AuditLogon" in one baseline vs "Audit Logon" in the other
 *      showed as duplicate add+remove).
 *   5. Cleans up the test manifests.
 *
 * If this regresses, the user will see phantom add+remove pairs for
 * the same logical rule across baseline versions in the actual UI.
 */
import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const MAIN_ENTRY = path.join(APP_ROOT, 'dist', 'electron', 'main.js');
const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
const electronExecutablePath = requireFromApp('electron') as string;

let app: ElectronApplication;
let win: Page;

const LEFT_NAME = 'e2e-diff-ws2019-dm';
const RIGHT_NAME = 'e2e-diff-ws2025-wm';

function readBaseline(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'public', '_baselines', rel), 'utf-8');
}

interface CfsBridge {
  manifests: {
    register: (req: {
      name: string;
      content: string;
      source?: 'user' | 'library' | 'import';
    }) => Promise<unknown>;
    delete: (name: string) => Promise<unknown>;
    list: (opts?: unknown) => Promise<{ data: Array<{ Name: string }> }>;
  };
}

test.beforeAll(async () => {
  app = await _electron.launch({
    args: [MAIN_ENTRY],
    cwd: APP_ROOT,
    executablePath: electronExecutablePath,
    env: { ...process.env, NODE_ENV: 'production', LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' },
  });
  win = await app.firstWindow();
  await win.evaluate((iso: string) => {
    try { window.localStorage.setItem('cfs.welcome.dismissedAt', iso); } catch { /* ok */ }
  }, new Date().toISOString());
  await win.reload();
  await win.waitForLoadState('domcontentloaded');

  // Load the bundled baselines, register both via IPC.
  const left = readBaseline('ws2019-domain-member.osc.yaml');
  const right = readBaseline('ws2025-workgroup-member.osc.yaml');

  await win.evaluate(
    async ([leftName, leftContent, rightName, rightContent]) => {
      const cfs = (window as unknown as { cfs: CfsBridge }).cfs;
      try { await cfs.manifests.delete(leftName); } catch { /* tolerated */ }
      try { await cfs.manifests.delete(rightName); } catch { /* tolerated */ }
      await cfs.manifests.register({ name: leftName, content: leftContent, source: 'user' });
      await cfs.manifests.register({ name: rightName, content: rightContent, source: 'user' });
    },
    [LEFT_NAME, left, RIGHT_NAME, right],
  );
});

test.afterAll(async () => {
  try {
    await win.evaluate(
      async ([leftName, rightName]) => {
        const cfs = (window as unknown as { cfs: CfsBridge }).cfs;
        try { await cfs.manifests.delete(leftName); } catch { /* ok */ }
        try { await cfs.manifests.delete(rightName); } catch { /* ok */ }
      },
      [LEFT_NAME, RIGHT_NAME],
    );
  } catch { /* tolerated */ }
  await app?.close();
});

test('Diff WS2019 vs WS2025: same rule does NOT appear in both Added and Removed', async () => {
  // Navigate to Diff page.
  await win.locator('aside').getByRole('link', { name: 'Diff' }).click();
  await expect(
    win.locator('h1, h2').filter({ hasText: /Compare Baselines|Diff/ }).first(),
  ).toBeVisible({ timeout: 20_000 });

  // Click the Pairwise tab if it's separate.
  const pairwiseTab = win.getByRole('button', { name: /Pairwise|Compare 2|Before.*After/i }).first();
  if (await pairwiseTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await pairwiseTab.click();
  }

  // Walk the selects; pick the left+right manifest by value.
  const selects = win.locator('select');
  const count = await selects.count();
  expect(count).toBeGreaterThanOrEqual(2);

  let leftIdx = -1;
  for (let i = 0; i < count; i++) {
    const opts = await selects.nth(i).locator('option').allTextContents();
    if (opts.some((o) => o.includes(LEFT_NAME))) {
      await selects.nth(i).selectOption(LEFT_NAME);
      leftIdx = i;
      break;
    }
  }
  expect(leftIdx).toBeGreaterThanOrEqual(0);

  for (let i = 0; i < count; i++) {
    if (i === leftIdx) continue;
    const opts = await selects.nth(i).locator('option').allTextContents();
    if (opts.some((o) => o.includes(RIGHT_NAME))) {
      await selects.nth(i).selectOption(RIGHT_NAME);
      break;
    }
  }

  // Click Compare and wait for the AI analysis section to render.
  await win.getByRole('button', { name: /^Compare$/ }).click();
  await expect(
    win.locator('text=/changes? detected|No differences detected/').first(),
  ).toBeVisible({ timeout: 30_000 });

  // Scroll the bottom of the analysis into view (the long analysis
  // section can require scrolling past the YAML diff viewer).
  await win.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await win.waitForTimeout(500);

  // Read the entire main content text. Extract the lists of added and
  // removed resource names and check no NORMALIZED name appears in
  // both.
  const pageText = await win.locator('main').innerText();

  // Heuristic extraction: pull lines that look like resource names
  // out of the analysis section. The actual rendering uses fluent UI
  // List items; their visible text is the resource display name.
  // We use a permissive split-on-newline strategy plus a normalized-
  // name comparison.
  const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  // The analysis surface uses headings/labels like "Added (123)",
  // "Removed (456)", "Changed (78)". We grab everything between those
  // markers.
  function extractSection(label: RegExp): string[] {
    const headerRe = new RegExp(label.source + String.raw`\s*\(\d+\)`, 'm');
    const m = pageText.match(headerRe);
    if (!m || m.index === undefined) return [];
    const start = m.index + m[0].length;
    // Next section heading marks the end.
    const nextRe = /(Added|Removed|Changed|AI delta|Generate changelog|Risk)/g;
    nextRe.lastIndex = start + 1;
    const next = nextRe.exec(pageText);
    const end = next ? next.index : pageText.length;
    return pageText
      .slice(start, end)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^\d+$/.test(l));
  }

  const added = extractSection(/Added/);
  const removed = extractSection(/Removed/);

  const removedNormalized = new Set(removed.map(normalize));
  const phantoms = added
    .map(normalize)
    .filter((n) => removedNormalized.has(n));

  expect(
    phantoms,
    `Phantom rename pairs (same normalized name in BOTH Added and Removed): ${JSON.stringify(phantoms.slice(0, 10))}`,
  ).toEqual([]);
});

