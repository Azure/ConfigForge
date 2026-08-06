// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../oscfg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oscfg')>();
  return {
    ...actual,
    getRegistrationSource: vi.fn(),
    sanitizeNamespace: vi.fn((name: string) => name.toLowerCase()),
  };
});

import { getRegistrationSource } from '../oscfg';
import { getDiffMatrix } from './diff-matrix';

const getRegistrationSourceMock = vi.mocked(getRegistrationSource);

describe('getDiffMatrix lossless values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not collapse adjacent unsafe QWord values', async () => {
    getRegistrationSourceMock.mockImplementation(async (name) => `resources:
  - name: ExactQword
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\SOFTWARE\\Example
      valueName: Exact
      valueType: REG_QWORD
      value: ${name === 'first' ? '18446744073709551615' : '18446744073709551614'}
`);

    const result = await getDiffMatrix('first,second');

    expect(result.stats).toMatchObject({
      identical: 0,
      differs: 1,
      totalRows: 1,
    });
  });
});
