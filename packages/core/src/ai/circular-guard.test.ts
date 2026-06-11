// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, describe, expect, it } from 'vitest';
import {
  AI_GENERATED_MARKER,
  __resetAiGeneratedRegistryForTests,
  assertNotAiGenerated,
  isAiGenerated,
  stripAiMarker,
  tagAsAiGenerated,
} from './circular-guard';

describe('circular-guard', () => {
  afterEach(() => {
    __resetAiGeneratedRegistryForTests();
  });

  it('round-trips: tag → detect → strip', () => {
    const tagged = tagAsAiGenerated('Resources: []', 3);
    expect(tagged.startsWith('<!-- ai-generated:rev=3 -->')).toBe(true);
    expect(isAiGenerated(tagged)).toBe(true);
    expect(stripAiMarker(tagged)).toBe('Resources: []');
  });

  it('non-tagged content passes through', () => {
    const content = 'name: foo\nResources: []\n';
    expect(isAiGenerated(content)).toBe(false);
    expect(() => assertNotAiGenerated(content, 'test')).not.toThrow();
    expect(stripAiMarker(content)).toBe(content);
  });

  it('assertNotAiGenerated throws with a clear message on tagged content', () => {
    const tagged = tagAsAiGenerated('hello', 1);
    expect(() => assertNotAiGenerated(tagged, 'analyzeDiff:before')).toThrow(
      /AI-generated content/i
    );
    expect(() => assertNotAiGenerated(tagged, 'analyzeDiff:before')).toThrow(
      /analyzeDiff:before/
    );
  });

  it('partial document with marker embedded mid-content is still detected', () => {
    const content = [
      'name: foo',
      'description: |',
      `  ${AI_GENERATED_MARKER}5 -->`,
      '  some pasted-in AI content',
      'Resources: []',
    ].join('\n');
    expect(isAiGenerated(content)).toBe(true);
    expect(() => assertNotAiGenerated(content, 'middle')).toThrow();
  });

  it('tagAsAiGenerated is idempotent (replaces existing marker, no stacking)', () => {
    const once = tagAsAiGenerated('body', 1);
    const twice = tagAsAiGenerated(once, 2);
    // Only one marker line at the top, with the new rev.
    expect(twice.startsWith('<!-- ai-generated:rev=2 -->')).toBe(true);
    expect(twice.match(/ai-generated:rev=/g)).toHaveLength(1);
    expect(stripAiMarker(twice)).toBe('body');
  });

  it('stripAiMarker on empty / non-string is safe', () => {
    expect(stripAiMarker('')).toBe('');
    expect(isAiGenerated('')).toBe(false);
  });

  // CF-SEC-007 — spoof-resistance via per-process content-hash registry.
  it('detects AI content even after the marker is stripped within the same session', () => {
    // Attacker laundering scenario: tag content → strip marker → re-feed.
    const tagged = tagAsAiGenerated('# settings:\n  foo: 1\n', 7);
    const laundered = stripAiMarker(tagged);
    expect(laundered.includes(AI_GENERATED_MARKER)).toBe(false);
    // Marker-only inspection would say "not AI", but the registry catches it.
    expect(isAiGenerated(laundered)).toBe(true);
    expect(() => assertNotAiGenerated(laundered, 'launder-attempt')).toThrow(
      /AI-generated content/i,
    );
  });

  it('NFC normalisation matches content with equivalent unicode encodings', () => {
    // "café" composed (NFC: U+00E9) vs decomposed (NFD: U+0065 + U+0301).
    const nfc = 'caf\u00e9';
    const nfd = 'caf\u0065\u0301';
    // Sanity: the two strings have different bytes.
    expect(nfc).not.toBe(nfd);
    tagAsAiGenerated(nfc, 1);
    // The decomposed form (without a marker) should still be recognised
    // because the registry stores NFC-normalised hashes.
    expect(isAiGenerated(nfd)).toBe(true);
  });

  it('registry is process-local: empty after reset', () => {
    tagAsAiGenerated('x', 1);
    expect(isAiGenerated('x')).toBe(true);
    __resetAiGeneratedRegistryForTests();
    expect(isAiGenerated('x')).toBe(false);
  });

  it('marker-bearing content is still detected after a registry reset', () => {
    // The registry strengthens the check but is not a replacement for the
    // marker — content that still bears the marker must keep being flagged.
    const tagged = tagAsAiGenerated('payload', 9);
    __resetAiGeneratedRegistryForTests();
    expect(isAiGenerated(tagged)).toBe(true);
  });
});
