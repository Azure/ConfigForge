// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * PR23: master-matrix N-way diff.
 *
 * Pure module — no I/O. Given N parsed manifest documents, produces a
 * 2-D matrix where each row is a setting and each column is a baseline.
 * The row-key construction merges the "same setting" across baselines
 * even when the resource `name` field differs (which it often does
 * across CIS WS2022 vs WS2025 baselines for the same registry value).
 *
 * Why not key by `name` alone? Two manifests authored independently
 * for the same MaxAuthTries value will likely use different display
 * names ("MaxAuthTries-WS2022" vs "MaxAuthTries"). Keying by
 * `(type, valueName | name | keyPath\\valueName)` merges them.
 */

/**
 * Tokenize a string with two-pass PascalCase splitting that also
 * handles ABBR+Word boundaries.
 *
 * Inlined here (rather than imported from `../cis/xccdf-parser`)
 * because this module is loaded by the renderer (via
 * apps/desktop/src/pages/Diff/state/useDiffMatrix.ts), and
 * `xccdf-parser.ts` transitively imports `node:fs/promises` +
 * `fast-xml-parser` which break the browser/Electron-renderer bundle.
 * The function is a pure string transform; keep a local copy.
 */
function splitPascalCase(s: string): string[] {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ABBR+Word boundary
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')      // lower-upper boundary
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

const MAX_DEPTH = 50;

export type CellStatus =
  | 'identical' // value matches the first non-empty baseline value
  | 'differs'   // value present and disagrees with the first baseline
  | 'missing';  // setting not present in this baseline

export interface MatrixCell {
  /** Raw enforcement value (or undefined if the setting is absent). */
  value: unknown;
  status: CellStatus;
  /** True when the resource is wrapped in a `Microsoft.OSConfig/Test`. */
  fromTestWrapper?: boolean;
}

export interface MatrixRow {
  /** Stable key used to merge the same setting across baselines. */
  key: string;
  /** Resource type (e.g. `Microsoft.Windows/Registry`). */
  type: string;
  /** Best-effort display name (first non-empty across baselines). */
  name: string;
  /** Registry valueName, if applicable. */
  valueName?: string;
  /** Registry keyPath, if applicable. */
  keyPath?: string;
  /** Per-baseline cells. Map keyed by manifest name. */
  values: Record<string, MatrixCell>;
  /** identical = all present cells equal; differs = ≥2 present, disagree;
   *  partial  = present in some baselines, missing in others. */
  status: 'identical' | 'differs' | 'partial';
}

export interface BuildMatrixInput {
  name: string;
  /** Parsed YAML doc — typically the result of `parseYamlDocument(text)`. */
  doc: unknown;
}

interface FlatResource {
  type: string;
  name: string;
  properties: Record<string, unknown>;
  /**
   * Resource-level `compliance` block (sibling of `properties`), captured
   * so the matrix can compare the user-declared expected value. Most
   * manifests authored via the CSV/security-definition importer or by
   * hand use `compliance: { equals: X }` instead of an inline
   * `properties.value`. Without this field the matrix builder couldn't
   * tell apart two manifests that target the same registry path with
   * different desired values — every row collapsed to "identical."
   */
  compliance?: unknown;
  fromTestWrapper: boolean;
}

/**
 * Build a master matrix from N manifest documents.
 *
 * Order of `manifests` matters: the first manifest is the reference for
 * cell-status comparison (identical vs differs).
 */
export function buildMatrix(manifests: BuildMatrixInput[]): MatrixRow[] {
  if (!Array.isArray(manifests) || manifests.length === 0) return [];

  const baselineNames = manifests.map((m) => m.name);

  // Map of rowKey -> partial row, populated as we walk each manifest.
  const rows = new Map<string, MatrixRow>();

  for (const { name: bname, doc } of manifests) {
    const flat = flattenManifest(doc);
    for (const r of flat) {
      const key = makeRowKey(r);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          type: r.type,
          name: r.name || (r.properties.valueName as string | undefined) || '',
          valueName: getString(r.properties, 'valueName'),
          keyPath: getString(r.properties, 'keyPath'),
          values: {},
          status: 'identical',
        };
        rows.set(key, row);
      }
      // Prefer first non-empty display values across baselines.
      if (!row.name && r.name) row.name = r.name;
      if (!row.valueName) row.valueName = getString(r.properties, 'valueName');
      if (!row.keyPath) row.keyPath = getString(r.properties, 'keyPath');

      const value = extractEnforcementValue(r.properties, r.compliance);
      row.values[bname] = {
        value,
        status: 'identical', // refined in pass-2
        fromTestWrapper: r.fromTestWrapper || undefined,
      };
    }
  }

  // Pass-1.5: merge rows that ended up under different structural keys
  // but represent the same logical setting across baseline versions.
  // This handles the WS2019→WS2025 type shift where the same rule is
  // encoded as e.g. Microsoft.Windows/AuditPolicy (WS2019) and
  // Microsoft.Windows/CSP (WS2025 via Test wrapper unwrap). Each
  // baseline's row has the other side as "missing"; after merge they
  // share a single row with both values present.
  const rawRows = Array.from(rows.values());
  const exactMerged = mergeRowsByNormalizedName(rawRows, baselineNames);
  const merged = mergeRowsByWordSetOverlap(exactMerged, baselineNames);

  // Pass-2: compute per-cell + per-row status against the first baseline
  // that ACTUALLY has the row populated.
  const out: MatrixRow[] = [];
  for (const row of merged) {
    const presentBaselines = baselineNames.filter((n) => row.values[n] !== undefined);
    const missingCount = baselineNames.length - presentBaselines.length;

    // Reference: first baseline with a value.
    const refName = presentBaselines[0];
    const refValue = refName !== undefined ? row.values[refName].value : undefined;
    const refSerialized = serialize(refValue);

    let differCount = 0;
    for (const bname of baselineNames) {
      const cell = row.values[bname];
      if (!cell) {
        // Materialize a missing cell so the UI can render an empty column.
        row.values[bname] = { value: undefined, status: 'missing' };
        continue;
      }
      if (serialize(cell.value) === refSerialized) {
        cell.status = 'identical';
      } else {
        cell.status = 'differs';
        differCount++;
      }
    }

    // v0.2.19: PRIORITY FIX — `differs` wins over `partial`.
    //
    // Previously the order was reversed:
    //   if (missingCount > 0 && presentBaselines.length > 0) → 'partial'
    //   else if (differCount > 0)                            → 'differs'
    //   else                                                  → 'identical'
    //
    // That meant any rule absent from at least one baseline got
    // `'partial'` regardless of whether the present baselines actually
    // agreed on a value or wildly disagreed. So `WS2019=1, WS2022=missing,
    // WS2025=0` showed up as "partial" — masking a real value drift
    // behind a "presence gap" classification.
    //
    // Correct semantics:
    //   - identical : every baseline has this rule with the same value.
    //   - differs   : ≥2 baselines have this rule AND they disagree on
    //                 value. (Whether some other baselines are missing
    //                 it doesn't change the fact that there's drift
    //                 among the ones that have it.)
    //   - partial   : ≥1 baseline has this rule, ≥1 baseline doesn't,
    //                 AND all the present-cells agree on value. (Pure
    //                 presence asymmetry, no value disagreement —
    //                 typically a rule that was added in a newer OS
    //                 version baseline.)
    if (differCount > 0) row.status = 'differs';
    else if (missingCount > 0 && presentBaselines.length > 0) row.status = 'partial';
    else row.status = 'identical';

    out.push(row);
  }

  // Stable, deterministic order: by type then key.
  out.sort((a, b) => (a.type === b.type ? a.key.localeCompare(b.key) : a.type.localeCompare(b.type)));
  return out;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function getString(props: Record<string, unknown>, key: string): string | undefined {
  const v = props[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The same row-key recipe used by analyzer's conflict detection but
 * extended to handle Test-wrapper inner resources and registry-style
 * settings. Stable across baselines because it does NOT include the
 * baseline name nor a free-form display name.
 *
 * Priority order (mirrors the analyzer's `resourceKey()`):
 *   1. Registry: `${type}:${keyPath}\\${valueName}`
 *   2. AuditPolicy: `${type}:${subcategory}`
 *   3. UserRightsAssignment / AccountPolicy: `${type}:${policy}`
 *   4. CSP / path-shaped: `${type}:${path}`
 *   5. Name fallback: `${type}:${name}`
 *   6. keyPath-only: `${type}:${keyPath}`
 *   7. Anonymous: `${type}:<anonymous>`
 */
/**
 * Normalize the registry hive portion of a keyPath so that
 * abbreviations (HKLM, HKCU, etc.) collide with their full forms
 * (HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER, ...). Cross-baseline
 * authors use both styles for the same logical setting — without
 * this, two manifests targeting the same registry value end up
 * under different row keys.
 */
function normalizeKeyPath(keyPath: string): string {
  if (!keyPath) return keyPath;
  // Strip trailing colon from "HKLM:" prefix and trailing/leading whitespace.
  let p = keyPath.trim();
  const m = p.match(/^([A-Z_]+):?[\\/]+(.*)$/i);
  if (!m) return p;
  const rawHive = m[1].toUpperCase();
  const rest = m[2];
  const hive =
    rawHive === 'HKLM' ? 'HKEY_LOCAL_MACHINE' :
    rawHive === 'HKCU' ? 'HKEY_CURRENT_USER' :
    rawHive === 'HKCR' ? 'HKEY_CLASSES_ROOT' :
    rawHive === 'HKU'  ? 'HKEY_USERS' :
    rawHive === 'HKCC' ? 'HKEY_CURRENT_CONFIG' :
    rawHive;
  return `${hive}\\${rest}`;
}

function makeRowKey(r: FlatResource): string {
  const valueName = getString(r.properties, 'valueName');
  const rawKeyPath = getString(r.properties, 'keyPath');
  const keyPath = rawKeyPath ? normalizeKeyPath(rawKeyPath) : rawKeyPath;
  if (valueName && keyPath) return `${r.type}:${keyPath}\\${valueName}`;
  if (valueName) return `${r.type}:${valueName}`;

  // AuditPolicy schema-canonical identity.
  if (r.type === 'Microsoft.Windows/AuditPolicy') {
    const subcategory = getString(r.properties, 'subcategory');
    if (subcategory) return `${r.type}:${subcategory}`;
  }

  // UserRightsAssignment / AccountPolicy schema-canonical identity.
  if (
    r.type === 'Microsoft.Windows/UserRightsAssignment' ||
    r.type === 'Microsoft.Windows/AccountPolicy'
  ) {
    const policy = getString(r.properties, 'policy');
    if (policy) return `${r.type}:${policy}`;
  }

  // CSP / path-shaped.
  const path = getString(r.properties, 'path');
  if (path) return `${r.type}:${path}`;

  // BaselineRule placeholder — ruleId is the stable identity.
  const ruleId = getString(r.properties, 'ruleId');
  if (ruleId) return `${r.type}:rule:${ruleId}`;

  // Normalize the name fallback (mirrors analyzer's name: prefix).
  if (r.name) {
    const normalized = normalizeNameForMerge(r.name);
    if (normalized) return `${r.type}:name:${normalized}`;
    return `${r.type}:${r.name}`;
  }
  if (keyPath) return `${r.type}:${keyPath}`;
  return `${r.type}:<anonymous>`;
}

/**
 * Normalize a display name for cross-type merging. Same algorithm as
 * the analyzer's `normalizeNameForIdentity()` — lowercase + strip
 * all non-alphanumeric characters so "Audit Account Lockout",
 * "AuditAccountLockout", "audit_account_lockout" all collapse to
 * "auditaccountlockout".
 */
function normalizeNameForMerge(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Common Windows policy category prefixes that appear in WS2019-era
 * human-readable rule names but NOT in WS2025-era OSConfig PascalCase
 * names. Stripping these lets `Network access: Allow anonymous SID/Name
 * translation` (2019) match `AllowAnonymousSIDOrNameTranslation` (2025)
 * via the word-set overlap pass below.
 */
const POLICY_CATEGORY_PREFIXES = [
  /^accounts:\s*/i,
  /^audit:\s*/i,
  /^audit\s+policy:\s*/i,
  /^account\s+lockout\s+policy:\s*/i,
  /^account\s+policies?:\s*/i,
  /^devices:\s*/i,
  /^domain\s+controller:\s*/i,
  /^domain\s+member:\s*/i,
  /^interactive\s+logon:\s*/i,
  /^microsoft\s+network\s+(client|server):\s*/i,
  /^network\s+access:\s*/i,
  /^network\s+security:\s*/i,
  /^password\s+policy:\s*/i,
  /^recovery\s+console:\s*/i,
  /^shutdown:\s*/i,
  /^system\s+(audit|cryptography|objects|settings):\s*/i,
  /^user\s+account\s+control:\s*/i,
  /^user\s+rights\s+assignment:\s*/i,
  /^mss\s+\([^)]+\)\s*/i, // "MSS (NoNameReleaseOnDemand) ..."
];

/** Filler words to exclude from word-set comparison so they don't dilute Jaccard. */
const NAME_TOKEN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'over', 'when',
  'where', 'will', 'should', 'must', 'have', 'has', 'set', 'ensure',
  'configure', 'enable', 'enabled', 'disable', 'disabled',
  'allow', 'allowed', 'deny', 'denied', // very common — keeping these would help match but also hurt precision
  'value', 'type', 'this', 'that', 'these', 'those',
  // Bridging words between conventions
  'or', 'of', 'on', 'an', 'is', 'be', 'to', 'a',
]);

/**
 * Tokenize a manifest resource name into a word set suitable for
 * cross-naming-convention matching. Handles:
 *   - Human-readable titles ("Network access: Allow anonymous SID/Name translation")
 *   - PascalCase identifiers ("AllowAnonymousSIDOrNameTranslation")
 *   - Underscore-separated ("Audit_Credential_Validation")
 *   - Mixed punctuation ("MSS: (NoNameReleaseOnDemand) Allow ...")
 *
 * After stripping Windows policy category prefixes, runs the same
 * PascalCase splitter the CIS matcher uses (so ABBR+Word boundaries
 * like "SIDOr" → "SID Or" are handled), lowercases, filters
 * stopwords, and returns a Set.
 */
export function extractNameWords(name: string): Set<string> {
  if (!name) return new Set();
  let s = name;
  for (const re of POLICY_CATEGORY_PREFIXES) {
    s = s.replace(re, '');
  }
  // splitPascalCase already lowercases, removes non-alphanum, and
  // filters length > 2. We additionally strip stopwords.
  const tokens = splitPascalCase(s);
  return new Set(tokens.filter((t) => !NAME_TOKEN_STOPWORDS.has(t)));
}

/**
 * Types known to encode the same logical Windows security settings
 * across baseline versions. Restricting cross-type merge to this set
 * prevents false positives when two genuinely different settings happen
 * to share a normalized display name.
 *
 * The "security setting" equivalence class: AuditPolicy, CSP,
 * UserRightsAssignment, AccountPolicy, and Registry can all represent
 * the same underlying Windows policy depending on the baseline vintage.
 */
const CROSS_TYPE_MERGE_ELIGIBLE = new Set([
  'Microsoft.Windows/AuditPolicy',
  'Microsoft.Windows/CSP',
  'Microsoft.Windows/UserRightsAssignment',
  'Microsoft.Windows/AccountPolicy',
  'Microsoft.Windows/Registry',
]);

/**
 * Two rows are eligible for cross-type merge if both types are in
 * the known equivalence class, OR if they share the same type
 * (same-type merge is always safe — it's the same schema with
 * different structural keys that didn't collide).
 */
function isMergeEligible(typeA: string, typeB: string): boolean {
  if (typeA === typeB) return true;
  return CROSS_TYPE_MERGE_ELIGIBLE.has(typeA) && CROSS_TYPE_MERGE_ELIGIBLE.has(typeB);
}

/**
 * Post-build merge pass: find rows that ended up in separate
 * structural-key slots but represent the same logical setting across
 * baseline versions (e.g. WS2019 Microsoft.Windows/AuditPolicy vs
 * WS2025 Microsoft.Windows/CSP for "Audit Account Lockout").
 *
 * Two rows are merge candidates when:
 *   1. They share the same normalized display name.
 *   2. Both types belong to the CROSS_TYPE_MERGE_ELIGIBLE set (or
 *      are the same type).
 *   3. Their baseline-cell sets are disjoint (no baseline appears in
 *      both rows — if they DO overlap, they're genuinely different
 *      settings that happen to share a normalized name).
 *
 * When merged:
 *   - The surviving row gets ALL cells from both rows.
 *   - The surviving row keeps the first row's key/type/name (arbitrary
 *     but stable — whichever row was inserted first into the Map).
 *   - The donor row is dropped from the output.
 */
function mergeRowsByNormalizedName(
  rows: MatrixRow[],
  baselineNames: string[],
): MatrixRow[] {
  // Index: normalizedName → list of row indices.
  const byNorm = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const n = rows[i].name ? normalizeNameForMerge(rows[i].name) : '';
    if (!n) continue;
    const list = byNorm.get(n);
    if (list) list.push(i);
    else byNorm.set(n, [i]);
  }

  const absorbed = new Set<number>();

  for (const indices of Array.from(byNorm.values())) {
    if (indices.length < 2) continue;

    // Try to merge each pair. We use a greedy approach: the first
    // row in the group absorbs compatible later rows.
    for (let i = 0; i < indices.length; i++) {
      const targetIdx = indices[i];
      if (absorbed.has(targetIdx)) continue;
      const target = rows[targetIdx];

      for (let j = i + 1; j < indices.length; j++) {
        const donorIdx = indices[j];
        if (absorbed.has(donorIdx)) continue;
        const donor = rows[donorIdx];

        // Type-pair guard: only merge rows whose types belong to the
        // same known equivalence class (e.g. AuditPolicy ↔ CSP).
        if (!isMergeEligible(target.type, donor.type)) continue;

        // Check disjointness: no baseline should have a real (non-missing)
        // cell in both rows.
        let overlap = false;
        for (const bname of baselineNames) {
          const tCell = target.values[bname];
          const dCell = donor.values[bname];
          const tPresent = tCell && tCell.status !== 'missing';
          const dPresent = dCell && dCell.status !== 'missing';
          if (tPresent && dPresent) {
            overlap = true;
            break;
          }
        }
        if (overlap) continue;

        // Merge: copy donor's present cells into target.
        for (const bname of baselineNames) {
          const dCell = donor.values[bname];
          if (dCell && dCell.status !== 'missing') {
            target.values[bname] = dCell;
          }
        }
        // Prefer non-empty display fields.
        if (!target.name && donor.name) target.name = donor.name;
        if (!target.valueName && donor.valueName) target.valueName = donor.valueName;
        if (!target.keyPath && donor.keyPath) target.keyPath = donor.keyPath;

        absorbed.add(donorIdx);
      }
    }
  }

  if (absorbed.size === 0) return rows;
  return rows.filter((_, i) => !absorbed.has(i));
}

