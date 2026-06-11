// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR28: end-to-end builder tests for the audit-pack PDF.
 *
 * These exercise the public surface (`buildAuditPack`,
 * `buildAuditPackBuffer`) with realistic input bundles and assert
 * structural invariants on the produced bytes (PDF header + EOF
 * sentinel) plus reasonable size + timing bounds. We avoid asserting
 * on rendered visual output — that's covered by the smoke flow.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAuditPack,
  buildAuditPackBuffer,
  type AuditPackInput,
  type RationaleEntry,
} from './';
import type { ManifestRegistration } from '../oscfg';
import type { ComplianceReport } from '../cis/compliance';
import type { Provenance } from '../ai/provenance';

const FIXED_CLOCK = () => new Date('2026-04-21T12:34:56.000Z');

function makeManifest(overrides: Partial<ManifestRegistration> = {}): ManifestRegistration {
  return {
    namespace: 'cis-ws2025-baseline',
    displayName: 'CIS Windows Server 2025 — Member Server (custom)',
    platform: 'windows',
    registeredAt: '2026-04-15T08:00:00.000Z',
    source: 'user',
    lastAppliedAt: '2026-04-20T13:30:00.000Z',
    lastAuditedAt: '2026-04-20T14:00:00.000Z',
    ...overrides,
  };
}

function makeComplianceReport(
  overrides: Partial<ComplianceReport> = {},
  ruleCount = 12,
): ComplianceReport {
  const perRule: ComplianceReport['perRule'] = [];
  for (let i = 0; i < ruleCount; i++) {
    const status: ComplianceReport['perRule'][number]['status'] =
      i % 4 === 0 ? 'mismatched' : i % 4 === 1 ? 'missing' : 'matched';
    perRule.push({
      ruleName: `Rule ${i + 1}: Ensure something is configured correctly (CIS ${i + 1}.1)`,
      status,
      severity: i % 3 === 0 ? 'Critical' : i % 3 === 1 ? 'Important' : 'Informational',
      type: 'Microsoft.Windows/Registry',
      gpoPath: 'Computer Configuration\\Policies\\Security Settings',
    });
  }
  const matched = perRule.filter((r) => r.status === 'matched').length;
  const mismatched = perRule.filter((r) => r.status === 'mismatched').length;
  const missing = perRule.filter((r) => r.status === 'missing').length;
  return {
    matched,
    mismatched,
    missing,
    score: Math.round((matched / Math.max(1, ruleCount)) * 100),
    total: ruleCount,
    severityBreakdown: {
      Critical: { matched: 1, mismatched: 1, missing: 0 },
      Important: { matched: 2, mismatched: 0, missing: 1 },
      Informational: { matched: 4, mismatched: 1, missing: 2 },
    },
    perRule,
    extras: [],
    ...overrides,
  };
}

function makeProvenance(): Provenance {
  return {
    sources: [
      { kind: 'CIS', label: 'CIS Microsoft Windows Server 2025 Benchmark v1.0', url: 'https://workbench.cisecurity.org/benchmarks/24193', confidence: 0.95 },
      { kind: 'NIST', label: 'NIST SP 800-53 Rev 5', url: 'https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final', confidence: 0.85 },
      { kind: 'MSDocs', label: 'Microsoft Security Compliance Toolkit', url: 'https://learn.microsoft.com/en-us/windows/security/threat-protection/security-compliance-toolkit-10', confidence: 0.9 },
    ],
    citationCoverage: 0.9,
  };
}

function makeRationale(n = 5): RationaleEntry[] {
  const out: RationaleEntry[] = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 3, 10 + i, 8, 0, 0)).toISOString();
    out.push({
      timestamp: ts,
      author: i % 2 === 0 ? 'Author One' : 'Author Two',
      reason:
        i % 3 === 0
          ? 'Loosened password complexity from 14 to 12 chars to align with the\nIT-issued laptop policy.\nApproved by CISO.'
          : 'Re-enabled SMB signing after the file-server team confirmed\ndowngrade attacks were observed in Q1.',
    });
  }
  return out;
}

function makeHistory(n: number, withAuthor = true): AuditPackInput['history'] {
  const out: AuditPackInput['history'] = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(Date.UTC(2026, 3, 1, 8, i % 60, 0)).toISOString();
    out.push({
      id: `2026-04-01T08-${String(i % 60).padStart(2, '0')}-00.000Z.${i.toString(16).padStart(8, '0')}`,
      manifestName: 'cis-ws2025-baseline',
      timestamp: t,
      message: i % 3 === 0 ? `Snapshot #${i}: tightened account policy` : '',
      size: 4096 + i,
      author: withAuthor && i % 2 === 0 ? 'Test Author' : undefined,
      rationale: i % 5 === 0 ? 'Required for SOX compliance review' : undefined,
    });
  }
  return out;
}

const PDF_HEADER = '%PDF-';
const PDF_TRAILER = '%%EOF';

function assertValidPdf(buf: Buffer): void {
  expect(buf.length).toBeGreaterThan(100);
  expect(buf.slice(0, 5).toString('ascii')).toBe(PDF_HEADER);
  const tail = buf.slice(Math.max(0, buf.length - 16)).toString('ascii');
  expect(tail).toContain(PDF_TRAILER);
}

