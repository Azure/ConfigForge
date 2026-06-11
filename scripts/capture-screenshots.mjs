// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Capture key UX screenshots for the README using playwright-electron.
// Launches the built Electron app (no dev server needed), navigates to
// each route via the hash router, and writes PNGs to docs/images/screenshots/.
//
// Prerequisites:
//   - `npm run desktop:build` (so apps/desktop/dist/electron/main.js exists)
//   - At least one registered manifest in ~/.configforge/manifests/
//   - For CIS shots: CIS data files in <repo>/public/_baselines/cis/_data/
//
// Run from the repo root:
//   node scripts/capture-screenshots.mjs

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const ELECTRON_ENTRY = path.join(REPO_ROOT, 'apps', 'desktop', 'dist', 'electron', 'main.js');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'images', 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };

// The Electron binary lives under apps/desktop/node_modules — resolve from
// that workspace so playwright._electron can launch it.
const requireFromDesktop = createRequire(path.join(REPO_ROOT, 'apps', 'desktop', 'package.json'));
const electronExe = requireFromDesktop('electron');

await fs.mkdir(OUT_DIR, { recursive: true });

console.log('[capture] launching electron:', ELECTRON_ENTRY);
const app = await electron.launch({
  executablePath: electronExe,
  args: [ELECTRON_ENTRY],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
});

const win = await app.firstWindow();
await win.setViewportSize(VIEWPORT);
// Initial settle for boot
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);

async function navigate(hashRoute) {
  // HashRouter — we navigate via window.location.hash so we don't go through HTTP.
  await win.evaluate((r) => {
    window.location.hash = r;
  }, hashRoute);
  await win.waitForTimeout(900);
}

async function shoot(slug, hashRoute, opts = {}) {
  console.log(`[shoot] ${slug} <- #${hashRoute}`);
  await navigate(hashRoute);
  if (opts.waitFor) {
    await win.waitForSelector(opts.waitFor, { timeout: 8000 }).catch(() => {});
  }
  if (opts.beforeShoot) {
    await opts.beforeShoot(win);
  }
  await win.waitForTimeout(opts.settle ?? 700);
  const file = path.join(OUT_DIR, `${slug}.png`);
  await win.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  console.log(`         -> ${file}`);
}

/**
 * Read the <option>s of the Nth <select> on the page and return the first
 * non-empty option value matching one of the given regex patterns (in
 * priority order). Skips a specific value if `exclude` is provided.
 */
async function pickManifestValue(p, selectIndex, patterns, exclude) {
  const opts = await p.evaluate((i) => {
    const sels = document.querySelectorAll('select');
    if (i >= sels.length) return [];
    return Array.from(sels[i].options).map((o) => o.value).filter((v) => !!v);
  }, selectIndex);
  for (const pat of patterns) {
    const match = opts.find((o) => pat.test(o) && o !== exclude);
    if (match) return match;
  }
  return opts.find((o) => o !== exclude) ?? null;
}

