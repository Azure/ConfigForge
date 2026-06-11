// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR28: pure section renderers for the audit-pack PDF.
 *
 * Each function takes a pdfkit `PDFDocument` and the section's data, and
 * appends content to the document. They MUST be no-throw best-effort —
 * the parent builder wraps each call with a try/catch that emits a
 * "(section unavailable)" line on failure. Sections may still throw if
 * something is genuinely broken, but they should defensively handle
 * malformed input (missing fields, null values, very long strings).
 */
import type { ManifestRegistration } from '../oscfg';
import type { ComplianceReport } from '../cis/compliance';
import type { Provenance } from '../ai/provenance';
import type { HistoryEntryWithAuthor, RationaleEntry } from './index';

const COLOR_TEXT = '#222';
const COLOR_MUTED = '#666';
const COLOR_PRIMARY = '#0050a0';
const COLOR_OK = '#1a7f37';
const COLOR_WARN = '#bf8700';
const COLOR_BAD = '#a40e26';
const COLOR_RULE = '#d0d7de';

const FONT_REG = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_OBL = 'Helvetica-Oblique';

const HISTORY_MAX_ROWS = 50;
const RATIONALE_MAX_ENTRIES = 30;
const RATIONALE_REASON_MAX_LINES = 3;

/**
 * Strip control characters and replace anything outside the WinAnsi
 * range with a `?`. PDFKit's standard fonts (Helvetica family) only
 * support WinAnsi encoding; non-ASCII chars throw or render as boxes.
 * The spec is fine with boxes for non-ASCII; we just ensure we never
 * crash. We map > U+00FF to '?' to keep the output ASCII-safe.
 */
function safeText(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/[^\x00-\xff]/g, '?');
}

/**
 * Coerce a possibly-empty author string to a visible em-dash placeholder
 * for tabular rendering. `??` (used in earlier drafts) only catches
 * null/undefined; the author resolver (`src/lib/history/author.ts`) can
 * legitimately return an empty string when both git config and the
 * `CONFIGFORGE_AUTHOR` env var are unset and the OS user can't be read.
 * Treat that as "unknown" instead of an empty cell.
 */
function coerceAuthor(value: unknown): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s.length === 0 ? '—' : s;
}

function truncate(value: unknown, max: number): string {
  const s = safeText(value);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function fmtTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeText(iso);
  return d.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC');
}

function pageWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

