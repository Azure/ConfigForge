// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import yaml from "js-yaml";
import {
  type AiSource,
  type Provenance,
  decorateWithProvenance,
} from "./provenance";
import { tagAsAiGenerated } from "./circular-guard";

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

export interface ChangedResource {
  name: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface DiffAnalysis {
  addedResources: string[];
  removedResources: string[];
  changedResources: ChangedResource[];
  riskLevel: RiskLevel;
  summary: string;
  /**
   * Optional bibliography for this analysis. Optional so existing callers
   * keep working — PR25 introduces the field but does not yet require it.
   */
  provenance?: Provenance;
}

export interface Conflict {
  setting: string;
  manifests: string[];
  values: unknown[];
}

export interface ConflictResult {
  conflicts: Conflict[];
}

export interface ChangelogEntry {
  field: string;
  from: unknown;
  to: unknown;
}

export interface Changelog {
  date: string;
  manifestName: string;
  changes: ChangelogEntry[];
  /**
   * Marker-tagged AI-generated rendering of the changelog. Present for
   * changelogs produced by `generateChangelog` so the circular-reference
   * guard can refuse to ingest this content as ground truth on a future
   * call. See `lib/ai/circular-guard.ts`.
   */
  taggedContent?: string;
  provenance?: Provenance;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

interface ParsedResource {
  name: string;
  type?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Substring patterns of registry/configuration paths that materially affect
 * device security. The list is intentionally permissive at the broad-theme
 * level (`security`, `firewall`, `policy`) and explicit for high-impact
 * hives that the broad patterns do NOT match (LanmanServer parameters,
 * LSA, Kerberos, Group Policy registry trees, etc.). Add specific CIS /
 * STIG hives here as they're encountered — the test suite asserts each
 * one classifies correctly.
 *
 * Match is case-insensitive substring against `keyPath`/`path`/`Path`.
 * Exported for test coverage; not part of the public module surface.
 *
 * @internal
 */
export const CRITICAL_PATH_SUBSTRINGS: readonly string[] = [
  // Broad themes (kept from the original regex-based heuristic)
  'security',
  'firewall',
  'policy',
  // Authentication / identity
  'lsa',
  'msv1_0',
  'kerberos',
  'authentication',
  'control\\session manager',
  // Network / file sharing
  'lanmanserver\\parameters',
  'lanmanworkstation\\parameters',
  'tcpip\\parameters',
  // Group policy registry trees
  '\\system\\currentcontrolset\\policies\\',
  'software\\policies\\',
  // Defender / firewall (not always matched by the broad themes alone).
  // Both spaced and concatenated variants are seen in real registry paths.
  'windowsfirewall',
  'windows firewall',
  'windowsdefender',
  'windows defender',
  // Audit / event log
  'eventlog\\security',
];

/**
 * Property field names that represent ENFORCEMENT of desired state, as
 * opposed to identifiers (`valueName`), descriptions, or compliance
 * criteria (`compliance.equals`).
 *
 * Matched as either the full dotted path (e.g. `value`, `data`) OR the
 * first segment of a dotted path (e.g. `value.dword`, `data.string`).
 * We deliberately do NOT match arbitrary substrings — that would
 * mis-classify look-alikes like `valueName` or `metadata`.
 *
 * @internal
 */
export const ENFORCEMENT_FIELD_KEYS: ReadonlySet<string> = new Set([
  'value',
  'desired',
  'desiredstate',
  'data',
  'enforce',
  'enforcement',
]);

/** @internal */
export function isCriticalSetting(resource: ParsedResource): boolean {
  const raw = resource.properties?.keyPath ?? resource.properties?.path ?? resource.properties?.Path;
  if (typeof raw !== 'string' || raw.length === 0) return false;
  const path = raw.toLowerCase();
  return CRITICAL_PATH_SUBSTRINGS.some((p) => path.includes(p));
}

/** @internal */
export function isEnforcementField(field: string): boolean {
  const lower = field.toLowerCase();
  if (ENFORCEMENT_FIELD_KEYS.has(lower)) return true;
  // flattenProps produces dotted paths for nested objects; match the
  // first segment so `value.dword`, `data.string`, etc. are enforcement.
  const head = lower.split('.', 1)[0];
  return ENFORCEMENT_FIELD_KEYS.has(head);
}

function isComplianceOnlyField(field: string): boolean {
  const lower = field.toLowerCase();
  return (
    lower.includes("compliance") ||
    lower.includes("refresh") ||
    lower.includes("description")
  );
}

function parseManifest(content: string): ParsedResource[] {
  try {
    const doc = yaml.load(content) as Record<string, unknown> | null;
    if (!doc) return [];

    // Handle Resources array at top level or under a root key
    const resources = (doc.Resources ?? doc.resources ?? []) as ParsedResource[];
    if (Array.isArray(resources)) return resources;

    return [];
  } catch {
    return [];
  }
}

/**
 * Build a stable identity key for a resource so the diff can match the
 * SAME logical setting across two manifests even when the display name
 * has been reshuffled (which is exactly what happens across baseline
 * versions: `EnsureAuditUserAccountManagement-WS2019` becomes plain
 * `EnsureAuditUserAccountManagement` in WS2025, or `AuditLogon`
 * becomes `Audit Logon`, or a numbered prefix gets bumped from
 * `1.1.1.1 Foo` to `2.1.1.1 Foo`, or a Test wrapper gets added/
 * removed around an inner resource).
 *
 * Priority order — most specific identifier first:
 *
 *   1. Test wrapper (`Microsoft.OSConfig/Test`) — recurse into the
 *      inner `properties.resource`. The wrapper is enforcement
 *      bookkeeping; the inner resource is what the user thinks of.
 *
 *   2. Registry — `${type}:${keyPath}\\${valueName}`. Two manifests
 *      that audit the same registry path AND value name are
 *      semantically the same setting regardless of cosmetic name
 *      differences. Mirrors the matrix-diff `makeRowKey` contract.
 *
 *   3. AuditPolicy — `${type}:${subcategory}`. `subcategory` is an
 *      enum-constrained schema field (AuditLogon, AuditAccountLogon,
 *      etc.) and is the canonical CIS identifier. Display names like
 *      "Audit Logon" vs "AuditLogon" must match.
 *
 *   4. UserRightsAssignment / AccountPolicy — `${type}:${policy}`.
 *      `policy` is the canonical SID-privilege or account-policy name
 *      (e.g. SeAssignPrimaryTokenPrivilege, MinimumPasswordLength).
 *
 *   5. CSP / FileLine / Sshd / other path-shaped types — `${type}:${path}`.
 *
 *   6. BaselineRule placeholder — `${type}:rule:${ruleId}`. Imported
 *      Azure Policy GC catalog entries carry an opaque ruleId; that's
 *      the stable identifier across baseline-catalog refreshes.
 *
 *   7. Normalized display name — `${type}:name:${normalize(name)}`
 *      where normalize() strips all non-alphanumeric chars and
 *      lowercases. Catches cross-baseline naming-convention drift
 *      like `AuditLogon` vs `Audit Logon`, `PasswordAge_Maximum` vs
 *      `Password Age Maximum`, etc. — same rule, different style.
 *
 *   8. Last resort: the type itself (anonymous-rule bucket).
 *
 * The previous implementation returned `r.name ?? type` directly,
 * which made any cosmetic-only rename (including the very common
 * "concatenated vs spaced" naming-convention drift across CIS
 * benchmark versions) produce a phantom add + remove pair for the
 * same setting.
 */
function normalizeNameForIdentity(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resourceKey(r: ParsedResource): string {
  if (!r || typeof r !== "object") return "unknown";
  const type = typeof r.type === "string" ? r.type : "unknown";
  const props = (r.properties ?? {}) as Record<string, unknown>;

  // Test wrapper: peek at the inner resource. Two manifests that
  // both audit the same registry value should match even if one
  // wraps the resource in a Test gate and the other doesn't.
  if (type === "Microsoft.OSConfig/Test" && props.resource && typeof props.resource === "object") {
    return resourceKey(props.resource as ParsedResource);
  }

  // Registry semantic identity.
  const keyPath = typeof props.keyPath === "string" ? props.keyPath : undefined;
  const valueName = typeof props.valueName === "string" ? props.valueName : undefined;
  if (keyPath && valueName) return `${type}:${keyPath}\\${valueName}`;
  if (valueName) return `${type}:${valueName}`;

  // AuditPolicy schema-canonical identity. The `subcategory` enum
  // (AuditLogon, AuditAccountLogon, AuditAccountManagement, ...) is
  // the stable identifier; display names drift across baselines.
  if (type === "Microsoft.Windows/AuditPolicy") {
    const subcategory = typeof props.subcategory === "string" ? props.subcategory : undefined;
    if (subcategory) return `${type}:${subcategory}`;
  }

  // UserRightsAssignment / AccountPolicy schema-canonical identity.
  // `policy` is the SID privilege name (SeAssignPrimaryTokenPrivilege,
  // ...) or account-policy name (MinimumPasswordLength, ...).
  if (
    type === "Microsoft.Windows/UserRightsAssignment" ||
    type === "Microsoft.Windows/AccountPolicy"
  ) {
    const policy = typeof props.policy === "string" ? props.policy : undefined;
    if (policy) return `${type}:${policy}`;
  }

  // CSP / path-shaped types.
  const path = typeof props.path === "string" ? props.path : undefined;
  if (path) return `${type}:${path}`;

  // Imported BaselineRule placeholder — ruleId is the stable identity.
  const ruleId = typeof props.ruleId === "string" ? props.ruleId : undefined;
  if (ruleId) return `${type}:rule:${ruleId}`;

  // Normalize the display name before falling back to it. Strips
  // spaces, hyphens, underscores, and case so "AuditLogon",
  // "Audit Logon", "Audit-Logon", "audit_logon" all collide as the
  // same rule — which is what you want when comparing two
  // baselines that follow different naming conventions for the
  // same underlying setting.
  if (typeof r.name === "string" && r.name.trim()) {
    const normalized = normalizeNameForIdentity(r.name);
    if (normalized) return `${type}:name:${normalized}`;
    return r.name;
  }
  return type;
}

/**
 * User-facing label for a resource — what we want to surface in the
 * added/removed/changed lists in the UI. Always prefer the display
 * name when present so reports read like "EnsureFoo was renamed to
 * EnsureFoo-v2" instead of dumping the semantic identity key.
 */
function displayName(r: ParsedResource | undefined): string {
  if (!r) return "unknown";
  if (typeof r.name === "string" && r.name.trim()) return r.name;
  if (typeof r.type === "string" && r.type.trim()) return r.type;
  return "unknown";
}

function flattenProps(
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(result, flattenProps(val as Record<string, unknown>, path));
    } else {
      result[path] = val;
    }
  }
  return result;
}

/**
 * Flatten every field of a resource that the diff cares about — i.e.
 * everything except the structural keys (`type`/`properties`). Previously
 * only `resource.properties` was flattened, which meant the analyzer
 * missed changes to top-level resource fields like `compliance.equals`,
 * `dependsOn`, `condition`, etc. and reported "No differences detected"
 * for manifests that differed only in those fields.
 *
 * `name` IS included so renames surface as field-level changes (e.g.
 * `field: "name", from: "EnsureFoo-WS2019", to: "EnsureFoo"`). Resources
 * are now matched by semantic identity (keyPath + valueName, or
 * ruleId, etc.) so the name no longer doubles as the resource key
 * and is safe to diff as a regular field.
 *
 * Path convention:
 *   - `resource.properties.X` flattens to `X` (preserves the existing
 *     contract — `isEnforcementField` matches on the first segment of
 *     dotted paths like `value.dword`).
 *   - Every other top-level resource field flattens with its own
 *     prefix, so changes show up as `compliance.equals`, `dependsOn`,
 *     `condition`, `name`, etc.
 */
function flattenResourceForDiff(r: ParsedResource): Record<string, unknown> {
  const props = (r.properties ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...flattenProps(props) };
  for (const [k, v] of Object.entries(r)) {
    if (k === "type" || k === "properties") continue;
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenProps(v as Record<string, unknown>, k));
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compare two YAML manifests and produce a deterministic analysis.
 * No external AI service calls — all heuristic-based.
 *
 * # Matching algorithm — TWO passes
 *
 * Pass 1: match by `resourceKey()` (structural identity within a type).
 * Catches WS2019→WS2025 Registry-to-Registry renames, AuditPolicy
 * subcategory matches, etc.
 *
 * Pass 2 (added v0.2.5 — handles CROSS-TYPE matches): for resources
 * still unmatched after pass 1, look them up by NORMALIZED display
 * name across types. This catches the very common case where a rule
 * is encoded differently between baseline versions:
 *
 *   - WS2019: `Microsoft.Windows/AuditPolicy` with
 *             `subcategory: AuditAccountLockout`, name `Audit Account Lockout`
 *   - WS2025: `Microsoft.OSConfig/Test` wrapping `Microsoft.Windows/CSP`
 *             with `path: ./Vendor/.../AccountLockout`, name `AuditAccountLockout`
 *
 * Pass 1's structural keys are type-prefixed so these don't match
 * (`Microsoft.Windows/AuditPolicy:AuditAccountLockout` ≠
 * `Microsoft.Windows/CSP:./Vendor/.../AccountLockout`). The display
 * names, normalized to `auditaccountlockout`, DO match — that's the
 * cross-type bridge.
 *
 * Risk: a same-name-different-intent collision is technically
 * possible. In practice the only normalized-name collisions in real
 * baselines are exactly the rule renames we want to merge; for
 * self-service comparison this is a net win.
 */
/**
 * Pull the user-meaningful "what does this rule set the value to"
 * out of a resource, regardless of which schema shape it uses.
 *
 * Walks the same priority chain the matrix-diff `extractEnforcementValue`
 * uses, plus Test-wrapper recursion so the wrapped-inner-resource's
 * value is what gets returned (not the wrapper's schema/expression).
 *
 * Used by `analyzeDiff` cross-type matched pairs (Pass-2 matches) and
 * by `detectConflicts` so the conflict scan considers the same notion
 * of "value" that the matrix-diff does. For example: a WS2019
 * `Microsoft.Windows/AuditPolicy` rule with `value: 2` and a WS2025
 * `Microsoft.OSConfig/Test` wrapping `Microsoft.Windows/CSP` with inner
 * `value: 2` BOTH return `2` here.
 *
 * v0.2.16: hoisted from a nested closure inside `analyzeDiff` to
 * module scope so `detectConflicts` can reuse it without copy-pasting
 * the priority chain.
 */
function extractEnforcementValue(r: ParsedResource): unknown {
  if (!r || typeof r !== "object") return undefined;
  const type = typeof r.type === "string" ? r.type : "";
  const props = (r.properties ?? {}) as Record<string, unknown>;

  // Test wrapper: peek at the inner resource's value, not the
  // wrapper's schema/expression/template.
  if (type === "Microsoft.OSConfig/Test" && props.resource && typeof props.resource === "object") {
    return extractEnforcementValue(props.resource as ParsedResource);
  }

  // Compliance.equals beats inline value (canonical user intent;
  // matches the matrix-diff contract).
  const compliance = (r.compliance ?? {}) as Record<string, unknown>;
  if ("equals" in compliance) return compliance.equals;
  if ("contains" in compliance) return { contains: compliance.contains };
  if ("matches" in compliance) return { matches: compliance.matches };
  if ("regex" in compliance) return { regex: compliance.regex };

  if ("value" in props) {
    const v = props.value;
    // Typed registry value: `{ dword: 1 }` / `{ string: "Foo" }` —
    // unwrap to the single inner value when there's exactly one key.
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 1) return obj[keys[0]];
    }
    return v;
  }
  if ("data" in props) return props.data;
  if ("desired" in props) return props.desired;
  if ("Value" in props) return (props as Record<string, unknown>).Value;
  return undefined;
}

export function analyzeDiff(before: string, after: string): DiffAnalysis {
  const beforeResources = parseManifest(before);
  const afterResources = parseManifest(after);

  // ─── Pass 1: structural identity ───
  // Build maps keyed by structural identity. The same resource can
  // only own ONE map slot (insertion order wins on collision — that's
  // fine; collisions within a single manifest are pathological).
  const beforeStruct = new Map<string, ParsedResource>();
  const afterStruct = new Map<string, ParsedResource>();
  for (const r of beforeResources) beforeStruct.set(resourceKey(r), r);
  for (const r of afterResources) afterStruct.set(resourceKey(r), r);

  // Track matched resources by reference (sets of the actual objects).
  const matchedBefore = new Set<ParsedResource>();
  const matchedAfter = new Set<ParsedResource>();
  // matched[i] = { beforeRes, afterRes } pair, in stable iteration order
  const matchedPairs: { beforeRes: ParsedResource; afterRes: ParsedResource }[] = [];

  for (const [key, beforeRes] of Array.from(beforeStruct.entries())) {
    const afterRes = afterStruct.get(key);
    if (afterRes) {
      matchedPairs.push({ beforeRes, afterRes });
      matchedBefore.add(beforeRes);
      matchedAfter.add(afterRes);
    }
  }

  // ─── Pass 2: cross-type normalized-name fallback ───
  // For resources still unmatched, look them up by normalized name
  // (ignoring type). This handles the WS2019→WS2025 case where the
  // same rule is encoded as AuditPolicy in 2019 and CSP-wrapped-in-Test
  // in 2025: the display names normalize to the same string even
  // though the type+identity-field combos don't.
  const afterUnmatchedByName = new Map<string, ParsedResource>();
  for (const r of afterResources) {
    if (matchedAfter.has(r)) continue;
    const n = typeof r.name === "string" ? r.name : "";
    if (!n.trim()) continue;
    const k = normalizeNameForIdentity(n);
    if (!k) continue;
    // First-wins: if two unmatched after-resources normalize to the
    // same name, only the first claims the slot (the second stays
    // genuinely unmatched). This avoids silently collapsing distinct
    // settings that happen to share a normalized name.
    if (!afterUnmatchedByName.has(k)) afterUnmatchedByName.set(k, r);
  }

  for (const beforeRes of beforeResources) {
    if (matchedBefore.has(beforeRes)) continue;
    const n = typeof beforeRes.name === "string" ? beforeRes.name : "";
    if (!n.trim()) continue;
    const k = normalizeNameForIdentity(n);
    if (!k) continue;
    const afterRes = afterUnmatchedByName.get(k);
    if (afterRes && !matchedAfter.has(afterRes)) {
      matchedPairs.push({ beforeRes, afterRes });
      matchedBefore.add(beforeRes);
      matchedAfter.add(afterRes);
    }
  }

  // ─── Build the public-facing result ───
  const addedResources: string[] = [];
  const removedResources: string[] = [];
  const changedResources: ChangedResource[] = [];
  const changeResourceRefs: ParsedResource[] = [];

  for (const r of afterResources) {
    if (!matchedAfter.has(r)) addedResources.push(displayName(r));
  }
  for (const r of beforeResources) {
    if (!matchedBefore.has(r)) removedResources.push(displayName(r));
  }

  for (const { beforeRes, afterRes } of matchedPairs) {
    // Cross-type matched pair (Pass-2 hit): a WS2019
    // Microsoft.Windows/AuditPolicy and a WS2025
    // Microsoft.OSConfig/Test-wrapping-CSP for the same rule, etc.
    // The two encodings have completely different field sets, so a
    // naive `flattenResourceForDiff` comparison reports every
    // structural field as added or removed — 700+ noise changes for
    // a real WS2019 vs WS2025 diff that semantically has only the
    // few enforcement values that actually drifted.
    //
    // For these pairs we ONLY diff the extracted enforcement value
    // (the "what does this rule actually set" semantic). If the
    // values match across the type shift → zero changes reported,
    // which is the correct signal (this rule is the same in both
    // baselines, just encoded differently). If they differ → one
    // clean `value: <old> → <new>` row.
    const beforeType = typeof beforeRes.type === "string" ? beforeRes.type : "";
    const afterType = typeof afterRes.type === "string" ? afterRes.type : "";
    const isCrossType = beforeType !== afterType;

    const resourceLabel = displayName(afterRes);

    if (isCrossType) {
      const bVal = extractEnforcementValue(beforeRes);
      const aVal = extractEnforcementValue(afterRes);
      if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changedResources.push({ name: resourceLabel, field: "value", from: bVal, to: aVal });
        changeResourceRefs.push(afterRes);
      }
      continue;
    }

    // Same-type matched pair: do the full structural flatten-diff.
    // Both sides have the same field set, so each field-level
    // difference is meaningful (a real value change, a compliance
    // op change, a rename, etc.).
    const beforeFlat = flattenResourceForDiff(beforeRes);
    const afterFlat = flattenResourceForDiff(afterRes);

    const allFields = new Set([
      ...Object.keys(beforeFlat),
      ...Object.keys(afterFlat),
    ]);

    for (const field of Array.from(allFields)) {
      const bVal = beforeFlat[field];
      const aVal = afterFlat[field];
      if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changedResources.push({ name: resourceLabel, field, from: bVal, to: aVal });
        changeResourceRefs.push(afterRes);
      }
    }
  }

  // Risk assessment
  let riskLevel: RiskLevel = "low";
  let enforcementChanges = 0;
  let criticalChanges = 0;
  let complianceOnlyChanges = 0;

  for (let i = 0; i < changedResources.length; i++) {
    const change = changedResources[i];
    const res = changeResourceRefs[i];
    const critical = res ? isCriticalSetting(res) : false;

    if (isEnforcementField(change.field)) {
      enforcementChanges++;
      if (critical) criticalChanges++;
    } else if (isComplianceOnlyField(change.field)) {
      complianceOnlyChanges++;
    } else {
      enforcementChanges++;
      if (critical) criticalChanges++;
    }
  }

  if (criticalChanges > 0) riskLevel = "high";
  else if (enforcementChanges > 0) riskLevel = "medium";

  // Summary
  const parts: string[] = [];
  const totalModified =
    addedResources.length + removedResources.length + changedResources.length;
  if (totalModified === 0) {
    return attachLocalProvenance(
      {
        addedResources,
        removedResources,
        changedResources,
        riskLevel: "low" as RiskLevel,
        summary: "No differences detected between manifests",
      },
      [
        { name: "before", role: "input" },
        { name: "after", role: "input" },
      ]
    );
  }

  parts.push(`${totalModified} change${totalModified > 1 ? "s" : ""} detected`);
  if (addedResources.length)
    parts.push(`${addedResources.length} resource${addedResources.length > 1 ? "s" : ""} added`);
  if (removedResources.length)
    parts.push(`${removedResources.length} resource${removedResources.length > 1 ? "s" : ""} removed`);
  if (enforcementChanges)
    parts.push(
      `${enforcementChanges} enforcement value${enforcementChanges > 1 ? "s" : ""} changed (${riskLevel} risk)`
    );
  if (complianceOnlyChanges)
    parts.push(
      `${complianceOnlyChanges} compliance criteria updated`
    );

  return attachLocalProvenance(
    {
      addedResources,
      removedResources,
      changedResources,
      riskLevel,
      summary: parts.join(": "),
    },
    [
      { name: "before", role: "input" },
      { name: "after", role: "input" },
    ]
  );
}

