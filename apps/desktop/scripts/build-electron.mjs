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

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'pdfkit'],
  sourcemap: true,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
};

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
