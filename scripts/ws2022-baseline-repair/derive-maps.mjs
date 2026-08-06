// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
//
// Derives the two reviewable data tables used by `repair-ws2022-baselines.mjs`
// from the *already reviewed and merged* WS2025 baseline repair:
//
//   csp-provider-map.json      CSP OMA-URI  ->  dedicated provider + addressing
//   schema-expression-map.json JSON Schema  ->  CEL expression + human template
//
// Both tables are pure evidence extraction. Nothing is invented here: every
// entry is the (before, after) pair of one WS2025 rule that a human already
// reviewed and merged to `main`. The tables are committed so the repair is
// auditable without git archaeology; this script exists so they can be
// regenerated and diffed.
//
// PROVENANCE RULES
// ----------------
//  * Every artifact is loaded with `git show <full 40-char SHA>:<path>`.
//    The working tree is never read. `HEAD`, branch names and abbreviated
//    SHAs are all mutable, so none of them are used.
//  * Every pinned commit must be an ancestor of `origin/main`, which this
//    script verifies before it derives anything.
//
// Usage:  node scripts/ws2022-baseline-repair/derive-maps.mjs [--check]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/**
 * Pinned evidence commits, all reachable from `origin/main`.
 *
 *   providerBeforeCommit  ab71aaf  generated WS2025, `Policy/Result` CSP form
 *   providerAfterCommit   50d469c  "fix(baselines): repair WS2025 standalone
 *                                  audits" — CSP moved onto dedicated providers
 *   schemaBeforeCommit    50d469c  same commit: dedicated providers, legacy
 *                                  `schema:` compliance blocks
 *   schemaAfterCommit     37ab26a  "fix(compliance): preserve CLI Test reasons"
 *                                  — `schema:` replaced by `expression:` +
 *                                  `template:`
 *   ws2022SourceCommit    173177e  last commit carrying the generated WS2022
 *                                  profiles (the repair input)
 *
 * Note the deliberate overlap: `50d469c` is the *after* state for the provider
 * mapping and the *before* state for the schema translation, which is exactly
 * how the two reviewed changes were layered on main.
 */
export const EVIDENCE = {
  providerBeforeCommit: 'ab71aaf778a87322899a671e6d06bce0fa40aa2a',
  providerAfterCommit: '50d469c3cf5e16729f1359538b10ef4bc0b6de78',
  schemaBeforeCommit: '50d469c3cf5e16729f1359538b10ef4bc0b6de78',
  schemaAfterCommit: '37ab26a74bd7a6aa7f6df9a6ecc0fba3a7521821',
  ws2022SourceCommit: '173177e9eaa34d0b910b44d0749192859831fd50',
};

export const WS2025 = [
  ['ws2025-workgroup-member.osc.yaml', 'workgroup-member'],
  ['ws2025-member-server.osc.yaml', 'member-server'],
  ['ws2025-domain-controller.osc.yaml', 'domain-controller'],
];

export const WS2022 = [
  'ws2022-workgroup-member.osc.yaml',
  'ws2022-domain-member.osc.yaml',
  'ws2022-domain-controller.osc.yaml',
];

const CSP_TYPE = 'Microsoft.Windows/CSP';

/** Fail loudly if any pinned SHA is not a full SHA reachable from origin/main. */
export function assertPinnedAndReachable(evidence = EVIDENCE, cwd = REPO) {
  for (const [label, sha] of Object.entries(evidence)) {
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`${label}: ${sha} is not a full 40-character SHA`);
    }
    const resolved = execFileSync('git', ['rev-parse', `${sha}^{commit}`], {
      cwd, encoding: 'utf8',
    }).trim();
    if (resolved !== sha) {
      throw new Error(`${label}: ${sha} does not resolve to itself — refusing to derive`);
    }
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd });
    } catch {
      throw new Error(`${label}: ${sha} is not reachable from origin/main`);
    }
  }
}

/** Load a baseline exclusively from a pinned commit — never the working tree. */
export function showAt(commit, file, cwd = REPO) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`refusing to read a baseline from a non-pinned ref: ${commit}`);
  }
  const text = execFileSync('git', ['show', `${commit}:public/_baselines/${file}`], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return yaml.load(text);
}

const byName = (doc) => new Map((doc.resources ?? []).map((r) => [r.name, r]));

/** Every OMA-URI addressed by any bundled WS2022 profile at the pinned source. */
function ws2022CspPaths() {
  const wanted = new Map();
  for (const file of WS2022) {
    for (const rule of showAt(EVIDENCE.ws2022SourceCommit, file).resources ?? []) {
      const inner = rule.properties?.resource;
      if (inner?.type !== CSP_TYPE) continue;
      const cspPath = String(inner.properties?.path ?? '');
      if (!wanted.has(cspPath)) wanted.set(cspPath, []);
      wanted.get(cspPath).push(`${file.replace('.osc.yaml', '')}:${rule.name}`);
    }
  }
  return wanted;
}

