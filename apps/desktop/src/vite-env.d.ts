// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build-time flavor flag. `'full'` (default) builds the
   * Windows/Linux deploy-capable bundle. `'author'` builds the
   * macOS author-only bundle that strips deploy / audit-results /
   * elevation surfaces. See `src/lib/flavor.ts`.
   */
  readonly VITE_CFS_FLAVOR?: 'full' | 'author';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