/**
 * Pass-1.6: word-set overlap merge for rows the exact-name pass
 * couldn't combine. Catches the WS2019 vs WS2025 naming-convention
 * shift where the same setting is encoded as:
 *
 *   WS2019: name = "Network access: Allow anonymous SID/Name translation"
 *   WS2025: name = "AllowAnonymousSIDOrNameTranslation"
 *
 * The exact normalize sees "networkaccessallowanonymoussidnametranslation"
 * vs "allowanonymoussidornametranslation" — no match. The word-set
 * pass tokenizes both (stripping "Network access:" prefix and
 * splitting PascalCase ABBR+Word) to get
 *   {allow, anonymous, sid, name, translation}
 *   {allow, anonymous, sid, name, translation}   (after stopword "or" filter)
 * → Jaccard 1.0 → merge.
 *
 * Guardrails to avoid false positives:
 *   - Both rows must be in CROSS_TYPE_MERGE_ELIGIBLE
 *   - Both word sets must have ≥3 tokens (avoid 1-2 word generic hits)
 *   - Jaccard similarity ≥ 0.75
 *   - Disjoint baseline cells (same as exact pass)
 *   - If both rows have distinct registry keyPaths, skip (those are
 *     hard-distinct identities)
 */
function mergeRowsByWordSetOverlap(
  rows: MatrixRow[],
  baselineNames: string[],
): MatrixRow[] {
  // Pre-compute word sets per row.
  const wordSets: Array<Set<string>> = rows.map((r) => extractNameWords(r.name));

  const absorbed = new Set<number>();

  // O(N²) — acceptable for typical N (< 1000 rows). Could be improved
  // with token-inverted index if profile shows this matters.
  for (let i = 0; i < rows.length; i++) {
    if (absorbed.has(i)) continue;
    const target = rows[i];
    const tWords = wordSets[i];
    if (tWords.size < 3) continue;

    for (let j = i + 1; j < rows.length; j++) {
      if (absorbed.has(j)) continue;
      const donor = rows[j];
      const dWords = wordSets[j];
      if (dWords.size < 3) continue;

      // Type-pair guard.
      if (!isMergeEligible(target.type, donor.type)) continue;

      // If both have distinct registry keyPaths (after hive normalization),
      // they're truly different settings even if their names look similar.
      // Same setting with HKLM vs HKEY_LOCAL_MACHINE notation should pass
      // this check because normalizeKeyPath collapses them.
      if (target.keyPath && donor.keyPath) {
        const tNorm = normalizeKeyPath(target.keyPath).toLowerCase();
        const dNorm = normalizeKeyPath(donor.keyPath).toLowerCase();
        if (tNorm !== dNorm) continue;
      }

      // Disjoint baseline cells.
      let overlap = false;
      for (const bname of baselineNames) {
        const tCell = target.values[bname];
        const dCell = donor.values[bname];
        const tPresent = tCell && tCell.status !== 'missing';
        const dPresent = dCell && dCell.status !== 'missing';
        if (tPresent && dPresent) { overlap = true; break; }
      }
      if (overlap) continue;

      // Word-set similarity threshold. Accept if either:
      //   - Jaccard ≥ 0.75 (strong overlap), OR
      //   - Absolute intersection ≥ 4 words AND Jaccard ≥ 0.55
      // The second clause catches the WS2025 "category prefix" pattern
      // (e.g. "UserRightsAccessCredentialManagerAsTrustedCaller" vs
      // "Access Credential Manager as a trusted caller" — 5 shared
      // distinctive words, ratio 0.71). Min 4 shared words avoids
      // false positives from generic 1-2 word overlaps.
      let intersection = 0;
      for (const w of tWords) if (dWords.has(w)) intersection++;
      const ratio = intersection / (tWords.size + dWords.size - intersection);
      const strongOverlap = intersection >= 4 && ratio >= 0.55;
      const highJaccard = ratio >= 0.75;
      if (!strongOverlap && !highJaccard) continue;

      // Merge donor → target.
      for (const bname of baselineNames) {
        const dCell = donor.values[bname];
        if (dCell && dCell.status !== 'missing') {
          target.values[bname] = dCell;
        }
      }
      if (!target.name && donor.name) target.name = donor.name;
      if (!target.valueName && donor.valueName) target.valueName = donor.valueName;
      if (!target.keyPath && donor.keyPath) target.keyPath = donor.keyPath;
      absorbed.add(j);
    }
  }

  if (absorbed.size === 0) return rows;
  return rows.filter((_, i) => !absorbed.has(i));
}