/**
 * Check for conflicting settings across multiple manifests.
 *
 * A conflict is two-or-more manifests targeting the **same logical
 * setting** with **different enforcement values**. Same setting + same
 * value across baselines is intentional alignment, not a conflict.
 *
 * v0.2.16: rewritten to delegate identity and value extraction to the
 * canonical `resourceKey()` and `extractEnforcementValue()` helpers
 * already used by matrix-diff. The previous implementation rolled its
 * own naive `${type}|${keyPath}` key and `props.value` extraction,
 * which:
 *   - never unwrapped `Microsoft.OSConfig/Test` wrappers, so a Test-
 *     wrapped Registry resource and a bare Registry resource for the
 *     same setting were treated as different settings;
 *   - bucketed every Registry resource under its keyPath alone,
 *     ignoring `valueName`, so two resources writing different value
 *     names under the same key were falsely collapsed into one
 *     bucket and their distinct values were reported as a conflict;
 *   - dropped any resource that only used `compliance.equals` (i.e.
 *     report-only audits) because the naive extractor only checked
 *     `properties.value`-style fields. matrix-diff would correctly
 *     report drift on those resources, but this conflict detector
 *     silently ignored them.
 *
 * Cross-type pairs (e.g. WS2019 `Microsoft.Windows/AuditPolicy` vs.
 * WS2025 `Microsoft.OSConfig/Test`-wrapping-CSP for the same rule) are
 * matched by `resourceKey()`'s normalized-name fallback when the
 * schema-canonical identifiers don't apply, mirroring matrix-diff's
 * Pass-2 cross-type match.
 */
