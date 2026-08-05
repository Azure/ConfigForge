// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROFILES,
  SOURCE_COMMIT,
  LIVE_SMOKE,
  valueKind,
  normalizeKeyPath,
  normalizeRegistryValueType,
  translateSchema,
  translatePrincipalListSchema,
} from './repair-ws2022-baselines.mjs';
import {
  EVIDENCE,
  WS2025,
  assertPinnedAndReachable,
  showAt,
  valueKind as evidenceValueKind,
} from './derive-maps.mjs';

/**
 * Unit coverage for the WS2022 baseline repair tooling.
 *
 * The shipped YAML is asserted separately in
 * `apps/desktop/src/data/ws2022-baselines.test.ts`.
 *
 * DESIGN NOTE — this suite deliberately does NOT check the generated baselines
 * against the mapping tables that generated them; that would be circular. Every
 * mapping claim is re-derived here by parsing the *pinned evidence commits*
 * with `git show`, independently of the committed JSON tables, and the tables
 * are then required to agree with that independent reading.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(HERE, 'repair-ws2022-baselines.mjs');
const readJson = (name) => JSON.parse(readFileSync(path.join(HERE, name), 'utf8'));

const cspMap = readJson('csp-provider-map.json');
const schemaMap = readJson('schema-expression-map.json');
const conversionReport = readJson('conversion-report.json');

const DEDICATED_PROVIDERS = [
  'Microsoft.Windows/AccountPolicy',
  'Microsoft.Windows/AuditPolicy',
  'Microsoft.Windows/UserRightsAssignment',
];

const FULL_SHA = /^[0-9a-f]{40}$/;
const CSP_TYPE = 'Microsoft.Windows/CSP';

/**
 * The pinned commits are only readable when the checkout has history. CI is
 * required to provide it (`fetch-depth: 0` on the test job); a developer with a
 * shallow or partial clone gets the non-git assertions and an explicit skip.
 */
let evidenceError = null;
try {
  assertPinnedAndReachable(EVIDENCE, REPO);
  for (const [file] of WS2025) showAt(EVIDENCE.providerAfterCommit, file, REPO);
} catch (error) {
  evidenceError = error;
}
const evidenceAvailable = evidenceError === null;

const byName = (doc) => new Map((doc.resources ?? []).map((rule) => [rule.name, rule]));
const tagToFile = new Map(WS2025.map(([file, tag]) => [tag, file]));
const cacheAt = new Map();
function rulesAt(commit, tag) {
  const key = `${commit}:${tag}`;
  if (!cacheAt.has(key)) cacheAt.set(key, byName(showAt(commit, tagToFile.get(tag), REPO)));
  return cacheAt.get(key);
}
const parseEvidenceRef = (ref) => {
  const match = /^ws2025-([a-z-]+):(.+)$/.exec(ref);
  if (!match) throw new Error(`malformed evidence reference: ${ref}`);
  return { tag: match[1], name: match[2] };
};

/**
 * Minimal CEL evaluator covering exactly the disjunction grammar used by the
 * restored user-rights assertion. `||` short-circuits the way CEL does, so a
 * `null` value never reaches `size()`; anything outside the grammar throws
 * rather than being silently approximated.
 */
function evalCel(expression, value) {
  return expression.split('||').map((part) => part.trim()).some((atom) => {
    if (atom === 'value == null') return value === null || value === undefined;
    const sized = /^value\.size\(\) == (\d+)$/.exec(atom);
    if (sized) {
      if (value === null || value === undefined) throw new Error('size() applied to a null value');
      if (!Array.isArray(value)) throw new Error('size() applied to a non-list value');
      return value.length === Number(sized[1]);
    }
    throw new Error(`unsupported CEL atom for this harness: ${atom}`);
  });
}

