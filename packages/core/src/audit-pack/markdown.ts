// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR28: Markdown serialization of the audit-pack input.
 *
 * Mirrors the PDF section layout so the markdown export carries the
 * same auditor-relevant information. Reused by the API route's
 * `?format=markdown` branch and is back-compatible with the PR24
 * compliance markdown audit pack (which the existing compliance page
 * builds client-side via its own `renderMarkdown` helper).
 *
 * Pure: no I/O, no clock dependency unless injected.
 *
 * Security note (v0.2.1 audit hardening, CF-SEC-006):
 * --------------------------------------------------
 * Audit packs are downloaded and shared with reviewers who treat them
 * as authoritative. Manifest-, history-, rationale-, and provenance-
 * derived strings are therefore UNTRUSTED — a crafted manifest could
 * otherwise spoof headings (`# Looks legit`), inject misleading links
 * (`[click](evil)`), break tables, smuggle HTML autolinks, or hide
 * failed checks.
 *
 * All untrusted strings flow through `escMdInline` (or `escMdCell`
 * inside tables); URLs through `safeAutoLink`; multi-line content
 * through `escMdLines`. Trusted constants (section headings, our own
 * "Confidential — Internal Use Only" footer, etc.) are emitted as
 * literals.
 */
import type { AuditPackInput } from './index';
import { escMdInline, escMdCell, escInlineCode, safeAutoLink } from '../markdown/escape';

