// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cfs, hasCfsNamespace, isElectron, safeCfs } from './cfs';

/**
 * CF-SEC-015 — feature-detection helpers for renderer code that may
 * run against a stripped-down flavor (e.g. macOS author build).
 *
 * The test suite simulates three preload states:
 *   - "full electron"  : every namespace present (main runtime)
 *   - "partial mac"    : authoring/activity namespaces present;
 *                       device-operation namespaces missing
 *                       (mac-author-build runtime)
 *   - "no preload"     : window.cfs undefined (test default, or a renderer
 *                       boot race before the bridge is ready)
 *
 * Renderer code that does flavor gating via `hasCfsNamespace` /
 * `safeCfs` must keep working in all three states.
 */

const originalCfs = (window as unknown as { cfs?: unknown }).cfs;

function setWindowCfs(partial: Record<string, unknown> | undefined): void {
  if (partial === undefined) {
    delete (window as unknown as { cfs?: unknown }).cfs;
  } else {
    (window as unknown as { cfs?: unknown }).cfs = partial;
  }
}

describe('cfs capability helpers (CF-SEC-015)', () => {
  beforeEach(() => {
    // Each test sets its own window.cfs shape; reset to a known baseline.
    setWindowCfs(undefined);
  });

  afterEach(() => {
    // Restore whatever the test-setup file installed so other suites are unaffected.
    if (originalCfs === undefined) {
      delete (window as unknown as { cfs?: unknown }).cfs;
    } else {
      (window as unknown as { cfs?: unknown }).cfs = originalCfs;
    }
  });

  it('isElectron returns false when window.cfs is undefined', () => {
    expect(isElectron()).toBe(false);
  });

  it('isElectron returns true when window.cfs is present', () => {
    setWindowCfs({});
    expect(isElectron()).toBe(true);
  });

  it('hasCfsNamespace returns false when window.cfs is undefined (no throw)', () => {
    expect(hasCfsNamespace('deploy' as never)).toBe(false);
    expect(hasCfsNamespace('auditResults' as never)).toBe(false);
  });

  it('hasCfsNamespace returns true for present namespaces and false for absent ones (mac-author shape)', () => {
    setWindowCfs({
      // Namespaces the mac author flavor preserves.
      manifests: {},
      library: {},
      diff: {},
      docs: {},
      importChannel: {},
      activity: {},
      // Intentionally OMITTED: deploy, deployRecovery, revert, system,
      // health, auditResults.
    });
    expect(hasCfsNamespace('manifests' as never)).toBe(true);
    expect(hasCfsNamespace('library' as never)).toBe(true);
    expect(hasCfsNamespace('activity' as never)).toBe(true);
    expect(hasCfsNamespace('deploy' as never)).toBe(false);
    expect(hasCfsNamespace('deployRecovery' as never)).toBe(false);
    expect(hasCfsNamespace('revert' as never)).toBe(false);
    expect(hasCfsNamespace('system' as never)).toBe(false);
    expect(hasCfsNamespace('health' as never)).toBe(false);
    expect(hasCfsNamespace('auditResults' as never)).toBe(false);
  });

  it('safeCfs returns undefined when window.cfs is undefined (no throw)', () => {
    expect(safeCfs('deploy' as never)).toBeUndefined();
    expect(safeCfs('manifests' as never)).toBeUndefined();
  });

  it('safeCfs returns the namespace object when present', () => {
    const manifestsApi = { list: () => Promise.resolve([]) };
    setWindowCfs({ manifests: manifestsApi });
    expect(safeCfs('manifests' as never)).toBe(manifestsApi);
  });

  it('safeCfs returns undefined for namespaces missing from the current flavor', () => {
    setWindowCfs({ manifests: {} }); // mac-author-style partial preload
    expect(safeCfs('deploy' as never)).toBeUndefined();
    expect(safeCfs('auditResults' as never)).toBeUndefined();
    // Sanity: the present namespace is still resolvable.
    expect(safeCfs('manifests' as never)).toBeDefined();
  });

  it('cfs proxy throws a clear error when window.cfs is undefined (preload bootstrap problem)', () => {
    expect(() => (cfs as unknown as Record<string, unknown>).manifests).toThrow(
      /window\.cfs is not available/,
    );
  });

  it('cfs proxy returns undefined for absent namespaces when window.cfs is present (legacy behaviour)', () => {
    // This is the dangerous shape that motivated CF-SEC-015 in the first
    // place: callers that do `cfs.deploy.run(...)` will blow up at
    // `.run`, not at `.deploy`. New code should prefer safeCfs.
    setWindowCfs({ manifests: {} });
    expect((cfs as unknown as Record<string, unknown>).deploy).toBeUndefined();
    // And the present namespace is reachable through the proxy too.
    expect((cfs as unknown as Record<string, unknown>).manifests).toBeDefined();
  });
});
