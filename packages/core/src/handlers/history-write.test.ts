// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `saveHistorySnapshot` and `deleteHistorySnapshot`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../history', () => ({
  saveSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
}));

import { saveHistorySnapshot, deleteHistorySnapshot } from './history-write';
import * as history from '../history';

const saveSnapshotMock = vi.mocked(history.saveSnapshot);
const deleteSnapshotMock = vi.mocked(history.deleteSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('saveHistorySnapshot', () => {
  it('rejects non-object payload', async () => {
    await expect(saveHistorySnapshot('nope' as never)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects missing name', async () => {
    await expect(
      saveHistorySnapshot({ name: '', content: 'x' }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/name/) });
  });

  it('rejects non-string content', async () => {
    await expect(
      saveHistorySnapshot({ name: 'x', content: 42 as never }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/content/),
    });
  });

  it('rejects non-string message when provided', async () => {
    await expect(
      saveHistorySnapshot({
        name: 'x',
        content: 'y',
        message: 42 as never,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('passes through to saveSnapshot and wraps result in { data }', async () => {
    saveSnapshotMock.mockResolvedValueOnce({
      id: 'abc',
      manifestName: 'x',
      content: 'y',
      timestamp: '2026-01-01',
      message: 'auto',
      author: 'tester',
    } as never);

    const result = await saveHistorySnapshot({ name: 'x', content: 'y', message: 'auto' });

    expect(saveSnapshotMock).toHaveBeenCalledWith('x', 'y', 'auto');
    expect(result.data.id).toBe('abc');
  });

  it('surfaces "Invalid manifest name" as 400', async () => {
    saveSnapshotMock.mockRejectedValueOnce(new Error('Invalid manifest name: <bad>'));
    await expect(
      saveHistorySnapshot({ name: 'bad', content: 'y' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('surfaces "Path traversal blocked" as 400', async () => {
    saveSnapshotMock.mockRejectedValueOnce(new Error('Path traversal blocked'));
    await expect(
      saveHistorySnapshot({ name: '..', content: 'y' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lets unknown errors bubble (caller wraps as 500)', async () => {
    saveSnapshotMock.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      saveHistorySnapshot({ name: 'x', content: 'y' }),
    ).rejects.toThrow('disk full');
  });
});

describe('deleteHistorySnapshot', () => {
  it('rejects missing name', async () => {
    await expect(
      deleteHistorySnapshot({ name: '', id: 'abc' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects missing id', async () => {
    await expect(
      deleteHistorySnapshot({ name: 'x', id: '' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns confirmation message on success', async () => {
    deleteSnapshotMock.mockResolvedValueOnce(undefined as never);
    const result = await deleteHistorySnapshot({ name: 'x', id: 'abc' });
    expect(result.message).toMatch(/'abc' deleted/);
  });

  it('surfaces "Invalid snapshot id" as 400', async () => {
    deleteSnapshotMock.mockRejectedValueOnce(new Error('Invalid snapshot id: ##'));
    await expect(
      deleteHistorySnapshot({ name: 'x', id: '##' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
