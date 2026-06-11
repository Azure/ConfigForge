// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-006 — audit-pack Markdown injection regression tests.
 *
 * The audit pack is downloaded and shared with reviewers, so manifest /
 * history / rationale / provenance strings must not be able to alter
 * the document's structure. These tests run `buildAuditPackMarkdown`
 * with deliberately malicious values and assert that no injection
 * survives the escape layer.
 */
import { describe, expect, it } from 'vitest';
import { buildAuditPackMarkdown } from './markdown';
import type { AuditPackInput } from './index';

const FIXED_CLOCK = () => new Date('2026-04-21T12:34:56.000Z');

function baseInput(overrides: Partial<AuditPackInput> = {}): AuditPackInput {
  return {
    manifest: {
      namespace: 'cis-ws2025-baseline',
      displayName: 'Test baseline',
      platform: 'windows',
      registeredAt: '2026-04-15T08:00:00.000Z',
      source: 'user',
    },
    history: [],
    clock: FIXED_CLOCK,
    ...overrides,
  };
}

/**
 * Returns every "structural" line that appears in the rendered markdown
 * after section-heading line 1 (`# Audit Pack — …`). Used to assert
 * that no untrusted input is able to add unexpected headings or
 * top-level rows.
 */
function structuralLines(md: string): string[] {
  return md.split('\n').filter((l) => /^(#{1,6} |```|<|!\[|\|---)/.test(l));
}

describe('buildAuditPackMarkdown — injection regression', () => {
  it('a manifest displayName cannot inject a heading or HTML', () => {
    const md = buildAuditPackMarkdown(
      baseInput({
        manifest: {
          ...baseInput().manifest,
          displayName: '\n\n# evil heading\n<script>alert(1)</script>',
        },
      }),
    );

    // Newlines should be collapsed; no NEW heading line should have
    // been added past the legit document structure. The H1 title line
    // legitimately contains escaped `\#` and `\<` characters; we just
    // make sure no line is *only* the attacker payload.
    const headingLines = md.split('\n').filter((l) => /^#{1,6} /.test(l));
    const newAttackerHeadings = headingLines.filter(
      (h) => /^#{1,6}\s+#\s*evil heading\s*$/.test(h),
    );
    expect(newAttackerHeadings).toHaveLength(0);
    // No UNESCAPED `<script` anywhere outside an inline code span
    // (this displayName isn't rendered inside an inline code span).
    expect(/(^|[^\\])<script/.test(md)).toBe(false);
  });

  it('a rationale reason with newlines + fences + HTML stays inside the blockquote', () => {
    const md = buildAuditPackMarkdown(
      baseInput({
        rationale: [
          {
            timestamp: '2026-04-20T10:00:00.000Z',
            author: 'Test',
            reason:
              '```\n# evil heading\n<img src=x onerror=alert(1)>\n[link](https://evil.example)\n```',
          },
        ],
      }),
    );

    // The rationale lines are emitted with `> ` blockquote prefix.
    // None should contain UNESCAPED HTML or markdown link syntax.
    const rationaleLines = md.split('\n').filter((l) => l.startsWith('> '));
    expect(rationaleLines.length).toBeGreaterThan(0);
    for (const line of rationaleLines) {
      expect(/(^|[^\\])<img/.test(line)).toBe(false);
      expect(line).not.toMatch(/\]\(https:\/\/evil/);
      // No raw triple-backtick fence breaking out of the quote.
      expect(line).not.toMatch(/^>?\s*```\s*$/);
    }
  });

  it('a history row with pipes cannot break the version-history table', () => {
    const md = buildAuditPackMarkdown(
      baseInput({
        history: [
          {
            id: 'snap1',
            manifestName: 'cis-ws2025-baseline',
            timestamp: '2026-04-20T10:00:00.000Z',
            message: 'pretend | extra | columns | here',
            author: 'attacker | also extra',
            size: 100,
          },
        ],
      }),
    );

    // Find the history table row (starts with `| 2026-`)
    const rowLine = md.split('\n').find((l) => l.startsWith('| 2026-'));
    expect(rowLine).toBeDefined();
    // Number of UNESCAPED pipes determines the column count. For a
    // four-column table we expect exactly five pipes (`| a | b | c | d |`).
    const unescapedPipes = (rowLine!.match(/(^|[^\\])\|/g) ?? []).length;
    expect(unescapedPipes).toBe(5);
  });

  it('a malicious provenance URL falls back to escaped plain text', () => {
    const md = buildAuditPackMarkdown(
      baseInput({
        provenance: {
          sources: [
            {
              kind: 'CIS',
              label: 'looks legit',
              url: 'javascript:alert(1)',
              confidence: 0.9,
            },
            {
              kind: 'NIST',
              label: 'also legit',
              url: 'https://good.example/path<inject>',
              confidence: 0.8,
            },
          ],
          citationCoverage: 0.85,
        },
      }),
    );

    // No `<javascript:` autolink reaches the rendered markdown.
    expect(md).not.toMatch(/<javascript:/);
    // No autolink containing an angle bracket payload.
    expect(md).not.toMatch(/<https:\/\/good\.example\/path<inject>>/);
  });

  it('preserves the canonical document structure when input is malicious', () => {
    const md = buildAuditPackMarkdown(
      baseInput({
        manifest: {
          ...baseInput().manifest,
          displayName: '# fake\n| col | col |',
        },
        history: [
          {
            id: 'snap1',
            manifestName: 'cis-ws2025-baseline',
            timestamp: '2026-04-20T10:00:00.000Z',
            message: '|||',
            size: 100,
          },
        ],
        rationale: [
          {
            timestamp: '2026-04-20T10:00:00.000Z',
            reason: '# poisoned\n[click](evil)',
          },
        ],
      }),
    );

    const lines = structuralLines(md);
    // Required section markers still present, untouched by injection.
    expect(lines.some((l) => l.startsWith('# Audit Pack — '))).toBe(true);
    expect(lines.some((l) => l === '## Compliance')).toBe(true);
    expect(lines.some((l) => l === '## Version History')).toBe(true);
  });
});
