// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * @configforge/core — entry barrel.
 *
 * The 12 sub-namespaces export from their respective subdirectories.
 * Consumers should import from the specific sub-path for tree-shaking:
 *
 *   import { listRegistrations } from '@configforge/core/oscfg';
 *   import { readRationale } from '@configforge/core/manifest/rationale-store';
 *
 * The bare `import { ... } from '@configforge/core'` pulls everything
 * (still tree-shakes if your bundler supports it, but the sub-path
 * imports give better build-time guarantees).
 */
export const PACKAGE_NAME = '@configforge/core';

// Sub-namespace re-exports. Kept narrow to avoid name collisions across
// the 12 sub-directories (e.g. each has its own `index.ts`). Consumers
// that hit a collision should switch to a specific sub-path import.
export * as oscfg from './oscfg';
export * as history from './history';
export * as system from './system';
export * as handlers from './handlers';
