// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase 10 cutover — apps/desktop is now self-sufficient for
 * linting. Previously this file had `root: false` and inherited
 * the Next.js eslint config from the deleted root .eslintrc.json.
 *
 * Now: standalone, TS parser without type-aware (project-based)
 * rules so lint runs in seconds. Type errors are caught by
 * `npm run core:build` (tsc -p packages/core/tsconfig.json) and
 * by the renderer/main bundlers (vite + esbuild).
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist', 'release', 'node_modules', '*.config.ts', '*.config.js', '*.config.mjs', 'build/**', 'e2e/**'],
  rules: {
    // Test setup files use globals that aren't otherwise referenced
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // FluentUI v9 type acrobatics
    '@typescript-eslint/no-explicit-any': 'off',
    // Tests use empty arrow functions for stubbed callbacks
    '@typescript-eslint/no-empty-function': 'off',
    // Cosmetic; we have escape sequences (\s{2,}) where it matters,
    // and aligned table-style regexes in tests are easier to read
    // with literal spaces.
    'no-regex-spaces': 'off',
    // Complexity caps — `warn` level only. These surface oversized files
    // and complex functions as page-split candidates without failing CI.
    // Several files already exceed these limits (e.g. ManifestEditor); the
    // intent is to track them in PR review rather than block immediately.
    // Flipping these to `error` is a follow-up after the page-split work
    // lands.
    'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
    'complexity': ['warn', 15],
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'vitest.setup.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};