export function deriveCspProviderMap() {
  const wanted = ws2022CspPaths();
  const found = new Map();

  for (const [file, tag] of WS2025) {
    const before = byName(showAt(EVIDENCE.providerBeforeCommit, file));
    const after = byName(showAt(EVIDENCE.providerAfterCommit, file));
    for (const [name, rule] of before) {
      const from = rule.properties?.resource;
      if (from?.type !== CSP_TYPE) continue;
      const cspPath = String(from.properties?.path ?? '');
      if (!wanted.has(cspPath)) continue;

      const to = after.get(name)?.properties?.resource;
      if (!to || to.type === CSP_TYPE) continue;

      const address = { ...to.properties };
      delete address.value;
      const record = {
        cspPath,
        target: { type: to.type, properties: address },
        ws2025Value: Object.prototype.hasOwnProperty.call(to.properties ?? {}, 'value')
          ? to.properties.value
          : undefined,
        evidence: [`ws2025-${tag}:${name}`],
      };

      const existing = found.get(cspPath);
      if (!existing) {
        found.set(cspPath, record);
        continue;
      }
      const a = JSON.stringify(existing.target);
      const b = JSON.stringify(record.target);
      if (a !== b) {
        throw new Error(`conflicting WS2025 provider mapping for ${cspPath}:\n  ${a}\n  ${b}`);
      }
      existing.evidence.push(`ws2025-${tag}:${name}`);
    }
  }

  const missing = [...wanted.keys()].filter((p) => !found.has(p));
  if (missing.length) {
    throw new Error(`no reviewed WS2025 mapping for:\n  ${missing.join('\n  ')}`);
  }

  const entries = [...found.values()].sort((a, b) => a.cspPath.localeCompare(b.cspPath));
  for (const entry of entries) entry.usedBy = wanted.get(entry.cspPath);
  return {
    _provenance: {
      description:
        'Policy CSP OMA-URI -> dedicated provider + addressing, extracted from the reviewed '
        + 'WS2025 CSP repair. Values are NOT carried over; only the mechanism is.',
      providerBeforeCommit: EVIDENCE.providerBeforeCommit,
      providerAfterCommit: EVIDENCE.providerAfterCommit,
      ws2022SourceCommit: EVIDENCE.ws2022SourceCommit,
      paths: WS2025.map(([file]) => `public/_baselines/${file}`),
      reachableFromOriginMain: true,
      regenerate: 'node scripts/ws2022-baseline-repair/derive-maps.mjs',
    },
    entries,
  };
}

export function deriveSchemaExpressionMap() {
  const table = new Map();
  for (const [file] of WS2025) {
    const before = byName(showAt(EVIDENCE.schemaBeforeCommit, file));
    const after = byName(showAt(EVIDENCE.schemaAfterCommit, file));
    for (const [name, rule] of before) {
      const next = after.get(name);
      if (!next) continue;
      const schema = rule.properties?.schema;
      if (schema === undefined) continue;
      const value = next.properties?.resource?.properties?.value;
      const key = `${JSON.stringify(schema)}\u0000${valueKind(value)}`;
      const out = {
        schema,
        valueKind: valueKind(value),
        expression: next.properties?.expression,
        template: next.properties?.template,
      };
      const existing = table.get(key);
      if (!existing) {
        table.set(key, { ...out, evidence: [name] });
        continue;
      }
      if (existing.expression !== out.expression || existing.template !== out.template) {
        throw new Error(
          `ambiguous schema translation for ${key}: `
          + `${existing.expression} vs ${out.expression} (${name})`,
        );
      }
      if (existing.evidence.length < 3 && !existing.evidence.includes(name)) {
        existing.evidence.push(name);
      }
    }
  }
  const entries = [...table.values()].sort(
    (a, b) => JSON.stringify(a.schema).localeCompare(JSON.stringify(b.schema))
      || a.valueKind.localeCompare(b.valueKind),
  );
  return {
    _provenance: {
      description:
        'Legacy JSON-Schema compliance shape -> CEL expression + human template, extracted '
        + 'from the reviewed WS2025 schema translation. Keyed by schema shape AND the kind '
        + 'of the desired value, because string-typed values use an int() coercion form.',
      schemaBeforeCommit: EVIDENCE.schemaBeforeCommit,
      schemaAfterCommit: EVIDENCE.schemaAfterCommit,
      paths: WS2025.map(([file]) => `public/_baselines/${file}`),
      reachableFromOriginMain: true,
      regenerate: 'node scripts/ws2022-baseline-repair/derive-maps.mjs',
    },
    entries,
  };
}

export function valueKind(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const targets = [
  ['csp-provider-map.json', deriveCspProviderMap],
  ['schema-expression-map.json', deriveSchemaExpressionMap],
];

function main() {
  assertPinnedAndReachable();
  const check = process.argv.includes('--check');
  let drift = 0;
  for (const [file, build] of targets) {
    const next = `${JSON.stringify(build(), null, 2)}\n`;
    const dest = path.join(HERE, file);
    if (check) {
      const current = readFileSync(dest, 'utf8');
      if (current.replace(/\r\n/g, '\n') !== next) {
        drift += 1;
        console.error(`DRIFT: ${file} differs from the derived table`);
      } else {
        console.log(`ok: ${file}`);
      }
      continue;
    }
    writeFileSync(dest, next, 'utf8');
    console.log(`wrote: ${file}`);
  }
  if (check && drift) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
