// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR24: compute a compliance % report for a user manifest against a CIS
 * baseline manifest.
 *
 * The CIS-derived baselines we ship in `public/_baselines/cis/` use the
 * canonical CIS rule name as each resource's `name`. The user manifests
 * we author against them follow the same convention. That makes a
 * strict-name match defensible to auditors: if `myResource.name ===
 * cisResource.name` we know they are talking about the same rule.
 *
 * Scoring (strict, auditor-defensible):
 *   matched     — name match + values agree
 *   mismatched  — name match + values differ
 *   missing     — present in CIS, absent in user manifest
 *   extras      — present in user manifest, absent in CIS (do NOT lower
 *                 the score; reported as informational)
 *   score       — round(matched / cisRules * 100); 0 if cisRules == 0
 */
import { extractResourcesFull } from '../platform';
import { findCisRulesForResources, type CrossRefMatch } from './crossref';

export type ComplianceStatus = 'matched' | 'mismatched' | 'missing';

export interface ComplianceRule {
  ruleName: string;
  status: ComplianceStatus;
  /** User's value for the resource — only set when present in user manifest. */
  myValue?: unknown;
  /** Expected (CIS) value. */
  expected?: unknown;
  /** Resource type; useful for grouping in the UI. */
  type?: string;
  severity: string;
  /** GPO path if known. */
  gpoPath?: string | null;
  /** Stable instance GUID (from rule-id-mappings) when available. */
  ruleId?: string;
}

export interface ComplianceExtra {
  ruleName: string;
  type?: string;
}

export interface ComplianceReport {
  matched: number;
  mismatched: number;
  missing: number;
  /** 0..100 integer score: matched / total CIS rules. */
  score: number;
  /** Total CIS rules considered (denominator for the score). */
  total: number;
  /** Severity tally over per-rule entries (incl. mismatched/missing). */
  severityBreakdown: Record<string, { matched: number; mismatched: number; missing: number }>;
  perRule: ComplianceRule[];
  /** Resources in the user's manifest that have no CIS counterpart. */
  extras: ComplianceExtra[];
}

interface ResourceLite {
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

interface ManifestDoc {
  resources?: unknown;
}

function safeResources(doc: ManifestDoc | null | undefined): ResourceLite[] {
  if (!doc || typeof doc !== 'object') return [];
  return extractResourcesFull(doc.resources);
}

/**
 * Stable compare for resource property values. Walks plain objects and
 * arrays; uses strict equality for primitives. We avoid `JSON.stringify`
 * for top-level compare because key ordering is not guaranteed; the
 * recursive walk below tolerates differently-ordered keys.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valuesEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!valuesEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Compare two property bags. We focus on the *enforcement* fields that
 * actually drive compliance (`value`, `data`, `desired`, `desiredState`)
 * when both bags carry one — that avoids false mismatches on metadata
 * differences (e.g. `valueType` casing). When neither side declares any
 * of those, we fall back to a deep compare of the full property bags.
 */
export function propertiesEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const fields = ['value', 'data', 'desired', 'desiredState'];
  let compared = false;
  for (const f of fields) {
    if (f in a || f in b) {
      compared = true;
      if (!valuesEqual(a[f], b[f])) return false;
    }
  }
  if (compared) return true;

  return valuesEqual(a, b);
}

function pickEnforcementValue(props: Record<string, unknown> | undefined): unknown {
  if (!props) return undefined;
  for (const k of ['value', 'data', 'desired', 'desiredState']) {
    if (k in props) return (props as Record<string, unknown>)[k];
  }
  return props;
}

/**
 * Build the compliance report.
 *
 * @param myManifestDoc   Parsed user manifest object (from yaml.load).
 * @param cisManifestDoc  Parsed CIS baseline manifest object.
 */
