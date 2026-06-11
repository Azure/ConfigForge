// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for `generateDocsFromContent`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../doc-generator', () => ({
  generateManifestDoc: vi.fn(),
}));

import { generateDocsFromContent } from './docs-write';
import * as docGen from '../doc-generator';

const generateMock = vi.mocked(docGen.generateManifestDoc);

beforeEach(() => {
  vi.clearAllMocks();
  generateMock.mockReturnValue('# Generated\n');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('generateDocsFromContent', () => {
  it('rejects missing body', () => {
    expect(() => generateDocsFromContent(undefined as never)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('rejects missing name', () => {
    expect(() => generateDocsFromContent({ name: '', content: 'x' })).toThrowError(
      expect.objectContaining({ status: 400, message: expect.stringMatching(/name/) }),
    );
  });

  it('rejects empty content', () => {
    expect(() => generateDocsFromContent({ name: 'x', content: '' })).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('returns markdown + filename derived from name', () => {
    const result = generateDocsFromContent({ name: 'mybase', content: 'resources: []' });
    expect(result.markdown).toBe('# Generated\n');
    expect(result.filename).toBe('mybase.md');
    expect(generateMock).toHaveBeenCalledWith('resources: []', 'mybase');
  });
});
