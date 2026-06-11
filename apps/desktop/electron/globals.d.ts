// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Ambient global injected by esbuild via the `define:` map in
 * `apps/desktop/scripts/build-electron.mjs`. Driven by the
 * `CFS_FLAVOR` env var at build time (default `'full'`; `'author'`
 * for the macOS author-only build).
 *
 * Used directly in `if (__CFS_FLAVOR__ === 'full')` guards so esbuild
 * substitutes a literal at build time, constant-folds the comparison,
 * and dead-code-eliminates the unreachable branch from the bundle —
 * something it does not do across module boundaries for derived
 * consts like `HAS_DEPLOY`.
 *
 * For the human-friendly named consts, see `electron/flavor.ts`.
 */
declare const __CFS_FLAVOR__: 'full' | 'author';
