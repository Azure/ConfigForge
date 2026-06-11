// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite config for the Electron renderer.
 *
 * - Dev server runs at http://localhost:5173
 * - Build outputs to ./dist/ for Electron's `loadFile`
 * - `base: './'` keeps asset paths file://-safe in production
 * - `@configforge/core` is aliased to its source tree so Vite/Rollup
 *   reads typed ESM directly. The CJS dist still works for the
 *   Electron main bundle (esbuild) which uses Node's resolver.
 * - Custom plugin strips the meta CSP tag in dev mode so Vite's
 *   HMR client can connect.
 */
function devCspPlugin() {
  return {
    name: 'cfs-dev-csp',
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string, ctx: { server?: unknown }) {
        if (!ctx.server) return html;
        return html.replace(
          /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i,
          '<!-- CSP stripped in dev -->',
        );
      },
    },
  };
}

const corePackageRoot = path.resolve(__dirname, '..', '..', 'packages', 'core', 'src');

export default defineConfig(({ mode }) => ({
  plugins: [react(), devCspPlugin()],
  resolve: {
    alias: [
      // Alias `@configforge/core` and its sub-paths to the TypeScript
      // source. Without this, Vite/Rollup hits the CJS `dist/` and
      // can't statically extract named exports.
      { find: /^@configforge\/core$/, replacement: path.join(corePackageRoot, 'index.ts') },
      { find: /^@configforge\/core\/(.+)$/, replacement: path.join(corePackageRoot, '$1') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Sourcemaps in dev only — production maps add ~50MB to the build
    // output and 3-5s to rollup with no runtime benefit for shipped users.
    sourcemap: mode === 'development',
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));