export function detectConflicts(
  manifests: { name: string; content: string }[]
): ConflictResult {
  type Entry = {
    manifest: string;
    value: unknown;
    displayLabel: string;
    type: string;
    /** Stable reference to the parsed resource so we can dedupe a
     * resource across the two-pass match (canonical + cross-encoding). */
    ref: ParsedResource;
  };

  // Pass 1 bucket: by schema-canonical identity (Test-unwrapped).
  // This handles the "same OS version" case where rules use the same
  // encoding — keyPath+valueName, subcategory GUID, policy name,
  // CSP path, etc.
  const canonicalMap = new Map<string, Entry[]>();
  // Pass 2 bucket: by normalized rule name only. This bridges the
  // cross-encoding case (WS2019 AuditPolicy w/ GUID subcategory vs.
  // WS2025 Microsoft.OSConfig/Test wrapping Microsoft.Windows/CSP with
  // a totally different identity field) — same logical rule, totally
  // different canonical key, but the human-facing name normalizes to
  // the same string. Mirrors matrix-diff's Pass-2 contract.
  const nameMap = new Map<string, Entry[]>();

  for (const { name: manifestName, content } of manifests) {
    const resources = parseManifest(content);
    for (const resource of resources) {
      const identityKey = resourceKey(resource);
      const value = extractEnforcementValue(resource);
      const label = displayName(resource) || identityKey;
      const entry: Entry = {
        manifest: manifestName,
        value,
        displayLabel: label,
        type: typeof resource.type === 'string' ? resource.type : 'unknown',
        ref: resource,
      };

      if (!canonicalMap.has(identityKey)) canonicalMap.set(identityKey, []);
      canonicalMap.get(identityKey)!.push(entry);

      // Also publish into the name-bucket — used by Pass 2 only when
      // the resource didn't already conflict on the canonical key.
      const rawName = displayName(resource);
      if (rawName) {
        const normalized = normalizeNameForIdentity(rawName);
        if (normalized) {
          if (!nameMap.has(normalized)) nameMap.set(normalized, []);
          nameMap.get(normalized)!.push(entry);
        }
      }
    }
  }

  // Helper: a bucket is a conflict if entries.length >= 2 AND the
  // distinct values differ AND they're not all nullish.
  //
  // v0.2.20: normalize "empty" representations to a single sentinel
  // before comparing. UserRights and similar policies represent
  // "nobody has this right" interchangeably as `""`, `[]`, `null`,
  // or absent — all the same security posture. The previous
  // `JSON.stringify(v ?? null)` treated `""` (`'""'`) and `[]`
  // (`'[]'`) as different and produced spurious cross-manifest
  // conflict cards for rules that all three baselines agree are
  // empty.
  const normalizeForCompare = (v: unknown): string => {
    if (v === undefined || v === null) return '∅';
    if (typeof v === 'string' && v === '') return '∅';
    if (Array.isArray(v) && v.length === 0) return '∅';
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0) {
      return '∅';
    }
    // For arrays of values (User Rights SIDs etc.) the underlying
    // policy is "the set of these principals." Two manifests that
    // ship the same set in different order should not show as
    // conflicting, so sort string-array elements before serializing.
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      return JSON.stringify([...(v as string[])].sort());
    }
    return JSON.stringify(v);
  };

  const isConflictBucket = (entries: Entry[]): boolean => {
    if (entries.length < 2) return false;
    // Only count one entry per manifest in the "do values differ"
    // check — two copies of the same rule inside one manifest with
    // the same value isn't a cross-manifest conflict. Two copies
    // inside one manifest with DIFFERENT values is a real intra-
    // manifest conflict and we still want to surface it; that's
    // why we check distinct manifests too.
    const distinctManifests = new Set(entries.map((e) => e.manifest));
    if (distinctManifests.size < 2 && entries.length < 2) return false;

    const serialized = entries.map((e) => normalizeForCompare(e.value));
    const uniqueValues = new Set(serialized);
    if (uniqueValues.size <= 1) return false;
    // Now also collapse "all empty / nullish" by checking whether
    // every distinct serialization is the empty sentinel.
    const allEmpty = serialized.every((s) => s === '∅');
    if (allEmpty) return false;
    return true;
  };

  const conflicts: Conflict[] = [];
  // Track resources that have already been reported as part of a
  // Pass-1 (canonical) conflict, so we don't re-flag them under a
  // Pass-2 (name-only) conflict for the same logical setting.
  const claimedRefs = new Set<ParsedResource>();
  // Pass-1 conflicts also pre-empt any cross-encoding name bucket
  // that's just the same canonical bucket viewed by name. Track
  // normalized names that were already covered by a Pass-1 conflict.
  const claimedNames = new Set<string>();

  // ── Pass 1: canonical identity ────────────────────────────────────
  for (const [key, entries] of Array.from(canonicalMap.entries())) {
    if (!isConflictBucket(entries)) continue;

    for (const e of entries) {
      claimedRefs.add(e.ref);
      const rawName = displayName(e.ref);
      if (rawName) {
        const normalized = normalizeNameForIdentity(rawName);
        if (normalized) claimedNames.add(normalized);
      }
    }

    const label = entries[0]!.displayLabel;
    const types = Array.from(new Set(entries.map((e) => e.type)));
    const setting =
      types.length === 1
        ? `${label} (${types[0]})`
        : `${label} [${types.join(' / ')}]`;

    conflicts.push({
      setting:
        setting +
        (key.includes(':rule:') || key.includes(':name:') ? '' : ` — ${key}`),
      manifests: entries.map((e) => e.manifest),
      values: entries.map((e) => e.value),
    });
  }

  // ── Pass 2: cross-encoding normalized-name match ──────────────────
  //
  // For any normalized name bucket that wasn't already covered by a
  // Pass-1 conflict, check if the *remaining* (non-claimed) entries
  // form a conflict. This is the WS2019→WS2025 cross-OS-version
  // case: rules with completely different schema-canonical IDs that
  // share the same human-facing name normalize to the same string.
  for (const [nameKey, entries] of Array.from(nameMap.entries())) {
    if (claimedNames.has(nameKey)) continue;
    const remaining = entries.filter((e) => !claimedRefs.has(e.ref));
    if (!isConflictBucket(remaining)) continue;

    // Cross-encoding match: the conflict is reported even though the
    // canonical keys differ. Surface the type list so the user can
    // tell that it's a cross-encoding bridge match, not a same-type
    // collision. Examples in real WS2019→WS2025 diffs:
    //   AuditAccountLockout — [Microsoft.Windows/AuditPolicy / Microsoft.OSConfig/Test]
    const label = remaining[0]!.displayLabel;
    const types = Array.from(new Set(remaining.map((e) => e.type)));
    conflicts.push({
      setting: `${label} [${types.join(' / ')}]`,
      manifests: remaining.map((e) => e.manifest),
      values: remaining.map((e) => e.value),
    });

    for (const e of remaining) claimedRefs.add(e.ref);
  }

  return { conflicts };
}

