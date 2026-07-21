// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `recheckHealth`, the Phase B addition that clears the
 * 60s health-status cache and re-runs the binary probe.
 *
 * The motivating scenario: a user opens the app without OSConfig
 * installed, sees the "CLI required" modal, installs OSConfig in a
 * second terminal, and clicks "I've already installed it — recheck".
 * Without `recheckHealth` they'd have to wait up to 60s OR restart
 * the app for the cached "not installed" result to expire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as oscfg from '../oscfg';
import * as system from '../system';
import { _clearHealthCache, getHealthStatus, recheckHealth } from './health';

vi.mock('../oscfg', async () => {
  const actual = await vi.importActual<typeof import('../oscfg')>('../oscfg');
  return {
    ...actual,
    resolveOscfgBinary: vi.fn(),
  };
});

vi.mock('../system', () => ({
  getSystemInfo: vi.fn(),
}));

const mockedOscfg = oscfg as unknown as {
  resolveOscfgBinary: ReturnType<typeof vi.fn>;
};
const mockedSystem = system as unknown as {
  getSystemInfo: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockedSystem.getSystemInfo.mockResolvedValue({
    platform: 'linux',
    isAdmin: true,
    serverType: 'WorkstationServer',
    osVersion: 'Ubuntu 22.04',
  });
});

afterEach(() => {
  vi.clearAllMocks();
  _clearHealthCache();
});

describe('recheckHealth', () => {
  it('returns installed=false when resolveOscfgBinary throws', async () => {
    mockedOscfg.resolveOscfgBinary.mockImplementation(() => {
      throw new Error('oscfg binary not found. Install the CLI…');
    });

    const status = await recheckHealth();

    expect(status.installed).toBe(false);
    expect(status.version).toContain('oscfg binary not found');
  });

  it('returns installed=true once the binary becomes available, even if a prior probe was cached', async () => {
    // First probe: CLI missing — populates the 60s cache with installed:false.
    mockedOscfg.resolveOscfgBinary.mockImplementationOnce(() => {
      throw new Error('oscfg binary not found.');
    });
    const first = await getHealthStatus();
    expect(first.installed).toBe(false);

    // User installs OSConfig. Without recheckHealth they'd see the
    // stale "installed:false" until the 60s TTL expires.
    mockedOscfg.resolveOscfgBinary.mockReturnValue({
      path: '/usr/local/bin/oscfg',
      version: 'oscfg 1.3.9-preview11',
      platform: 'linux',
      source: 'path',
    });

    // recheckHealth must bypass the cache.
    const second = await recheckHealth();
    expect(second.installed).toBe(true);
    expect(second.version).toContain('1.3.9');
  });

  it('clears the cache so the next non-recheck call also sees the fresh result', async () => {
    mockedOscfg.resolveOscfgBinary.mockReturnValueOnce({
      path: '/usr/local/bin/oscfg',
      version: 'oscfg 1.3.9-preview11',
      platform: 'linux',
      source: 'path',
    });
    await recheckHealth();

    // After recheck, getHealthStatus should reflect the freshly-cached value
    // (recheck repopulates the cache via the underlying getHealthStatus call).
    mockedOscfg.resolveOscfgBinary.mockImplementation(() => {
      throw new Error('should not be invoked — recheck cached the success path');
    });
    const cached = await getHealthStatus();
    expect(cached.installed).toBe(true);
    expect(cached.version).toContain('1.3.9');
  });

  it.each([
    'oscfg 1.3.9-preview11',
    'oscfg 1.3.10-preview13',
    'oscfg 1.4.3',
    'oscfg 2.0.0-preview1',
  ])('accepts supported or newer CLI version %s', async (version) => {
    mockedOscfg.resolveOscfgBinary.mockReturnValue({
      path: '/usr/local/bin/oscfg',
      version,
      platform: 'linux',
      source: 'path',
    });

    const status = await recheckHealth();

    expect(status.versionMismatch).toBe(false);
    expect(status.status).toBe('healthy');
    expect(status.expectedVersion).toBe('1.3.9');
  });

  it.each(['oscfg 1.3.8-preview18', 'oscfg 1.2.99'])(
    'flags CLI version %s below the minimum',
    async (version) => {
      mockedOscfg.resolveOscfgBinary.mockReturnValue({
        path: '/usr/local/bin/oscfg',
        version,
        platform: 'linux',
        source: 'path',
      });

      const status = await recheckHealth();

      expect(status.versionMismatch).toBe(true);
      expect(status.status).toBe('degraded');
      expect(status.expectedVersion).toBe('1.3.9');
    },
  );
});
