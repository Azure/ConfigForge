// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR28: Audit-pack PDF generator.
 *
 * Geeta's Feb 2026 ConfigForge concept-testing research surfaced that
 * auditors live in PDF and want a single self-contained document showing:
 *   - what's in the baseline (header / manifest metadata),
 *   - how it scores against CIS (compliance section),
 *   - the version history with author + rationale (PR27 data),
 *   - where the AI-generated bits came from (PR25 provenance).
 *
 * The builder is **pure**: feed it a normalized input bundle and it
 * streams a `pdfkit` PDFDocument (which is itself a Readable stream).
 * The API route (and unit tests) wrap that with the convenience buffer
 * helper at the bottom.
 *
 * Defensive about PR27: `entry.author` / `entry.rationale` are read with
 * `??` fallbacks in `sections.ts`, and `rationale` is an optional input.
 */
import PDFDocument from 'pdfkit';
import type { ManifestRegistration } from '../oscfg';
import type { HistoryEntryMeta } from '../history';
import type { ComplianceReport } from '../cis/compliance';
import type { Provenance } from '../ai/provenance';
import {
  attachFooter,
  renderCitations,
  renderCompliance,
  renderDeviceAudit,
  renderHeader,
  renderHistoryTable,
  renderRationaleLog,
} from './sections';

/** PR25 type re-exported under the spec's name for clarity. */
export type ProvenanceBundle = Provenance;

/**
 * v0.1.6 — last device-side audit run, persisted by deploy.ts after
 * every audit/enforce. Imported from the manifest store at call time
 * by the audit-pack handler; the renderer can also query it via
 * `cfs:audit-results:get`. Schema kept loose (`unknown` for the
 * payload) so deploy.ts can evolve the per-resource shape without a
 * synchronized migration of this type.
 */
export interface DeviceAuditSnapshot {
  /** Always 1 today; bumped on breaking schema changes. */
  version: 1;
  /** ISO 8601 timestamp captured at write time. */
  recordedAt: string;
  /** `audit` (read-only check) vs `enforce` (apply + audit). */
  mode: 'audit' | 'enforce';
  /** Raw `DeployResponseData` body — see handlers/deploy.ts. */
  result: unknown;
}

/**
 * Rationale entry shape rendered by the audit-pack PDF + Markdown.
 * Mapped from the on-disk `RationaleEntry` shape in
 * `../manifest/rationale-store` by the `tryLoadRationale` adapter
 * (see `rationale-loader.ts`). The store keeps additional fields
 * (`oldValue` / `newValue` / `skipped`) that the audit-pack does not
 * currently render; the adapter strips them.
 */
export interface RationaleEntry {
  timestamp: string;
  author?: string;
  /** Resource the change targeted (e.g. `password-policy`). Optional —
   *  pre-PR38 audit-pack fixtures don't carry it. */
  resourceName?: string;
  reason: string;
}

/**
 * Extension of HistoryEntryMeta with PR27's optional author/rationale
 * fields. Strictly compatible: a PR27-vintage HistoryEntryMeta with the
 * fields populated assigns to this; a pre-PR27 entry without them also
 * assigns (the fields are optional and we render `—` fallbacks).
 */
export interface HistoryEntryWithAuthor extends HistoryEntryMeta {
  author?: string;
  authorEmail?: string;
  rationale?: string;
}

export interface AuditPackInput {
  manifest: ManifestRegistration;
  history: HistoryEntryWithAuthor[];
  rationale?: RationaleEntry[];
  complianceReport?: ComplianceReport;
  provenance?: ProvenanceBundle;
  /**
   * v0.1.6 — last device-side audit result, sourced from the
   * `~/.configforge/audit-results/<ns>.json` cache that deploy.ts
   * writes after every audit/enforce run. Renders as a new "Device
   * Audit" section in the PDF/Markdown above the on-demand CIS
   * compliance section. Undefined when no audit has been run yet.
   */
  deviceAudit?: DeviceAuditSnapshot;
  /** Injected for deterministic test snapshots; defaults to `() => new Date()`. */
  clock?: () => Date;
}

