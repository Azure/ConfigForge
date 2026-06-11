// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { serializeProperties } from './exec';

describe('serializeProperties', () => {
  it('returns empty string for undefined', () => {
    expect(serializeProperties(undefined)).toBe('');
  });

  it('returns empty string for empty object', () => {
    expect(serializeProperties({})).toBe('');
  });

  it('serializes simple properties to JSON', () => {
    const result = serializeProperties({ keyPath: 'HKLM:\\Software', valueName: 'Version' });
    const parsed = JSON.parse(result);
    expect(parsed.keyPath).toBe('HKLM:\\Software');
    expect(parsed.valueName).toBe('Version');
  });

  it('preserves numeric values', () => {
    const result = serializeProperties({ value: 42, enabled: true });
    const parsed = JSON.parse(result);
    expect(parsed.value).toBe(42);
    expect(parsed.enabled).toBe(true);
  });

  it('handles nested objects', () => {
    const result = serializeProperties({ outer: { inner: 'deep' } });
    const parsed = JSON.parse(result);
    expect(parsed.outer.inner).toBe('deep');
  });

  it('produces valid JSON with backslashes in registry paths', () => {
    const result = serializeProperties({ keyPath: 'HKLM:\\Software\\MyApp\\Settings' });
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result).keyPath).toBe('HKLM:\\Software\\MyApp\\Settings');
  });
});
