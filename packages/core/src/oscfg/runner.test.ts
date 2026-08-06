// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import { translateKnownErrors } from './runner';

describe('translateKnownErrors', () => {
  // ── Pre-existing: PermissionDenied / file-rotate ─────────────────────────

  it('translates the elevated-only file-rotate panic', () => {
    const raw = 'thread main panicked at PermissionDenied (os error 5) inside file-rotate';
    const out = translateKnownErrors(raw, 101);
    expect(out).toMatch(/Administrator privileges/i);
    expect(out).toMatch(/elevated PowerShell/i);
  });

  it('does NOT translate file-rotate when exit code is not 101', () => {
    const raw = 'thread main panicked at PermissionDenied (os error 5) inside file-rotate';
    expect(translateKnownErrors(raw, 1)).toBe(raw);
  });

  // ── New: UserRightsAssignment access-denied ──────────────────────────────

  it('translates LSA Access-Denied on UserRightsAssignment', () => {
    const raw =
      'Microsoft.Windows/UserRightsAssignment (<unnamed>): {Access Denied}\r\n' +
      'A process has requested access to an object, but has not been granted those access rights. (0xD0000022)';
    const out = translateKnownErrors(raw, 1);
    expect(out).toMatch(/UserRightsAssignment requires Administrator privileges/i);
    expect(out).toMatch(/LSA/);
  });

  it('does NOT translate Access-Denied unrelated to UserRightsAssignment', () => {
    const raw = 'Microsoft.Windows/Registry (<unnamed>): Access Denied (0xD0000022)';
    expect(translateKnownErrors(raw, 1)).toBe(raw);
  });

  // ── New: Policy CSP 0x82F00009 ───────────────────────────────────────────

  it('translates 0x82F00009 with a UserRights-specific hint when path mentions UserRights', () => {
    const raw =
      'Microsoft.Windows/CSP (<unnamed>): 0x82F00009 (path=./Vendor/MSFT/Policy/Result/UserRights/AccessFromNetwork)';
    const out = translateKnownErrors(raw, 1);
    expect(out).toMatch(/Policy CSP read failed \(0x82F00009\)/);
    expect(out).toMatch(/Microsoft\.Windows\/UserRightsAssignment/);
    expect(out).toMatch(/SeNetworkLogonRight/);
  });

  it('translates 0x82F00009 with a generic hint for non-UserRights CSP paths', () => {
    const raw = 'Microsoft.Windows/CSP (<unnamed>): 0x82F00009';
    const out = translateKnownErrors(raw, 1);
    expect(out).toMatch(/Policy CSP read failed \(0x82F00009\)/);
    expect(out).toMatch(/dedicated provider/);
    // The non-UserRights branch should NOT mention SeNetworkLogonRight.
    expect(out).not.toMatch(/SeNetworkLogonRight/);
  });

  it('treats /UserRights/ in the path as the UserRights variant', () => {
    const raw =
      'Microsoft.Windows/CSP (<unnamed>): 0x82F00009 path=./Vendor/MSFT/Policy/Config/UserRights/SeShutdownPrivilege';
    const out = translateKnownErrors(raw, 1);
    expect(out).toMatch(/UserRightsAssignment/);
  });

  // ── Passthrough: unmatched errors are returned verbatim ──────────────────

  it.each([
    'Microsoft.Windows/Registry: missing field `valueName`',
    'oscfg exited with code 1',
    'unsupported resource type Microsoft.Mythical/Provider',
    '',
  ])('passes through unmatched error: %s', (raw) => {
    expect(translateKnownErrors(raw, 1)).toBe(raw);
  });
});


// ── PR21: spawn concurrency gate ───────────────────────────────────────
import { _internals } from './runner';

describe('runner spawn concurrency gate (PR21)', () => {
  it('exposes a sane MAX_CONCURRENT_SPAWNS', () => {
    // Must be > 0 (otherwise nothing ever runs) and <= 16 (otherwise no
    // gating in practice on a typical 8-core dev machine).
    expect(_internals.MAX_CONCURRENT_SPAWNS).toBeGreaterThan(0);
    expect(_internals.MAX_CONCURRENT_SPAWNS).toBeLessThanOrEqual(16);
  });

  it('parses unsafe CLI JSON integers without rounding', () => {
    const parsed = _internals.parseOscfgOutput(
      '{"value":18446744073709551615,"adjacent":18446744073709551614}',
    ) as { value: unknown; adjacent: unknown };

    expect(parsed.value).toBe(18446744073709551615n);
    expect(parsed.adjacent).toBe(18446744073709551614n);
  });
});