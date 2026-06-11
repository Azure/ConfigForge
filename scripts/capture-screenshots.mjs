// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Capture key UX screenshots for the README. Uses bundled Playwright
// chromium (no Google Chrome required). Saves PNGs to docs/images/screenshots/.
//
// Run: node scripts/capture-screenshots.mjs
// Prereq: server running on http://localhost:3000 with at least one
//         registered manifest in ~/.configforge/manifests/.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const OUT_DIR = path.resolve('docs/images/screenshots');
const BASE = 'http://localhost:3000';
const VIEWPORT = { width: 1440, height: 900 };

await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2, // retina-quality PNGs
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();

async function shoot(slug, navUrl, opts = {}) {
  console.log(`[shoot] ${slug} <- ${navUrl}`);
  await page.goto(`${BASE}${navUrl}`, { waitUntil: 'networkidle' });
  if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 8000 }).catch(() => {});
  if (opts.beforeShoot) await opts.beforeShoot(page);
  // small settle to avoid mid-paint frames
  await page.waitForTimeout(700);
  const file = path.join(OUT_DIR, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  console.log(`         -> ${file}`);
}

// 1) Library — the "shopping" experience: pre-built baselines catalog
await shoot('library', '/library', {
  waitFor: 'h1, [data-testid="library-grid"]',
});

// 2) Home / dashboard
await shoot('home', '/', {
  waitFor: 'main',
});

// 3) Manifest detail — this is where the new "Audit Pack" button lives
await shoot('manifest-detail', '/manifests/ws2025-member-server', {
  waitFor: 'main',
});

// 4) Audit pack download page (the auditor deliverable). Use cis-ws2022-ms
//    because it has 527 rationale entries — exercises PR39's rationale-log
//    renderer in the PDF. A 2s settle gives the iframe time to start its
//    PDF stream so the screenshot doesn't capture mid-load.
await shoot('audit-pack', '/manifests/cis-ws2022-ms/audit-pack', {
  waitFor: 'main',
  beforeShoot: async (p) => {
    await p.waitForTimeout(2000);
  },
});

// 5) Diff — pairwise + matrix compare hub
await shoot('diff', '/diff', {
  waitFor: 'main',
});

// 6) New manifest editor — authoring experience
await shoot('new-manifest', '/manifests/new', {
  waitFor: 'main',
});

await browser.close();
console.log('\nAll screenshots written to', OUT_DIR);
