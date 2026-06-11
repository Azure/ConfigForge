// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { Config } from 'tailwindcss';

/**
 * Tailwind config for the Electron desktop renderer.
 *
 * Mirrors the root `tailwind.config.ts` palette so ported pages keep
 * their existing class names. `content` only scans
 * `apps/desktop/src/**` — the legacy `src/app/**` Next.js code is
 * built by its own pipeline.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        azure: {
          50: '#e6f2fc',
          100: '#cce4f9',
          200: '#99c9f3',
          300: '#66afed',
          400: '#3394e7',
          500: '#0078D4',
          600: '#0063b1',
          700: '#004e8c',
          800: '#003966',
          900: '#002050',
          950: '#001433',
        },
        msft: {
          green: '#107C10',
          yellow: '#FFB900',
          red: '#D83B01',
          purple: '#5C2D91',
          teal: '#008575',
          gray: {
            50: '#FAF9F8',
            100: '#F3F2F1',
            200: '#EDEBE9',
            300: '#D2D0CE',
            400: '#A19F9D',
            500: '#605E5C',
            600: '#484644',
            700: '#3B3A39',
            800: '#323130',
            900: '#201F1E',
          },
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Cascadia Code"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