export async function computeCompliance(
  myManifestDoc: ManifestDoc | null | undefined,
  cisManifestDoc: ManifestDoc | null | undefined,
): Promise<ComplianceReport> {
  const myResources = safeResources(myManifestDoc);
  const cisResources = safeResources(cisManifestDoc);

  // Index user resources by strict name. If the same name appears
  // multiple times we keep the first; downstream consumers can dedupe
  // upstream if they care.
  const myByName = new Map<string, ResourceLite>();
  for (const r of myResources) {
    if (!myByName.has(r.name)) myByName.set(r.name, r);
  }

  // Try to attach CIS metadata (severity / GPO / rule GUID) for each
  // CIS resource; bulk lookup is cheap once the catalog is cached.
  const cisMatches: Array<CrossRefMatch | null> = await findCisRulesForResources(cisResources);

  const perRule: ComplianceRule[] = [];
  const severityBreakdown: ComplianceReport['severityBreakdown'] = {};

  function bumpSeverity(sev: string, status: ComplianceStatus): void {
    const key = sev || 'Unknown';
    const bucket = severityBreakdown[key] ?? { matched: 0, mismatched: 0, missing: 0 };
    bucket[status] += 1;
    severityBreakdown[key] = bucket;
  }

  let matched = 0;
  let mismatched = 0;
  let missing = 0;

  cisResources.forEach((cis, i) => {
    const meta = cisMatches[i];
    const severity = meta?.severity ?? 'Unknown';
    const gpoPath = meta?.gpoPath ?? null;
    const ruleId = meta?.ruleId;

    const mine = myByName.get(cis.name);
    if (!mine) {
      missing += 1;
      bumpSeverity(severity, 'missing');
      perRule.push({
        ruleName: cis.name,
        status: 'missing',
        expected: pickEnforcementValue(cis.properties),
        type: cis.type,
        severity,
        gpoPath,
        ruleId,
      });
      return;
    }
    if (propertiesEqual(mine.properties, cis.properties)) {
      matched += 1;
      bumpSeverity(severity, 'matched');
      perRule.push({
        ruleName: cis.name,
        status: 'matched',
        myValue: pickEnforcementValue(mine.properties),
        expected: pickEnforcementValue(cis.properties),
        type: cis.type,
        severity,
        gpoPath,
        ruleId,
      });
    } else {
      mismatched += 1;
      bumpSeverity(severity, 'mismatched');
      perRule.push({
        ruleName: cis.name,
        status: 'mismatched',
        myValue: pickEnforcementValue(mine.properties),
        expected: pickEnforcementValue(cis.properties),
        type: cis.type,
        severity,
        gpoPath,
        ruleId,
      });
    }
  });

  // Extras: resources in the user manifest with no CIS counterpart.
  const cisNameSet = new Set(cisResources.map((r) => r.name));
  const extras: ComplianceExtra[] = [];
  for (const mine of myResources) {
    if (!cisNameSet.has(mine.name)) {
      extras.push({ ruleName: mine.name, type: mine.type });
    }
  }

  const total = cisResources.length;
  const score = total === 0 ? 0 : Math.round((matched / total) * 100);

  return {
    matched,
    mismatched,
    missing,
    score,
    total,
    severityBreakdown,
    perRule,
    extras,
  };
}

/**
 * Render the report as a Markdown audit pack — the format the auditor
 * downloads from the compliance page.
 */
export function reportToMarkdown(
  manifestName: string,
  baselineId: string,
  report: ComplianceReport,
): string {
  const out: string[] = [];
  const ts = new Date().toISOString();

  out.push(`# Compliance Audit Pack — ${manifestName}`);
  out.push('');
  out.push(`- **Baseline:** \`${baselineId}\``);
  out.push(`- **Generated:** ${ts}`);
  out.push(`- **Score:** ${report.score}% (${report.matched} / ${report.total})`);
  out.push(`- **Matched:** ${report.matched}`);
  out.push(`- **Mismatched:** ${report.mismatched}`);
  out.push(`- **Missing:** ${report.missing}`);
  out.push(`- **Extras (in your manifest, not in baseline):** ${report.extras.length}`);
  out.push('');

  out.push('## Severity Breakdown');
  out.push('');
  out.push('| Severity | Matched | Mismatched | Missing |');
  out.push('| --- | ---: | ---: | ---: |');
  for (const [sev, b] of Object.entries(report.severityBreakdown)) {
    out.push(`| ${sev} | ${b.matched} | ${b.mismatched} | ${b.missing} |`);
  }
  out.push('');

  out.push('## Rules');
  out.push('');
  out.push('| Status | Severity | Rule | GPO Path | My Value | Expected |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of report.perRule) {
    const my = r.myValue === undefined ? '' : '`' + JSON.stringify(r.myValue) + '`';
    const exp = r.expected === undefined ? '' : '`' + JSON.stringify(r.expected) + '`';
    const gpo = r.gpoPath ? r.gpoPath.replace(/\|/g, '\\|') : '';
    const name = r.ruleName.replace(/\|/g, '\\|');
    out.push(`| ${r.status} | ${r.severity} | ${name} | ${gpo} | ${my} | ${exp} |`);
  }

  if (report.extras.length > 0) {
    out.push('');
    out.push('## Extras (in your manifest, not in CIS)');
    out.push('');
    for (const e of report.extras) {
      out.push(`- ${e.ruleName}${e.type ? ` _(${e.type})_` : ''}`);
    }
  }

  return out.join('\n') + '\n';
}
