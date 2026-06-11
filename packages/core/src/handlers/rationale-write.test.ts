// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `appendRationaleEntry`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../oscfg', () => ({
  isValidNamespace: vi.fn((s: string) => /^[A-Za-z0-9._-]{1,96}$/.test(s)),
}));

vi.mock('../history/author', () => ({
  resolveAuthor: vi.fn(),
}));

vi.mock('../manifest/rationale-store', () => ({
  appendRationale: vi.fn(),
}));

import { appendRationaleEntry } from './rationale-write';
import * as author from '../history/author';
import * as store from '../manifest/rationale-store';

const resolveAuthorMock = vi.mocked(author.resolveAuthor);
const appendRationaleMock = vi.mocked(store.appendRationale);

beforeEach(() => {
  vi.clearAllMocks();
  resolveAuthorMock.mockResolvedValue({ name: 'amir', source: 'git' as const });
  appendRationaleMock.mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('appendRationaleEntry', () => {
  const baseValid = {
    id: 'mybase',
    resourceName: 'PasswordPolicy',
    reason: 'org-mandated baseline drift',
  };

  it('rejects invalid namespace', async () => {
    await expect(
      appendRationaleEntry({ ...baseValid, id: '../escape' }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Invalid manifest id/) });
  });

  it('rejects empty resourceName', async () => {
    await expect(
      appendRationaleEntry({ ...baseValid, resourceName: '' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects 1025-char resourceName', async () => {
    await expect(
      appendRationaleEntry({ ...baseValid, resourceName: 'x'.repeat(1025) }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/too long/) });
  });

  it('rejects non-boolean skipped', async () => {
    await expect(
      appendRationaleEntry({ ...baseValid, skipped: 'true' as never }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects empty reason when not skipped', async () => {
    await expect(
      appendRationaleEntry({ ...baseValid, reason: '   ' }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/reason is required/) });
  });

  it('allows empty reason when skipped is true', async () => {
    const result = await appendRationaleEntry({
      ...baseValid,
      reason: '',
      skipped: true,
    });
    expect(result.ok).toBe(true);
    expect(result.entry.reason).toBe('');
    expect(result.entry.skipped).toBe(true);
    expect(result.entry.author).toBe('amir');
    expect(typeof result.entry.ts).toBe('string');
  });

  it('rejects 501-char reason', async () => {
    await expect(
      appendRationaleEntry({ ...baseValid, reason: 'x'.repeat(501) }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/too long/) });
  });

  it('writes through to appendRationale and returns the entry', async () => {
    const result = await appendRationaleEntry(baseValid);
    expect(result.ok).toBe(true);
    expect(appendRationaleMock).toHaveBeenCalledTimes(1);
    expect(appendRationaleMock.mock.calls[0][0]).toBe('mybase');
    expect(appendRationaleMock.mock.calls[0][1].resourceName).toBe('PasswordPolicy');
    expect(result.entry.author).toBe('amir');
  });

  it('continues with empty author when resolveAuthor throws', async () => {
    resolveAuthorMock.mockRejectedValueOnce(new Error('git not installed'));
    const result = await appendRationaleEntry(baseValid);
    expect(result.entry.author).toBe('');
  });

  it('surfaces appendRationale failure as 500', async () => {
    appendRationaleMock.mockRejectedValueOnce(new Error('disk full'));
    await expect(appendRationaleEntry(baseValid)).rejects.toMatchObject({
      status: 500,
      message: 'disk full',
    });
  });

  it('decodes percent-encoded id', async () => {
    const encoded = encodeURIComponent('my-base');
    const result = await appendRationaleEntry({ ...baseValid, id: encoded });
    expect(result.ok).toBe(true);
    expect(appendRationaleMock.mock.calls[0][0]).toBe('my-base');
  });
});
