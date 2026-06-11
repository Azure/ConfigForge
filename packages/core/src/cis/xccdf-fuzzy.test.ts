// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Regression tests for fuzzy XCCDF title matching. The matcher
// previously used a bidirectional substring rule (`tw.includes(w) ||
// w.includes(tw)`) which let short generic tokens (e.g. "use", "and")
// fuse with longer unrelated title words ("useful", "sensitive"),
// inflating the ratio for completely wrong titles. v0.3.41 switches
// to exact-word matching with a 0.8 threshold (was 0.6 bidirectional
// substring) so the CIS Diff tab stops over-counting coverage.

import { describe, expect, it } from 'vitest';
import {
  fuzzyMatchXccdfTitle,
  bestFuzzyMatchXccdfTitle,
  splitPascalCase,
  type XccdfCatalog,
} from './xccdf-parser';

function makeCatalog(rules: Array<{ ruleId: string; title: string }>): XccdfCatalog {
  // Minimal mock — fuzzyMatchXccdfTitle only consumes rules + titleWordIndex.
  // Use splitPascalCase on the title to tokenize the same way the real
  // parser does (otherwise the test's word lists diverge from production).
  return {
    rules: rules.map((r) => ({
      ruleId: r.ruleId,
      title: r.title,
      description: '',
      severity: 'medium',
      fixtext: '',
      registryPaths: [],
      userRights: [],
    })),
    titleWordIndex: rules.map((r, ruleIdx) => ({
      ruleIdx,
      words: splitPascalCase(r.title.replace(/\s+/g, '')),
    })),
  } as unknown as XccdfCatalog;
}

describe('fuzzyMatchXccdfTitle — exact-word match (no substring)', () => {
  it('does NOT match unrelated longer title words via substring', () => {
    // Pre-fix: short tokens like "use" would substring-match "useful" in
    // titles. Post-fix exact-word: no match.
    const catalog = makeCatalog([
      { ruleId: 'R1', title: 'Useful diagnostic notes for administrators' },
    ]);
    const hit = fuzzyMatchXccdfTitle(catalog, 'Use', 0.8);
    expect(hit).toBeNull();
  });

  it('matches when whole tokens overlap exactly', () => {
    const catalog = makeCatalog([
      { ruleId: 'R1', title: 'DisableLocalSystemNullSessionFallback' },
    ]);
    const hit = fuzzyMatchXccdfTitle(catalog, 'DisableLocalSystemNullSessionFallback', 0.8);
    expect(hit?.ruleId).toBe('R1');
  });

  it('rejects matches below the 0.8 threshold (3/4 tokens = 0.75)', () => {
    // "Audit Other Account Events" vs title "Audit Other System Events":
    // tokens audit+other+events match (3/4 = 0.75), "account" misses.
    // Pre-v0.3.41 threshold 0.6 → false positive. New threshold 0.8 → null.
    const catalog = makeCatalog([
      { ruleId: 'R1', title: 'AuditOtherSystemEvents' },
    ]);
    const hit = fuzzyMatchXccdfTitle(catalog, 'AuditOtherAccountEvents', 0.8);
    expect(hit).toBeNull();
  });
});

describe('bestFuzzyMatchXccdfTitle — diagnostic variant', () => {
  it('returns best candidate with ratio even when below threshold', () => {
    const catalog = makeCatalog([
      { ruleId: 'R1', title: 'AuditOtherSystemEvents' },
    ]);
    const best = bestFuzzyMatchXccdfTitle(catalog, 'AuditOtherAccountEvents');
    expect(best?.rule.ruleId).toBe('R1');
    expect(best?.ratio).toBeCloseTo(0.75, 2);
  });
});

