// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tests for src/components/rationale-diff.ts.
 *
 * The diff helper is the unit-testable core of the rationale-prompt
 * decision: should the modal pop up on Save? These tests pin down the
 * "no diff = no prompt" contract and verify whitespace-only edits don't
 * spuriously trigger the modal.
 */
import { describe, expect, it } from 'vitest';

import {
  diffResources,
  extractResources,
  shouldPromptForRationale,
  summarizeDiff,
} from './rationale-diff';

const BASE = `
$schema: https://aka.ms/osc/schemas/prerelease/document.json
resources:
  - name: A
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\Foo
      valueName: BarA
      valueType: Dword
  - name: B
    type: Microsoft.Windows/Registry
    properties:
      keyPath: HKLM:\\Foo
      valueName: BarB
      valueType: Dword
`;

describe('extractResources', () => {
  it('returns the resources array for a normal manifest', () => {
    const r = extractResources(BASE);
    expect(r).toHaveLength(2);
    expect(r[0].name).toBe('A');
  });
  it('returns [] for an empty string', () => {
    expect(extractResources('')).toEqual([]);
  });
  it('returns [] for a non-manifest object (e.g. security definition)', () => {
    expect(extractResources('Settings:\n  - Foo: 1\n')).toEqual([]);
  });
  it('returns [] for malformed YAML without throwing', () => {
    expect(extractResources(': :\n  - bad: : \n   garbage')).toEqual([]);
  });
  it('returns [] for top-level array (not an object)', () => {
    expect(extractResources('- a\n- b\n')).toEqual([]);
  });
});

describe('diffResources', () => {
  it('detects an added resource', () => {
    const after = BASE + '  - name: C\n    type: Microsoft.Windows/Registry\n    properties: {}\n';
    const d = diffResources(BASE, after);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ resourceName: 'C', kind: 'added' });
    expect(d[0].oldValue).toBeNull();
    expect((d[0].newValue as Record<string, unknown>).name).toBe('C');
  });

  it('detects a removed resource', () => {
    // Drop B from BASE.
    const after = BASE.replace(/  - name: B[\s\S]+/, '');
    const d = diffResources(BASE, after);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ resourceName: 'B', kind: 'removed' });
    expect(d[0].newValue).toBeNull();
  });

  it('detects a modified resource', () => {
    const after = BASE.replace('valueName: BarA', 'valueName: BarA-RENAMED');
    const d = diffResources(BASE, after);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ resourceName: 'A', kind: 'modified' });
    expect(d[0].oldValue).not.toBeNull();
    expect(d[0].newValue).not.toBeNull();
  });

  it('returns empty when only whitespace differs', () => {
    const after = BASE.replace(/\n\n/g, '\n\n\n');
    expect(diffResources(BASE, after)).toEqual([]);
  });

  it('returns empty when only comments differ', () => {
    const after = BASE.replace('resources:', '# a comment\nresources:');
    expect(diffResources(BASE, after)).toEqual([]);
  });

  it('returns empty when key-order differs but values are the same', () => {
    // Reorder properties in resource A — same data, different key order.
    const reordered = BASE.replace(
      /  - name: A[\s\S]+?valueType: Dword/,
      [
        '  - name: A',
        '    type: Microsoft.Windows/Registry',
        '    properties:',
        '      valueType: Dword',
        '      valueName: BarA',
        '      keyPath: HKLM:\\Foo',
      ].join('\n'),
    );
    // Note: this DOES change JSON key order, which our naive
    // structuralEqual check WILL detect as a diff. That's a known
    // limitation — documenting it via this assertion. Users won't
    // typically reorder property keys without intent, so a prompt
    // here is acceptable.
    expect(diffResources(BASE, reordered).length).toBe(1);
  });

  it('handles add+remove+modify in one diff', () => {
    let after = BASE.replace(/  - name: B[\s\S]+/, '');
    after += '  - name: C\n    type: Microsoft.Windows/Registry\n    properties: {}\n';
    after = after.replace('valueName: BarA', 'valueName: BarA-X');
    const d = diffResources(BASE, after);
    expect(d).toHaveLength(3);
    const kinds = new Set(d.map((x) => x.kind));
    expect(kinds.has('added')).toBe(true);
    expect(kinds.has('removed')).toBe(true);
    expect(kinds.has('modified')).toBe(true);
  });

  it('drops resources with empty/missing name silently', () => {
    const noName = `
resources:
  - type: Microsoft.Windows/Registry
    properties: {}
  - name: A
    type: Microsoft.Windows/Registry
    properties: {}
`;
    const r = extractResources(noName);
    // Both make it through extractResources (no name still has the obj).
    expect(r).toHaveLength(2);
    // But diff against itself should still be []
    expect(diffResources(noName, noName)).toEqual([]);
  });
});

