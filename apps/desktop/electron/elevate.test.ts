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

import { which, isCurrentProcessElevated, enableLinuxRootSandboxBypass } from './elevate';
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
});
