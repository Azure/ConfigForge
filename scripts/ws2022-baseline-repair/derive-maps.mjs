// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
//
// Derives the two reviewable data tables used by `repair-ws2022-baselines.mjs`
// from the *already reviewed and merged* WS2025 baseline repair (PRs #82/#93):
//
//   csp-provider-map.json      CSP OMA-URI  ->  dedicated provider + addressing
//   schema-expression-map.json JSON Schema  ->  CEL expression + human template
//
// Both tables are pure evidence extraction. Nothing is invented here: every
// entry is the (before, after) pair of one WS2025 rule that a human already
// reviewed. The tables are committed so the repair is auditable without git
// archaeology; this script exists so they can be regenerated and diffed.
//
// Evidence commits (see `git log public/_baselines/ws2025-workgroup-member.osc.yaml`):
//   50d469c^  generated WS2025, Policy/Result CSP form           (CSP addressing)
//   50d469c   CSP -> dedicated providers                          (provider mapping)
//   6fb3052^  dedicated providers, legacy `schema:` form          (schema shapes)
//   6fb3052   `schema:` -> `expression:` + `template:`            (CEL translation)
//
// Usage:  node scripts/ws2022-baseline-repair/derive-maps.mjs [--check]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const BASELINES = path.join(REPO, 'public', '_baselines');

const CSP_COMMIT = '50d469c';
const SCHEMA_COMMIT = '6fb3052';
// Last commit carrying the original generated WS2022 profiles (the repair input).
const WS2022_SOURCE_REF = '173177e';

const WS2025 = [
  ['ws2025-workgroup-member.osc.yaml', 'workgroup-member'],
  ['ws2025-member-server.osc.yaml', 'member-server'],
  ['ws2025-domain-controller.osc.yaml', 'domain-controller'],
];

const WS2022 = [
  'ws2022-workgroup-member.osc.yaml',
  'ws2022-domain-member.osc.yaml',
  'ws2022-domain-controller.osc.yaml',
];

const CSP_TYPE = 'Microsoft.Windows/CSP';

function showAt(commit, file) {
  const text = execFileSync('git', ['show', `${commit}:public/_baselines/${file}`], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return yaml.load(text);
}

function loadLocal(file) {
  return yaml.load(readFileSync(path.join(BASELINES, file), 'utf8'));
}

const byName = (doc) => new Map((doc.resources ?? []).map((r) => [r.name, r]));

/** Every OMA-URI addressed by any bundled WS2022 profile. */
function ws2022CspPaths() {
  const wanted = new Map();
  for (const file of WS2022) {
    for (const rule of showAt(WS2022_SOURCE_REF, file).resources ?? []) {
      const inner = rule.properties?.resource;
      if (inner?.type !== CSP_TYPE) continue;
      const cspPath = String(inner.properties?.path ?? '');
      if (!wanted.has(cspPath)) wanted.set(cspPath, []);
      wanted.get(cspPath).push(`${file.replace('.osc.yaml', '')}:${rule.name}`);
    }
  }
  return wanted;
}

function deriveCspProviderMap() {
  const wanted = ws2022CspPaths();
  const found = new Map();

  for (const [file, tag] of WS2025) {
    const before = byName(showAt(`${CSP_COMMIT}^`, file));
    const after = byName(loadLocal(file));
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
      derivedFrom: {
        before: `${CSP_COMMIT}^ (public/_baselines/ws2025-*.osc.yaml)`,
        after: 'HEAD (public/_baselines/ws2025-*.osc.yaml)',
      },
      regenerate: 'node scripts/ws2022-baseline-repair/derive-maps.mjs',
    },
    entries,
  };
}

function deriveSchemaExpressionMap() {
  const table = new Map();
  for (const [file] of WS2025) {
    const before = byName(showAt(`${SCHEMA_COMMIT}^`, file));
    const after = byName(loadLocal(file));
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
      if (existing.evidence.length < 3) existing.evidence.push(name);
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
      derivedFrom: {
        before: `${SCHEMA_COMMIT}^ (public/_baselines/ws2025-*.osc.yaml)`,
        after: 'HEAD (public/_baselines/ws2025-*.osc.yaml)',
      },
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

const check = process.argv.includes('--check');
let drift = 0;
for (const [file, build] of targets) {
  const next = `${JSON.stringify(build(), null, 2)}\n`;
  const dest = path.join(HERE, file);
  if (check) {
    const current = readFileSync(dest, 'utf8');
    if (current !== next) {
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
