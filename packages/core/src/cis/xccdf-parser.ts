// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * XCCDF + OVAL parser for CIS Benchmark XML files.
 *
 * Customers download CIS benchmarks as XCCDF XML + companion OVAL XML
 * from CIS Workbench. This module parses them and builds an index that
 * the CIS cross-reference drawer can query.
 *
 * ## Design decisions (POC)
 *
 * - **Windows registry matching only.** Linux XCCDF rules use script-
 *   based checks that need a completely different matching strategy.
 * - **Full XCCDF → OVAL chain.** We follow Rule → check-content-ref →
 *   OVAL definition → criteria → test → object to ensure each registry
 *   path is attributed to the correct rule.
 * - **Lazy index build.** File discovery is cheap (readdir + head-of-
 *   file sniff); the full OVAL parse + index build happens on first
 *   lookup for that OS version.
 * - **fast-xml-parser** for speed and zero native deps in Electron.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

// ── Types ────────────────────────────────────────────────────────────

export interface XccdfRule {
  ruleId: string;
  title: string;
  description: string;
  severity: string;
  fixtext: string;
  /** Registry paths this rule checks (from OVAL chain). */
  registryPaths: NormalizedRegistryPath[];
  /** User-right privilege names this rule checks (e.g. "SE_NETWORK_LOGON_NAME"). */
  userRights: string[];
  /** Audit policy subcategory names this rule checks (e.g. "credential_validation"). */
  auditSubcategories: string[];
  /** Password/lockout policy setting names this rule checks (e.g. an example like "Password Hist Len" maps to PasswordHistorySize on OSConfig). */
  passwordPolicies: string[];
}

export interface NormalizedRegistryPath {
  hive: string;
  key: string;
  valueName: string;
  /** Canonical lookup key: `HIVE\key\valueName` all lowercase. */
  canonical: string;
}

export interface XccdfCatalog {
  /** Source filename (e.g. `CIS_Microsoft_Windows_Server_2025_...`). */
  filename: string;
  platform: 'windows' | 'linux' | 'unknown';
  product: string;
  version: string;
  benchmarkTitle: string;
  benchmarkVersion: string;
  rules: XccdfRule[];
  /** Reverse index: canonical registry path → rule indices. */
  registryIndex: Map<string, number[]>;
  /** Reverse index: normalized user-right key → rule indices. */
  userRightIndex: Map<string, number[]>;
  /** Reverse index: normalized audit subcategory key → rule indices. */
  auditSubcategoryIndex: Map<string, number[]>;
  /** Reverse index: normalized password-policy setting key → rule indices. */
  passwordPolicyIndex: Map<string, number[]>;
  /** Fuzzy fallback: array of {ruleIdx, normalizedTitleWords} for title-based search. */
  titleWordIndex: Array<{ ruleIdx: number; words: string[] }>;
  ruleCount: number;
  registryMatchCount: number;
}

export interface XccdfDiscovery {
  filename: string;
  xccdfPath: string;
  ovalPath: string | null;
  platform: 'windows' | 'linux' | 'unknown';
  product: string;
  version: string;
  title: string;
}

// ── Hive normalization ───────────────────────────────────────────────

const HIVE_ALIASES: Record<string, string> = {
  hklm: 'HKEY_LOCAL_MACHINE',
  hkey_local_machine: 'HKEY_LOCAL_MACHINE',
  hkcu: 'HKEY_CURRENT_USER',
  hkey_current_user: 'HKEY_CURRENT_USER',
  hku: 'HKEY_USERS',
  hkey_users: 'HKEY_USERS',
  hkcr: 'HKEY_CLASSES_ROOT',
  hkey_classes_root: 'HKEY_CLASSES_ROOT',
};

function normalizeHive(hive: string): string {
  return HIVE_ALIASES[hive.toLowerCase().trim()] ?? hive.toUpperCase();
}

function normalizeKey(key: string): string {
  // Strip leading/trailing backslashes by index (not anchored-quantifier
  // regexes like /\\+$/, which trigger js/polynomial-redos), then collapse
  // internal runs of backslashes to a single one.
  let start = 0;
  let end = key.length;
  while (start < end && key[start] === '\\') start++;
  while (end > start && key[end - 1] === '\\') end--;
  return key.slice(start, end).replace(/\\{2,}/g, '\\');
}

export function canonicalRegistryPath(
  hive: string,
  key: string,
  valueName: string,
): NormalizedRegistryPath {
  const h = normalizeHive(hive);
  const k = normalizeKey(key);
  const v = valueName ?? '';
  return {
    hive: h,
    key: k,
    valueName: v,
    canonical: `${h}\\${k}\\${v}`.toLowerCase(),
  };
}

// ── Platform detection ───────────────────────────────────────────────

interface PlatformInfo {
  platform: 'windows' | 'linux' | 'unknown';
  product: string;
  version: string;
}

const WINDOWS_PATTERNS: Array<{ re: RegExp; product: string; versionGroup: number }> = [
  { re: /Windows\s+Server\s+(\d{4})/i, product: 'windows-server', versionGroup: 1 },
  { re: /Windows\s+(\d+)\s+Enterprise/i, product: 'windows-enterprise', versionGroup: 1 },
  { re: /Windows\s+(\d+)\s+Stand-?alone/i, product: 'windows-standalone', versionGroup: 1 },
  { re: /Windows\s+(\d+)/i, product: 'windows', versionGroup: 1 },
];

const LINUX_PATTERNS: Array<{ re: RegExp; product: string; versionGroup: number }> = [
  { re: /Ubuntu\s+Linux\s+([\d.]+)/i, product: 'ubuntu', versionGroup: 1 },
  { re: /Red\s+Hat\s+Enterprise\s+Linux\s+(\d+)/i, product: 'rhel', versionGroup: 1 },
  { re: /Debian\s+Linux\s+(\d+)/i, product: 'debian', versionGroup: 1 },
  { re: /SUSE\s+Linux\s+Enterprise\s+(\d+)/i, product: 'suse', versionGroup: 1 },
  { re: /AlmaLinux\s+OS\s+(\d+)/i, product: 'almalinux', versionGroup: 1 },
  { re: /Rocky\s+Linux\s+(\d+)/i, product: 'rocky', versionGroup: 1 },
  { re: /Oracle\s+Linux\s+(\d+)/i, product: 'oracle-linux', versionGroup: 1 },
  { re: /Amazon\s+Linux\s+(\d+|2023)/i, product: 'amazon-linux', versionGroup: 1 },
  { re: /CentOS\s+(\d+)/i, product: 'centos', versionGroup: 1 },
];

