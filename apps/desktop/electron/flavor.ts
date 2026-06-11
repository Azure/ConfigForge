// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Build-time flavor flags for the Electron main + preload bundles.
 *
 * Mirrors `apps/desktop/src/lib/flavor.ts` (renderer-side). The
 * `__CFS_FLAVOR__` global is injected by esbuild at build time via
 * `scripts/build-electron.mjs` (default `'full'`; `'author'` when
 * `CFS_FLAVOR=author` is set in the env).
 *
 * Because esbuild substitutes `__CFS_FLAVOR__` with a string
 * literal, every `if (HAS_DEPLOY)` collapses to `if (true)` /
 * `if (false)` after substitution — the whole block is eliminated
 * from the author bundle by dead-code analysis.
 *
 * Same flag set as the renderer:
 *
 *   - `HAS_DEPLOY`        — register `cfs:deploy:run` / `:cancel`
 *                            handlers + emit `cfs:deploy:progress`
 *                            events.
 *   - `HAS_ELEVATION`     — register `cfs:system:is-elevated` /
 *                            `cfs:system:elevate` handlers.
 *   - `HAS_DEVICE_AUDIT`  — register `cfs:audit-results:get`
 *                            handler (reads device-audit cache).
 *   - `HAS_ACTIVITY_FEED` — register `cfs:activity:recent` handler
 *                            (deploy event feed).
 */

declare const __CFS_FLAVOR__: 'full' | 'author';

export type CfsFlavor = 'full' | 'author';

export const FLAVOR: CfsFlavor = __CFS_FLAVOR__;

export const HAS_DEPLOY = __CFS_FLAVOR__ === 'full';
export const HAS_ELEVATION = __CFS_FLAVOR__ === 'full';
export const HAS_DEVICE_AUDIT = __CFS_FLAVOR__ === 'full';
export const HAS_ACTIVITY_FEED = __CFS_FLAVOR__ === 'full';
