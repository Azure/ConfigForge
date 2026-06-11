// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `fetchBaselineCsv`.
 *
 * Stubs global fetch so we don't hit GitHub during CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBaselineCsv } from './baseline-csv';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('fetchBaselineCsv', () => {
  it('rejects missing url with 400', async () => {
    await expect(fetchBaselineCsv({ url: '' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/url/i),
    });
  });

  it('rejects malformed url with 400', async () => {
    await expect(fetchBaselineCsv({ url: 'not a url' })).rejects.toMatchObject({
      status: 400,
      message: 'Invalid URL',
    });
  });

  it('rejects URL outside the allowlisted host with 403', async () => {
    await expect(
      fetchBaselineCsv({ url: 'https://example.com/foo.csv' }),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/not allowed/i),
    });
  });

  it('rejects URL outside the allowlisted path prefix with 403', async () => {
    await expect(
      fetchBaselineCsv({ url: 'https://raw.githubusercontent.com/notmicrosoft/x/main/y.csv' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('returns text + content type on success', async () => {
    global.fetch = vi.fn(async () =>
      new Response('a,b,c\n1,2,3\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ) as unknown as typeof fetch;

    const result = await fetchBaselineCsv({
      url: 'https://raw.githubusercontent.com/microsoft/osconfig/main/baselines/x.csv',
    });
    expect(result.text).toContain('1,2,3');
    expect(result.contentType).toMatch(/text\/csv/);
  });

  it('surfaces non-200 GitHub responses with the upstream status', async () => {
    global.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      fetchBaselineCsv({
        url: 'https://raw.githubusercontent.com/microsoft/osconfig/main/missing.csv',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces network errors as 502', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(
      fetchBaselineCsv({
        url: 'https://raw.githubusercontent.com/microsoft/osconfig/main/x.csv',
      }),
    ).rejects.toMatchObject({ status: 502, message: 'network down' });
  });

  // ── Size cap (regression) ─────────────────────────────────────────────
  // Before this guard, `await res.text()` had no upper bound: a malicious
  // or misbehaving server could stream gigabytes into the main process and
  // OOM it. We mirror the 10 MB MAX_REMOTE_BYTES used by the manifest URL
  // fetch in handlers/manifests.ts.

  it('rejects with 413 when Content-Length advertises >10 MB', async () => {
    global.fetch = vi.fn(async () =>
      new Response('a,b\n1,2\n', {
        status: 200,
        headers: { 'content-length': String(11 * 1024 * 1024) },
      }),
    ) as unknown as typeof fetch;

    await expect(
      fetchBaselineCsv({
        url: 'https://raw.githubusercontent.com/microsoft/osconfig/main/huge.csv',
      }),
    ).rejects.toMatchObject({
      status: 413,
      message: expect.stringMatching(/too large/i),
    });
  });

  it('rejects with 413 when the body itself exceeds 10 MB (no Content-Length)', async () => {
    // 10 MB + 1 byte. Constructed without setting content-length so the
    // post-read guard is what catches it (covers chunked/streaming).
    const oversized = 'x'.repeat(10 * 1024 * 1024 + 1);
    global.fetch = vi.fn(async () =>
      new Response(oversized, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ) as unknown as typeof fetch;

    await expect(
      fetchBaselineCsv({
        url: 'https://raw.githubusercontent.com/microsoft/osconfig/main/big.csv',
      }),
    ).rejects.toMatchObject({
      status: 413,
      message: expect.stringMatching(/too large/i),
    });
  });

  it('passes through a body just under the 10 MB cap', async () => {
    const justUnder = 'y'.repeat(10 * 1024 * 1024 - 1);
    global.fetch = vi.fn(async () =>
      new Response(justUnder, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await fetchBaselineCsv({
      url: 'https://raw.githubusercontent.com/microsoft/osconfig/main/justunder.csv',
    });
    expect(result.text.length).toBe(justUnder.length);
  });
});
