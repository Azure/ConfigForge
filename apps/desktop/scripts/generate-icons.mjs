// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase 8 — Icon asset generator.
 *
 * Reads `docs/theme/favicon.svg` (the "CF" badge on Azure Blue) and
 * produces the icon assets electron-builder consumes from
 * `apps/desktop/build/`:
 *
 *   icon.ico         — Windows. Multi-resolution: 16/24/32/48/64/128/256.
 *                      NSIS uses 32+, the executable's display in
 *                      Explorer uses 256+, the taskbar uses 32.
 *   icon.png         — Linux. 512×512 (electron-builder up-scales).
 *
 * The source SVG is intentionally tiny (32×32 viewBox); sharp renders
 * it at the requested raster size with crisp edges thanks to the
 * solid-fill geometry. If the source ever becomes more complex (e.g.
 * gradients, multi-color), bump the SVG's viewBox first so we don't
 * lose detail at smaller raster sizes.
 *
 * Idempotent: re-running overwrites the outputs in place.
 *
 * Usage:
 *   node apps/desktop/scripts/generate-icons.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const sourceSvg = path.join(repoRoot, 'docs', 'theme', 'favicon.svg');
const outputDir = path.resolve(__dirname, '..', 'build');

// Sizes ICO format supports natively. 256 is the practical ceiling
// (Vista+ supports it; older formats truncated at 48). 16 and 24
// matter for legacy XP-era contexts; we keep them for completeness
// since cost is microseconds.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 512;

async function main() {
  console.log(`[icons] reading source: ${path.relative(repoRoot, sourceSvg)}`);
  const svg = await readFile(sourceSvg);

  await mkdir(outputDir, { recursive: true });

  console.log(`[icons] rendering ${ICO_SIZES.length} PNG sizes for ICO bundling…`);
  const pngBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(svg)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  );

  const icoPath = path.join(outputDir, 'icon.ico');
  const icoBuffer = await pngToIco(pngBuffers);
  await writeFile(icoPath, icoBuffer);
  console.log(`[icons] wrote ${path.relative(repoRoot, icoPath)} (${icoBuffer.length} bytes, ${ICO_SIZES.length} sizes)`);

  const pngPath = path.join(outputDir, 'icon.png');
  const pngBuffer = await sharp(svg)
    .resize(PNG_SIZE, PNG_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await writeFile(pngPath, pngBuffer);
  console.log(`[icons] wrote ${path.relative(repoRoot, pngPath)} (${pngBuffer.length} bytes, ${PNG_SIZE}×${PNG_SIZE})`);

  console.log('[icons] ✅ done');
}

main().catch((err) => {
  console.error('[icons] ❌ failed:', err);
  process.exit(1);
});