try {
  // 1) Library — the "shopping" experience
  await shoot('library', '/library', { waitFor: 'main' });

  // 2) Home / dashboard
  await shoot('home', '/', { waitFor: 'main' });

  // 3) New manifest — register / paste / build entry point
  await shoot('new-manifest', '/manifests/new', { waitFor: 'main' });

  // 4) Manifest detail (default Editor view)
  await shoot('manifest-detail', '/manifests/ws2025-member-server', {
    waitFor: 'main',
    settle: 1500,
  });

  // 5) Visual Builder — click the Visual Builder tab
  await shoot('visual-builder', '/manifests/ws2025-member-server', {
    waitFor: 'main',
    beforeShoot: async (p) => {
      const btn = await p.$('button:has-text("Visual Builder")');
      if (btn) {
        await btn.click();
        await p.waitForTimeout(800);
      }
    },
    settle: 1200,
  });

  // 6) Audit pack
  await shoot('audit-pack', '/manifests/ws2025-member-server/audit-pack', {
    waitFor: 'main',
    settle: 2500,
  });

  // 7) Diff hub — pick WS2019 vs WS2025 Member Server baselines for the most interesting diff
  await shoot('diff', '/diff', {
    waitFor: 'main',
    beforeShoot: async (p) => {
      await p.waitForTimeout(2500);
      // Switch BOTH mode selects to "From Manifest"
      await p.locator('select').nth(0).selectOption('manifest').catch(() => {});
      await p.waitForTimeout(500);
      await p.locator('select').nth(1).selectOption('manifest').catch(() => {});
      await p.waitForTimeout(1500);
      // Now 4 selects: [leftMode, leftManifest, rightMode, rightManifest]
      const leftValue = await pickManifestValue(p, 1, [
        /^Windows-Server-2019---Member-Server$/i,
        /windows.*server.*2019/i,
        /2019/i,
      ]);
      const rightValue = await pickManifestValue(p, 3, [
        /^Windows-Server-2025---Member-Server$/i,
        /windows.*server.*2025.*member/i,
        /2025/i,
      ], leftValue);
      if (leftValue) await p.locator('select').nth(1).selectOption(leftValue).catch(() => {});
      await p.waitForTimeout(1200);
      if (rightValue) await p.locator('select').nth(3).selectOption(rightValue).catch(() => {});
      await p.waitForTimeout(1500);
      const compareBtn = p.locator('button:has-text("Compare")').first();
      if (await compareBtn.count() > 0) {
        await compareBtn.click({ timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(8000);
      }
    },
    settle: 1500,
  });

  // 8) CIS Diff tab — score the WS2025 manifest against the CIS Azure Compute WS2022 XCCDF
  //    (Microsoft-audited benchmark — produces the strongest "this is the real number" shot)
  await shoot('cis-diff', '/diff', {
    waitFor: 'main',
    beforeShoot: async (p) => {
      const cisTabBtn = p.locator('button:has-text("CIS Diff")').first();
      if (await cisTabBtn.count() > 0) {
        await cisTabBtn.click();
        await p.waitForTimeout(2500);
      }
      // Wait for the benchmark dropdown to be populated (cfs.cis.status() is async)
      await p.waitForFunction(() => {
        const sels = document.querySelectorAll('select');
        return sels.length >= 2 && sels[1].options.length > 1;
      }, { timeout: 8000 }).catch(() => {});
      await p.waitForTimeout(500);
      // Log what's actually in the benchmark dropdown
      const benchOpts = await p.evaluate(() => {
        const sels = document.querySelectorAll('select');
        if (sels.length < 2) return [];
        return Array.from(sels[1].options).map((o) => ({ value: o.value, text: o.textContent }));
      });
      console.log('         [cis-diff] benchmark options:', JSON.stringify(benchOpts, null, 2));
      // Manifest select (selects[0]) — pick WS2025 user baseline
      const manifestValue = await pickManifestValue(p, 0, [
        /^ws2025-member-server$/i,
        /^Windows-Server-2025---Member-Server$/i,
        /2025.*member/i,
      ]);
      if (manifestValue) {
        await p.locator('select').nth(0).selectOption(manifestValue).catch(() => {});
      } else {
        await p.locator('select').nth(0).selectOption({ index: 1 }).catch(() => {});
      }
      await p.waitForTimeout(900);
      // Benchmark (selects[1]) — prefer CIS Azure Compute WS2022 XCCDF
      const benchValue = await pickManifestValue(p, 1, [
        /CIS_Azure_Compute.*2022.*xccdf/i,
        /Azure.*Compute.*2022/i,
        /xccdf.*2022/i,
      ]);
      console.log('         [cis-diff] picked benchmark:', benchValue);
      if (benchValue) {
        await p.locator('select').nth(1).selectOption(benchValue).catch((e) => {
          console.log('         [cis-diff] selectOption failed:', e.message);
        });
        await p.waitForTimeout(800);
      }
      const compareBtn = p.locator('button:has-text("Compare against CIS")').first();
      if (await compareBtn.count() > 0) {
        await compareBtn.click({ timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(15000);
      }
    },
    settle: 2000,
  });

  // 9) CIS Mapping page (data files + status) — also doubles as a probe for paths
  await shoot('cis-mapping', '/cis', { waitFor: 'main', settle: 1500 });
  // Diagnostic: print what dataDir the app resolved to
  const diag = await win.evaluate(async () => {
    if (typeof window.cfs?.cis?.status === 'function') {
      const s = await window.cfs.cis.status();
      return { dataDir: s.dataDir, xccdf: s.xccdfFiles?.length ?? 0, azure: s.azurePolicyCisFiles?.length ?? 0 };
    }
    return { error: 'no cfs.cis' };
  });
  console.log('         [diag] cis.status =>', JSON.stringify(diag));

  console.log('\n[capture] All screenshots written to', OUT_DIR);
} finally {
  await app.close();
}
