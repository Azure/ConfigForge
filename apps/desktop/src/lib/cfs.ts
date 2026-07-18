// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Renderer-side shim around `window.cfs.*`.
 *
 * The Electron preload bridge is the single source for renderer ↔
 * main IPC. This module just exposes that surface as a typed import.
 *
 * Phase 10 (cutover) deleted the old `fetch('/api/*')` fallback
 * shim that let the renderer run against the Next.js dev server
 * during the parallel-tree iteration of Phases 4-9. The Electron
 * app is now the only host — `window.cfs` MUST be present at
 * runtime. Tests mock it in `apps/desktop/vitest.setup.ts`.
 *
 * CF-SEC-015 — per-flavor capability gating. The macOS author build
 * intentionally omits the deploy/revert/deployRecovery/system/health/
 * auditResults namespaces from preload. Renderer code that calls into
 * one of those namespaces without checking presence will crash with a
 * cryptic "Cannot read property X of undefined". Use
 * `hasCfsNamespace` / `safeCfs` from this module to make the flavor
 * branch explicit.
 *
 * Pattern:
 *
 *   import { hasCfsNamespace, safeCfs } from '../lib/cfs';
 *
 *   if (!hasCfsNamespace('deploy')) {
 *     // mac author flavor: skip the deploy UI entirely.
 *     return null;
 *   }
 *   // Type-narrowed: safeCfs('deploy') is defined here.
 *   await safeCfs('deploy')!.run(...)
 *
 * Existing call sites that assume the namespace exists keep working on
 * main. The flavor-conditional sites (Settings.tsx,
 * ManifestAuditPack.tsx, useCliPresence.ts, etc.) should migrate to
 * the helper over time.
 */

import type { CfsApi } from '../../electron/preload';

declare global {
  interface Window {
    cfs?: CfsApi;
  }
}

function hasIpc(): boolean {
  return typeof window !== 'undefined' && typeof window.cfs !== 'undefined';
}

export const cfs: CfsApi = new Proxy({} as CfsApi, {
  get(_target, prop: string) {
    if (!hasIpc()) {
      // Throw on first property access rather than silently returning
      // undefined. This surfaces preload-bridge bootstrap problems
      // immediately instead of letting them propagate as cryptic
      // "X is not a function" errors deeper in the renderer.
      throw new Error(
        `cfs.${prop} accessed but window.cfs is not available — ` +
          `the Electron preload bridge must be present. ` +
          `In tests, stub window.cfs via apps/desktop/vitest.setup.ts.`,
      );
    }
    return (window.cfs as unknown as Record<string, unknown>)[prop];
  },
});

export const isElectron = (): boolean => hasIpc();

/**
 * Returns true iff `window.cfs[key]` is defined (i.e. the preload bridge
 * exposed this namespace for the current flavor). The check is
 * intentionally truthy-typed rather than "is object" so that a future
 * preload that exposes a function under a namespace key (rare but
 * possible) is still treated as present.
 *
 * On a fresh renderer with no preload (e.g. before Electron has wired
 * up the bridge, or in a test without the vitest.setup.ts stub), this
 * returns false rather than throwing — feature-detection should never
 * itself blow up.
 */
export function hasCfsNamespace<K extends keyof CfsApi>(key: K): boolean {
  if (typeof window === 'undefined' || typeof window.cfs === 'undefined') {
    return false;
  }
  return (window.cfs as unknown as Record<string, unknown>)[key as string] != null;
}

/**
 * Returns `window.cfs[key]` if the namespace is present in this flavor,
 * otherwise `undefined`. Unlike the `cfs` proxy above, this does NOT
 * throw on missing preload — flavor-conditional renderer code can
 * branch on the result without try/catch.
 *
 * Example:
 *
 *   const auditApi = safeCfs('auditResults');
 *   if (!auditApi) return <FeatureUnavailable />;
 *   const rows = await auditApi.list();
 */
export function safeCfs<K extends keyof CfsApi>(key: K): CfsApi[K] | undefined {
  if (typeof window === 'undefined' || typeof window.cfs === 'undefined') {
    return undefined;
  }
  return (window.cfs as unknown as Record<string, CfsApi[K] | undefined>)[key as string];
}
