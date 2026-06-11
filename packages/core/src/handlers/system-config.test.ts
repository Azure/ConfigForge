// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Regression tests for `getSystemConfigForManifest`.
 *
 * The handler used to pass user-supplied `name` straight to the registry
 * layer (`getRegistration`, `getRegistrationSource`), which builds
 * `<dataDir>/<name>.json` paths internally. A value like
 * `../../../etc/passwd` would therefore resolve outside the configforge
 * data dir. We now slug the input through `sanitizeNamespace` first and
 * 400 on names that slug to empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as oscfg from '../oscfg';
import * as system from '../system';
import { getSystemConfigForManifest } from './system-config';
import { isHandlerError } from './errors';

vi.mock('../oscfg', async () => {
  const actual = await vi.importActual<typeof import('../oscfg')>('../oscfg');
  return {
    ...actual,
    listRegistrations: vi.fn(),
    getRegistration: vi.fn(),
    getRegistrationSource: vi.fn(),
  };
});

vi.mock('../system', () => ({
  getSystemInfo: vi.fn(),
}));

const mockedOscfg = oscfg as unknown as {
  getRegistration: ReturnType<typeof vi.fn>;
  getRegistrationSource: ReturnType<typeof vi.fn>;
};

const mockedSystem = system as unknown as {
  getSystemInfo: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  vi.clearAllMocks();
});

function happySystemInfo() {
  mockedSystem.getSystemInfo.mockResolvedValue({
    platform: 'win32',
    isAdmin: true,
    serverType: 'workstation',
    osVersion: '10.0.22631',
  });
}

describe('getSystemConfigForManifest — path traversal / sanitization', () => {
  it('passes a sanitized namespace (not the raw input) to getRegistration', async () => {
    happySystemInfo();
    mockedOscfg.getRegistration.mockResolvedValue({
      namespace: 'etcpasswd',
      platform: 'cross-platform',
    });
    mockedOscfg.getRegistrationSource.mockResolvedValue('resources: []\n');

    // Path-traversal style input. The threat is path escape inside the
    // registry layer, which does `path.join(dataDir, name + '.json')`.
    // What MATTERS for safety is that `/` and `\` are gone — once those
    // are replaced, the result resolves to a single filename inside
    // dataDir and cannot escape (even if `..` substrings survive).
    await getSystemConfigForManifest('../../../etc/passwd');

    expect(mockedOscfg.getRegistration).toHaveBeenCalledTimes(1);
    const passed = mockedOscfg.getRegistration.mock.calls[0][0];
    expect(passed).not.toContain('/');
    expect(passed).not.toContain('\\');
    // It should be a non-empty allowed-charset slug.
    expect(passed).toMatch(/^[A-Za-z0-9._-]+$/);
    // It should NOT be the raw input.
    expect(passed).not.toBe('../../../etc/passwd');
  });

  it('strips backslash path separators (Windows traversal style)', async () => {
    happySystemInfo();
    mockedOscfg.getRegistration.mockResolvedValue({ namespace: 'x', platform: 'windows' });
    mockedOscfg.getRegistrationSource.mockResolvedValue('resources: []\n');

    await getSystemConfigForManifest('..\\..\\Windows\\System32\\config\\SAM');

    const passed = mockedOscfg.getRegistration.mock.calls[0][0];
    expect(passed).not.toContain('\\');
    expect(passed).not.toContain('/');
    expect(passed).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('passes the same sanitized namespace to getRegistrationSource', async () => {
    happySystemInfo();
    mockedOscfg.getRegistration.mockResolvedValue({ namespace: 'ws2025', platform: 'windows' });
    mockedOscfg.getRegistrationSource.mockResolvedValue('resources: []\n');

    await getSystemConfigForManifest('WS2025  Member  Server');

    const regArg = mockedOscfg.getRegistration.mock.calls[0][0];
    const srcArg = mockedOscfg.getRegistrationSource.mock.calls[0][0];
    expect(regArg).toBe(srcArg); // same slug for both lookups
    expect(regArg).not.toContain(' ');
  });

  it('throws 400 on a name that sanitizes to empty (only invalid chars)', async () => {
    happySystemInfo();
    // sanitizeNamespace: replaces [^A-Za-z0-9._-]+ with '-', then trims
    // leading/trailing dashes. A string of only `/` characters becomes
    // a single `-` then trims to empty.
    try {
      await getSystemConfigForManifest('////');
      throw new Error('expected HandlerError');
    } catch (err) {
      expect(isHandlerError(err)).toBe(true);
      if (isHandlerError(err)) {
        expect(err.status).toBe(400);
      }
    }
    expect(mockedOscfg.getRegistration).not.toHaveBeenCalled();
  });

  it('still 404s for a well-formed namespace that has no registration', async () => {
    happySystemInfo();
    mockedOscfg.getRegistration.mockResolvedValue(null);

    try {
      await getSystemConfigForManifest('nonexistent-ns');
      throw new Error('expected HandlerError');
    } catch (err) {
      expect(isHandlerError(err)).toBe(true);
      if (isHandlerError(err)) {
        expect(err.status).toBe(404);
      }
    }
  });

  it('still 400s when name is missing', async () => {
    happySystemInfo();
    try {
      await getSystemConfigForManifest('');
      throw new Error('expected HandlerError');
    } catch (err) {
      expect(isHandlerError(err)).toBe(true);
      if (isHandlerError(err)) {
        expect(err.status).toBe(400);
      }
    }
  });
});
