// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * CF-SEC-005 / CF-SEC-006 — markdown escape regression tests.
 *
 * These exist to catch any regression that would re-open the audit-pack
 * / doc-generator injection surface. We assert on the SHAPE of the
 * output (no surviving headings, links, images, autolinks, HTML, or
 * unintended table columns), not on the exact escape sequence — so a
 * future tweak to the helpers that's still safe doesn't break tests.
 */
import { describe, expect, it } from 'vitest';
import {
  escMdInline,
  escMdCell,
  escInlineCode,
  safeAutoLink,
} from './escape';

describe('escMdInline', () => {
  it('returns empty string for null / undefined', () => {
    expect(escMdInline(null)).toBe('');
    expect(escMdInline(undefined)).toBe('');
  });

  it('passes through plain ASCII letters and digits', () => {
    expect(escMdInline('Hello World 2026')).toBe('Hello World 2026');
  });

  it('escapes heading markers so untrusted text cannot inject a section', () => {
    const out = escMdInline('# Looks legit');
    // The literal `#` at start would otherwise render as a heading
    expect(out.startsWith('#')).toBe(false);
    expect(out).toContain('\\#');
  });

  it('escapes link/image syntax so untrusted text cannot inject a link', () => {
    const out = escMdInline('Click [here](https://evil.example/x)');
    expect(out).not.toMatch(/\[here\]\(/);
    expect(out).toContain('\\[');
    expect(out).toContain('\\]');
    expect(out).toContain('\\(');
    expect(out).toContain('\\)');
  });

  it('escapes image syntax', () => {
    const out = escMdInline('![oops](data:image/png;base64,xyz)');
    expect(out).toContain('\\!');
    expect(out).toContain('\\[');
  });

  it('escapes inline HTML so autolinks and tags cannot be smuggled', () => {
    const out = escMdInline('<script>alert(1)</script>');
    // Unescaped `<` is gone; only `\<` survives.
    expect(/(^|[^\\])</.test(out)).toBe(false);
    expect(out).toContain('\\<');
    expect(out).toContain('\\>');
  });

  it('escapes pipes so multi-line table-cell injection is prevented', () => {
    const out = escMdInline('a | b | c');
    expect(out).not.toMatch(/[^\\]\|/);
    expect(out).toContain('\\|');
  });

  it('collapses newlines into single spaces so block breaks cannot escape inline context', () => {
    const out = escMdInline('first\n# heading\nthird');
    expect(out.includes('\n')).toBe(false);
    expect(out).toContain('\\#');
  });

  it('strips control characters', () => {
    const out = escMdInline('hello\u0001world\u0007!');
    // Loose check: no control bytes survive
    expect(/[\x00-\x08\x0b-\x1f\x7f]/.test(out)).toBe(false);
    // The exclamation is escaped because `!` is markdown-significant.
    expect(out).toBe('helloworld\\!');
  });

  it('escapes backticks so untrusted text cannot break out of a code span', () => {
    const out = escMdInline('`code` then text');
    expect(out).toContain('\\`');
  });

  it('escapes emphasis markers (asterisk + underscore)', () => {
    const out = escMdInline('*bold* _italic_');
    expect(out).toContain('\\*');
    expect(out).toContain('\\_');
  });
});

describe('escMdCell', () => {
  it('matches escMdInline for non-pipe content', () => {
    expect(escMdCell('hello')).toBe(escMdInline('hello'));
  });

  it('escapes pipe so a malicious cell value cannot add columns', () => {
    const out = escMdCell('A | hidden | column');
    // pipes are escaped
    expect(out.match(/[^\\]\|/)).toBeNull();
  });
});

describe('escInlineCode', () => {
  it('returns empty string for null / undefined', () => {
    expect(escInlineCode(null)).toBe('');
    expect(escInlineCode(undefined)).toBe('');
  });

  it('strips control chars', () => {
    expect(/[\x00-\x08\x0b-\x1f\x7f]/.test(escInlineCode('a\u0000b'))).toBe(false);
  });

  it('neutralises backticks so input cannot close the code span', () => {
    const out = escInlineCode('a`b`c');
    expect(out.includes('`')).toBe(false);
  });

  it('leaves ordinary punctuation alone inside a code span', () => {
    // CommonMark renders everything else literally inside `…`.
    expect(escInlineCode('foo/bar.baz')).toBe('foo/bar.baz');
  });

  it('collapses newlines so a multi-line value cannot break out of the code span', () => {
    const out = escInlineCode('first\n# heading\nthird');
    expect(out.includes('\n')).toBe(false);
  });
});

describe('safeAutoLink', () => {
  it('returns null when no URL is provided', () => {
    expect(safeAutoLink(undefined)).toBeNull();
    expect(safeAutoLink('')).toBeNull();
  });

  it('emits an autolink for valid http/https URLs', () => {
    expect(safeAutoLink('https://example.com/path')).toBe('<https://example.com/path>');
    expect(safeAutoLink('http://example.com')).toBe('<http://example.com/>');
  });

  it('rejects javascript: and other unsupported schemes', () => {
    const out = safeAutoLink('javascript:alert(1)');
    expect(out).not.toMatch(/^</);
    // Falls back to escaped plain text
    expect(out).not.toContain('javascript:alert(1)');
  });

  it('rejects file:// scheme', () => {
    const out = safeAutoLink('file:///etc/passwd');
    expect(out).not.toMatch(/^</);
  });

  it('rejects URLs with embedded whitespace or angle brackets', () => {
    expect(safeAutoLink('https://evil.example/<inject>')).not.toMatch(/^</);
    expect(safeAutoLink('https://evil.example/\nfoo')).not.toMatch(/^</);
  });

  it('returns escaped plain text when URL parsing fails', () => {
    const out = safeAutoLink('not a url');
    expect(out).not.toMatch(/^</);
  });
});

describe('regression — full audit-pack injection scenarios', () => {
  it('a manifest displayName containing markdown cannot inject a heading', () => {
    // Caller would write: out.push(`# Audit Pack — ${escMdInline(name)}`);
    const name = '\n\n# I am a fake heading\n';
    const rendered = `# Audit Pack — ${escMdInline(name)}`;
    expect(rendered.split('\n').length).toBe(1);
    expect(rendered).toContain('\\#');
  });

  it('a rationale reason cannot inject a fenced code block or HTML', () => {
    // Caller would write: out.push(`> ${escMdInline(line)}`);
    const reason = '```\n# evil\n<img src=x>\n```';
    // Even after the caller splits on \n, each line is escaped:
    for (const line of reason.split('\n')) {
      const rendered = `> ${escMdInline(line)}`;
      // No raw backticks that could close a fence
      expect(/[^\\]`/.test(rendered)).toBe(false);
      // No raw HTML
      expect(/[^\\]</.test(rendered)).toBe(false);
    }
  });

  it('a malicious provenance URL cannot escape the autolink', () => {
    const link = safeAutoLink('https://good.example/x>evil');
    expect(link).not.toMatch(/^<.*>.*>/);
  });
});
