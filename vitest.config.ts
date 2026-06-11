// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Root vitest config (Phase 10 — post-cutover).
 *
 * Two projects:
 *   - "core":    @configforge/core unit tests (Node env, no JSX)
 *   - "desktop": Electron renderer tests (JSDOM env, FluentUI + RTL)
 *
 * Phase 10 dropped `src/**` from the "core" include because the
 * legacy Next.js tree was deleted at cutover. Only `packages/**`
 * tests remain in the core project.
 *
 * `npm test` (root) runs both projects in sequence. To run just
 * one: `npx vitest --project core` or `npx vitest --project desktop`.
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'core',
          include: ['packages/**/*.test.ts', 'scripts/**/*.test.mjs'],
          environment: 'node',
        },
        resolve: {
          alias: [
            { find: /^@configforge\/core(\/|$)/, replacement: path.resolve(__dirname, './packages/core/src') + '$1' },
          ],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'desktop',
          include: ['apps/desktop/src/**/*.test.{ts,tsx}', 'apps/desktop/electron/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./apps/desktop/vitest.setup.ts'],
        },
        resolve: {
          alias: [
            { find: /^@configforge\/core$/, replacement: path.resolve(__dirname, './packages/core/src/index.ts') },
            { find: /^@configforge\/core\/(.+)$/, replacement: path.resolve(__dirname, './packages/core/src/$1') },
            { find: '@', replacement: path.resolve(__dirname, './apps/desktop/src') },
          ],
        },
      },
    ],
  },
});