/**
 * Pull the enforcement-relevant value off a resource.
 *
 * Priority order (most reliable indicator of "what does this manifest
 * want this setting to be set to" first):
 *
 *   1. `compliance.equals` / `compliance.contains` / `compliance.matches` /
 *      `compliance.regex` — the canonical user-declared expected value.
 *      CSV imports and most authored manifests set this; legacy
 *      "inline value" baselines do not.
 *   2. `properties.value` (with the typed `{dword: X}` / `{string: Y}`
 *      unwrap) — the older inline-enforcement pattern still in some
 *      Microsoft-authored baselines.
 *   3. `properties.data` / `properties.desired` / `properties.Value` —
 *      alternate spellings.
 *   4. Fall back to the whole `properties` object so a shape mismatch
 *      (e.g. presence/absence of `ensure: present`) still shows as a
 *      delta. This is the path the bug used to take for every
 *      compliance-only resource — it produced false "identical" because
 *      properties matched while the actual expected value differed.
 */
function extractEnforcementValue(
  props: Record<string, unknown>,
  compliance?: unknown,
): unknown {
  if (compliance && typeof compliance === 'object' && !Array.isArray(compliance)) {
    const c = compliance as Record<string, unknown>;
    if ('equals' in c) return c.equals;
    if ('contains' in c) return { contains: c.contains };
    if ('matches' in c) return { matches: c.matches };
    if ('regex' in c) return { regex: c.regex };
  }
  if ('value' in props) {
    const v = props.value;
    // Typed registry value: `{ dword: 1 }` or `{ string: "Foo" }`.
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 1) return obj[keys[0]];
    }
    return v;
  }
  if ('data' in props) return props.data;
  if ('desired' in props) return props.desired;
  if ('Value' in props) return (props as Record<string, unknown>).Value;
  // No enforcement-shaped field found — return the whole props object so
  // a shape mismatch (e.g. presence/absence of an `ensure: present`) still
  // shows up as a delta.
  return props;
}