/**
 * Build the audit-pack PDF and return the underlying pdfkit stream.
 * Caller is responsible for piping it (or use buildAuditPackBuffer).
 *
 * Each section is no-throw best-effort: a section that fails to render
 * logs a warning and inserts a single "(section unavailable)" line.
 * That way one bad input doesn't poison the whole document.
 */
export function buildAuditPack(input: AuditPackInput): NodeJS.ReadableStream {
  const clock = input.clock ?? (() => new Date());
  const now = clock();

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 56, left: 56, right: 56, bottom: 72 },
    info: {
      Title: `Audit Pack — ${input.manifest.displayName}`,
      Author: 'ConfigForge',
      Producer: 'ConfigForge / pdfkit',
      Creator: 'ConfigForge',
      CreationDate: now,
      ModDate: now,
    },
    bufferPages: true,
    autoFirstPage: true,
  });

  // ── Section 1: Header (always rendered) ───────────────────────────────
  safeSection(doc, 'Header', () => renderHeader(doc, input.manifest, now));

  // Empty-state breadcrumb when literally nothing is captured.
  const provHasSources = !!input.provenance && input.provenance.sources.length > 0;
  const hasAnyData =
    input.history.length > 0 ||
    (input.rationale != null && input.rationale.length > 0) ||
    input.complianceReport != null ||
    input.deviceAudit != null ||
    provHasSources;
  if (!hasAnyData) {
    doc.moveDown(1);
    doc
      .fontSize(11)
      .fillColor('#666')
      .text('No data captured for this manifest yet.');
    doc.fillColor('black');
  }

  // ── Section 2a: Device Audit (last persisted run, v0.1.6) ─────────────
  // Rendered ONLY when an audit has been run for this manifest. This is
  // distinct from the on-demand CIS Compliance section below — the
  // device audit answers "what does the device actually look like
  // right now" while compliance answers "does the YAML follow the
  // CIS reference baseline".
  if (input.deviceAudit) {
    safeSection(doc, 'DeviceAudit', () => renderDeviceAudit(doc, input.deviceAudit));
  }

  // ── Section 2b: Compliance (CIS comparison, on-demand via ?against=) ──
  safeSection(doc, 'Compliance', () => renderCompliance(doc, input.complianceReport));

  // ── Section 3: History table ──────────────────────────────────────────
  safeSection(doc, 'History', () => renderHistoryTable(doc, input.history));

  // ── Section 4: Rationale log (skipped entirely if undefined/empty) ────
  if (input.rationale && input.rationale.length > 0) {
    safeSection(doc, 'Rationale', () => renderRationaleLog(doc, input.rationale!));
  }

  // ── Section 5: Citations (skipped entirely if no provenance/sources) ──
  if (provHasSources) {
    safeSection(doc, 'Citations', () => renderCitations(doc, input.provenance!));
  }

  // Footer pass — must run AFTER all content so total-page count is final.
  safeSection(doc, 'Footer', () => attachFooter(doc, now));

  doc.end();
  return doc;
}

/**
 * Convenience wrapper that drains the stream into a single Buffer.
 * Used by unit tests (which want a byte-level handle on the output)
 * and the API route in environments where streaming isn't a win.
 */
export async function buildAuditPackBuffer(input: AuditPackInput): Promise<Buffer> {
  const stream = buildAuditPack(input);
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function safeSection(
  doc: PDFKit.PDFDocument,
  label: string,
  fn: () => void,
): void {
  try {
    fn();
  } catch (err) {
    console.warn(`[audit-pack] ${label} render failed:`, err);
    try {
      doc.fillColor('#900').fontSize(10).text(`(${label} section unavailable)`).moveDown(0.5);
      doc.fillColor('black');
    } catch {
      // best-effort; if the doc is in a state where even this fails,
      // we let buildAuditPack continue to the next section.
    }
  }
}