describe('pinned provenance', () => {
  it('is reachable in CI, where full history is required', () => {
    if (process.env.CI) {
      expect(evidenceError, `CI must check out full history: ${evidenceError?.message}`).toBe(null);
    } else {
      expect(typeof evidenceAvailable).toBe('boolean');
    }
  });

  it('pins the WS2022 repair input to a full SHA', () => {
    expect(SOURCE_COMMIT).toBe('173177e9eaa34d0b910b44d0749192859831fd50');
    expect(SOURCE_COMMIT).toMatch(FULL_SHA);
    expect(conversionReport._provenance.sourceCommit).toBe(SOURCE_COMMIT);
  });

  it('pins the provider map to the reviewed WS2025 CSP repair, by full SHA', () => {
    const p = cspMap._provenance;
    expect(p.providerBeforeCommit).toBe('ab71aaf778a87322899a671e6d06bce0fa40aa2a');
    expect(p.providerAfterCommit).toBe('50d469c3cf5e16729f1359538b10ef4bc0b6de78');
    expect(p.ws2022SourceCommit).toBe(SOURCE_COMMIT);
    for (const key of ['providerBeforeCommit', 'providerAfterCommit', 'ws2022SourceCommit']) {
      expect(p[key], key).toMatch(FULL_SHA);
    }
    expect(p.reachableFromOriginMain).toBe(true);
    expect(p.derivedFrom, 'mutable working-tree provenance must be gone').toBeUndefined();
  });

  it('pins the schema map to the reviewed WS2025 schema translation, by full SHA', () => {
    const p = schemaMap._provenance;
    expect(p.schemaBeforeCommit).toBe('50d469c3cf5e16729f1359538b10ef4bc0b6de78');
    expect(p.schemaAfterCommit).toBe('37ab26a74bd7a6aa7f6df9a6ecc0fba3a7521821');
    expect(p.schemaBeforeCommit).toMatch(FULL_SHA);
    expect(p.schemaAfterCommit).toMatch(FULL_SHA);
    expect(p.reachableFromOriginMain).toBe(true);
  });

  it('matches the pinned SHAs the derivation script actually reads', () => {
    expect(EVIDENCE.providerBeforeCommit).toBe(cspMap._provenance.providerBeforeCommit);
    expect(EVIDENCE.providerAfterCommit).toBe(cspMap._provenance.providerAfterCommit);
    expect(EVIDENCE.schemaBeforeCommit).toBe(schemaMap._provenance.schemaBeforeCommit);
    expect(EVIDENCE.schemaAfterCommit).toBe(schemaMap._provenance.schemaAfterCommit);
    expect(EVIDENCE.ws2022SourceCommit).toBe(SOURCE_COMMIT);
  });

  it('refuses to read evidence from a mutable ref', () => {
    expect(() => showAt('HEAD', 'ws2025-workgroup-member.osc.yaml', REPO)).toThrow(/non-pinned/);
    expect(() => showAt('37ab26a', 'ws2025-workgroup-member.osc.yaml', REPO)).toThrow(/non-pinned/);
  });

  it.runIf(evidenceAvailable)('resolves every pinned SHA to an ancestor of origin/main', () => {
    for (const [label, sha] of Object.entries(EVIDENCE)) {
      expect(sha, label).toMatch(FULL_SHA);
      const resolved = execFileSync('git', ['rev-parse', `${sha}^{commit}`], {
        cwd: REPO, encoding: 'utf8',
      }).trim();
      expect(resolved, label).toBe(sha);
      expect(
        () => execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: REPO }),
        `${label} ${sha} must be reachable from origin/main`,
      ).not.toThrow();
    }
  });

  it.runIf(evidenceAvailable)('rejects an unreachable commit', () => {
    expect(() => assertPinnedAndReachable(
      { bogus: '0000000000000000000000000000000000000000' },
      REPO,
    )).toThrow();
    expect(() => assertPinnedAndReachable({ abbreviated: '37ab26a' }, REPO))
      .toThrow(/full 40-character SHA/);
  });
});