// ── PR23: explainDelta ──────────────────────────────────────────────────────

export interface DeltaExplanation {
  /** 1-3 sentence semantic explanation of the cell-level delta. */
  explanation: string;
  /** 0..1 deterministic confidence score for the heuristic match. */
  confidence: number;
}

/**
 * Generate a 1-2 sentence explanation of why two baselines disagree on a
 * single setting. Pure local heuristics — NO external LLM call. Output
 * is deterministic and cacheable per (rule, valueA, valueB, baselines).
 *
 * Confidence reflects how much the heuristic is "really known" vs.
 * pattern-matched. A registered Windows registry value with a numeric
 * delta and a known critical hive scores high; a free-form unknown
 * value pair scores low.
 */
export function explainDelta(
  rule: { type: string; name: string },
  valueA: unknown,
  valueB: unknown,
  baselineNames: [string, string],
): DeltaExplanation {
  const [aName, bName] = baselineNames;
  const aLabel = formatValue(valueA);
  const bLabel = formatValue(valueB);

  // Same value → no delta to explain.
  if (JSON.stringify(valueA) === JSON.stringify(valueB)) {
    return {
      explanation: `${aName} and ${bName} both set ${rule.name} to ${aLabel}; no delta.`,
      confidence: 1,
    };
  }

  // Only-in-one (one side missing). The matrix surfaces this case.
  if (valueA === undefined || valueA === null) {
    return {
      explanation: `${rule.name} is only enforced in ${bName} (set to ${bLabel}); ${aName} leaves it unmanaged.`,
      confidence: 0.85,
    };
  }
  if (valueB === undefined || valueB === null) {
    return {
      explanation: `${rule.name} is only enforced in ${aName} (set to ${aLabel}); ${bName} leaves it unmanaged.`,
      confidence: 0.85,
    };
  }

  // Numeric delta: derive a stricter/looser narrative for known
  // monotonic settings.
  if (typeof valueA === 'number' && typeof valueB === 'number') {
    const direction = inferStricterDirection(rule.name);
    if (direction === 'lower-is-stricter') {
      const stricter = valueA < valueB ? aName : bName;
      const looser = stricter === aName ? bName : aName;
      const stricterVal = stricter === aName ? aLabel : bLabel;
      const looserVal = stricter === aName ? bLabel : aLabel;
      return {
        explanation: `${stricter} sets ${rule.name} to ${stricterVal} (stricter); ${looser} sets it to ${looserVal}.`,
        confidence: 0.8,
      };
    }
    if (direction === 'higher-is-stricter') {
      const stricter = valueA > valueB ? aName : bName;
      const looser = stricter === aName ? bName : aName;
      const stricterVal = stricter === aName ? aLabel : bLabel;
      const looserVal = stricter === aName ? bLabel : aLabel;
      return {
        explanation: `${stricter} sets ${rule.name} to ${stricterVal} (stricter); ${looser} sets it to ${looserVal}.`,
        confidence: 0.8,
      };
    }
    // Unknown direction — generic numeric narrative.
    return {
      explanation: `${aName} sets ${rule.name} to ${aLabel}; ${bName} sets it to ${bLabel}.`,
      confidence: 0.6,
    };
  }

  // Boolean delta (REG_DWORD 0/1 is also matched above — this is the
  // explicit-bool case for non-registry resources).
  if (typeof valueA === 'boolean' && typeof valueB === 'boolean') {
    const enabled = valueA ? aName : bName;
    const disabled = enabled === aName ? bName : aName;
    return {
      explanation: `${enabled} enables ${rule.name}; ${disabled} disables it.`,
      confidence: 0.75,
    };
  }

  // String delta.
  if (typeof valueA === 'string' && typeof valueB === 'string') {
    return {
      explanation: `${aName} sets ${rule.name} to "${aLabel}"; ${bName} sets it to "${bLabel}".`,
      confidence: 0.5,
    };
  }

  // Fallback for arbitrary object shapes.
  return {
    explanation: `${aName} sets ${rule.name} to ${aLabel}; ${bName} sets it to ${bLabel}.`,
    confidence: 0.4,
  };
}