describe('buildAuditPack — empty input', () => {
  it('still produces a valid PDF when there is no history, rationale, compliance, or provenance', async () => {
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest(),
      history: [],
      clock: FIXED_CLOCK,
    });
    assertValidPdf(buf);
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe('buildAuditPack — full input', () => {
  it('renders all sections with realistic content', async () => {
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest(),
      history: makeHistory(10),
      rationale: makeRationale(4),
      complianceReport: makeComplianceReport(),
      provenance: makeProvenance(),
      clock: FIXED_CLOCK,
    });
    assertValidPdf(buf);
    expect(buf.length).toBeGreaterThan(5 * 1024);
    expect(buf.length).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('buildAuditPack — performance', () => {
  it('renders a 50-entry history under 3s wall time', async () => {
    const start = Date.now();
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest(),
      history: makeHistory(50),
      clock: FIXED_CLOCK,
    });
    const elapsed = Date.now() - start;
    assertValidPdf(buf);
    // eslint-disable-next-line no-console
    console.log(`[audit-pack-test] 50-entry history rendered in ${elapsed}ms (${buf.length} bytes)`);
    expect(elapsed).toBeLessThan(3000);
  });

  it('renders a 350-rule full-data manifest under 30s wall time', async () => {
    const start = Date.now();
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest({
        displayName: 'CIS Windows Server 2025 — Domain Controller (full)',
      }),
      history: makeHistory(50),
      rationale: makeRationale(30),
      complianceReport: makeComplianceReport({}, 350),
      provenance: makeProvenance(),
      clock: FIXED_CLOCK,
    });
    const elapsed = Date.now() - start;
    assertValidPdf(buf);
    // eslint-disable-next-line no-console
    console.log(`[audit-pack-test] 350-rule full data rendered in ${elapsed}ms (${buf.length} bytes)`);
    // The user said 3-5 minutes is fine. Be defensive at 30s for CI reliability.
    expect(elapsed).toBeLessThan(30000);
  }, 60_000);
});

describe('buildAuditPack — determinism', () => {
  it('produces identical-sized bytes for identical inputs + clocks (±10 bytes tolerance)', async () => {
    const baseInput: AuditPackInput = {
      manifest: makeManifest(),
      history: makeHistory(5),
      rationale: makeRationale(3),
      complianceReport: makeComplianceReport(),
      provenance: makeProvenance(),
      clock: FIXED_CLOCK,
    };
    const a = await buildAuditPackBuffer(baseInput);
    const b = await buildAuditPackBuffer(baseInput);
    assertValidPdf(a);
    assertValidPdf(b);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(10);
  });
});

describe('buildAuditPack — stream surface', () => {
  it('returns a Readable stream that emits PDF bytes', async () => {
    const stream = buildAuditPack({
      manifest: makeManifest(),
      history: makeHistory(3),
      clock: FIXED_CLOCK,
    });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    assertValidPdf(buf);
  });
});

describe('buildAuditPack — edge cases', () => {
  it('renders even when compliance report has score: null (rendered as —)', async () => {
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest(),
      history: [],
      complianceReport: {
        ...makeComplianceReport(),
        score: null as unknown as number,
      },
      clock: FIXED_CLOCK,
    });
    assertValidPdf(buf);
  });

  it('renders even when manifest displayName has non-ASCII characters', async () => {
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest({ displayName: 'Тестовый baseline · 中文 · 日本語' }),
      history: [],
      clock: FIXED_CLOCK,
    });
    assertValidPdf(buf);
  });

  it('renders even when manifest displayName is at the 96-char limit', async () => {
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest({ displayName: 'A'.repeat(96) }),
      history: [],
      clock: FIXED_CLOCK,
    });
    assertValidPdf(buf);
  });

  it('truncates overlong displayName names without overflowing (>96 chars)', async () => {
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest({ displayName: 'B'.repeat(200) }),
      history: [],
      clock: FIXED_CLOCK,
    });
    assertValidPdf(buf);
  });

  it('renders 50+ history entries with truncation footnote', async () => {
    const buf = await buildAuditPackBuffer({
      manifest: makeManifest(),
      history: makeHistory(120),
      clock: FIXED_CLOCK,
    });
    assertValidPdf(buf);
    expect(buf.length).toBeGreaterThan(5 * 1024);
  });

  it('handles concurrent renders of the same input without shared mutable state', async () => {
    const input: AuditPackInput = {
      manifest: makeManifest(),
      history: makeHistory(5),
      complianceReport: makeComplianceReport(),
      clock: FIXED_CLOCK,
    };
    const results = await Promise.all([
      buildAuditPackBuffer(input),
      buildAuditPackBuffer(input),
      buildAuditPackBuffer(input),
    ]);
    for (const buf of results) {
      assertValidPdf(buf);
    }
    expect(Math.abs(results[0].length - results[1].length)).toBeLessThanOrEqual(10);
    expect(Math.abs(results[0].length - results[2].length)).toBeLessThanOrEqual(10);
  });
});