export function buildAuditPackMarkdown(input: AuditPackInput): string {
  const clock = input.clock ?? (() => new Date());
  const generatedAt = clock().toISOString();
  const out: string[] = [];

  const m = input.manifest;
  out.push(`# Audit Pack — ${escMdInline(m.displayName)}`);
  out.push('');
  out.push(`- **Namespace:** \`${escInlineCode(m.namespace)}\``);
  out.push(`- **Platform:** ${escMdInline(m.platform)}`);
  out.push(`- **Source:** ${escMdInline(m.source)}`);
  out.push(`- **Registered:** ${fmt(m.registeredAt)}`);
  out.push(`- **Last applied:** ${fmt(m.lastAppliedAt)}`);
  out.push(`- **Last audited:** ${fmt(m.lastAuditedAt)}`);
  out.push(`- **Generated:** ${generatedAt}`);
  out.push('');

  // ── Device Audit (last persisted run, v0.1.6) ──
  // Same data the audit-pack PDF renders in the Device Audit
  // section. Distinct from the on-demand Compliance section below.
  out.push('## Device Audit (last run)');
  out.push('');
  if (!input.deviceAudit) {
    out.push(
      'No device audit captured yet. Run an audit from the manifest detail page to populate this section.',
    );
    out.push('');
  } else {
    const snap = input.deviceAudit;
    const r = (snap.result ?? {}) as Record<string, unknown>;
    const hostname = typeof r.Hostname === 'string' ? r.Hostname : '—';
    const total = typeof r.TotalResources === 'number' ? r.TotalResources : null;
    const compliant = typeof r.Compliant === 'number' ? r.Compliant : 0;
    const noncompliant = typeof r.NonCompliant === 'number' ? r.NonCompliant : 0;
    const indeterminate = typeof r.Indeterminate === 'number' ? r.Indeterminate : 0;
    const errors = typeof r.Errors === 'number' ? r.Errors : 0;
    out.push(`- **Hostname:** ${escMdInline(hostname)}`);
    out.push(`- **Recorded:** ${fmt(snap.recordedAt)}`);
    out.push(`- **Mode:** ${escMdInline(snap.mode)}`);
    if (total !== null) out.push(`- **Total resources:** ${total}`);
    out.push(`- **Compliant:** ${compliant}`);
    out.push(`- **Non-compliant:** ${noncompliant}`);
    out.push(`- **Indeterminate:** ${indeterminate}`);
    out.push(`- **Errors:** ${errors}`);
    out.push('');
    const resources = Array.isArray(r.Resources)
      ? (r.Resources as Array<Record<string, unknown>>)
      : [];
    const failed = resources
      .filter((res) => {
        const status = String(res.Status ?? res.status ?? '').toLowerCase();
        return status === 'noncompliant' || status === 'non-compliant' || status === 'failed';
      })
      .slice(0, 10);
    if (failed.length > 0) {
      out.push('### Top non-compliant resources');
      out.push('');
      for (const res of failed) {
        const name =
          typeof res.Name === 'string' ? res.Name : typeof res.name === 'string' ? res.name : '?';
        const reason =
          typeof res.Reason === 'string'
            ? res.Reason
            : typeof res.reason === 'string'
              ? res.reason
              : '';
        out.push(`- **${escMdInline(name)}** — ${escMdInline(reason)}`);
      }
      out.push('');
    }
  }

  // ── Compliance ──
  out.push('## Compliance');
  out.push('');
  if (!input.complianceReport) {
    out.push('Compliance report not available — run `/api/compliance/report` first.');
    out.push('');
  } else {
    const r = input.complianceReport;
    const score = r.score == null || Number.isNaN(r.score) ? '—' : `${r.score}`;
    out.push(`- **Score:** ${score} / 100`);
    out.push(`- **Matched:** ${r.matched}`);
    out.push(`- **Mismatched:** ${r.mismatched}`);
    out.push(`- **Missing:** ${r.missing}`);
    out.push(`- **Total CIS rules:** ${r.total}`);
    out.push('');
    if (Object.keys(r.severityBreakdown).length > 0) {
      out.push('### Severity breakdown');
      out.push('');
      out.push('| Severity | Matched | Mismatched | Missing |');
      out.push('| --- | ---: | ---: | ---: |');
      for (const [sev, b] of Object.entries(r.severityBreakdown)) {
        out.push(`| ${escMdCell(sev)} | ${b.matched} | ${b.mismatched} | ${b.missing} |`);
      }
      out.push('');
    }
    const top5 = r.perRule.filter((x) => x.status === 'missing').slice(0, 5);
    if (top5.length > 0) {
      out.push('### Top missing rules');
      out.push('');
      for (const rule of top5) {
        out.push(
          `- **${escMdInline(rule.ruleName)}** _(${escMdInline(rule.severity)}${rule.type ? ` · ${escMdInline(rule.type)}` : ''})_`,
        );
      }
      out.push('');
    }
  }

  // ── Version history ──
  out.push('## Version History');
  out.push('');
  if (input.history.length === 0) {
    out.push('No version history yet.');
    out.push('');
  } else {
    const total = input.history.length;
    const rows = input.history.slice(0, 50);
    out.push('| Timestamp | Author | Message | Rationale |');
    out.push('| --- | --- | --- | --- |');
    for (const e of rows) {
      out.push(
        `| ${fmt(e.timestamp)} | ${escMdCell(coerceAuthor(e.author))} | ${escMdCell(e.message ?? '')} | ${escMdCell(e.rationale ?? '')} |`,
      );
    }
    if (total > 50) {
      out.push('');
      out.push(
        `_(showing 50 of ${total} — full history in \`~/.configforge/history/${escInlineCode(m.namespace)}/\`)_`,
      );
    }
    out.push('');
  }

  // ── Rationale log ──
  if (input.rationale && input.rationale.length > 0) {
    out.push('## Rationale Log');
    out.push('');
    const sorted = [...input.rationale]
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
      .slice(0, 30);
    for (const e of sorted) {
      const resourceSuffix = e.resourceName ? ` · ${escMdInline(e.resourceName)}` : '';
      out.push(`### ${fmt(e.timestamp)} — ${escMdInline(coerceAuthor(e.author))}${resourceSuffix}`);
      out.push('');
      // CF-SEC-006: rationale lines were previously pushed RAW, allowing
      // a crafted reason field to inject headings, tables, images, HTML,
      // or autolinks into the auditor-facing report. Escape every line
      // and emit as blockquote so it renders as quoted text even if the
      // escape misses a future markdown construct.
      const allLines = (e.reason ?? '').split(/\r?\n/);
      const lines = allLines.slice(0, 3);
      for (const line of lines) {
        out.push(`> ${escMdInline(line)}`);
      }
      if (allLines.length > 3) out.push('> …');
      out.push('');
    }
  }

  // ── Citations ──
  if (input.provenance && input.provenance.sources.length > 0) {
    out.push('## Citations');
    out.push('');
    input.provenance.sources.forEach((s, i) => {
      // CF-SEC-006: previously inserted as raw `<URL>` autolink, which
      // only checked scheme. A URL containing `>`, newline, or other
      // markdown-significant characters could escape the autolink and
      // inject misleading content. `safeAutoLink` validates via WHATWG
      // URL, requires http/https, and emits an escaped plain-text
      // fallback when the URL is unsafe.
      const linkText = safeAutoLink(s.url);
      const url = linkText ? ` — ${linkText}` : '';
      const conf =
        typeof s.confidence === 'number' && Number.isFinite(s.confidence)
          ? ` _(confidence ${(s.confidence * 100).toFixed(0)}%)_`
          : '';
      out.push(
        `${i + 1}. **${escMdInline(s.label)}** _(${escMdInline(s.kind)})_${url}${conf}`,
      );
    });
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(`_Generated ${generatedAt} · Confidential — Internal Use Only_`);
  out.push('');
  return out.join('\n');
}

function fmt(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString();
}

/** See sections.ts coerceAuthor — same rules, separate copy to keep modules independent. */
function coerceAuthor(value: unknown): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s.length === 0 ? '—' : s;
}