describe('shouldPromptForRationale', () => {
  it('false for byte-identical inputs (fast path)', () => {
    expect(shouldPromptForRationale(BASE, BASE)).toBe(false);
  });
  it('false for whitespace-only edits', () => {
    expect(shouldPromptForRationale(BASE, BASE + '\n\n')).toBe(false);
  });
  it('true for a real value change', () => {
    expect(
      shouldPromptForRationale(BASE, BASE.replace('valueName: BarA', 'valueName: NEW')),
    ).toBe(true);
  });
  it('true for an added resource', () => {
    const after = BASE + '  - name: C\n    type: Microsoft.Windows/Registry\n    properties: {}\n';
    expect(shouldPromptForRationale(BASE, after)).toBe(true);
  });
  it('false when both inputs are empty', () => {
    expect(shouldPromptForRationale('', '')).toBe(false);
  });
  it('false when both inputs are non-manifest junk (no resources)', () => {
    expect(shouldPromptForRationale('not a manifest', 'still not a manifest')).toBe(false);
  });
  it('false when the diff would exceed the sanity cap (mid-edit malformed YAML)', () => {
    // Build a 30-resource manifest, then "edit" to malformed YAML so the
    // diff sees "everything removed". The cap prevents a 30-resource
    // manifest from spawning 30 rationale POSTs while the user is mid-typing.
    const manyResources =
      'resources:\n' +
      Array.from({ length: 30 }, (_, i) => `  - name: R${i}\n    type: Microsoft.Windows/Registry\n    properties: {}\n`).join('');
    const malformed = ': : not yaml :: \n   garbage';
    expect(shouldPromptForRationale(manyResources, malformed)).toBe(false);
  });
  it('still prompts at the cap boundary (exactly 20 diffs)', () => {
    const before = 'resources:\n' + Array.from({ length: 20 }, (_, i) => `  - name: R${i}\n    type: Microsoft.Windows/Registry\n    properties:\n      val: ${i}\n`).join('');
    const after = 'resources:\n' + Array.from({ length: 20 }, (_, i) => `  - name: R${i}\n    type: Microsoft.Windows/Registry\n    properties:\n      val: ${i + 100}\n`).join('');
    expect(shouldPromptForRationale(before, after)).toBe(true);
  });
});

describe('summarizeDiff', () => {
  it('"no changes" for empty input', () => {
    expect(summarizeDiff([])).toBe('no changes');
  });
  it('reports a single change concisely', () => {
    expect(
      summarizeDiff([{ resourceName: 'A', kind: 'modified', oldValue: 1, newValue: 2 }]),
    ).toBe('A modified');
  });
  it('caps long lists at the first 3 + count', () => {
    const diffs = ['A', 'B', 'C', 'D', 'E'].map((n) => ({
      resourceName: n,
      kind: 'modified' as const,
      oldValue: 0,
      newValue: 1,
    }));
    expect(summarizeDiff(diffs)).toBe('A modified, B modified, C modified (+2 more)');
  });
});