/** @internal */
export const LOWER_IS_STRICTER_HINTS: readonly string[] = [
  'maxauthtries',
  'idletimeout',
  'lockoutduration',
  'lockoutthreshold',
  'sessiontimeout',
  'maxlogins',
  'maxretries',
  'failedlogin',
];

/** @internal */
export const HIGHER_IS_STRICTER_HINTS: readonly string[] = [
  'minlength',
  'minimumpasswordlength',
  'passwordhistory',
  'passwordminlength',
  'auditloglength',
  'maxlogsize',
];

function inferStricterDirection(
  ruleName: string,
): 'lower-is-stricter' | 'higher-is-stricter' | 'unknown' {
  const lower = ruleName.toLowerCase();
  if (LOWER_IS_STRICTER_HINTS.some((h) => lower.includes(h))) return 'lower-is-stricter';
  if (HIGHER_IS_STRICTER_HINTS.some((h) => lower.includes(h))) return 'higher-is-stricter';
  return 'unknown';
}

function formatValue(v: unknown): string {
  if (v === undefined) return '(unset)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Generate a structured changelog from two YAML manifest versions.
 */
export function generateChangelog(
  before: string,
  after: string,
  manifestName: string
): Changelog {
  const analysis = analyzeDiff(before, after);
  const changes: ChangelogEntry[] = [];

  for (const name of analysis.addedResources) {
    changes.push({ field: `Added resource: ${name}`, from: undefined, to: "(new)" });
  }

  for (const name of analysis.removedResources) {
    changes.push({ field: `Removed resource: ${name}`, from: "(existed)", to: undefined });
  }

  for (const change of analysis.changedResources) {
    changes.push({
      field: `${change.name} → ${change.field}`,
      from: change.from,
      to: change.to,
    });
  }

  const base: Changelog = {
    date: new Date().toISOString().split("T")[0],
    manifestName,
    changes,
  };

  // Render a human-readable form, then tag it as AI-generated so a future
  // call to `assertNotAiGenerated` can refuse to ground on it. NOTE:
  // `assertNotAiGenerated` is available in circular-guard but is not
  // currently wired into any ingestion path, so this marker is advisory
  // today (labeling, not enforcement).
  const rendered = [
    `# Changelog — ${manifestName}`,
    `Generated ${base.date}`,
    "",
    ...changes.map((c) => `- ${c.field}: ${String(c.from)} → ${String(c.to)}`),
  ].join("\n");
  const taggedContent = tagAsAiGenerated(rendered, 1);

  return attachLocalProvenance(
    { ...base, taggedContent },
    [
      { name: manifestName, role: "before" },
      { name: manifestName, role: "after" },
    ]
  );
}

/**
 * Render a Changelog as a clean, human-readable Markdown document for
 * download. Groups added / removed / changed resources into separate
 * sections, lists value transitions with code-formatted before/after,
 * and includes a footer explaining the source manifests.
 *
 * The output is wrapped with the `<!-- ai-generated -->` marker so that
 * re-fed content is *detectable* by `assertNotAiGenerated`. The marker is
 * an HTML comment, so it's invisible when the file is rendered as
 * Markdown. NOTE: the ingestion-time check is not currently wired into
 * the analyzer, so the marker is advisory (labeling, not enforcement).
 */
export function renderChangelogMarkdown(
  changelog: Changelog,
  options: { beforeLabel?: string; afterLabel?: string } = {}
): string {
  const { beforeLabel = "before", afterLabel = "after" } = options;
  const lines: string[] = [];

  lines.push(`# Changelog — ${changelog.manifestName}`);
  lines.push("");
  lines.push(`_Generated ${changelog.date} by ConfigForge._`);
  lines.push("");
  lines.push(`Comparing **${beforeLabel}** → **${afterLabel}**.`);
  lines.push("");

  if (changelog.changes.length === 0) {
    lines.push("No changes detected.");
  } else {
    const added = changelog.changes.filter((c) => c.field.startsWith("Added resource: "));
    const removed = changelog.changes.filter((c) => c.field.startsWith("Removed resource: "));
    const modified = changelog.changes.filter(
      (c) => !c.field.startsWith("Added resource: ") && !c.field.startsWith("Removed resource: ")
    );

    if (added.length > 0) {
      lines.push(`## Added (${added.length})`);
      lines.push("");
      for (const c of added) {
        const name = c.field.replace(/^Added resource: /, "");
        lines.push(`- \`${name}\``);
      }
      lines.push("");
    }

    if (removed.length > 0) {
      lines.push(`## Removed (${removed.length})`);
      lines.push("");
      for (const c of removed) {
        const name = c.field.replace(/^Removed resource: /, "");
        lines.push(`- \`${name}\``);
      }
      lines.push("");
    }

    if (modified.length > 0) {
      lines.push(`## Changed (${modified.length})`);
      lines.push("");
      for (const c of modified) {
        const fromStr = c.from === undefined ? "(unset)" : String(c.from);
        const toStr = c.to === undefined ? "(unset)" : String(c.to);
        lines.push(`- **${c.field}**: \`${fromStr}\` → \`${toStr}\``);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("_This changelog was generated by ConfigForge from a manifest diff. " +
    "Re-importing it as a baseline source is refused by the circular-reference guard._");

  const rendered = lines.join("\n");
  return tagAsAiGenerated(rendered, 1);
}

// ── Provenance helpers ───────────────────────────────────────────────────────

/**
 * Attach `kind: 'manifest'` provenance to a response, derived from the
 * inputs the analyzer actually saw. Confidence is 1.0 for manifests
 * because they're authoritative ground truth — they're the user's own
 * registered configuration, not a probabilistic AI output.
 *
 * Use this for any deterministic AI-adjacent function whose only sources
 * are the input manifests themselves.
 */
export function attachLocalProvenance<T extends object>(
  response: T,
  inputs: Array<{ name: string; role?: string }>
): T & { provenance: Provenance } {
  const sources: AiSource[] = inputs.map((i) => ({
    kind: "manifest",
    label: i.role ? `${i.name} (${i.role})` : i.name,
    confidence: 1,
  }));
  return decorateWithProvenance(response, sources);
}
