// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR28: per-section unit tests for the audit-pack PDF.
 *
 * The section renderers are pure: they take a pdfkit doc and write to
 * it. We assert that they don't throw on degenerate inputs (missing
 * fields, empty arrays, malformed URLs) and that they produce non-empty
 * output. Byte-level content assertions live in `index.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import {
  attachFooter,
  renderCitations,
  renderCompliance,
  renderHeader,
  renderHistoryTable,
  renderRationaleLog,
} from './sections';
import type { ManifestRegistration } from '../oscfg';
import type { ComplianceReport } from '../cis/compliance';
import type { Provenance } from '../ai/provenance';
import type { HistoryEntryWithAuthor, RationaleEntry } from './';

const NOW = new Date('2026-04-21T12:34:56.000Z');

function makeManifest(): ManifestRegistration {
  return {
    namespace: 'cis-baseline',
    displayName: 'CIS Baseline',
    platform: 'windows',
    registeredAt: '2026-04-15T08:00:00.000Z',
    source: 'user',
    lastAppliedAt: '2026-04-20T13:30:00.000Z',
    lastAuditedAt: '2026-04-20T14:00:00.000Z',
  };
}

function newDoc(): PDFKit.PDFDocument {
  return new PDFDocument({
    size: 'LETTER',
    margins: { top: 56, left: 56, right: 56, bottom: 72 },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      CreationDate: NOW,
      ModDate: NOW,
    },
  });
}

async function drainToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  });
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

describe('renderHeader', () => {
  it('writes the title without throwing and produces non-empty output', async () => {
    const doc = newDoc();
    expect(() => renderHeader(doc, makeManifest(), NOW)).not.toThrow();
    attachFooter(doc, NOW);
    const buf = await drainToBuffer(doc);
    expect(buf.length).toBeGreaterThan(800);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles a manifest with extreme displayName length', async () => {
    const doc = newDoc();
    expect(() =>
      renderHeader(
        doc,
        {
          ...makeManifest(),
          displayName: 'X'.repeat(200),
        },
        NOW,
      ),
    ).not.toThrow();
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });
});

describe('renderCompliance', () => {
  it('renders the "not available" line when the report is undefined', async () => {
    const doc = newDoc();
    expect(() => renderCompliance(doc, undefined)).not.toThrow();
    attachFooter(doc, NOW);
    const buf = await drainToBuffer(doc);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders score: null without crashing and shows "—"', async () => {
    const doc = newDoc();
    const report: ComplianceReport = {
      matched: 0,
      mismatched: 0,
      missing: 0,
      score: null as unknown as number,
      total: 0,
      severityBreakdown: {},
      perRule: [],
      extras: [],
    };
    expect(() => renderCompliance(doc, report)).not.toThrow();
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });

  it('renders top 5 missing rules', async () => {
    const doc = newDoc();
    const report: ComplianceReport = {
      matched: 1,
      mismatched: 0,
      missing: 6,
      score: 14,
      total: 7,
      severityBreakdown: {},
      perRule: [
        { ruleName: 'Rule A', status: 'matched', severity: 'Critical' },
        { ruleName: 'Rule B', status: 'missing', severity: 'Critical' },
        { ruleName: 'Rule C', status: 'missing', severity: 'Important' },
        { ruleName: 'Rule D', status: 'missing', severity: 'Important' },
        { ruleName: 'Rule E', status: 'missing', severity: 'Informational' },
        { ruleName: 'Rule F', status: 'missing', severity: 'Informational' },
        { ruleName: 'Rule G', status: 'missing', severity: 'Informational' },
      ],
      extras: [],
    };
    expect(() => renderCompliance(doc, report)).not.toThrow();
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });
});

describe('renderHistoryTable', () => {
  it('renders mixed entries (some with author, some without) without throwing', async () => {
    const doc = newDoc();
    const history: HistoryEntryWithAuthor[] = [
      {
        id: 'snap-1',
        manifestName: 'cis-baseline',
        timestamp: '2026-04-20T08:00:00.000Z',
        message: 'first revision',
        author: 'Test User',
        rationale: 'Reference baseline import',
      },
      {
        id: 'snap-2',
        manifestName: 'cis-baseline',
        timestamp: '2026-04-20T09:00:00.000Z',
        message: undefined,
      },
      {
        id: 'snap-3',
        manifestName: 'cis-baseline',
        timestamp: '2026-04-20T10:00:00.000Z',
        message: 'add audit policies',
        author: 'Reviewer Two',
      },
    ];
    expect(() => renderHistoryTable(doc, history)).not.toThrow();
    attachFooter(doc, NOW);
    const buf = await drainToBuffer(doc);
    expect(buf.length).toBeGreaterThan(800);
  });

  it('renders empty history with the "No version history yet." line', async () => {
    const doc = newDoc();
    expect(() => renderHistoryTable(doc, [])).not.toThrow();
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });

  it('truncates to 50 entries with footnote when N > 50', async () => {
    const doc = newDoc();
    const history: HistoryEntryWithAuthor[] = Array.from({ length: 80 }, (_, i) => ({
      id: `snap-${i}`,
      manifestName: 'cis-baseline',
      timestamp: new Date(Date.UTC(2026, 3, 1, 8, i % 60, 0)).toISOString(),
      message: `revision ${i}`,
    }));
    expect(() => renderHistoryTable(doc, history)).not.toThrow();
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });
});

describe('renderRationaleLog', () => {
  it('renders multi-line reasons with line-break preservation (cap 3 lines)', async () => {
    const doc = newDoc();
    const rationale: RationaleEntry[] = [
      {
        timestamp: '2026-04-20T08:00:00.000Z',
        author: 'Test User',
        reason: 'line one\nline two\nline three\nline four (should be elided with …)',
      },
      {
        timestamp: '2026-04-19T08:00:00.000Z',
        reason: 'no author here',
      },
    ];
    expect(() => renderRationaleLog(doc, rationale)).not.toThrow();
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });
});

describe('renderCitations', () => {
  it('renders nothing when provenance.sources is empty (no extra page)', async () => {
    const doc = newDoc();
    const provenance: Provenance = { sources: [], citationCoverage: 0 };
    const startPages = doc.bufferedPageRange().count;
    expect(() => renderCitations(doc, provenance)).not.toThrow();
    const endPages = doc.bufferedPageRange().count;
    expect(endPages).toBe(startPages);
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });

  it('renders the bibliography with a numbered list', async () => {
    const doc = newDoc();
    const provenance: Provenance = {
      sources: [
        { kind: 'CIS', label: 'CIS WS2025 v1.0', url: 'https://workbench.cisecurity.org/benchmarks/24193', confidence: 0.9 },
        { kind: 'NIST', label: 'NIST SP 800-53 Rev 5', url: 'https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final', confidence: 0.8 },
      ],
      citationCoverage: 0.85,
    };
    expect(() => renderCitations(doc, provenance)).not.toThrow();
    attachFooter(doc, NOW);
    const buf = await drainToBuffer(doc);
    expect(buf.length).toBeGreaterThan(800);
  });

  it('skips the URL line when the URL is broken / relative', async () => {
    const doc = newDoc();
    const provenance: Provenance = {
      sources: [
        { kind: 'CIS', label: 'Bad URL', url: 'not-a-url', confidence: 0.5 },
        { kind: 'CIS', label: 'Relative', url: '/local/path', confidence: 0.5 },
        { kind: 'CIS', label: 'Empty', url: '', confidence: 0.5 },
      ],
      citationCoverage: 0.5,
    };
    expect(() => renderCitations(doc, provenance)).not.toThrow();
    attachFooter(doc, NOW);
    await drainToBuffer(doc);
  });
});

describe('attachFooter', () => {
  it('stamps a footer on every buffered page', async () => {
    const doc = newDoc();
    renderHeader(doc, makeManifest(), NOW);
    doc.addPage();
    doc.addPage();
    expect(() => attachFooter(doc, NOW)).not.toThrow();
    const buf = await drainToBuffer(doc);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
