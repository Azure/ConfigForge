// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { isWindows11OrLater, isRemoteDesktopSession, isMicaSupported } from './platform-detection';

/**
 * Platform detection helpers — Mica gating depends on these.
 *
 * v0.1.0 shipped Mica unconditionally enabled, which produced a
 * blank-white window for every Azure DevBox / RDP user because RDP
 * doesn't transport DirectComposition surfaces. v0.1.1 fixes this by
 * gating Mica behind `isMicaSupported()` which AND-combines Win11 22000+
 * with `!isRemoteDesktopSession()`.
 *
 * These tests lock in the gating logic so it can't regress silently.
 * The functions accept `env` and `platform` overrides specifically so
 * we can simulate Windows / Linux / RDP / Console in pure unit tests
 * without spawning Electron.
 */
describe('platform-detection', () => {
  describe('isWindows11OrLater', () => {
    it('returns false on non-Windows platforms even with high build numbers', () => {
      expect(isWindows11OrLater({}, 'darwin')).toBe(false);
      expect(isWindows11OrLater({}, 'linux')).toBe(false);
    });

    // We can't easily mock os.release() per-call without rewiring the
    // module, so the rest of the build-number coverage is implicit:
    // the function reads os.release() once on `win32`. The integration
    // path is exercised via the IPC handler test in src/lib/platform.test.ts.
    it('returns false on non-Windows regardless of env', () => {
      expect(isWindows11OrLater({ SESSIONNAME: 'Console' }, 'darwin')).toBe(false);
    });
  });

  describe('isRemoteDesktopSession', () => {
    it('returns false on non-Windows platforms even with RDP env vars', () => {
      // Linux / macOS users connecting via xrdp / Screen Sharing don't
      // hit the DirectComposition transport problem, so we don't gate
      // Mica off for them. (Mica is a Windows-only concept anyway —
      // this is belt-and-suspenders.)
      expect(isRemoteDesktopSession({ SESSIONNAME: 'rdp-abc', CLIENTNAME: 'LAPTOP' }, 'linux')).toBe(false);
      expect(isRemoteDesktopSession({ SESSIONNAME: 'rdp-abc' }, 'darwin')).toBe(false);
    });

    it('returns true when SESSIONNAME starts with "rdp-" (Azure DevBox case)', () => {
      // Real value observed on Azure DevBox: "rdp-sxs260209400#0"
      expect(isRemoteDesktopSession({ SESSIONNAME: 'rdp-sxs260209400#0' }, 'win32')).toBe(true);
    });

    it('returns true when SESSIONNAME starts with "RDP-" (mstsc case)', () => {
      // Standard mstsc / Windows App format
      expect(isRemoteDesktopSession({ SESSIONNAME: 'RDP-Tcp#5' }, 'win32')).toBe(true);
    });

    it('returns true when CLIENTNAME is set to a non-empty hostname', () => {
      // Some session managers (Citrix, certain group policies) leave
      // SESSIONNAME as "Console" but still set CLIENTNAME to the
      // originating client. The DirectComposition transport problem
      // applies to any remote-display scenario, so we treat this as RDP.
      expect(isRemoteDesktopSession({ CLIENTNAME: 'LAPTOP-7BD07SRF' }, 'win32')).toBe(true);
    });

    it('returns false when SESSIONNAME is "Console" and CLIENTNAME is unset', () => {
      // The local-physical-console case — Mica works correctly here.
      expect(isRemoteDesktopSession({ SESSIONNAME: 'Console' }, 'win32')).toBe(false);
    });

    it('returns false when CLIENTNAME is the literal "Console"', () => {
      // Some environments populate CLIENTNAME=Console for local sessions
      // (a known Windows quirk). We must NOT treat that as RDP.
      expect(isRemoteDesktopSession({ SESSIONNAME: 'Console', CLIENTNAME: 'Console' }, 'win32')).toBe(false);
      expect(isRemoteDesktopSession({ CLIENTNAME: 'console' }, 'win32')).toBe(false);
    });

    it('returns false when both SESSIONNAME and CLIENTNAME are missing', () => {
      // Defensive — Electron sometimes strips env vars during sandbox setup.
      // Falling back to "not RDP" is the safe default (Mica may render
      // wrong but the window won't be blank, which is the worse failure).
      expect(isRemoteDesktopSession({}, 'win32')).toBe(false);
    });

    it('returns false when SESSIONNAME is empty string', () => {
      expect(isRemoteDesktopSession({ SESSIONNAME: '' }, 'win32')).toBe(false);
    });

    it('returns false when CLIENTNAME is whitespace only', () => {
      expect(isRemoteDesktopSession({ CLIENTNAME: '   ' }, 'win32')).toBe(false);
    });

    it('case-insensitive match on rdp- prefix', () => {
      expect(isRemoteDesktopSession({ SESSIONNAME: 'RdP-anything' }, 'win32')).toBe(true);
      expect(isRemoteDesktopSession({ SESSIONNAME: 'rDp-XYZ' }, 'win32')).toBe(true);
    });

    it('returns true when --rdp-session flag is passed via argv (UAC propagation)', () => {
      // v0.1.7 fix — UAC's consent.exe doesn't propagate SESSIONNAME
      // to the elevated child reliably. The unprivileged parent passes
      // `--rdp-session` on the command line when it knows it's in RDP;
      // the elevated process picks it up here. This test pins that
      // behaviour: env vars completely empty, but argv flag set.
      expect(
        isRemoteDesktopSession({}, 'win32', ['app.exe', '--rdp-session']),
      ).toBe(true);
    });

    it('--rdp-session flag is honored even when SESSIONNAME is "Console"', () => {
      // The exact failure mode in the wild: elevated process inherits
      // `SESSIONNAME=Console` (or empty) from consent.exe but the user
      // is actually on RDP. Argv flag overrides.
      expect(
        isRemoteDesktopSession(
          { SESSIONNAME: 'Console' },
          'win32',
          ['app.exe', '--rdp-session'],
        ),
      ).toBe(true);
    });

    it('--rdp-session flag is ignored on non-Windows platforms', () => {
      // Mica is Windows-only so the early-return on platform applies
      // even when the argv flag is set.
      expect(
        isRemoteDesktopSession({}, 'linux', ['app', '--rdp-session']),
      ).toBe(false);
    });
  });

  describe('isMicaSupported', () => {
    it('is false on non-Windows platforms', () => {
      expect(isMicaSupported({}, 'darwin')).toBe(false);
      expect(isMicaSupported({}, 'linux')).toBe(false);
    });

    it('is false in RDP sessions even when Win11 build is satisfied', () => {
      // The actual repro from the v0.1.0 blank-window report: Win11 24H2
      // (build 26100) on Azure DevBox. Without the RDP guard, this user
      // gets Mica enabled, which RDP can't transport, so the window
      // arrives at the client as solid white.
      //
      // We can't directly inject os.release() here since
      // isWindows11OrLater calls it internally. But we can prove the
      // AND-gate by relying on the host: this test passes regardless
      // of whether the host is Win11 or not, because RDP env makes the
      // result false either way.
      expect(isMicaSupported({ SESSIONNAME: 'rdp-sxs260209400#0' }, 'win32')).toBe(false);
      expect(isMicaSupported({ CLIENTNAME: 'LAPTOP-X' }, 'win32')).toBe(false);
    });

    it('is false when --rdp-session argv flag is set (UAC propagation)', () => {
      // v0.1.7 fix — covers the elevated-process blank-window case.
      // Even with completely empty env (the worst case for the
      // elevated child after consent.exe scrubs SESSIONNAME), the
      // argv flag forces Mica off so the elevated window paints
      // through the RDP framebuffer instead of arriving solid white.
      expect(isMicaSupported({}, 'win32', ['app.exe', '--rdp-session'])).toBe(false);
    });
  });
});