describe('csp-provider-map.json', () => {
  it('maps every CSP path to exactly one dedicated provider', () => {
    const seen = new Set();
    for (const entry of cspMap.entries) {
      expect(entry.cspPath).toMatch(/^\.\/Vendor\/MSFT\/Policy\/Result\//);
      expect(seen.has(entry.cspPath), `duplicate mapping for ${entry.cspPath}`).toBe(false);
      seen.add(entry.cspPath);
      expect(DEDICATED_PROVIDERS).toContain(entry.target.type);
    }
    expect(cspMap.entries.length).toBe(81);
  });

  it('has the expected provider split', () => {
    const counts = {};
    for (const entry of cspMap.entries) {
      counts[entry.target.type] = (counts[entry.target.type] ?? 0) + 1;
    }
    expect(counts).toEqual({
      'Microsoft.Windows/AuditPolicy': 33,
      'Microsoft.Windows/UserRightsAssignment': 37,
      'Microsoft.Windows/AccountPolicy': 11,
    });
  });

  it('addresses each provider the way that provider is addressed', () => {
    for (const entry of cspMap.entries) {
      const props = entry.target.properties ?? {};
      expect(Object.keys(props), entry.cspPath).not.toContain('value');
      if (entry.target.type === 'Microsoft.Windows/AuditPolicy') {
        expect(Object.keys(props), entry.cspPath).toEqual(['subcategory']);
        expect(props.subcategory, entry.cspPath).toMatch(
          /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/,
        );
      } else {
        expect(Object.keys(props), entry.cspPath).toEqual(['name']);
        expect(typeof props.name).toBe('string');
      }
      if (entry.target.type === 'Microsoft.Windows/UserRightsAssignment') {
        expect(props.name, entry.cspPath).toMatch(/^Se[A-Z][A-Za-z]*(Privilege|Right)$/);
      }
    }
  });

  it('carries WS2025 evidence for every mapping', () => {
    for (const entry of cspMap.entries) {
      expect(entry.evidence.length, entry.cspPath).toBeGreaterThan(0);
      for (const ref of entry.evidence) expect(ref).toMatch(/^ws2025-[a-z-]+:\S+$/);
    }
  });

  it('covers every CSP path the three WS2022 profiles actually used', () => {
    const mapped = new Set(cspMap.entries.map((entry) => entry.cspPath));
    for (const profile of conversionReport.profiles) {
      for (const conversion of profile.conversions) {
        expect(mapped.has(conversion.cspPath), `${profile.profile}: ${conversion.cspPath}`)
          .toBe(true);
      }
    }
  });

  it('states known representative mappings explicitly', () => {
    const at = (cspPath) => cspMap.entries.find((entry) => entry.cspPath === cspPath);
    expect(at('./Vendor/MSFT/Policy/Result/Audit/AccountLogon_AuditCredentialValidation').target)
      .toEqual({
        type: 'Microsoft.Windows/AuditPolicy',
        properties: { subcategory: '{0CCE923F-69AE-11D9-BED3-505054503030}' },
      });
    expect(at('./Vendor/MSFT/Policy/Result/UserRights/AccessFromNetwork').target).toEqual({
      type: 'Microsoft.Windows/UserRightsAssignment',
      properties: { name: 'SeNetworkLogonRight' },
    });
    expect(at('./Vendor/MSFT/Policy/Result/UserRights/ActAsPartOfTheOperatingSystem').target)
      .toEqual({
        type: 'Microsoft.Windows/UserRightsAssignment',
        properties: { name: 'SeTcbPrivilege' },
      });
    expect(at('./Vendor/MSFT/Policy/Result/DeviceLock/MaximumPasswordAge').target).toEqual({
      type: 'Microsoft.Windows/AccountPolicy',
      properties: { name: 'MaximumPasswordAge' },
    });
    expect(at('./Vendor/MSFT/Policy/Result/DeviceLock/ClearTextPassword').target).toEqual({
      type: 'Microsoft.Windows/AccountPolicy',
      properties: { name: 'EnablePasswordReversibleEncryption' },
    });
  });
});

describe('csp-provider-map.json vs. independently parsed pinned baselines', () => {
  it.runIf(evidenceAvailable)(
    'reproduces every target address from the pinned before/after WS2025 pair',
    () => {
      for (const entry of cspMap.entries) {
        entry.evidence.forEach((ref, index) => {
          const { tag, name } = parseEvidenceRef(ref);
          const before = rulesAt(EVIDENCE.providerBeforeCommit, tag).get(name);
          const after = rulesAt(EVIDENCE.providerAfterCommit, tag).get(name);
          expect(before, `${ref} missing at providerBeforeCommit`).toBeDefined();
          expect(after, `${ref} missing at providerAfterCommit`).toBeDefined();

          const from = before.properties?.resource;
          expect(from?.type, ref).toBe(CSP_TYPE);
          expect(from.properties?.path, ref).toBe(entry.cspPath);

          const to = after.properties?.resource;
          expect(to?.type, ref).toBe(entry.target.type);
          const address = { ...to.properties };
          delete address.value;
          expect(address, ref).toEqual(entry.target.properties);
          // `ws2025Value` is recorded from the first evidence profile only, and is
          // never carried into WS2022 — the later profiles legitimately differ.
          if (index === 0) {
            expect(to.properties?.value, `${ref} desired value`).toEqual(entry.ws2025Value);
          }
        });
      }
    },
  );

  it.runIf(evidenceAvailable)('reads the representative mappings straight out of git', () => {
    const wg = rulesAt(EVIDENCE.providerAfterCommit, 'workgroup-member');
    expect(wg.get('AuditCredentialValidation').properties.resource).toEqual({
      type: 'Microsoft.Windows/AuditPolicy',
      properties: { subcategory: '{0CCE923F-69AE-11D9-BED3-505054503030}', value: 3 },
    });
    expect(wg.get('UserRightsAccessFromNetwork').properties.resource).toEqual({
      type: 'Microsoft.Windows/UserRightsAssignment',
      properties: { name: 'SeNetworkLogonRight', value: ['*S-1-5-32-544', '*S-1-5-11'] },
    });
    expect(wg.get('DeviceLockMaximumPasswordAge').properties.resource.properties.name)
      .toBe('MaximumPasswordAge');

    const beforeWg = rulesAt(EVIDENCE.providerBeforeCommit, 'workgroup-member');
    expect(beforeWg.get('AuditCredentialValidation').properties.resource.properties.path)
      .toBe('./Vendor/MSFT/Policy/Result/Audit/AccountLogon_AuditCredentialValidation');
  });

  it.runIf(evidenceAvailable)('leaves no unmapped WS2025 CSP conversion behind', () => {
    const mapped = new Set(cspMap.entries.map((entry) => entry.cspPath));
    const used = new Set(
      conversionReport.profiles.flatMap((p) => p.conversions.map((c) => c.cspPath)),
    );
    for (const cspPath of mapped) {
      expect(used.has(cspPath), `${cspPath} is mapped but unused — stale map entry`).toBe(true);
    }
  });
});

describe('schema-expression-map.json', () => {
  it('translates every reviewed schema shape to a CEL expression and template', () => {
    for (const entry of schemaMap.entries) {
      expect(typeof entry.expression).toBe('string');
      expect(entry.expression.length).toBeGreaterThan(0);
      expect(entry.template).toContain('{value}');
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
    expect(schemaMap.entries.length).toBe(49);
  });

  it('is unambiguous — one translation per (schema, value kind) pair', () => {
    const seen = new Set();
    for (const entry of schemaMap.entries) {
      const key = `${JSON.stringify(entry.schema)}|${entry.valueKind}`;
      expect(seen.has(key), `ambiguous translation for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('states known representative translations explicitly', () => {
    const at = (schema, kind) => schemaMap.entries.find(
      (entry) => JSON.stringify(entry.schema) === JSON.stringify(schema) && entry.valueKind === kind,
    );
    expect(at({ const: 0 }, 'number').expression).toBe('(value == 0)');
    expect(at({ const: '1' }, 'string').expression).toBe('(value == "1")');
    expect(at({ enum: [0, 1] }, 'number').expression)
      .toBe('([0,1].exists(item, value == item))');
  });

  it.runIf(evidenceAvailable)(
    'reproduces every translation from the pinned before/after WS2025 pair',
    () => {
      for (const entry of schemaMap.entries) {
        for (const name of entry.evidence) {
          // The same rule name lives in more than one WS2025 profile and can carry a
          // different schema in each, so the claim is "some pinned profile shows this
          // exact (schema, valueKind) -> (expression, template) pair".
          const pairs = [];
          for (const [, tag] of WS2025) {
            const before = rulesAt(EVIDENCE.schemaBeforeCommit, tag).get(name);
            const after = rulesAt(EVIDENCE.schemaAfterCommit, tag).get(name);
            if (before && after) pairs.push({ tag, before, after });
          }
          expect(pairs.length, `${name} missing from the pinned WS2025 baselines`)
            .toBeGreaterThan(0);

          const match = pairs.find(({ before, after }) => (
            JSON.stringify(before.properties?.schema) === JSON.stringify(entry.schema)
            && evidenceValueKind(after.properties?.resource?.properties?.value) === entry.valueKind
          ));
          expect(
            match,
            `${name}: no pinned profile carries schema ${JSON.stringify(entry.schema)} `
            + `with a ${entry.valueKind} value`,
          ).toBeDefined();
          expect(match.after.properties?.expression, `${name} @${match.tag}`)
            .toBe(entry.expression);
          expect(match.after.properties?.template, `${name} @${match.tag}`).toBe(entry.template);
          expect(
            match.after.properties?.schema,
            `${name} still carries a legacy schema at schemaAfterCommit`,
          ).toBeUndefined();
        }
      }
    },
  );

  it.runIf(evidenceAvailable)(
    'confirms the pinned after-commit really is the expression+template form',
    () => {
      for (const [, tag] of WS2025) {
        const after = rulesAt(EVIDENCE.schemaAfterCommit, tag);
        let expressions = 0;
        let templates = 0;
        let schemas = 0;
        let resultCsp = 0;
        let configCsp = 0;
        for (const rule of after.values()) {
          if (typeof rule.properties?.expression === 'string') expressions += 1;
          if (typeof rule.properties?.template === 'string') templates += 1;
          if (rule.properties?.schema !== undefined) schemas += 1;
          const inner = rule.properties?.resource;
          if (inner?.type !== CSP_TYPE) continue;
          const cspPath = String(inner.properties?.path ?? '');
          if (cspPath.startsWith('./Vendor/MSFT/Policy/Result/')) resultCsp += 1;
          else if (cspPath.startsWith('./Vendor/MSFT/Policy/Config/')) configCsp += 1;
          else throw new Error(`${tag}: unexpected CSP path ${cspPath}`);
        }
        expect(schemas, `${tag} must have no legacy schema blocks`).toBe(0);
        expect(expressions, tag).toBe(after.size);
        expect(templates, tag).toBe(after.size);
        // `Policy/Result` is the MDM-resultant path that fails to read on a
        // standalone machine and is what this repair eliminates. The five
        // remaining `Policy/Config` rules read back what was written and are the
        // documented, reviewed residual in shipped WS2025.
        expect(resultCsp, `${tag} must have no Policy/Result CSP rules left`).toBe(0);
        expect(configCsp, `${tag} reviewed Policy/Config residual`).toBe(5);
      }
    },
  );
});

describe('deterministic normalisers', () => {
  it('adds the colon that the standalone registry provider requires', () => {
    expect(normalizeKeyPath('HKEY_LOCAL_MACHINE\\System\\CurrentControlSet\\Control\\Lsa')).toBe(
      'HKEY_LOCAL_MACHINE:\\System\\CurrentControlSet\\Control\\Lsa',
    );
    expect(normalizeKeyPath('HKLM\\SOFTWARE\\Policies')).toBe('HKLM:\\SOFTWARE\\Policies');
  });

  it('leaves an already-normalised keyPath untouched (idempotent)', () => {
    const normalized = 'HKEY_LOCAL_MACHINE:\\SYSTEM\\CurrentControlSet\\Services';
    expect(normalizeKeyPath(normalized)).toBe(normalized);
  });

  it('maps legacy value-type aliases onto the REG_* names WS2025 ships', () => {
    expect(normalizeRegistryValueType('Dword')).toBe('REG_DWORD');
    expect(normalizeRegistryValueType('String')).toBe('REG_SZ');
    expect(normalizeRegistryValueType('MultiString')).toBe('REG_MULTI_SZ');
    expect(normalizeRegistryValueType('REG_BINARY')).toBe('REG_BINARY');
  });

  it('classifies desired values the way the schema map is keyed', () => {
    expect(valueKind(1)).toBe('number');
    expect(valueKind('1')).toBe('string');
    expect(valueKind([])).toBe('array');
    expect(valueKind(true)).toBe('boolean');
  });

  it('renders informational, const, range and enum schemas in WS2025 CEL form', () => {
    expect(translateSchema({}, 'number')).toEqual({
      expression: 'true',
      template: 'The value {value} is informational for this control.',
    });
    expect(translateSchema({ const: 0 }, 'number').expression).toBe('(value == 0)');
    expect(translateSchema({ minimum: 14 }, 'number').expression).toBe(
      '(value != null && value >= 14)',
    );
    expect(translateSchema({ minimum: 1, maximum: 70 }, 'number').expression).toBe(
      '(value != null && value >= 1 && value <= 70)',
    );
  });

  it('refuses to guess at an unrecognised schema shape', () => {
    expect(() => translateSchema({ multipleOf: 3 }, 'number')).toThrow();
  });
});

describe('user-rights "unassigned" assertion', () => {
  const EMPTY_OR_NULL = { oneOf: [{ const: '' }, { type: 'null' }] };
  const EXPECTED = 'value == null || value.size() == 0';

  it('restates "empty string or not set" over a principal list', () => {
    expect(translatePrincipalListSchema(EMPTY_OR_NULL, '', [])).toEqual({
      expression: EXPECTED,
      template: 'The value {value} must be unassigned (no principals).',
      source: 'principal-list-restatement',
    });
    expect(translatePrincipalListSchema(EMPTY_OR_NULL, null, [])?.expression).toBe(EXPECTED);
  });

  it('declines anything it has not been given evidence for', () => {
    expect(translatePrincipalListSchema({}, '', [])).toBe(null);
    expect(translatePrincipalListSchema(EMPTY_OR_NULL, '', ['*S-1-5-32-544'])).toBe(null);
    expect(translatePrincipalListSchema(EMPTY_OR_NULL, 'Administrators', [])).toBe(null);
    expect(translatePrincipalListSchema({ const: '' }, '', [])).toBe(null);
    expect(translatePrincipalListSchema({ oneOf: [{ const: 'x' }, { type: 'null' }] }, '', []))
      .toBe(null);
    expect(translatePrincipalListSchema(null, '', [])).toBe(null);
  });

  it('passes for an unset or empty assignment and fails for any assigned principal', () => {
    expect(evalCel(EXPECTED, null)).toBe(true);
    expect(evalCel(EXPECTED, undefined)).toBe(true);
    expect(evalCel(EXPECTED, [])).toBe(true);
    expect(evalCel(EXPECTED, ['*S-1-5-32-544'])).toBe(false);
    expect(evalCel(EXPECTED, ['*S-1-5-32-544', '*S-1-5-11'])).toBe(false);
  });

  it('short-circuits, so size() is never applied to a null value', () => {
    expect(() => evalCel(EXPECTED, null)).not.toThrow();
    expect(() => evalCel('value.size() == 0', null)).toThrow(/size\(\) applied to a null/);
  });

  it('is never an informational downgrade in any profile report', () => {
    const expected = { 'ws2022-domain-member': 7, 'ws2022-domain-controller': 6, 'ws2022-workgroup-member': 7 };
    for (const profile of conversionReport.profiles) {
      const key = profile.profile.replace('.osc.yaml', '');
      expect(profile.assertionDowngrades, `${key} must have no downgrades left`).toEqual([]);
      expect(profile.assertionRestatements.length, key).toBe(expected[key]);
      for (const item of profile.assertionRestatements) {
        expect(item.to, `${key}:${item.name}`).toBe(EXPECTED);
        expect(item.from, `${key}:${item.name}`).toEqual(EMPTY_OR_NULL);
        expect(item.name, `${key}:${item.name}`).toMatch(/^UserRights/);
      }
    }
  });

  it.runIf(evidenceAvailable)(
    'restates exactly the rules that were "empty or not set" in the pinned source',
    () => {
      for (const profile of conversionReport.profiles) {
        const source = showAt(EVIDENCE.ws2022SourceCommit, profile.profile, REPO);
        const src = byName(source);
        const eligible = [...src.values()].filter((rule) => {
          const schema = rule.properties?.schema;
          const inner = rule.properties?.resource;
          if (inner?.type !== CSP_TYPE) return false;
          if (!String(inner.properties?.path ?? '').includes('/UserRights/')) return false;
          return JSON.stringify(schema) === JSON.stringify(EMPTY_OR_NULL);
        }).map((rule) => rule.name).sort();
        const restated = profile.assertionRestatements.map((item) => item.name).sort();
        expect(restated, profile.profile).toEqual(eligible);
        for (const name of eligible) {
          expect(src.get(name).properties?.resource?.properties?.value, name).toBe('');
        }
      }
    },
  );
});

describe('conversion report', () => {
  it('covers all three bundled WS2022 profiles', () => {
    expect(conversionReport.profiles.map((p) => p.profile)).toEqual([...PROFILES]);
  });

  it('leaves no residual Policy CSP rule in any profile', () => {
    for (const profile of conversionReport.profiles) {
      expect(profile.residualCsp, profile.profile).toEqual([]);
      expect(profile.convertedCsp, profile.profile).toBe(profile.sourceCsp);
    }
  });

  it('reconciles every rule-count delta through a declared expansion', () => {
    for (const profile of conversionReport.profiles) {
      const extra = profile.expansions.reduce((sum, e) => sum + e.into.length - 1, 0);
      expect(profile.sourceRules + extra, profile.profile).toBe(profile.outputRules);
    }
  });

  it('pins the exact per-profile rule and provider counts', () => {
    const expected = {
      'ws2022-domain-member.osc.yaml': {
        sourceRules: 257,
        outputRules: 259,
        providerCounts: {
          'Microsoft.Windows/Registry': 184,
          'Microsoft.Windows/AuditPolicy': 26,
          'Microsoft.Windows/UserRightsAssignment': 36,
          'Microsoft.Windows/AccountPolicy': 13,
        },
      },
      'ws2022-domain-controller.osc.yaml': {
        sourceRules: 242,
        outputRules: 244,
        providerCounts: {
          'Microsoft.Windows/Registry': 171,
          'Microsoft.Windows/AuditPolicy': 32,
          'Microsoft.Windows/UserRightsAssignment': 28,
          'Microsoft.Windows/AccountPolicy': 13,
        },
      },
      'ws2022-workgroup-member.osc.yaml': {
        sourceRules: 200,
        outputRules: 202,
        providerCounts: {
          'Microsoft.Windows/Registry': 129,
          'Microsoft.Windows/AuditPolicy': 26,
          'Microsoft.Windows/UserRightsAssignment': 36,
          'Microsoft.Windows/AccountPolicy': 11,
        },
      },
    };
    for (const profile of conversionReport.profiles) {
      const want = expected[profile.profile];
      expect(want, profile.profile).toBeDefined();
      expect(profile.sourceRules, profile.profile).toBe(want.sourceRules);
      expect(profile.outputRules, profile.profile).toBe(want.outputRules);
      const total = Object.values(profile.providerCounts).reduce((a, b) => a + b, 0);
      expect(total, profile.profile).toBe(profile.outputRules);
      for (const [type, count] of Object.entries(want.providerCounts)) {
        expect(profile.providerCounts[type], `${profile.profile}:${type}`).toBe(count);
      }
    }
  });

  it('justifies every registry shape repair with a WS2025 contract', () => {
    for (const profile of conversionReport.profiles) {
      for (const repair of profile.registryShapeRepairs) {
        expect(repair.evidence, `${profile.profile}:${repair.name}`).toMatch(/^ws2025-/);
        expect(repair.from.valueType).not.toBe(repair.to.valueType);
      }
    }
  });

  it('records the live smoke run as labelled, non-native evidence', () => {
    const smoke = conversionReport._provenance.liveSmoke;
    expect(smoke).toEqual(LIVE_SMOKE);
    expect(smoke.profile).toBe('ws2022-workgroup-member.osc.yaml');
    expect(smoke.oscfgVersion).toBe('1.3.12-preview5');
    expect(smoke.shipped).toEqual({ compliant: 171, readErrors: 29 });
    expect(smoke.repaired).toEqual({ compliant: 200, nonCompliant: 2, readErrors: 0 });
    expect(smoke.host).toMatch(/Windows Server 2025/);
    expect(smoke.host).toMatch(/not Windows Server 2022/);
    expect(smoke.caveat).toMatch(/not.*native.*Windows Server 2022 validation/i);
    const totals = smoke.repaired.compliant + smoke.repaired.nonCompliant + smoke.repaired.readErrors;
    expect(totals, 'the smoke run must account for every rule in the profile').toBe(202);
  });
});

describe('--report is read-only', () => {
  const watched = [
    path.join(REPO, 'public', '_baselines', 'ws2022-domain-member.osc.yaml'),
    path.join(REPO, 'public', '_baselines', 'ws2022-domain-controller.osc.yaml'),
    path.join(REPO, 'public', '_baselines', 'ws2022-workgroup-member.osc.yaml'),
    path.join(HERE, 'conversion-report.json'),
    path.join(HERE, 'csp-provider-map.json'),
    path.join(HERE, 'schema-expression-map.json'),
  ];
  const snapshot = () => watched.map((file) => {
    const stat = statSync(file);
    return { file, size: stat.size, mtimeMs: stat.mtimeMs, content: readFileSync(file, 'utf8') };
  });

  it.runIf(evidenceAvailable)('prints a summary without touching a single file', () => {
    const before = snapshot();
    const stdout = execFileSync(process.execPath, [SCRIPT, '--report'], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const after = snapshot();

    expect(stdout).toContain('--report is read-only: nothing was written.');
    expect(stdout).not.toContain('wrote:');
    for (const profile of PROFILES) expect(stdout).toContain(profile);
    expect(stdout).toContain('assertion restatements');
    expect(stdout).toMatch(/restated: UserRights\w+ -> value == null \|\| value\.size\(\) == 0/);

    for (let i = 0; i < watched.length; i += 1) {
      expect(after[i].content, `${watched[i]} content changed`).toBe(before[i].content);
      expect(after[i].size, `${watched[i]} size changed`).toBe(before[i].size);
      expect(after[i].mtimeMs, `${watched[i]} was rewritten`).toBe(before[i].mtimeMs);
    }
  }, 120_000);

  it.runIf(evidenceAvailable)('still writes when no mode flag is given', () => {
    const before = snapshot();
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const after = snapshot();
    expect(stdout).toContain('wrote:');
    for (let i = 0; i < 4; i += 1) {
      expect(after[i].content, `${watched[i]} must be regenerated identically`)
        .toBe(before[i].content);
    }
  }, 120_000);
});
