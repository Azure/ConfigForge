// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-005 — `doc-generator` Markdown injection regression tests.
 *
 * Manifest-derived names, types, property keys/values, and dependencies
 * must not be able to alter the structure of the generated docs file
 * (which auditors/operators may share or treat as authoritative).
 */
import { describe, expect, it } from 'vitest';
import { generateManifestDoc } from './doc-generator';

function structuralLines(md: string): string[] {
  return md.split('\n').filter((l) => /^(#{1,6} |```|<|!\[)/.test(l));
}

describe('generateManifestDoc — injection regression', () => {
  it('a manifest name containing markdown cannot inject a heading', () => {
    const md = generateManifestDoc('resources: []', '\n\n# evil heading\n<script>x</script>');
    // No NEW heading line should appear. The legitimate top-of-file
    // heading is `# ` followed by the escaped name. The escaped form
    // contains `\#` and `\<`, which renderers display literally and
    // never interpret as either a heading or HTML.
    const lines = md.split('\n');
    const headingLines = lines.filter((l) => /^#{1,6} /.test(l));
    // We expect a single H1 (the doc title) plus the 3 H2 section
    // headers we emit (Summary, Resource Types, Resources). The
    // attacker must not have added a fourth/fifth H1/H2 line.
    expect(headingLines.length).toBeLessThanOrEqual(4);
    // Specifically: no heading line consists of `# evil heading`
    // (the attacker's payload) — only the title `# Audit Pack` /
    // `# <escaped name>` line should start with `# `.
    const newHeadings = headingLines.filter(
      (h) => /^#{1,6}\s+#\s*evil heading\s*$/.test(h),
    );
    expect(newHeadings).toHaveLength(0);
  });

  it('a resource name containing markdown is escaped', () => {
    const yaml = `resources:\n  - name: "# evil"\n    type: Microsoft.Windows/Registry\n`;
    const md = generateManifestDoc(yaml, 'test');
    const headings = md.split('\n').filter((l) => /^#{1,6} /.test(l));
    // No heading line contains the unescaped "# evil" text as its content.
    expect(headings.every((h) => !/^#{1,6} #{1,6} evil$/.test(h.trim()))).toBe(true);
  });

  it('a resource type with pipes cannot break the resource-types table', () => {
    const yaml = `resources:\n  - name: a\n    type: "X|injected|column"\n`;
    const md = generateManifestDoc(yaml, 'test');
    // Find the resource-types table row (starts with `| ` and contains backticked type).
    const tableSection = md.split('## Resource Types')[1] ?? '';
    const rowLine = tableSection
      .split('\n')
      .find((l) => l.startsWith('| `'));
    expect(rowLine).toBeDefined();
    // Inside an inline-code span the pipe doesn't break the table, but
    // the platform-label cell uses escMdCell; assert no extra unescaped
    // pipes appear in the OUTSIDE-code part of the row.
    const outsideCode = rowLine!.replace(/`[^`]*`/g, '');
    const unescapedPipes = (outsideCode.match(/(^|[^\\])\|/g) ?? []).length;
    // For a two-column table: `| ... | ... |` → 3 pipes
    expect(unescapedPipes).toBe(3);
  });

  it('a property key/value with markdown cannot inject blocks', () => {
    const yaml = `resources:\n  - name: r\n    type: Microsoft.Windows/Registry\n    properties:\n      "# evil": "[click](https://evil.example)"\n`;
    const md = generateManifestDoc(yaml, 'test');
    // No real markdown link reaching the rendered output
    expect(md).not.toMatch(/\[click\]\(https:\/\/evil/);
    // No leading-# heading line containing the attacker key text
    const headings = md.split('\n').filter((l) => /^#{1,6} /.test(l));
    expect(headings.every((h) => !/^#{1,6} evil$/.test(h.trim()))).toBe(true);
  });

  it('a dependsOn entry with HTML / markdown is escaped', () => {
    const yaml = `resources:\n  - name: a\n    type: Microsoft.Windows/Registry\n    dependsOn:\n      - "<script>alert(1)</script>"\n`;
    const md = generateManifestDoc(yaml, 'test');
    // Any `<script` must be backslash-escaped.
    expect(/(^|[^\\])<script/.test(md)).toBe(false);
  });

  it('preserves canonical section structure under malicious input', () => {
    const yaml = `resources:\n  - name: "# evil"\n    type: "Microsoft.Windows/Registry"\n    properties:\n      a: "| extra | column"\n    dependsOn: "## fake heading"\n`;
    const md = generateManifestDoc(yaml, 'name with \\| pipe and # hash');
    const lines = structuralLines(md);
    expect(lines.some((l) => /^# /.test(l))).toBe(true);
    expect(lines.some((l) => l === '## Summary')).toBe(true);
    expect(lines.some((l) => l === '## Resource Types')).toBe(true);
    expect(lines.some((l) => l === '## Resources')).toBe(true);
  });
});