/**
 * Treat empty/null-ish values as equivalent. Matters when comparing a
 * resource where one baseline writes `value: []` (empty array, "no
 * users assigned") and another baseline writes `value: null`, `''`,
 * `['']` (array of empty string), `{}`, or omits the field entirely —
 * they're the same logical state.
 */
function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (v === '') return true;
  if (Array.isArray(v)) {
    // Empty array AND array of only empty/null elements both count as empty.
    // ['']  and  [null]  and  []  all represent "no values present".
    return v.length === 0 || v.every((x) => isEmpty(x));
  }
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Canonicalize a value to a comparable string. Equates representations
 * that mean the same thing but serialize differently:
 *   - Empty values (see isEmpty above) → "__EMPTY__"
 *   - Booleans ↔ "0"/"1": OSConfig and CIS baselines write the same
 *     security setting as `true` / `1` interchangeably (Guest account
 *     status, NoLMHash, etc.). Canonicalize so `true === 1 === "1"`
 *     and `false === 0 === "0"`.
 *   - Numeric strings ↔ numbers: `"24"` (CSP array of strings) ===
 *     `24` (registry dword).
 */
/**
 * Normalize a Windows-style path string for diff comparison:
 *  - Collapses repeated backslashes: `Foo\\\\Bar` → `Foo\Bar`
 *  - Strips trailing backslashes: `Foo\Bar\` → `Foo\Bar`
 *  - Lower-cases hive names so `HKLM:\System` matches `hklm:\system`
 *  - Leaves the rest of the path case alone (Windows registry IS
 *    case-insensitive for key paths, but customer-supplied names can
 *    be mixed-case for human readability and we want to preserve that)
 *
 * Heuristic: only applies if the string contains a backslash. Plain
 * identifiers, URLs, and Unix paths pass through unchanged.
 */
