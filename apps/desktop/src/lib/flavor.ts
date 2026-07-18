// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Build-time flavor flags for the renderer.
 *
 * Driven by the `VITE_CFS_FLAVOR` env var that Vite inlines at build
 * time. Two values are supported:
 *
 *   - `'full'`     (default) — Windows + Linux behavior: includes
 *                   deploy, audit-results-from-device, system
 *                   elevation, author + device activity, and the
 *                   footer health indicator.
 *   - `'author'`   — macOS author-only build: strips deploy /
 *                   audit-results / elevation surfaces. Manifest
 *                   authoring, the bundled Microsoft baseline
 *                   library, the cross-baseline compliance
 *                   comparison, the audit-pack PDF, and the
 *                   manifest-vs-manifest diff all stay.
 *
 * Because Vite replaces `import.meta.env.VITE_CFS_FLAVOR` with a
 * literal string at build time, every `if (HAS_DEPLOY)` /
 * `{HAS_DEPLOY && ...}` becomes a constant condition the
 * tree-shaker can eliminate from the author bundle.
 */

export type CfsFlavor = 'full' | 'author';

const raw = (import.meta.env.VITE_CFS_FLAVOR ?? 'full') as string;

export const FLAVOR: CfsFlavor = raw === 'author' ? 'author' : 'full';

/** True when the build wraps oscfg and can deploy/enforce/audit a device. */
export const HAS_DEPLOY = FLAVOR === 'full';

/** True when the build can request OS-level admin/root elevation. */
export const HAS_ELEVATION = FLAVOR === 'full';

/**
 * True when the build can read the on-disk device-audit cache that
 * `oscfg get` populates after a deploy. The audit-pack PDF still
 * generates without this — the "Device Audit" section just won't
 * appear in the bundle.
 */
export const HAS_DEVICE_AUDIT = FLAVOR === 'full';

/**
 * True when the build's footer should show the live oscfg health
 * indicator (CLI version + admin status). The author flavor has
 * no oscfg to query and no concept of admin elevation, so the
 * indicator is hidden entirely.
 */
export const HAS_HEALTH = FLAVOR === 'full';

/**
 * True when the dashboard's "Recent activity" tile should render.
 * Both flavors retain authoring history; the main process filters
 * device deploy/audit/revert records out of the author flavor.
 */
export const HAS_ACTIVITY_FEED = true;