function detectPlatform(text: string): PlatformInfo {
  for (const p of WINDOWS_PATTERNS) {
    const m = text.match(p.re);
    if (m) return { platform: 'windows', product: p.product, version: m[p.versionGroup] };
  }
  for (const p of LINUX_PATTERNS) {
    const m = text.match(p.re);
    if (m) return { platform: 'linux', product: p.product, version: m[p.versionGroup] };
  }
  return { platform: 'unknown', product: 'unknown', version: '' };
}

// ── Word tokenization helpers (shared by fuzzy match + title index) ──

/**
 * Common stopwords stripped from XCCDF title tokenization so they don't
 * inflate match ratios. "Ensure" appears in nearly every CIS rule title.
 */
const TITLE_STOPWORDS = new Set([
  'ensure', 'the', 'for', 'and', 'set', 'are', 'with', 'that', 'this',
  'from', 'into', 'level', 'option', 'options',
]);

/**
 * Split a PascalCase / CamelCase / mixed-abbreviation identifier into
 * lowercased words of length > 2. Handles three boundary types:
 *   - ABBR + Word: "SIDOr" -> "SID Or"
 *   - lower/digit + Upper: "AllowA" -> "Allow A"
 *   - non-alphanumeric: punctuation/underscore -> space
 *
 * Length filter is `> 2` (not `> 3`) so short-but-meaningful tokens like
 * "sid", "ntp", "cdp", "rdp" survive — these matter for CIS rule titles.
 */
export function splitPascalCase(s: string): string[] {
  if (!s) return [];
  return s
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Tokenize an XCCDF rule title for the fuzzy index. Strips punctuation,
 * lowercases, drops words ≤2 chars, and removes high-frequency stopwords.
 */
export function tokenizeXccdfTitle(title: string): string[] {
  if (!title) return [];
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w));
}

/**
 * Extract a word pool from a Windows CSP path's last segment. CSP
 * manifests expose richer naming via the path itself:
 *
 *   ./Vendor/MSFT/Policy/Result/LocalPoliciesSecurityOptions/NetworkAccess_AllowAnonymousSIDOrNameTranslation
 *
 * The last segment is `NetworkAccess_AllowAnonymousSIDOrNameTranslation`.
 * Splitting on `_` gives the policy area + setting, and `splitPascalCase`
 * then breaks each half into individual words. The resulting pool is fed
 * to the fuzzy title matcher in addition to the resource name itself.
 */
export function extractCspPathWords(cspPath: string): string[] {
  if (!cspPath) return [];
  const lastSeg = cspPath.split('/').pop() ?? '';
  if (!lastSeg) return [];
  const halves = lastSeg.split('_');
  return halves.flatMap((h) => splitPascalCase(h));
}

// ── XML parser config ────────────────────────────────────────────────

function makeParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => {
      // These elements can appear 0-N times; force array.
      const arrayTags = new Set([
        'Group', 'Rule', 'check', 'check-content-ref',
        'definition', 'criterion', 'criteria',
        'registry_test', 'registry_object', 'registry_state',
        'userright_test', 'auditeventpolicysubcategories_test',
      ]);
      return arrayTags.has(name);
    },
    // Prevent huge text nodes from blowing up memory
    trimValues: true,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textContent(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    // fast-xml-parser puts text content in #text when attributes are present
    if ('#text' in obj) return String(obj['#text']);
    // Inline XHTML: concatenate all text descendants
    const parts: string[] = [];
    for (const v of Object.values(obj)) {
      if (typeof v === 'string') parts.push(v);
      else if (typeof v === 'object' && v != null) parts.push(textContent(v));
    }
    return parts.join(' ');
  }
  return String(node);
}

// ── Discovery (cheap filesystem scan) ────────────────────────────────

/** Cache of discovery results keyed by dataDir + mtime fingerprint. */
const discoveryCache = new Map<string, { fingerprint: string; discoveries: XccdfDiscovery[] }>();

export async function discoverXccdfFiles(dataDir: string): Promise<XccdfDiscovery[]> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch {
    return [];
  }

  const xccdfFiles = entries.filter((f) => f.endsWith('-xccdf.xml'));
  if (xccdfFiles.length === 0) return [];

  // Build fingerprint from mtimes of all XCCDF files. If unchanged, return cached.
  const stats = await Promise.all(
    xccdfFiles.map(async (xf) => {
      try {
        const s = await stat(join(dataDir, xf));
        return `${xf}:${s.mtimeMs}:${s.size}`;
      } catch {
        return `${xf}:?`;
      }
    }),
  );
  const fingerprint = stats.join('|');
  const cached = discoveryCache.get(dataDir);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.discoveries;
  }

  // Parallel sniff of all XCCDF files. CRITICAL: read only the first 8KB
  // (titles are always within the first 1-2KB of XCCDF XML). Reading the
  // entire 3MB+ file just to grep a title was costing 1-2s × N files
  // every time the UI called cis.status() and was the main reason
  // opening the manifest editor felt slow.
  const HEAD_BYTES = 8192;
  const { open } = await import('node:fs/promises');
  const results = await Promise.all(
    xccdfFiles.map(async (xf) => {
      const prefix = xf.replace(/-xccdf\.xml$/, '');
      const ovalCandidate = `${prefix}-oval.xml`;
      const ovalPath = entries.includes(ovalCandidate)
        ? join(dataDir, ovalCandidate)
        : null;

      // Sniff platform from filename first
      const info = detectPlatform(xf);

      // Try to read just the head of the XML for title detection.
      let title = xf;
      try {
        const fh = await open(join(dataDir, xf), 'r');
        try {
          const buf = Buffer.alloc(HEAD_BYTES);
          const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
          const head = buf.slice(0, bytesRead).toString('utf-8');
          const titleMatch = head.match(/<(?:\w+:)?title[^>]*>([^<]+)/);
          if (titleMatch) {
            title = titleMatch[1].trim();
            if (info.platform === 'unknown') {
              const titleInfo = detectPlatform(title);
              if (titleInfo.platform !== 'unknown') {
                info.platform = titleInfo.platform;
                info.product = titleInfo.product;
                info.version = titleInfo.version;
              }
            }
          }
        } finally {
          await fh.close();
        }
      } catch { /* discovery should never fail */ }

      return {
        filename: xf,
        xccdfPath: join(dataDir, xf),
        ovalPath,
        platform: info.platform,
        product: info.product,
        version: info.version,
        title,
      } as XccdfDiscovery;
    }),
  );

  discoveryCache.set(dataDir, { fingerprint, discoveries: results });
  return results;
}

// ── Full parse (expensive — called lazily on first lookup) ───────────

