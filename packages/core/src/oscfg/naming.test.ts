// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { sanitizeNamespace, isValidNamespace } from './naming';

describe('sanitizeNamespace', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeNamespace('')).toBe('');
  });

  it('passes through a clean slug unchanged', () => {
    expect(sanitizeNamespace('WS2025-MemberServer')).toBe('WS2025-MemberServer');
  });

  it('replaces spaces and special characters with hyphens', () => {
    expect(sanitizeNamespace('WS2025 Member Server')).toBe('WS2025-Member-Server');
  });

  it('replaces consecutive invalid chars with a single hyphen', () => {
    expect(sanitizeNamespace('my!!!manifest')).toBe('my-manifest');
  });

  it('strips leading and trailing hyphens after replacement', () => {
    expect(sanitizeNamespace('  !!hello!!  ')).toBe('hello');
  });

  it('preserves dots and underscores', () => {
    expect(sanitizeNamespace('baseline.v2_draft')).toBe('baseline.v2_draft');
  });

  it('truncates to 96 characters', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeNamespace(long).length).toBeLessThanOrEqual(96);
  });

  it('trims whitespace before processing', () => {
    expect(sanitizeNamespace('  hello  ')).toBe('hello');
  });
});

describe('isValidNamespace', () => {
  it('rejects empty string', () => {
    expect(isValidNamespace('')).toBe(false);
  });

  it('accepts a clean slug', () => {
    expect(isValidNamespace('WS2025-MemberServer')).toBe(true);
  });

  it('accepts dots and underscores', () => {
    expect(isValidNamespace('baseline.v2_draft')).toBe(true);
  });

  it('rejects spaces', () => {
    expect(isValidNamespace('has space')).toBe(false);
  });

  it('rejects strings longer than 96 characters', () => {
    expect(isValidNamespace('a'.repeat(97))).toBe(false);
  });

  it('accepts exactly 96 characters', () => {
    expect(isValidNamespace('a'.repeat(96))).toBe(true);
  });

  // CF-SEC: path traversal hardening
  it('rejects bare-dot directories', () => {
    expect(isValidNamespace('.')).toBe(false);
    expect(isValidNamespace('..')).toBe(false);
  });

  it('rejects path traversal sequences embedded in the name', () => {
    expect(isValidNamespace('foo..bar')).toBe(false);
    expect(isValidNamespace('..baseline')).toBe(false);
    expect(isValidNamespace('baseline..')).toBe(false);
  });
});
