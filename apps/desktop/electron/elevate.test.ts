// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron BEFORE importing the module under test so the top-level
// `import { app, BrowserWindow } from 'electron'` resolves to our stubs
// instead of the real Electron runtime (which doesn't exist in vitest's
// Node env).
vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
    quit: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

import { which, isCurrentProcessElevated, enableLinuxRootSandboxBypass, buildLinuxElevationArgv } from './elevate';
import { app } from 'electron';

/**
 * Process elevation — unit coverage for the helpers that don't fork
 * subprocesses. The full `relaunchElevated()` flow spawns the OS
 * elevation prompt; we deliberately do NOT exercise that in CI
 * (would pop a UAC dialog on Windows runners, which is broken in
 * headless mode).
 */
describe('elevate — helpers', () => {
  describe('which', () => {
    it('finds an executable that exists in the first PATH entry', () => {
      // Use a guaranteed-present path — the node binary itself.
      const node = which('node');
      // We can't assert the exact path because it varies by runner,
      // but if vitest is running, `node` MUST be on PATH.
      expect(node).not.toBeNull();
    });

    it('returns null for an executable that does not exist anywhere', () => {
      // Random unicode garbage that no real binary uses as a name.
      const result = which('definitely-not-a-real-command-Δϟ-12345');
      expect(result).toBeNull();
    });

    it('returns null when PATH is empty', () => {
      const oldPath = process.env.PATH;
      process.env.PATH = '';
      try {
        expect(which('node')).toBeNull();
      } finally {
        process.env.PATH = oldPath;
      }
    });
  });

  describe('enableLinuxRootSandboxBypass', () => {
    beforeEach(() => {
      vi.mocked(app.commandLine.appendSwitch).mockClear();
    });

    it('is a no-op on non-Linux platforms (Windows)', () => {
      // Stub process.platform — vitest's `vi.stubGlobal` wraps the
      // assignment so it's restored after the test.
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        enableLinuxRootSandboxBypass();
        expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
      } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
      }
    });

    it('is a no-op on Linux when not running as root', () => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const oldGetuid = process.getuid;
      // Pretend we're a normal user (uid 1000).
      // @ts-expect-error -- assigning a vi.fn to process.getuid for the test
      process.getuid = vi.fn(() => 1000);
      try {
        enableLinuxRootSandboxBypass();
        expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
      } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
        // @ts-expect-error -- restoring
        process.getuid = oldGetuid;
      }
    });

    it('appends --no-sandbox on Linux when running as root (uid 0)', () => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const oldGetuid = process.getuid;
      // @ts-expect-error -- stubbing process.getuid for the test
      process.getuid = vi.fn(() => 0);
      try {
        enableLinuxRootSandboxBypass();
        expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('no-sandbox');
      } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
        // @ts-expect-error -- stubbing process.getuid for the test
        process.getuid = oldGetuid;
      }
    });
  });

  describe('isCurrentProcessElevated', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('on Linux returns true when uid is 0', () => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const oldGetuid = process.getuid;
      // @ts-expect-error -- stubbing process.getuid for the test
      process.getuid = vi.fn(() => 0);
      try {
        expect(isCurrentProcessElevated()).toBe(true);
      } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
        // @ts-expect-error -- stubbing process.getuid for the test
        process.getuid = oldGetuid;
      }
    });

    it('on Linux returns false when uid is non-zero', () => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const oldGetuid = process.getuid;
      // @ts-expect-error -- stubbing process.getuid for the test
      process.getuid = vi.fn(() => 1000);
      try {
        expect(isCurrentProcessElevated()).toBe(false);
      } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
        // @ts-expect-error -- stubbing process.getuid for the test
        process.getuid = oldGetuid;
      }
    });

    it('on FreeBSD / unsupported platforms returns false', () => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
      try {
        expect(isCurrentProcessElevated()).toBe(false);
      } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
      }
    });
  });

  /*
   * buildLinuxElevationArgv is the v0.2.1 fix for the
   * "pkexec exited with code null" failure on the AppImage build.
   * The argv shape it produces is:
   *
   *   pkexec /usr/bin/env DISPLAY=:0 XAUTHORITY=/home/foo/.Xauthority
   *          WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000
   *          XDG_SESSION_TYPE=wayland
   *          /path/to/Configforge --no-sandbox
   *
   * Two things this gets right that the v0.2.0 version did not:
   *   1. AppImage detection: when APPIMAGE is set, relaunch the
   *      .AppImage file (which AppRun will mount + boot fresh under
   *      root) instead of the FUSE-mount execPath.
   *   2. Display env forwarding so the elevated renderer can connect
   *      to the user's X or Wayland session.
   */
  describe('buildLinuxElevationArgv', () => {
    it('uses process.execPath when not running from an AppImage', () => {
      const argv = buildLinuxElevationArgv('/opt/ConfigForge/cfs', {});
      expect(argv).toEqual(['/opt/ConfigForge/cfs', '--no-sandbox']);
    });

    it('uses APPIMAGE env var instead of execPath when running from AppImage', () => {
      const argv = buildLinuxElevationArgv(
        '/tmp/.mount_ConfXX/usr/bin/electron',
        { APPIMAGE: '/home/amir/Downloads/ConfigForge-0.2.1.AppImage' },
      );
      expect(argv[0]).toBe('/home/amir/Downloads/ConfigForge-0.2.1.AppImage');
      expect(argv).not.toContain('/tmp/.mount_ConfXX/usr/bin/electron');
    });

    it('forwards DISPLAY + XAUTHORITY via /usr/bin/env when set (X11 session)', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        DISPLAY: ':0',
        XAUTHORITY: '/home/amir/.Xauthority',
      });
      expect(argv).toEqual([
        '/usr/bin/env',
        'DISPLAY=:0',
        'XAUTHORITY=/home/amir/.Xauthority',
        '/opt/cfs/cfs',
        '--no-sandbox',
      ]);
    });

    it('falls back to $HOME/.Xauthority when DISPLAY is set but XAUTHORITY is not (Ubuntu 22.04 GNOME Wayland default)', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        DISPLAY: ':0',
        HOME: '/home/amir',
      });
      expect(argv).toContain('XAUTHORITY=/home/amir/.Xauthority');
    });

    it('does not fall back to $HOME/.Xauthority when DISPLAY is unset (no X session at all)', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        HOME: '/home/amir',
      });
      expect(argv.find((a) => a.startsWith('XAUTHORITY='))).toBeUndefined();
    });

    it('forwards DBUS_SESSION_BUS_ADDRESS when set (GNOME on Ubuntu 22.04)', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        DISPLAY: ':0',
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
      });
      expect(argv).toContain('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus');
    });

    it('forwards XDG_CURRENT_DESKTOP for desktop-aware Electron paths', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        DISPLAY: ':0',
        XDG_CURRENT_DESKTOP: 'GNOME',
      });
      expect(argv).toContain('XDG_CURRENT_DESKTOP=GNOME');
    });

    it('forwards WAYLAND_DISPLAY + XDG_RUNTIME_DIR via /usr/bin/env when set (Wayland session)', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_RUNTIME_DIR: '/run/user/1000',
        XDG_SESSION_TYPE: 'wayland',
      });
      expect(argv).toContain('/usr/bin/env');
      expect(argv).toContain('WAYLAND_DISPLAY=wayland-0');
      expect(argv).toContain('XDG_RUNTIME_DIR=/run/user/1000');
      expect(argv).toContain('XDG_SESSION_TYPE=wayland');
      expect(argv[argv.length - 2]).toBe('/opt/cfs/cfs');
      expect(argv[argv.length - 1]).toBe('--no-sandbox');
    });

    it('forwards both X11 + Wayland env vars in mixed sessions (XWayland users)', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        DISPLAY: ':0',
        XAUTHORITY: '/run/user/1000/.mutter-Xwaylandauth.X',
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_RUNTIME_DIR: '/run/user/1000',
      });
      expect(argv).toContain('DISPLAY=:0');
      expect(argv).toContain('WAYLAND_DISPLAY=wayland-0');
    });

    it('skips env vars with empty / undefined values rather than forwarding KEY=', () => {
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {
        DISPLAY: ':0',
        XAUTHORITY: '', // empty -> skip (otherwise pkexec would set XAUTHORITY="")
        WAYLAND_DISPLAY: undefined,
      });
      expect(argv).toContain('DISPLAY=:0');
      expect(argv).not.toContain('XAUTHORITY=');
      expect(argv).not.toContain('WAYLAND_DISPLAY=');
    });

    it('omits the /usr/bin/env wrapper entirely when no display env vars are set', () => {
      // Headless / TTY-only Linux: no GUI session, no env to forward.
      // We still pass --no-sandbox because the elevated process is
      // running as root, which Electron requires regardless of GUI.
      const argv = buildLinuxElevationArgv('/opt/cfs/cfs', {});
      expect(argv[0]).not.toBe('/usr/bin/env');
      expect(argv).toEqual(['/opt/cfs/cfs', '--no-sandbox']);
    });

    it('appends --rdp-session when the caller flags an RDP session', () => {
      const argv = buildLinuxElevationArgv(
        '/opt/cfs/cfs',
        { DISPLAY: ':10' },
        { isRdp: true },
      );
      expect(argv[argv.length - 1]).toBe('--rdp-session');
      expect(argv[argv.length - 2]).toBe('--no-sandbox');
      expect(argv[argv.length - 3]).toBe('/opt/cfs/cfs');
    });

    it('AppImage + display env: both fixes compose', () => {
      const argv = buildLinuxElevationArgv(
        '/tmp/.mount_ConfXX/usr/bin/electron',
        {
          APPIMAGE: '/home/amir/Downloads/ConfigForge-0.2.1.AppImage',
          DISPLAY: ':0',
          XAUTHORITY: '/home/amir/.Xauthority',
        },
      );
      expect(argv).toEqual([
        '/usr/bin/env',
        'DISPLAY=:0',
        'XAUTHORITY=/home/amir/.Xauthority',
        '/home/amir/Downloads/ConfigForge-0.2.1.AppImage',
        '--no-sandbox',
      ]);
    });
  });
});
