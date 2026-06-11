// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const outDir = resolve(appDir, 'dist', 'electron');
mkdirSync(outDir, { recursive: true });

const flavor = process.env.CFS_FLAVOR === 'author' ? 'author' : 'full';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'pdfkit'],
  sourcemap: true,
  minify: false,
  // esbuild defaults treeShaking=on only for ESM. We bundle as CJS
  // so it's off by default — that means `if (false) { ... }` blocks
  // (the ones that result from the __CFS_FLAVOR__ substitution
  // collapsing to `'author' === 'full'`) survive into the bundle.
  // Force-enable to actually eliminate the deploy/elevation/audit-
  // results / activity-feed handler bodies on author builds.
  treeShaking: true,
  // The dead-branch elimination itself only fires under
  // `minifySyntax`. We keep `minifyIdentifiers` + `minifyWhitespace`
  // off so the bundled main.js / preload.js stay diff-readable,
  // since we ship the source maps anyway.
  minifySyntax: true,
  legalComments: 'none',
  logLevel: 'info',
  // Build-time flavor flag. The author flavor strips deploy /
  // elevation / audit-results / activity-feed surfaces from main
  // and preload. Each `if (HAS_DEPLOY)` / `if (HAS_ELEVATION)` etc.
  // in flavor.ts collapses to `if (false)` after this substitution
  // and gets eliminated by esbuild's dead-code pass.
  define: {
    __CFS_FLAVOR__: JSON.stringify(flavor),
  },
};

console.log(`[build-electron] flavor=${flavor}`);

await Promise.all([
  build({
    ...common,
    entryPoints: [resolve(appDir, 'electron/main.ts')],
    outfile: resolve(outDir, 'main.js'),
  }),
  build({
    ...common,
    entryPoints: [resolve(appDir, 'electron/preload.ts')],
    outfile: resolve(outDir, 'preload.js'),
  }),
]);