function rule(doc: PDFKit.PDFDocument): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y + 2;
  doc.save();
  doc.strokeColor(COLOR_RULE).lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke();
  doc.restore();
  doc.moveDown(0.6);
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.5);
  ensureSpace(doc, 40);
  doc.fillColor(COLOR_PRIMARY).font(FONT_BOLD).fontSize(14).text(safeText(title));
  doc.fillColor(COLOR_TEXT).font(FONT_REG).fontSize(10);
  rule(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

export function renderHeader(
  doc: PDFKit.PDFDocument,
  manifest: ManifestRegistration,
  generatedAt: Date,
): void {
  // Logo / wordmark — text only, no image dep.
  doc.font(FONT_BOLD).fontSize(10).fillColor(COLOR_PRIMARY).text('CONFIGFORGE', { align: 'left' });
  doc.fillColor(COLOR_MUTED).font(FONT_OBL).fontSize(8).text('Security baseline audit pack', { align: 'left' });
  doc.moveDown(0.6);

  // Title — manifest display name. Cap at 96 chars (matches manifest naming
  // limit per spec) and truncate gracefully if a custom title sneaks past it.
  doc
    .font(FONT_BOLD)
    .fontSize(20)
    .fillColor(COLOR_TEXT)
    .text(truncate(manifest.displayName, 96), { width: pageWidth(doc) });
  doc.moveDown(0.3);

  // Platform badge (rendered as text — `Platform: <value>`).
  const platformLabel = `Platform: ${safeText(manifest.platform)}`;
  doc.font(FONT_REG).fontSize(11).fillColor(COLOR_MUTED).text(platformLabel);
  doc.moveDown(0.1);

  // Metadata grid.
  doc.font(FONT_REG).fontSize(10).fillColor(COLOR_TEXT);
  const metaLines: Array<[string, string]> = [
    ['Namespace', safeText(manifest.namespace)],
    ['Source', safeText(manifest.source)],
    ['Registered', fmtTimestamp(manifest.registeredAt)],
    ['Last applied', fmtTimestamp(manifest.lastAppliedAt)],
    ['Last audited', fmtTimestamp(manifest.lastAuditedAt)],
    ['Generated', fmtTimestamp(generatedAt.toISOString())],
  ];
  for (const [k, v] of metaLines) {
    doc.font(FONT_BOLD).text(`${k}: `, { continued: true });
    doc.font(FONT_REG).text(v);
  }

  doc.moveDown(0.6);
  rule(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance
// ─────────────────────────────────────────────────────────────────────────────

export function renderCompliance(
  doc: PDFKit.PDFDocument,
  report: ComplianceReport | undefined,
): void {
  sectionHeading(doc, 'Compliance');

  if (!report) {
    doc
      .font(FONT_REG)
      .fontSize(10)
      .fillColor(COLOR_MUTED)
      .text('Compliance report not available — run /api/compliance/report first.');
    doc.fillColor(COLOR_TEXT);
    return;
  }

  const score = report.score == null || Number.isNaN(report.score) ? null : report.score;
  const scoreLabel = score == null ? '—' : `${score} / 100`;

  ensureSpace(doc, 80);
  const startY = doc.y;
  const left = doc.page.margins.left;

  // Score badge.
  doc.save();
  doc.font(FONT_BOLD).fontSize(28).fillColor(scoreColor(score));
  doc.text(scoreLabel, left, startY);
  doc.restore();
  doc
    .font(FONT_REG)
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text(`Matched ${report.matched} · Mismatched ${report.mismatched} · Missing ${report.missing}`, left, startY + 32);
  doc
    .font(FONT_REG)
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text(`Total CIS rules: ${report.total}`, left, startY + 44);

  // Bar chart — three bars (matched / mismatched / missing).
  const barLeft = left + 220;
  const barTop = startY + 4;
  const barAreaWidth = pageWidth(doc) - 220;
  drawComplianceBar(doc, barLeft, barTop, barAreaWidth, 14, 'Matched', report.matched, report.total, COLOR_OK);
  drawComplianceBar(doc, barLeft, barTop + 22, barAreaWidth, 14, 'Mismatched', report.mismatched, report.total, COLOR_WARN);
  drawComplianceBar(doc, barLeft, barTop + 44, barAreaWidth, 14, 'Missing', report.missing, report.total, COLOR_BAD);

  // Re-anchor cursor below both columns.
  doc.y = startY + 80;
  doc.fillColor(COLOR_TEXT).font(FONT_REG).fontSize(10);

  // Top 5 missing rules.
  const top5 = report.perRule.filter((r) => r.status === 'missing').slice(0, 5);
  if (top5.length > 0) {
    doc.moveDown(0.4);
    doc.font(FONT_BOLD).fontSize(11).text('Top missing rules');
    doc.moveDown(0.2);
    doc.font(FONT_REG).fontSize(10).fillColor(COLOR_TEXT);
    for (const r of top5) {
      ensureSpace(doc, 16);
      doc
        .font(FONT_BOLD)
        .fillColor(COLOR_BAD)
        .text(`• ${truncate(r.ruleName, 110)}`, { width: pageWidth(doc) });
      const sevAndType = [r.severity, r.type].filter(Boolean).map(safeText).join(' · ');
      if (sevAndType) {
        doc.font(FONT_OBL).fontSize(9).fillColor(COLOR_MUTED).text(`   ${sevAndType}`);
      }
      doc.font(FONT_REG).fontSize(10).fillColor(COLOR_TEXT);
    }
  }

  doc.moveDown(0.4);
}

function scoreColor(score: number | null): string {
  if (score == null) return COLOR_MUTED;
  if (score >= 90) return COLOR_OK;
  if (score >= 70) return COLOR_WARN;
  return COLOR_BAD;
}

function drawComplianceBar(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: number,
  total: number,
  color: string,
): void {
  const v = Math.max(0, Number.isFinite(value) ? value : 0);
  const t = Math.max(1, Number.isFinite(total) ? total : 1);
  const fillWidth = Math.min(width, (v / t) * width);
  doc.save();
  doc.fillColor('#eee').rect(x, y, width, height).fill();
  if (fillWidth > 0) {
    doc.fillColor(color).rect(x, y, fillWidth, height).fill();
  }
  doc.restore();
  doc
    .font(FONT_REG)
    .fontSize(8)
    .fillColor(COLOR_TEXT)
    .text(`${label} (${v})`, x + 4, y + 3, { width: width - 8, lineBreak: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// Device audit (v0.1.6 — last persisted deploy.ts audit run)
// ─────────────────────────────────────────────────────────────────────────────

import type { DeviceAuditSnapshot } from './index';

/**
 * Render the most recent device-side audit run, sourced from the
 * `~/.configforge/audit-results/<ns>.json` cache that
 * `handlers/deploy.ts` writes after every audit/enforce. Distinct
 * from the CIS Compliance section, which compares the user's YAML
 * against a reference baseline at PDF-build time. This section
 * answers "what does the device actually look like?", which is the
 * question auditors actually ask.
 *
 * Defensive about the payload shape — the persisted result is a
 * frozen `DeployResponseData` snapshot from whatever version of
 * deploy.ts wrote it. We type-narrow each field at read time.
 */
export function renderDeviceAudit(
  doc: PDFKit.PDFDocument,
  snapshot: DeviceAuditSnapshot | undefined,
): void {
  sectionHeading(doc, 'Device Audit (last run)');

  if (!snapshot) {
    doc
      .font(FONT_REG)
      .fontSize(10)
      .fillColor(COLOR_MUTED)
      .text(
        'No device audit captured yet. Run an audit from the manifest detail page to populate this section.',
      );
    doc.fillColor(COLOR_TEXT);
    return;
  }

  // Type-narrow the persisted result. Each field is read defensively
  // — a future deploy.ts response shape change should degrade
  // gracefully (missing field → "—") rather than crashing the PDF.
  const r = (snapshot.result ?? {}) as Record<string, unknown>;
  const hostname = typeof r.Hostname === 'string' ? r.Hostname : '—';
  const total = typeof r.TotalResources === 'number' ? r.TotalResources : null;
  const compliant = typeof r.Compliant === 'number' ? r.Compliant : 0;
  const noncompliant = typeof r.NonCompliant === 'number' ? r.NonCompliant : 0;
  const indeterminate = typeof r.Indeterminate === 'number' ? r.Indeterminate : 0;
  const errors = typeof r.Errors === 'number' ? r.Errors : 0;

  const recorded = new Date(snapshot.recordedAt);
  const ago = humanizeAgo(recorded, new Date());

  doc
    .font(FONT_REG)
    .fontSize(10)
    .fillColor(COLOR_TEXT)
    .text(
      `Audited ${safeText(hostname)} ${ago} (mode: ${snapshot.mode})`,
      doc.page.margins.left,
    );

  ensureSpace(doc, 80);
  const startY = doc.y + 8;
  const left = doc.page.margins.left;

  doc
    .font(FONT_BOLD)
    .fontSize(28)
    .fillColor(noncompliant > 0 || errors > 0 ? COLOR_BAD : compliant > 0 ? COLOR_OK : COLOR_MUTED)
    .text(total == null ? '—' : String(compliant), left, startY);

  doc
    .font(FONT_REG)
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text(
      total == null ? 'compliant resources' : `compliant of ${total} resources`,
      left,
      startY + 32,
    );

  // Per-bucket counts, right of the headline number.
  const colLeft = left + 220;
  const lineHeight = 14;
  const buckets: Array<[string, number, string]> = [
    ['Compliant', compliant, COLOR_OK],
    ['Non-compliant', noncompliant, COLOR_BAD],
    ['Indeterminate', indeterminate, COLOR_WARN],
    ['Errors', errors, COLOR_BAD],
  ];
  for (let i = 0; i < buckets.length; i++) {
    const [label, value, color] = buckets[i];
    doc
      .font(FONT_BOLD)
      .fontSize(10)
      .fillColor(color)
      .text(String(value), colLeft, startY + i * lineHeight, { width: 40 });
    doc
      .font(FONT_REG)
      .fontSize(10)
      .fillColor(COLOR_MUTED)
      .text(label, colLeft + 44, startY + i * lineHeight);
  }

  doc.y = startY + buckets.length * lineHeight + 6;
  doc.fillColor(COLOR_TEXT).font(FONT_REG).fontSize(10);

  // Top 5 non-compliant resources (if the persisted result includes
  // a Resources array — see deploy.ts toUiResources).
  const resources = Array.isArray(r.Resources) ? (r.Resources as Array<Record<string, unknown>>) : [];
  const failed = resources
    .filter((res) => {
      const status = String(res.Status ?? res.status ?? '').toLowerCase();
      return status === 'noncompliant' || status === 'non-compliant' || status === 'failed';
    })
    .slice(0, 5);
  if (failed.length > 0) {
    doc.moveDown(0.5);
    doc.font(FONT_BOLD).fontSize(11).text('Top non-compliant resources');
    doc.moveDown(0.2);
    doc.font(FONT_REG).fontSize(10).fillColor(COLOR_TEXT);
    for (const res of failed) {
      ensureSpace(doc, 18);
      const name = typeof res.Name === 'string' ? res.Name : typeof res.name === 'string' ? res.name : '?';
      const reason = typeof res.Reason === 'string' ? res.Reason : typeof res.reason === 'string' ? res.reason : '';
      doc
        .font(FONT_BOLD)
        .fillColor(COLOR_BAD)
        .text(`• ${truncate(safeText(name), 110)}`, { width: pageWidth(doc) });
      if (reason) {
        doc
          .font(FONT_REG)
          .fillColor(COLOR_MUTED)
          .text(`   ${truncate(safeText(reason), 200)}`, { width: pageWidth(doc) });
      }
      doc.fillColor(COLOR_TEXT);
    }
  }

  doc.moveDown(0.5);
}

/**
 * Internal helper for renderDeviceAudit — turns a recorded-at
 * timestamp into "5 minutes ago" / "2 hours ago" / "3 days ago".
 */
function humanizeAgo(then: Date, now: Date): string {
  const ms = now.getTime() - then.getTime();
  if (Number.isNaN(ms) || ms < 0) {
    // Fallback to absolute ISO if the clock is wonky.
    return `at ${then.toISOString()}`;
  }
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `just now`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// History table
// ─────────────────────────────────────────────────────────────────────────────

export function renderHistoryTable(
  doc: PDFKit.PDFDocument,
  history: HistoryEntryWithAuthor[],
): void {
  sectionHeading(doc, 'Version History');

  if (!history || history.length === 0) {
    doc.font(FONT_REG).fontSize(10).fillColor(COLOR_MUTED).text('No version history yet.');
    doc.fillColor(COLOR_TEXT);
    return;
  }

  const total = history.length;
  const rows = history.slice(0, HISTORY_MAX_ROWS);

  // Column layout: timestamp | author | message | rationale.
  const left = doc.page.margins.left;
  const widthTotal = pageWidth(doc);
  const colW = {
    ts: Math.round(widthTotal * 0.22),
    author: Math.round(widthTotal * 0.18),
    message: Math.round(widthTotal * 0.30),
    rationale: 0,
  };
  colW.rationale = widthTotal - colW.ts - colW.author - colW.message;

  // Header row.
  ensureSpace(doc, 28);
  const headerY = doc.y;
  doc.font(FONT_BOLD).fontSize(9).fillColor(COLOR_TEXT);
  doc.text('Timestamp', left, headerY, { width: colW.ts });
  doc.text('Author', left + colW.ts, headerY, { width: colW.author });
  doc.text('Message', left + colW.ts + colW.author, headerY, { width: colW.message });
  doc.text('Rationale', left + colW.ts + colW.author + colW.message, headerY, { width: colW.rationale });
  doc.y = headerY + 14;
  rule(doc);

  // Body rows.
  doc.font(FONT_REG).fontSize(9).fillColor(COLOR_TEXT);
  for (const entry of rows) {
    const ts = fmtTimestamp(entry.timestamp);
    const author = safeText(coerceAuthor(entry.author));
    const message = truncate(entry.message ?? '', 120);
    const rationale = truncate(entry.rationale ?? '', 100);
    const rowY = doc.y;
    const heights = [
      doc.heightOfString(ts, { width: colW.ts }),
      doc.heightOfString(author || '—', { width: colW.author }),
      doc.heightOfString(message || ' ', { width: colW.message }),
      doc.heightOfString(rationale || ' ', { width: colW.rationale }),
    ];
    const rowH = Math.max(...heights, 12) + 4;

    if (rowY + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const y = doc.y;
    doc.text(ts, left, y, { width: colW.ts });
    doc.text(author || '—', left + colW.ts, y, { width: colW.author });
    doc.text(message, left + colW.ts + colW.author, y, { width: colW.message });
    doc.text(rationale, left + colW.ts + colW.author + colW.message, y, { width: colW.rationale });
    doc.y = y + rowH;
  }

  // Truncation footnote.
  if (total > HISTORY_MAX_ROWS) {
    doc.moveDown(0.3);
    doc
      .font(FONT_OBL)
      .fontSize(8)
      .fillColor(COLOR_MUTED)
      .text(
        `(showing ${HISTORY_MAX_ROWS} of ${total} — full history in ~/.configforge/history/${safeText(rows[0]?.manifestName ?? '<ns>')}/)`,
      );
    doc.fillColor(COLOR_TEXT);
  }

  doc.moveDown(0.3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rationale log
// ─────────────────────────────────────────────────────────────────────────────

export function renderRationaleLog(
  doc: PDFKit.PDFDocument,
  rationale: RationaleEntry[],
): void {
  sectionHeading(doc, 'Rationale Log');

  // Reverse chrono — newest first. The caller may already pass it sorted;
  // sort defensively. Stable for equal timestamps.
  const sorted = [...rationale].sort((a, b) => {
    const ta = a.timestamp ?? '';
    const tb = b.timestamp ?? '';
    if (ta === tb) return 0;
    return ta < tb ? 1 : -1;
  });
  const recent = sorted.slice(0, RATIONALE_MAX_ENTRIES);

  doc.font(FONT_REG).fontSize(10).fillColor(COLOR_TEXT);
  for (const entry of recent) {
    ensureSpace(doc, 36);
    const ts = fmtTimestamp(entry.timestamp);
    const author = safeText(coerceAuthor(entry.author));
    const resourceSuffix = entry.resourceName ? ` · ${safeText(entry.resourceName)}` : '';
    doc.font(FONT_BOLD).fontSize(10).fillColor(COLOR_TEXT).text(`${ts}  `, { continued: true });
    doc.font(FONT_REG).fillColor(COLOR_MUTED).text(`by ${author}${resourceSuffix}`);

    const reasonLines = safeText(entry.reason ?? '').split(/\r?\n/);
    const showLines = reasonLines.slice(0, RATIONALE_REASON_MAX_LINES);
    const truncated = reasonLines.length > RATIONALE_REASON_MAX_LINES;
    let body = showLines.join('\n');
    if (truncated) body += '\n…';

    doc
      .font(FONT_REG)
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(body || '—', { width: pageWidth(doc) });
    doc.moveDown(0.4);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Citations / bibliography
// ─────────────────────────────────────────────────────────────────────────────

export function renderCitations(doc: PDFKit.PDFDocument, provenance: Provenance): void {
  if (!provenance.sources || provenance.sources.length === 0) {
    return;
  }
  sectionHeading(doc, 'Citations');

  doc.font(FONT_REG).fontSize(10).fillColor(COLOR_TEXT);
  provenance.sources.forEach((src, i) => {
    ensureSpace(doc, 22);
    const idx = `[${i + 1}]`;
    const labelStr = safeText(src.label || '(untitled source)');
    const conf =
      typeof src.confidence === 'number' && Number.isFinite(src.confidence)
        ? ` · confidence ${(src.confidence * 100).toFixed(0)}%`
        : '';
    const kind = safeText(src.kind ?? '');
    doc.font(FONT_BOLD).text(`${idx} `, { continued: true });
    doc.font(FONT_REG).text(`${labelStr}${kind ? ` (${kind})` : ''}${conf}`);

    if (src.url && isRenderableUrl(src.url)) {
      doc
        .font(FONT_OBL)
        .fontSize(9)
        .fillColor(COLOR_MUTED)
        .text(`    ${safeText(src.url)}`, { width: pageWidth(doc) });
      doc.fillColor(COLOR_TEXT).font(FONT_REG).fontSize(10);
    }
    doc.moveDown(0.2);
  });
}

/** Reject URLs that are obviously broken or relative — render label only. */
function isRenderableUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

export function attachFooter(doc: PDFKit.PDFDocument, generatedAt: Date): void {
  // bufferPages: true was set in the constructor — pages are still in
  // memory and we can iterate them to stamp footers.
  const range = doc.bufferedPageRange();
  const total = range.count;
  const generatedIso = generatedAt.toISOString();
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const pageNum = i + 1;
    const text = `Generated ${generatedIso} · Page ${pageNum} of ${total} · Confidential — Internal Use Only`;
    const left = doc.page.margins.left;
    const width = pageWidth(doc);
    const y = doc.page.height - doc.page.margins.bottom + 24;
    doc.save();
    doc
      .font(FONT_REG)
      .fontSize(8)
      .fillColor(COLOR_MUTED)
      .text(safeText(text), left, y, { width, align: 'center', lineBreak: false });
    doc.restore();
  }
}