/**
 * Parse an XCCDF + companion OVAL and build the full rule index with
 * registry-path cross-references.
 *
 * Follows the chain:
 *   XCCDF Rule → check-content-ref → OVAL definition → criteria → test → object
 */
export async function parseXccdfCatalog(
  xccdfPath: string,
  ovalPath: string | null,
): Promise<XccdfCatalog> {
  const parser = makeParser();
  const xccdfRaw = await readFile(xccdfPath, 'utf-8');
  const xccdf = parser.parse(xccdfRaw);

  const root = xccdf.Benchmark;
  if (!root) {
    throw new Error(`Not a valid XCCDF file: no <Benchmark> root in ${xccdfPath}`);
  }

  const benchmarkTitle = textContent(root.title) || basename(xccdfPath);
  const benchmarkVersion = root['@_id'] ?? '';
  const pinfo = detectPlatform(benchmarkTitle);

  // ── Collect all Rules recursively from nested Groups ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRules: Array<Record<string, any>> = [];
  function walkGroups(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const rule of asArray(obj.Rule as Record<string, unknown>)) {
      rawRules.push(rule as Record<string, any>);
    }
    for (const group of asArray(obj.Group as Record<string, unknown>)) {
      walkGroups(group);
    }
  }
  walkGroups(root);

  // ── Build OVAL indexes (definition → tests → objects) ──
  type OvalDef = { testRefs: string[] };
  type OvalTest = { objectRef: string };
  type OvalRegObj = NormalizedRegistryPath;

  const ovalDefs = new Map<string, OvalDef>();
  const ovalTests = new Map<string, OvalTest>();
  const ovalRegObjects = new Map<string, OvalRegObj>();
  /** userright_object id → privilege name (e.g. "SE_NETWORK_LOGON_NAME"). */
  const ovalUserRightObjects = new Map<string, string>();
  /** auditeventpolicysubcategories_object id → subcategory key extracted from comment. */
  const ovalAuditObjects = new Map<string, string>();
  /** passwordpolicy_object id → setting key extracted from comment. */
  const ovalPasswordObjects = new Map<string, string>();

  if (ovalPath) {
    try {
      const ovalRaw = await readFile(ovalPath, 'utf-8');
      const oval = parser.parse(ovalRaw);
      const ovalRoot = oval.oval_definitions ?? oval['oval-definitions'] ?? oval;

      // Definitions → criteria → criterion (test_ref)
      const defs = asArray(
        (ovalRoot.definitions?.definition) as Record<string, unknown>[],
      );
      for (const def of defs) {
        const defId = (def as Record<string, unknown>)['@_id'] as string;
        if (!defId) continue;
        const testRefs: string[] = [];
        function walkCriteria(node: unknown): void {
          if (!node || typeof node !== 'object') return;
          // node may be an array (isArray forces 'criteria' to array)
          // or a single object. Handle both.
          if (Array.isArray(node)) {
            for (const item of node) walkCriteria(item);
            return;
          }
          const n = node as Record<string, unknown>;
          for (const crit of asArray(n.criterion as Record<string, unknown>)) {
            const cr = crit as Record<string, unknown>;
            const tr = cr['@_test_ref'] as string;
            if (tr) testRefs.push(tr);
          }
          for (const sub of asArray(n.criteria as Record<string, unknown>)) {
            walkCriteria(sub);
          }
        }
        walkCriteria(def.criteria);
        ovalDefs.set(defId, { testRefs });
      }

      // Tests → object_ref
      const tests = ovalRoot.tests;
      if (tests) {
        for (const [, testArr] of Object.entries(tests)) {
          for (const test of asArray(testArr as Record<string, unknown>)) {
            const tid = (test as Record<string, unknown>)['@_id'] as string;
            const objNode = (test as Record<string, unknown>).object as Record<string, unknown>;
            const objRef = objNode?.['@_object_ref'] as string;
            if (tid && objRef) ovalTests.set(tid, { objectRef: objRef });
          }
        }
      }

      // Objects → registry_object (hive/key/name)
      const objects = ovalRoot.objects;
      if (objects) {
        for (const regObj of asArray(
          objects.registry_object as Record<string, unknown>,
        )) {
          const oid = (regObj as Record<string, unknown>)['@_id'] as string;
          const hive = textContent((regObj as Record<string, unknown>).hive);
          const key = textContent((regObj as Record<string, unknown>).key);
          const name = textContent((regObj as Record<string, unknown>).name);
          // Skip variable-driven objects (OVAL uses var_ref for dynamic keys)
          if (!hive || !key) continue;
          if (typeof (regObj as Record<string, unknown>).key === 'object') {
            const keyObj = (regObj as Record<string, unknown>).key as Record<string, unknown>;
            if (keyObj['@_var_ref']) continue;
          }
          if (oid) {
            ovalRegObjects.set(oid, canonicalRegistryPath(hive, key, name));
          }
        }

        // userright_object: contains <userright>SE_NETWORK_LOGON_NAME</userright>
        for (const urObj of asArray(
          objects.userright_object as Record<string, unknown>,
        )) {
          const oid = (urObj as Record<string, unknown>)['@_id'] as string;
          const right = textContent((urObj as Record<string, unknown>).userright).trim();
          if (oid && right) ovalUserRightObjects.set(oid, right);
        }

        // auditeventpolicysubcategories_object: empty self-closing,
        // info lives in the comment attribute e.g.
        //   comment="Ensure 'audit_policy_name_a' is 'Equals' to 'AUDIT_SUCCESS_FAILURE'"
        for (const auObj of asArray(
          objects.auditeventpolicysubcategories_object as Record<string, unknown>,
        )) {
          const oid = (auObj as Record<string, unknown>)['@_id'] as string;
          const comment = ((auObj as Record<string, unknown>)['@_comment'] as string) ?? '';
          const m = comment.match(/'([a-z_]+)'/);
          if (oid && m) ovalAuditObjects.set(oid, m[1]);
        }

        // passwordpolicy_object: also empty, info in comment attribute e.g.
        //   comment="Ensure 'Example Policy Name' is 'Greater Than Or Equal' to '24'"
        for (const ppObj of asArray(
          objects.passwordpolicy_object as Record<string, unknown>,
        )) {
          const oid = (ppObj as Record<string, unknown>)['@_id'] as string;
          const comment = ((ppObj as Record<string, unknown>)['@_comment'] as string) ?? '';
          const m = comment.match(/'([^']+)'/);
          if (oid && m) ovalPasswordObjects.set(oid, m[1]);
        }
      }
    } catch (err) {
      // OVAL parse failure is non-fatal — rules still load, just no registry matching
      // eslint-disable-next-line no-console
      console.warn(`[cis-xccdf] OVAL parse failed for ${ovalPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Build XccdfRule[] with registry paths from OVAL chain ──
  const rules: XccdfRule[] = [];
  const registryIndex = new Map<string, number[]>();
  const userRightIndex = new Map<string, number[]>();
  const auditSubcategoryIndex = new Map<string, number[]>();
  const passwordPolicyIndex = new Map<string, number[]>();
  const titleWordIndex: Array<{ ruleIdx: number; words: string[] }> = [];
  let registryMatchCount = 0;

  function addToIndex(idx: Map<string, number[]>, key: string, ruleIdx: number): void {
    const existing = idx.get(key);
    if (existing) existing.push(ruleIdx);
    else idx.set(key, [ruleIdx]);
  }

  for (const raw of rawRules) {
    const ruleId = (raw['@_id'] as string) ?? '';
    const title = textContent(raw.title);
    const description = textContent(raw.description);
    const severity = (raw['@_severity'] as string) ?? '';
    const fixtext = textContent(raw.fixtext);

    // Follow XCCDF -> OVAL chain.
    // CIS XCCDF uses either `check` directly on the Rule, or
    // `complex-check > check` (the more common pattern for rules
    // with variable exports).
    const registryPaths: NormalizedRegistryPath[] = [];
    const userRights: string[] = [];
    const auditSubcategories: string[] = [];
    const passwordPolicies: string[] = [];
    const directChecks = asArray(raw.check as Record<string, unknown>);
    const complexCheck = raw['complex-check'] as Record<string, unknown> | undefined;
    const nestedChecks = complexCheck
      ? asArray(complexCheck.check as Record<string, unknown>)
      : [];
    const allChecks = [...directChecks, ...nestedChecks];

    for (const chk of allChecks) {
      const c = chk as Record<string, unknown>;
      const refs = asArray(c['check-content-ref'] as Record<string, unknown>);
      for (const r of refs) {
        const rf = r as Record<string, unknown>;
        const refName = (rf['@_name'] as string) ?? '';
        // refName is the OVAL definition id
        const def = ovalDefs.get(refName);
        if (!def) continue;
        for (const testRef of def.testRefs) {
          const test = ovalTests.get(testRef);
          if (!test) continue;
          const regObj = ovalRegObjects.get(test.objectRef);
          if (regObj) registryPaths.push(regObj);
          const urName = ovalUserRightObjects.get(test.objectRef);
          if (urName) userRights.push(urName);
          const auName = ovalAuditObjects.get(test.objectRef);
          if (auName) auditSubcategories.push(auName);
          const ppName = ovalPasswordObjects.get(test.objectRef);
          if (ppName) passwordPolicies.push(ppName);
        }
      }
    }

    const ruleIdx = rules.length;
    rules.push({
      ruleId, title, description, severity, fixtext,
      registryPaths, userRights, auditSubcategories, passwordPolicies,
    });

    // Index registry paths
    for (const rp of registryPaths) {
      addToIndex(registryIndex, rp.canonical, ruleIdx);
    }
    if (registryPaths.length > 0) registryMatchCount++;

    // Index userright privilege names (lowercase, no SE_ prefix, no _NAME suffix)
    for (const ur of userRights) {
      addToIndex(userRightIndex, normalizeUserRight(ur), ruleIdx);
    }
    // Index audit subcategory friendly names (already lowercase from OVAL)
    for (const au of auditSubcategories) {
      addToIndex(auditSubcategoryIndex, normalizeAuditSubcategory(au), ruleIdx);
    }
    // Index password-policy setting names (compact lowercase)
    for (const pp of passwordPolicies) {
      addToIndex(passwordPolicyIndex, normalizePasswordPolicy(pp), ruleIdx);
    }

    // Build title word index for fuzzy fallback (strips stopwords +
    // tokens ≤2 chars). See `tokenizeXccdfTitle`.
    const titleWords = tokenizeXccdfTitle(title);
    if (titleWords.length > 0) {
      titleWordIndex.push({ ruleIdx, words: titleWords });
    }
  }

  return {
    filename: basename(xccdfPath),
    platform: pinfo.platform,
    product: pinfo.product,
    version: pinfo.version,
    benchmarkTitle,
    benchmarkVersion,
    rules,
    registryIndex,
    userRightIndex,
    auditSubcategoryIndex,
    passwordPolicyIndex,
    titleWordIndex,
    ruleCount: rules.length,
    registryMatchCount,
  };
}

// ── Catalog cache ────────────────────────────────────────────────────

const catalogCache = new Map<string, { catalog: XccdfCatalog; mtime: number }>();

export async function getOrParseXccdfCatalog(
  xccdfPath: string,
  ovalPath: string | null,
): Promise<XccdfCatalog> {
  const key = xccdfPath;
  let mtime = 0;
  try {
    mtime = (await stat(xccdfPath)).mtimeMs;
  } catch { /* file gone — will error in parse */ }

  const cached = catalogCache.get(key);
  if (cached && cached.mtime === mtime) {
    return cached.catalog;
  }

  const catalog = await parseXccdfCatalog(xccdfPath, ovalPath);
  catalogCache.set(key, { catalog, mtime });
  return catalog;
}

export function clearXccdfCache(): void {
  catalogCache.clear();
  discoveryCache.clear();
}

// ── Normalization for non-registry resource types ────────────────────

/**
 * Normalize a user-right name to a canonical lookup key.
 * Manifest resources use OSConfig names like "SeNetworkLogonRight";
 * OVAL uses Win32 API names like "SE_NETWORK_LOGON_NAME".
 * Both normalize to: lowercase, alphanumeric only.
 *   "SeNetworkLogonRight" → "senetworklogonright"
 *   "SE_NETWORK_LOGON_NAME" → "senetworklogonname"
 * Then strip trailing "right"/"name"/"privilege" so both match.
 */
export function normalizeUserRight(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Drop common leading prefixes that differ between OSConfig and OVAL forms.
  // OSConfig resources: "UserRightsCreateToken" -> "userrightscreatetoken"
  // OVAL privilege:     "SE_CREATE_TOKEN_NAME"  -> "secreatetokenname"
  // Both should normalize to "createtoken".
  for (const prefix of ['userrights', 'se']) {
    if (n.startsWith(prefix)) {
      n = n.slice(prefix.length);
      break;
    }
  }
  // Drop common trailing suffixes
  for (const suffix of ['privilege', 'right', 'name']) {
    if (n.endsWith(suffix)) {
      n = n.slice(0, -suffix.length);
      break;
    }
  }
  return n;
}

/**
 * Normalize an audit subcategory name.
 *   OVAL: "credential_validation"
 *   Manifest: "AuditCredentialValidation" or "credential_validation"
 */
export function normalizeAuditSubcategory(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n.startsWith('audit')) n = n.slice(5);
  return n;
}

/**
 * Normalize a password/lockout policy setting name.
 *   OVAL-side abbreviated name examples (e.g. "Password Hist Len", "Min Passwd Len")
 *   Manifest-side OSConfig name examples (e.g. "PasswordHistorySize", "MinimumPasswordLength")
 * Strategy: lowercase alphanumeric, then strip common synonyms.
 */
export function normalizePasswordPolicy(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Normalize synonyms: "passwd" ↔ "password", "len" ↔ "length", "hist" ↔ "history"
  n = n.replace(/passwd/g, 'password');
  n = n.replace(/len$/, 'length');
  n = n.replace(/length$/, 'len'); // standardize on shorter form for matching
  n = n.replace(/history/, 'hist');
  n = n.replace(/minimum/, 'min');
  n = n.replace(/maximum/, 'max');
  return n;
}

/**
 * Strip a CSP category prefix from a resource name when the manifest
 * resource is a CSP-style policy under a known category. Example:
 *   name="UserRightsDebugPrograms", cspPath=".../UserRights/DebugPrograms"
 *   → returns "DebugPrograms"
 *
 * The category portion (e.g. "UserRights") is the CSP node name, not part
 * of the CIS rule title — CIS titles for user-rights rules say "Debug
 * programs", not "User rights Debug programs". Including the category
 * words in the fuzzy-match input drags the overlap ratio below threshold.
 *
 * If the CSP path doesn't reveal a category, or the name doesn't actually
 * start with that category, returns the name unchanged.
 */
export function stripCspCategoryPrefix(name: string, cspPath: string | null | undefined): string {
  if (!cspPath || !name) return name;
  // Extract the second-to-last path segment (the category).
  // Path shape: ./Vendor/MSFT/Policy/Result/<Category>/<Setting>
  const m = cspPath.match(/\/([A-Z][A-Za-z0-9]+)\/[^/]+$/);
  if (!m) return name;
  const category = m[1];
  if (name.startsWith(category) && name.length > category.length) {
    return name.slice(category.length);
  }
  return name;
}

/**
 * Fuzzy-match an OSConfig resource name against XCCDF rule titles.
 * Returns the rule with the highest word-overlap ratio if it meets threshold.
 * Used as a fallback when registry-exact matching fails (e.g. for CSP-based
 * manifest resources that don't have direct registry paths).
 *
 * The `extraWords` parameter lets callers feed an additional pool of
 * tokens (e.g. words extracted from a Windows CSP path's last segment) so
 * the matcher has more signal than the resource name alone provides.
 */
export function fuzzyMatchXccdfTitle(
  catalog: XccdfCatalog,
  resourceName: string,
  threshold: number = 0.8,
  extraWords: string[] = [],
): XccdfRule | null {
  // Tokenize resource name with the shared PascalCase splitter, then
  // union with any caller-provided extra words (deduplicated).
  const nameWords = splitPascalCase(resourceName);
  const wordSet = new Set<string>([...nameWords, ...extraWords]);
  const words = [...wordSet].filter((w) => !TITLE_STOPWORDS.has(w));
  if (words.length === 0) return null;

  let bestIdx = -1;
  let bestRatio = 0;
  for (const { ruleIdx, words: titleWords } of catalog.titleWordIndex) {
    // Exact-word match (Jaccard-style): no bidirectional substring. The
    // substring approach previously allowed short generic tokens
    // ("use", "and") to absorb unrelated longer title words ("useful",
    // "sensitive"), inflating the ratio for completely wrong titles.
    const titleWordSet = new Set(titleWords);
    const matched = words.filter((w) => titleWordSet.has(w));
    const ratio = matched.length / words.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = ruleIdx;
    }
  }
  return bestRatio >= threshold && bestIdx >= 0 ? catalog.rules[bestIdx] : null;
}

/**
 * Diagnostic variant of `fuzzyMatchXccdfTitle` that returns the best
 * candidate plus its ratio, regardless of whether it crosses the
 * threshold. Used by the near-miss audit so callers can see the
 * "almost matched" leads (ratio in [0.4, 0.6)).
 */
export function bestFuzzyMatchXccdfTitle(
  catalog: XccdfCatalog,
  resourceName: string,
  extraWords: string[] = [],
): { rule: XccdfRule; ratio: number; words: string[] } | null {
  const nameWords = splitPascalCase(resourceName);
  const wordSet = new Set<string>([...nameWords, ...extraWords]);
  const words = [...wordSet].filter((w) => !TITLE_STOPWORDS.has(w));
  if (words.length === 0) return null;

  let bestIdx = -1;
  let bestRatio = 0;
  for (const { ruleIdx, words: titleWords } of catalog.titleWordIndex) {
    const titleWordSet = new Set(titleWords);
    const matched = words.filter((w) => titleWordSet.has(w));
    const ratio = matched.length / words.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = ruleIdx;
    }
  }
  if (bestIdx < 0) return null;
  return { rule: catalog.rules[bestIdx], ratio: bestRatio, words };
}

/**
 * Look up a non-registry resource (UserRights, AuditPolicy, AccountPolicy)
 * against the XCCDF catalog's specialized indices.
 */
export function lookupNonRegistryInXccdf(
  catalog: XccdfCatalog,
  innerType: string,
  resourceName: string,
  propertyName?: string,
  propertySubcategory?: string,
  cspPath?: string,
): XccdfRule | null {
  if (!innerType) return null;
  const t = innerType.toLowerCase();

  // Minimal alias table for OSConfig user-right names that DON'T share
  // a substring with the Win32 OVAL constant. These come from Microsoft
  // privilege constant docs (learn.microsoft.com/.../authorization/
  // privilege-constants).
  // Key: normalized OSConfig form. Value: normalized OVAL key.
  const OSCONFIG_USER_RIGHT_ALIASES: Record<string, string> = {
    bypasstraversechecking: 'changenotify',         // SE_CHANGE_NOTIFY_NAME
    increaseprocessworkingset: 'incworkingset',     // SE_INC_WORKING_SET_NAME
    increaseschedulingpriority: 'incbasepriority',  // SE_INC_BASE_PRIORITY_NAME
    loadunloaddevicedrivers: 'loaddriver',          // SE_LOAD_DRIVER_NAME
    accessfromnetwork: 'networklogon',              // SE_NETWORK_LOGON_NAME
    denyaccessfromnetwork: 'denynetworklogon',      // SE_DENY_NETWORK_LOGON_NAME
    accesscredentialmanagerastrustedcaller: 'trustedcredmanaccess', // SE_TRUSTED_CREDMAN_ACCESS_NAME
    enabledelegation: 'enabledelegation',           // SE_ENABLE_DELEGATION_NAME (no-op but explicit)
    manageauditingandsecuritylog: 'security',       // SE_SECURITY_NAME
    modifyfirmwareenvironment: 'systemenvironment', // SE_SYSTEM_ENVIRONMENT_NAME
    modifyobjectlabel: 'relabel',                   // SE_RELABEL_NAME
    profilesingleprocess: 'profsingleprocess',      // SE_PROF_SINGLE_PROCESS_NAME
    profilesystemperformance: 'systemprofile',      // SE_SYSTEM_PROFILE_NAME
    replaceprocessleveltoken: 'assignprimarytoken', // SE_ASSIGNPRIMARYTOKEN_NAME
  };

  // Helper: try exact + alias + substring lookup against userRightIndex.
  // OSConfig uses friendly suffix names that Win32 doesn't always have
  // (e.g. "ImpersonateClient" → Win32 SE_IMPERSONATE_NAME → "impersonate"),
  // so when exact normalization fails we accept a key that is a prefix
  // of the OSConfig form. The alias table handles the genuinely asymmetric
  // cases (e.g. BypassTraverseChecking → SE_CHANGE_NOTIFY_NAME).
  function lookupUserRightWithSubstring(key: string): XccdfRule | null {
    if (!key) return null;
    const direct = catalog.userRightIndex.get(key);
    if (direct && direct.length > 0) return catalog.rules[direct[0]];
    const aliasKey = OSCONFIG_USER_RIGHT_ALIASES[key];
    if (aliasKey) {
      const aliased = catalog.userRightIndex.get(aliasKey);
      if (aliased && aliased.length > 0) return catalog.rules[aliased[0]];
    }
    // Substring fallback (min 4 chars to avoid hits on tiny common
    // fragments). Prefer the longest matching prefix so "shutdown"
    // (8) wins over a shorter false-positive prefix.
    let bestKey: string | null = null;
    let bestLen = 0;
    for (const [k, idxs] of catalog.userRightIndex.entries()) {
      if (k.length >= 4 && idxs.length > 0 && key.startsWith(k) && k.length > bestLen) {
        bestKey = k;
        bestLen = k.length;
      }
    }
    if (bestKey) {
      const idxs = catalog.userRightIndex.get(bestKey)!;
      return catalog.rules[idxs[0]];
    }
    return null;
  }

  // CSP-style resources: the policy category lives in the second-to-last
  // path segment (e.g. .../UserRights/ManageVolume, .../Audit/SubName).
  // Route these to the same specialized indices the native types use,
  // because their CIS rule titles (e.g. "Perform volume maintenance tasks"
  // for SE_MANAGE_VOLUME_NAME) don't share enough words with the OSConfig
  // names ("ManageVolume") for the fuzzy matcher to find them.
  if (t.endsWith('/csp') && cspPath) {
    const userRightMatch = cspPath.match(/\/UserRights\/([A-Za-z0-9]+)$/i);
    if (userRightMatch) {
      const hit = lookupUserRightWithSubstring(normalizeUserRight(userRightMatch[1]));
      if (hit) return hit;
    }
    const auditMatch = cspPath.match(/\/Audit\/([A-Za-z0-9_]+)$/i);
    if (auditMatch) {
      const key = normalizeAuditSubcategory(auditMatch[1]);
      const indices = catalog.auditSubcategoryIndex.get(key);
      if (indices && indices.length > 0) return catalog.rules[indices[0]];
    }
  }

  if (t.endsWith('userrightsassignment')) {
    const hit = lookupUserRightWithSubstring(normalizeUserRight(propertyName || resourceName));
    if (hit) return hit;
  } else if (t.endsWith('auditpolicy')) {
    const key = normalizeAuditSubcategory(propertySubcategory || resourceName);
    const indices = catalog.auditSubcategoryIndex.get(key);
    if (indices && indices.length > 0) return catalog.rules[indices[0]];
  } else if (t.endsWith('accountpolicy') || t.endsWith('passwordpolicy')) {
    const key = normalizePasswordPolicy(propertyName || resourceName);
    const indices = catalog.passwordPolicyIndex.get(key);
    if (indices && indices.length > 0) return catalog.rules[indices[0]];
  }
  return null;
}

/**
 * Look up an OSConfig resource against XCCDF-derived indexes.
 *
 * Returns the first matching CIS rule, or null. Caller should prefer
 * the JSON-catalog path when available (higher fidelity).
 */
export async function lookupResourceInXccdf(
  catalog: XccdfCatalog,
  registryKey?: string,
  registryValueName?: string,
): Promise<XccdfRule | null> {
  if (!registryKey) return null;

  // Try to extract hive from keyPath (e.g. "HKEY_LOCAL_MACHINE\Software\...")
  const firstSlash = registryKey.indexOf('\\');
  if (firstSlash < 0) return null;

  const hive = registryKey.substring(0, firstSlash);
  const key = registryKey.substring(firstSlash + 1);
  const norm = canonicalRegistryPath(hive, key, registryValueName ?? '');

  const indices = catalog.registryIndex.get(norm.canonical);
  if (!indices || indices.length === 0) return null;

  return catalog.rules[indices[0]];
}

// ── Linux fuzzy matcher ───────────────────────────────────────────────
//
// Linux CIS rule titles use verbose natural language (e.g. "Ensure
// usb-storage kernel module is not available", "Ensure permissions on
// /etc/cron.d are configured"). The Windows-tuned PascalCase tokenizer
// + 0.8 threshold matcher misses ~93% of these because:
//   1. Stopwords inflate denominators ("ensure", "is", "the", "are",
//      "for") — almost every Linux title starts with "Ensure".
//   2. Resource names are short (3–4 tokens) but titles are long (7–9).
//      Even strong overlap can't reach 0.8.
//   3. Paths like "/etc/cron.d" tokenize identically to "/etc/cron.hourly"
//      — wrong rule wins by tie.
//   4. Nested children (`properties.resources[*].properties.name = dccp`)
//      are never extracted into the resource token bag.
//
// The Linux matcher below addresses each: aggressive stopword filter
// with domain-word retention, light stemming, hyphenated-token
// preservation, hard path constraint, polarity guard, distinctive-
// token requirement, best-vs-runner-up margin gate.

/**
 * Stopwords stripped from Linux CIS matching. Combines the existing
 * XCCDF stopwords with state/connective words that appear in virtually
 * every Linux rule title and so carry no discriminative signal.
 *
 * NOT included (intentionally kept as meaningful tokens): kernel,
 * module, root, audit, cron, ssh, sudo, umask, pam, gid, uid, group,
 * user, dccp, rds, sctp, tipc, host, port, login, password, hash.
 */
export const LINUX_TITLE_STOPWORDS = new Set([
  // existing XCCDF stopwords
  'ensure', 'the', 'for', 'and', 'set', 'are', 'with', 'that', 'this',
  'from', 'into', 'level', 'option', 'options',
  // state/connective expansion
  'is', 'be', 'not', 'all', 'on', 'of', 'to', 'in', 'by', 'or',
  'must', 'should', 'will', 'can', 'has', 'have', 'was', 'were',
  // common adjectives/state appearing in 50%+ Linux titles
  'default', 'properly', 'configured', 'disabled', 'enabled',
  'available', 'restricted', 'required', 'present', 'permitted',
  // generic filesystem nouns
  'etc', 'conf', 'file', 'files', 'line', 'linux', 'setting', 'settings',
  'system', 'directory', 'directories', 'value', 'values',
]);

/**
 * Tokenize a Linux CIS title or resource name for fuzzy matching.
 *
 * - lowercase, replace non `[a-z0-9/.\-_]` with space
 * - drop tokens ≤ 2 chars and `LINUX_TITLE_STOPWORDS`
 * - light stem (strip trailing `s` for length ≥ 5) so plurals match
 * - hyphenated tokens kept whole AND split (`usb-storage` → both)
 * - dot-separated kept whole AND split (`net.ipv4.ip_forward` → both)
 */
export function linuxFuzzyTokenize(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  // Preserve whole hyphenated/dotted tokens by extracting first
  const wholeMatches = text.toLowerCase().match(/[a-z0-9][a-z0-9.\-_]*[a-z0-9]/g) ?? [];
  for (const tok of wholeMatches) {
    // Drop if pure numeric, ≤2 chars, or stopword
    if (tok.length <= 2) continue;
    if (LINUX_TITLE_STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    out.add(stemLinuxToken(tok));
    // If the token contains - or ., also add the sub-parts
    if (/[\-.]/.test(tok)) {
      for (const sub of tok.split(/[\-.]/)) {
        if (sub.length > 2 && !LINUX_TITLE_STOPWORDS.has(sub) && !/^\d+$/.test(sub)) {
          out.add(stemLinuxToken(sub));
        }
      }
    }
  }
  // Also run splitPascalCase for CamelCase'd resource names like
  // "DisableUSBStorage" → ["disable", "usb", "storage"]
  for (const w of splitPascalCase(text)) {
    if (LINUX_TITLE_STOPWORDS.has(w)) continue;
    out.add(stemLinuxToken(w));
  }
  return [...out];
}

/**
 * Light stemming for Linux fuzzy matching. Strips a trailing `s` for
 * words length ≥ 5 so `users`↔`user`, `modules`↔`module`, `dumps`↔`dump`.
 * Avoids stemming short words like `is`, `as`, `bus` to prevent
 * collisions. Hyphenated/dotted tokens are not stemmed.
 */
function stemLinuxToken(w: string): string {
  if (w.length < 5) return w;
  if (/[\-.]/.test(w)) return w;
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    return w.slice(0, -1);
  }
  return w;
}

/**
 * Extract normalized full path tokens from a text. A path is any
 * substring matching `/[A-Za-z0-9._\-/]+`. Each path is normalized by:
 *   - lowercase
 *   - collapse `//` → `/`
 *   - strip trailing `/`
 *
 * Returns a Set of distinct normalized paths.
 */
export function linuxPathTokens(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const matches = text.match(/\/[A-Za-z0-9._\-/]+/g) ?? [];
  for (const m of matches) {
    let norm = m.toLowerCase().replace(/\/+/g, '/');
    if (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
    if (norm.length > 1) out.add(norm);
  }
  return out;
}

/**
 * Boundary-aware path containment. Returns true if `a` and `b` are
 * equal or one is a strict path-segment prefix of the other.
 *
 * Critically `/etc/cron.d` is NOT a prefix of `/etc/cron.daily`
 * because the boundary check requires a literal `/` separator after
 * the prefix (or exact equality).
 */
export function linuxPathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (b.startsWith(a + '/')) return true;
  if (a.startsWith(b + '/')) return true;
  return false;
}

export type LinuxPolarity = 'disable' | 'enable' | 'configure' | null;

/**
 * Detect polarity (disable / enable / configure) from a token bag.
 *
 * Used as a hard reject when two sides have conflicting polarity:
 * a "Disable X" resource must not match an "Ensure X is enabled" rule.
 * Returns `null` when no clear signal — `null` is permissive (no
 * constraint applied).
 */
export function tokenPolarity(tokens: Iterable<string>): LinuxPolarity {
  const set = tokens instanceof Set ? tokens : new Set(tokens);
  // Strong disable signals
  if (set.has('disable') || set.has('blacklist') || set.has('removed')) {
    return 'disable';
  }
  // Strong enable signals
  if (set.has('enable') || set.has('installed') || set.has('running') || set.has('active')) {
    return 'enable';
  }
  // Note: 'disabled', 'enabled', 'configured', 'available', 'restricted'
  // are in LINUX_TITLE_STOPWORDS and stripped before this function runs.
  // So we re-check the source TEXT separately via polarityFromText.
  return null;
}

/**
 * Detect polarity directly from raw text (before stopword removal).
 * This is the version used at the catalog/resource boundary because
 * polarity-indicating words like "disabled", "enabled", "is not
 * available" are in the stopword set and would be lost otherwise.
 */
export function polarityFromText(text: string): LinuxPolarity {
  const t = text.toLowerCase();
  // Phrase-level signals first
  if (/\bnot\s+available\b|\bnot\s+enabled\b|\bnot\s+installed\b|\bnot\s+loaded\b/.test(t)) {
    return 'disable';
  }
  if (/\bloaded\s+false\b|\benabled\s+false\b/.test(t)) {
    return 'disable';
  }
  if (/\bloaded\s+true\b/.test(t)) {
    return 'enable';
  }
  // Word-level signals
  if (/\b(disable|disabled|blacklist|removed|restricted)\b/.test(t)) {
    return 'disable';
  }
  if (/\b(enable|enabled|installed|running|active)\b/.test(t)) {
    return 'enable';
  }
  if (/\b(configured|configure|set)\b/.test(t)) {
    return 'configure';
  }
  return null;
}

/**
 * Token sources with confidence weights. Higher weight = stronger
 * signal. The weights are used both in the overlap score and in the
 * distinctive-token guard.
 */
export interface LinuxResourceTokens {
  /** High-confidence (weight 2.0): nested KernelModule names, User names, full paths. */
  high: string[];
  /** Medium-confidence (weight 1.0): resource name tokens, propertyName parts. */
  med: string[];
  /** Low-confidence (weight 0.5): generic path segments, file basenames. */
  low: string[];
  /** Normalized full paths (for path-constraint check). */
  paths: Set<string>;
  /** Original text used for polarity detection (before stopword removal). */
  polaritySource: string;
}

export interface LinuxFuzzyMatchResult<R extends { ruleId: string; title: string }> {
  rule: R;
  score: number;
  matched: string[];
  /** Margin (best - secondBest). Negative when no second candidate. */
  margin: number;
}

const WEIGHT_HIGH = 2.0;
const WEIGHT_MED = 1.0;
const WEIGHT_LOW = 0.5;
const LINUX_SCORE_THRESHOLD = 0.5;
const LINUX_MARGIN = 0.15;
const DISTINCTIVE_MIN_LEN = 4;

/**
 * Linux-aware fuzzy matcher. Works on both XCCDF Linux catalogs and
 * Azure Policy Linux catalogs because it only requires `{ ruleId,
 * title }` from each rule.
 *
 * Acceptance rules (all must hold):
 *   1. Score (weighted containment) ≥ 0.5
 *   2. At least one distinctive token matched (path, high-confidence
 *      token, or ≥2 medium-confidence tokens of length ≥ 4)
 *   3. If resource has path(s) AND title has path(s), they must
 *      boundary-overlap (else hard reject regardless of score)
 *   4. No polarity conflict (disable vs enable hard reject)
 *   5. Best score must beat runner-up by ≥ 0.15 — unless best has an
 *      exact path or high-confidence token match (then no margin)
 *
 * Returns the winning rule and metadata, or `null` if no rule meets
 * the bar.
 */
export function linuxFuzzyMatch<R extends { ruleId: string; title: string }>(
  rules: R[],
  resourceTokens: LinuxResourceTokens,
): LinuxFuzzyMatchResult<R> | null {
  if (rules.length === 0) return null;
  // Build resource token set (deduped, stemmed) + weights map
  const resourceWeights = new Map<string, number>();
  const resourcePaths = resourceTokens.paths;
  for (const t of resourceTokens.high) {
    if (!t) continue;
    const stem = stemLinuxToken(t.toLowerCase());
    resourceWeights.set(stem, Math.max(resourceWeights.get(stem) ?? 0, WEIGHT_HIGH));
  }
  for (const t of resourceTokens.med) {
    if (!t) continue;
    const stem = stemLinuxToken(t.toLowerCase());
    if (!resourceWeights.has(stem)) resourceWeights.set(stem, WEIGHT_MED);
  }
  for (const t of resourceTokens.low) {
    if (!t) continue;
    const stem = stemLinuxToken(t.toLowerCase());
    if (!resourceWeights.has(stem)) resourceWeights.set(stem, WEIGHT_LOW);
  }
  if (resourceWeights.size === 0) return null;

  const resourceWeightSum = [...resourceWeights.values()].reduce((a, b) => a + b, 0);
  const resourcePolarity = polarityFromText(resourceTokens.polaritySource);
  const resourceHasPath = resourcePaths.size > 0;

  let best: LinuxFuzzyMatchResult<R> | null = null;
  let bestExactDistinctive = false;
  let runnerUpScore = 0;

  for (const rule of rules) {
    const titleTokens = new Set(linuxFuzzyTokenize(rule.title));
    if (titleTokens.size === 0) continue;
    const titlePaths = linuxPathTokens(rule.title);
    const titleHasPath = titlePaths.size > 0;

    // (3) Hard path constraint
    if (resourceHasPath && titleHasPath) {
      let pathOverlap = false;
      outer: for (const p of resourcePaths) {
        for (const q of titlePaths) {
          if (linuxPathsOverlap(p, q)) { pathOverlap = true; break outer; }
        }
      }
      if (!pathOverlap) continue;
    }

    // (4) Hard polarity constraint
    const titlePolarity = polarityFromText(rule.title);
    if (
      resourcePolarity && titlePolarity &&
      ((resourcePolarity === 'disable' && titlePolarity === 'enable') ||
       (resourcePolarity === 'enable' && titlePolarity === 'disable'))
    ) {
      continue;
    }

    // Compute weighted overlap
    let matchedWeight = 0;
    const matched: string[] = [];
    let highMatched = false;
    let pathMatched = false;
    let mediumDistinctiveCount = 0;

    // Paths matching also counts as a distinctive signal
    if (resourceHasPath && titleHasPath) {
      for (const p of resourcePaths) {
        for (const q of titlePaths) {
          if (linuxPathsOverlap(p, q)) { pathMatched = true; break; }
        }
        if (pathMatched) break;
      }
    }

    for (const [tok, w] of resourceWeights) {
      if (titleTokens.has(tok)) {
        matchedWeight += w;
        matched.push(tok);
        if (w >= WEIGHT_HIGH) highMatched = true;
        if (w >= WEIGHT_MED && tok.length >= DISTINCTIVE_MIN_LEN) mediumDistinctiveCount++;
      }
    }

    // (2) Distinctive guard
    const hasDistinctive = pathMatched || highMatched || mediumDistinctiveCount >= 2;
    if (!hasDistinctive) {
      // Track as a runner-up candidate for margin purposes only if it
      // would otherwise score. But it cannot win.
      const titleWeightApprox = titleTokens.size * WEIGHT_MED;
      const score = matchedWeight / Math.max(1, Math.min(resourceWeightSum, titleWeightApprox));
      if (score > runnerUpScore) runnerUpScore = score;
      continue;
    }

    // Title weight: each title token counts at WEIGHT_MED for the
    // containment denominator. Path matching is independent (already
    // checked via constraint).
    const titleWeight = titleTokens.size * WEIGHT_MED;
    const denom = Math.min(resourceWeightSum, titleWeight);
    const score = denom > 0 ? matchedWeight / denom : 0;

    if (!best || score > best.score) {
      runnerUpScore = best?.score ?? runnerUpScore;
      best = { rule, score, matched, margin: 0 };
      bestExactDistinctive = pathMatched || highMatched;
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  if (!best) return null;
  best.margin = best.score - runnerUpScore;

  // (1) Score threshold
  if (best.score < LINUX_SCORE_THRESHOLD) return null;
  // (5) Margin gate — skipped if best had exact path or high-confidence match
  if (!bestExactDistinctive && best.margin < LINUX_MARGIN) return null;

  return best;
}