function normalizePathLike(s: string): string {
  if (!s.includes('\\')) return s;
  // Collapse repeated backslashes
  let out = s.replace(/\\+/g, '\\');
  // Strip trailing backslashes (but keep a single trailing one for
  // drive roots like `C:\` since stripping that turns it into `C:`)
  if (!/^[A-Za-z]:\\$/.test(out)) {
    out = out.replace(/\\+$/, '');
  }
  // Case-insensitive hive prefix: HKLM:\, HKCU:\, HKEY_LOCAL_MACHINE\, etc.
  // Lower-case only the hive prefix; the rest of the path is preserved.
  const hiveMatch = out.match(/^([A-Za-z_]+(?::|\\))/);
  if (hiveMatch) {
    out = hiveMatch[1].toUpperCase() + out.slice(hiveMatch[1].length);
  }
  return out;
}

function canonicalize(v: unknown): unknown {
  if (isEmpty(v)) return '__EMPTY__';
  if (typeof v === 'boolean') return v ? '__TRUE__' : '__FALSE__';
  if (v === 0 || v === '0' || v === 'false' || v === 'False') return '__FALSE__';
  if (v === 1 || v === '1' || v === 'true' || v === 'True') return '__TRUE__';
  // Strip enclosing quotes ("'24'" -> "24") and trim whitespace then
  // try numeric coercion so '24' equals 24.
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    // Path-like strings (containing backslashes) collapse doubled
    // backslashes and strip trailing ones so "Foo\\Bar\\" == "Foo\Bar".
    // Catches Windows Firewall logging-name paths that come from CSP
    // as `%systemroot%\\system32\\...` vs `%systemroot%\system32\...`,
    // and registry paths with vs without trailing backslashes.
    return normalizePathLike(trimmed);
  }
  if (Array.isArray(v)) {
    // Filter out empty members and canonicalize each remaining one so
    // [""] and ["", "  "] both collapse to [] which then maps to __EMPTY__
    // via isEmpty above (already handled), but a non-empty array gets
    // member-wise canonical form so [1] === ["1"] === [true].
    const cleaned = v.filter((x) => !isEmpty(x)).map(canonicalize);
    if (cleaned.length === 0) return '__EMPTY__';
    return cleaned;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const cv = canonicalize(obj[k]);
      if (cv !== '__EMPTY__') out[k] = cv;
    }
    return Object.keys(out).length === 0 ? '__EMPTY__' : out;
  }
  return v;
}

function serialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Flatten a manifest document into a list of leaf resources, unwrapping
 * Microsoft.OSConfig/Test compliance wrappers. The Test wrapper's INNER
 * Microsoft.Windows/Registry resource is the actual setting under
 * comparison — comparing the Test wrapper directly would miss the
 * underlying value.
 */
function flattenManifest(doc: unknown): FlatResource[] {
  const out: FlatResource[] = [];
  if (!doc || typeof doc !== 'object') return out;
  const root = doc as Record<string, unknown>;
  const resources = (root.resources ?? root.Resources) as unknown;
  if (!Array.isArray(resources)) return out;
  walk(resources, out, 0, false);
  return out;
}

function walk(
  arr: unknown[],
  out: FlatResource[],
  depth: number,
  inTestWrapper: boolean,
): void {
  if (depth > MAX_DEPTH) return;
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const res = r as Record<string, unknown>;
    const type = typeof res.type === 'string' ? res.type : '';
    const name = typeof res.name === 'string' ? res.name : '';
    const props = (res.properties ?? res.Properties) as
      | Record<string, unknown>
      | undefined;

    // Test wrapper: peek at the inner resource (described by the same
    // properties shape minus the schema/expression). The OSConfig CLI
    // executes the wrapper as a single unit, but for DIFF purposes we
    // care about the underlying value — that's the user-facing setting.
    if (type === 'Microsoft.OSConfig/Test' && props) {
      const inner = (props.resource ?? props.Resource) as
        | Record<string, unknown>
        | undefined;
      if (inner && typeof inner === 'object') {
        const innerType = typeof inner.type === 'string' ? inner.type : type;
        const innerName = typeof inner.name === 'string' ? inner.name : name;
        const innerProps = (inner.properties ?? inner.Properties) as
          | Record<string, unknown>
          | undefined;
        const innerCompliance = inner.compliance ?? inner.Compliance;
        if (innerType) {
          out.push({
            type: innerType,
            name: innerName,
            properties: innerProps ?? {},
            compliance: innerCompliance,
            fromTestWrapper: true,
          });
        }
      } else if (name) {
        // Test wrapper without nested `resource` — still record it
        // using the wrapper's own properties so it doesn't vanish from
        // the matrix.
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          if (k === 'schema' || k === 'expression' || k === 'resource' || k === 'Resource') continue;
          cleaned[k] = v;
        }
        out.push({
          type,
          name,
          properties: cleaned,
          compliance: res.compliance ?? res.Compliance,
          fromTestWrapper: true,
        });
      }
      continue;
    }

    // Group wrapper: recurse, do not emit the group itself.
    if (type === 'Microsoft.OSConfig/Group' && props && Array.isArray(props.resources)) {
      walk(props.resources as unknown[], out, depth + 1, inTestWrapper);
      continue;
    }

    if (type) {
      const cleaned: Record<string, unknown> = {};
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          if (k === 'resources' || k === 'resource') continue;
          cleaned[k] = v;
        }
      }
      out.push({
        type,
        name,
        properties: cleaned,
        compliance: res.compliance ?? res.Compliance,
        fromTestWrapper: inTestWrapper,
      });
    }

    // Recurse into nested groupings even outside Group wrappers.
    if (props) {
      if (Array.isArray(props.resources)) walk(props.resources as unknown[], out, depth + 1, inTestWrapper);
      const nested = props.resource as Record<string, unknown> | undefined;
      if (nested && typeof nested === 'object') walk([nested], out, depth + 1, inTestWrapper);
    }
  }
}
