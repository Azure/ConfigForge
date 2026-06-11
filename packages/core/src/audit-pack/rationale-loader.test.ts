// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `src/lib/audit-pack/rationale-loader`.
 *
 * Covers the mapping from on-disk store shape to audit-pack render
 * shape, fail-soft on read errors, and skipped-entry handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../manifest/rationale-store', () => ({
  readRationale: vi.fn(),
}));

import { readRationale } from '../manifest/rationale-store';
import { tryLoadRationale } from './rationale-loader';

const mocked = readRationale as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocked.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tryLoadRationale', () => {
  it('returns undefined when the store is empty (so the section is omitted)', async () => {
    mocked.mockResolvedValueOnce([]);
    const result = await tryLoadRationale('cis-baseline');
    expect(result).toBeUndefined();
  });

  it('maps store fields to the audit-pack render shape', async () => {
    mocked.mockResolvedValueOnce([
      {
        ts: '2026-04-20T08:00:00.000Z',
        author: 'alice',
        resourceName: 'password-policy',
        oldValue: 14,
        newValue: 12,
        reason: 'Aligned with IT-issued laptop policy.',
      },
    ]);
    const result = await tryLoadRationale('cis-baseline');
    expect(result).toEqual([
      {
        timestamp: '2026-04-20T08:00:00.000Z',
        author: 'alice',
        resourceName: 'password-policy',
        reason: 'Aligned with IT-issued laptop policy.',
      },
    ]);
  });

  it('drops oldValue / newValue (rendered via history section, not rationale)', async () => {
    mocked.mockResolvedValueOnce([
      {
        ts: '2026-04-20T08:00:00.000Z',
        author: 'alice',
        resourceName: 'r',
        oldValue: { complex: 'object', nested: [1, 2, 3] },
        newValue: 'string',
        reason: 'because',
      },
    ]);
    const [entry] = (await tryLoadRationale('cis-baseline'))!;
    expect(entry).not.toHaveProperty('oldValue');
    expect(entry).not.toHaveProperty('newValue');
  });

  it('keeps skipped entries with a sentinel reason so auditors see them', async () => {
    mocked.mockResolvedValueOnce([
      {
        ts: '2026-04-20T08:00:00.000Z',
        author: 'alice',
        resourceName: 'audit-policy',
        oldValue: 'a',
        newValue: 'b',
        reason: '',
        skipped: true,
      },
    ]);
    const result = await tryLoadRationale('cis-baseline');
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      timestamp: '2026-04-20T08:00:00.000Z',
      reason: '(rationale skipped)',
    });
  });

  it('omits author / resourceName when the store entry has them empty', async () => {
    mocked.mockResolvedValueOnce([
      {
        ts: '2026-04-20T08:00:00.000Z',
        author: '',
        resourceName: '',
        oldValue: 0,
        newValue: 1,
        reason: 'some reason',
      },
    ]);
    const [entry] = (await tryLoadRationale('cis-baseline'))!;
    expect(entry).not.toHaveProperty('author');
    expect(entry).not.toHaveProperty('resourceName');
    expect(entry.reason).toBe('some reason');
  });

  it('falls soft to undefined when readRationale throws (never poisons the audit-pack)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.mockRejectedValueOnce(Object.assign(new Error('disk on fire'), { code: 'EIO' }));
    const result = await tryLoadRationale('cis-baseline');
    expect(result).toBeUndefined();
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('preserves chronological order from the store (oldest first)', async () => {
    mocked.mockResolvedValueOnce([
      { ts: '2026-04-18T08:00:00.000Z', author: 'a', resourceName: 'r', oldValue: 0, newValue: 1, reason: 'one' },
      { ts: '2026-04-20T08:00:00.000Z', author: 'b', resourceName: 'r', oldValue: 1, newValue: 2, reason: 'two' },
    ]);
    const result = await tryLoadRationale('cis-baseline');
    expect(result!.map((e) => e.timestamp)).toEqual([
      '2026-04-18T08:00:00.000Z',
      '2026-04-20T08:00:00.000Z',
    ]);
  });

  it('handles whitespace-only reason as empty (drops it; renders as "—" via the section fallback)', async () => {
    mocked.mockResolvedValueOnce([
      {
        ts: '2026-04-20T08:00:00.000Z',
        author: 'a',
        resourceName: 'r',
        oldValue: 0,
        newValue: 1,
        reason: '   \n  \t  ',
      },
    ]);
    const [entry] = (await tryLoadRationale('cis-baseline'))!;
    expect(entry.reason).toBe('');
  });
});
