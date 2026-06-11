// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Verifies the diff-viewer text contrast change (v0.2.8 follow-up).
 *
 * Injects a synthetic DiffViewer-shaped DOM into a live page that
 * already has Tailwind compiled, then reads computed colors and
 * computes WCAG 2.1 contrast ratios.
 *
 * WCAG AA for normal text needs >= 4.5:1. The fix replaced uniform
 * text-slate-300 (low contrast on tinted bg) with status-specific
 * lighter colors. We assert each variant meets at least AA-large
 * (>= 3.0) and ideally AA (>= 4.5).
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
  await win.evaluate((iso: string) => {
    try { window.localStorage.setItem('cfs.welcome.dismissedAt', iso); } catch {}
  }, new Date().toISOString());
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => { await app?.close(); });

test('diff viewer text colors meet WCAG AA contrast on tinted backgrounds', async () => {
  // Inject a sample diff structure matching diff-viewer.tsx exactly.
  // Uses the same Tailwind classes that the live component emits so
  // we read the same compiled CSS values the user would see.
  const result = await win.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'diff-contrast-probe';
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;z-index:99999;background:#0f172a;';
    host.innerHTML = `
      <div class="overflow-hidden rounded-lg border border-slate-700">
        <div class="max-h-[600px] overflow-auto font-mono text-xs leading-6">
          <div class="grid grid-cols-2" data-row="added">
            <div class="flex border-r border-slate-700/60 bg-slate-800/60">
              <span class="w-10 px-2 text-right text-slate-500">1</span>
              <pre class="flex-1 px-3 text-slate-400" data-cell="added-left">old line</pre>
            </div>
            <div class="flex bg-emerald-200">
              <span class="w-10 px-2 text-right text-slate-700">1</span>
              <pre class="flex-1 px-3 text-black" data-cell="added-right">added line</pre>
            </div>
          </div>
          <div class="grid grid-cols-2" data-row="removed">
            <div class="flex border-r border-slate-700/60 bg-red-200">
              <span class="w-10 px-2 text-right text-slate-700">2</span>
              <pre class="flex-1 px-3 text-black" data-cell="removed-left">removed line</pre>
            </div>
            <div class="flex bg-slate-800/60">
              <span class="w-10 px-2 text-right text-slate-500">2</span>
              <pre class="flex-1 px-3 text-slate-400" data-cell="removed-right">old line</pre>
            </div>
          </div>
          <div class="grid grid-cols-2" data-row="changed">
            <div class="flex border-r border-slate-700/60 bg-amber-100">
              <span class="w-10 px-2 text-right text-slate-700">3</span>
              <pre class="flex-1 px-3 text-black" data-cell="changed-left">changed left</pre>
            </div>
            <div class="flex bg-amber-100">
              <span class="w-10 px-2 text-right text-slate-700">3</span>
              <pre class="flex-1 px-3 text-black" data-cell="changed-right">changed right</pre>
            </div>
          </div>
          <div class="grid grid-cols-2" data-row="same">
            <div class="flex border-r border-slate-700/60">
              <span class="w-10 px-2 text-right text-slate-500">4</span>
              <pre class="flex-1 px-3 text-slate-200" data-cell="same-left">same line</pre>
            </div>
            <div class="flex">
              <span class="w-10 px-2 text-right text-slate-500">4</span>
              <pre class="flex-1 px-3 text-slate-200" data-cell="same-right">same line</pre>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    // WCAG 2.1 relative luminance + contrast ratio.
    function parseRgb(s: string): [number, number, number, number] {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 1];
      const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
      const [r, g, b, a = 1] = parts;
      return [r, g, b, a];
    }
    function blend(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
      const a = fg[3];
      return [
        Math.round(fg[0] * a + bg[0] * (1 - a)),
        Math.round(fg[1] * a + bg[1] * (1 - a)),
        Math.round(fg[2] * a + bg[2] * (1 - a)),
      ];
    }
    function lum([r, g, b]: [number, number, number]): number {
      const conv = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b);
    }
    function ratio(a: [number, number, number], b: [number, number, number]): number {
      const la = lum(a), lb = lum(b);
      const [hi, lo] = la > lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    }
    function effectiveBg(el: HTMLElement): [number, number, number] {
      // Walk up the DOM, blending semi-transparent bg layers onto
      // the page root (slate-900) until we reach an opaque ancestor.
      let stack: [number, number, number, number][] = [];
      let cur: HTMLElement | null = el;
      while (cur) {
        const bg = parseRgb(getComputedStyle(cur).backgroundColor);
        if (bg[3] > 0) stack.unshift(bg);
        if (bg[3] === 1) break;
        cur = cur.parentElement;
      }
      let base: [number, number, number] = [15, 23, 42]; // slate-900
      for (const layer of stack) base = blend(layer, base);
      return base;
    }

    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-cell]'));
    const results = cells.map((el) => {
      const fg = parseRgb(getComputedStyle(el).color);
      const bg = effectiveBg(el);
      const fgRgb: [number, number, number] = [fg[0], fg[1], fg[2]];
      return {
        cell: el.getAttribute('data-cell')!,
        fg: `rgb(${fgRgb.join(',')})`,
        bg: `rgb(${bg.join(',')})`,
        contrast: Math.round(ratio(fgRgb, bg) * 100) / 100,
      };
    });

    host.remove();
    return results;
  });

  console.log('\nDiff viewer contrast measurements:');
  for (const r of result) {
    console.log(`  ${r.cell.padEnd(16)} fg=${r.fg.padEnd(20)} bg=${r.bg.padEnd(20)} ratio=${r.contrast}:1`);
  }

  // The "left-of-added" and "right-of-removed" cells deliberately
  // use text-slate-500 (muted "ghost") because the OTHER side carries
  // the meaningful content. AA-large (3.0) is the realistic floor
  // here. The meaningful cells (added-right, removed-left, changed-*,
  // same-*) must meet AA (4.5).
  const meaningful = result.filter((r) => !['added-left', 'removed-right'].includes(r.cell));
  const ghosts = result.filter((r) => ['added-left', 'removed-right'].includes(r.cell));

  for (const r of meaningful) {
    expect(r.contrast, `${r.cell} should meet WCAG AA (>=4.5)`).toBeGreaterThanOrEqual(4.5);
  }
  for (const r of ghosts) {
    expect(r.contrast, `${r.cell} (ghost) should meet AA-large (>=3.0)`).toBeGreaterThanOrEqual(3.0);
  }
});
