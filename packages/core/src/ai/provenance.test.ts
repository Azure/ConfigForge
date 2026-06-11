// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import {
  type AiSource,
  computeCitationCoverage,
  decorateWithProvenance,
  dedupeSources,
  normalizeUrl,
} from './provenance';

describe('normalizeUrl', () => {
  it('lowercases the host', () => {
    expect(normalizeUrl('https://Learn.MICROSOFT.com/en-us/x')).toBe(
      'https://learn.microsoft.com/en-us/x'
    );
  });

  it('strips the fragment', () => {
    expect(normalizeUrl('https://example.com/p#frag')).toBe(
      'https://example.com/p'
    );
  });

  it('strips utm_* tracking params but keeps others', () => {
    expect(
      normalizeUrl(
        'https://example.com/p?utm_source=x&utm_medium=y&id=42&fbclid=abc'
      )
    ).toBe('https://example.com/p?id=42');
  });

  it('returns the input unchanged when it is not a URL', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
    expect(normalizeUrl('')).toBe('');
  });
});

describe('dedupeSources', () => {
  it('drops duplicates by kind+label+url', () => {
    const sources: AiSource[] = [
      { kind: 'CIS', label: 'CIS WS2025 1.1.1', url: 'https://cis/x', confidence: 0.7 },
      { kind: 'CIS', label: 'CIS WS2025 1.1.1', url: 'https://cis/x', confidence: 0.9 },
      { kind: 'NIST', label: 'NIST 800-53 AC-1', confidence: 0.6 },
    ];
    const out = dedupeSources(sources);
    expect(out).toHaveLength(2);
    // Keeps the higher-confidence variant
    const cis = out.find((s) => s.kind === 'CIS');
    expect(cis?.confidence).toBe(0.9);
  });

  it('treats different URLs as different sources', () => {
    const out = dedupeSources([
      { kind: 'MSDocs', label: 'doc', url: 'https://a.example/x', confidence: 0.5 },
      { kind: 'MSDocs', label: 'doc', url: 'https://b.example/x', confidence: 0.5 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('treats utm-only URL differences as duplicates', () => {
    const out = dedupeSources([
      { kind: 'MSDocs', label: 'doc', url: 'https://example.com/p', confidence: 0.5 },
      { kind: 'MSDocs', label: 'doc', url: 'https://example.com/p?utm_source=x', confidence: 0.5 },
    ]);
    expect(out).toHaveLength(1);
  });

  it('clamps confidence to 0..1', () => {
    const out = dedupeSources([
      { kind: 'CIS', label: 'a', confidence: 1.7 },
      { kind: 'NIST', label: 'b', confidence: -0.4 },
    ]);
    expect(out.find((s) => s.kind === 'CIS')!.confidence).toBe(1);
    expect(out.find((s) => s.kind === 'NIST')!.confidence).toBe(0);
  });
});

describe('computeCitationCoverage', () => {
  it('is 0 when there are no sources', () => {
    expect(computeCitationCoverage([])).toBe(0);
  });

  it('is the mean of confidences when there are sources', () => {
    expect(
      computeCitationCoverage([
        { kind: 'CIS', label: 'a', confidence: 0.8 },
        { kind: 'NIST', label: 'b', confidence: 0.4 },
      ])
    ).toBeCloseTo(0.6);
  });
});

describe('decorateWithProvenance', () => {
  it('adds a provenance field with deduped sources', () => {
    const response = { summary: 'hi' };
    const decorated = decorateWithProvenance(response, [
      { kind: 'CIS', label: 'x', confidence: 0.5 },
      { kind: 'CIS', label: 'x', confidence: 0.5 },
    ]);
    expect(decorated.summary).toBe('hi');
    expect(decorated.provenance.sources).toHaveLength(1);
    expect(decorated.provenance.citationCoverage).toBeGreaterThan(0);
  });

  it('merges with existing provenance instead of overwriting', () => {
    const seeded = decorateWithProvenance(
      { summary: 'hi' },
      [{ kind: 'CIS', label: 'a', confidence: 0.7 }]
    );
    const merged = decorateWithProvenance(seeded, [
      { kind: 'NIST', label: 'b', confidence: 0.5 },
    ]);
    expect(merged.provenance.sources).toHaveLength(2);
  });

  it('produces 0 citationCoverage when sources is empty', () => {
    const decorated = decorateWithProvenance({ x: 1 }, []);
    expect(decorated.provenance.citationCoverage).toBe(0);
    expect(decorated.provenance.sources).toEqual([]);
  });
});
