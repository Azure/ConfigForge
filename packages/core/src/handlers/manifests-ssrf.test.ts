// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * SSRF-guard tests for `fetchManifestFromUri` (CF-SEC-016 hardening).
 *
 * Mocks `node:dns/promises` and global fetch so CI never hits the network.
 * Locks in the resolve-and-recheck behavior that closes the
 * "public hostname that resolves to a private IP" bypass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { fetchManifestFromUri } from './manifests';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('fetchManifestFromUri — SSRF guard', () => {
  it('rejects a non-http(s) scheme', async () => {
    await expect(fetchManifestFromUri('file:///etc/passwd')).rejects.toMatchObject({
      status: 400,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a literal private / IMDS address without any network call', async () => {
    await expect(
      fetchManifestFromUri('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/private\/loopback/i),
    });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a public hostname that RESOLVES to a private IP (the reported bypass)', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      fetchManifestFromUri('http://manifest.attacker.example/x.yaml'),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/resolves to a private\/loopback address \(169\.254\.169\.254\)/i),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an IPv4-mapped IPv6 address that resolves private', async () => {
    lookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.5', family: 6 }]);
    await expect(
      fetchManifestFromUri('http://mapped.attacker.example/x.yaml'),
    ).rejects.toMatchObject({ status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows a public host, refuses redirects, and returns the body', async () => {
    lookupMock.mockResolvedValue([{ address: '140.82.112.3', family: 4 }]);
    global.fetch = vi.fn(
      async () => new Response('resources:\n  - {}\n', { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(
      fetchManifestFromUri('https://raw.githubusercontent.com/microsoft/osconfig/main/x.yaml'),
    ).resolves.toContain('resources:');

    const init = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as
      | RequestInit
      | undefined;
    expect(init?.redirect).toBe('error');
  });
});
