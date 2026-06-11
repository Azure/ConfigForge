// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// End-to-end Linux fuzzy-matcher audit using the new linuxFuzzyMatch.
//
// Mirrors cis-bulk-lookup.ts's Linux branch: builds LinuxResourceTokens
// per manifest resource (walking nested children) and calls
// linuxFuzzyMatch against the Linux Azure Policy CIS catalog.
//
// Usage:
//   node scripts/audit-linux-fuzzy.mjs <manifest-namespace>
// Example:
//   node scripts/audit-linux-fuzzy.mjs Azure-Local-SFF---Linux-Security-Baseline

import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ns = process.argv[2];
if (!ns) {
  console.error('usage: node scripts/audit-linux-fuzzy.mjs <namespace>');
  process.exit(1);
}

const yamlPath = join(homedir(), '.configforge', 'manifests', `${ns}.source.yaml`);
const yamlText = await readFile(yamlPath, 'utf8');
const jsYaml = await import('js-yaml');
const manifest = jsYaml.load(yamlText);
const resources = manifest?.resources ?? [];
console.log(`Manifest: ${ns}`);
console.log(`Resources: ${resources.length}`);

const corePath = join(process.cwd(), 'packages', 'core', 'dist');
const { linuxFuzzyMatch, linuxFuzzyTokenize } = await import(
  pathToFileURL(join(corePath, 'cis', 'xccdf-parser.js')).href
);
const { parseAzurePolicyCisJson } = await import(
  pathToFileURL(join(corePath, 'cis', 'azure-policy-cis.js')).href
);

const dataDir = 'C:/Users/amirbredy/AppData/Local/Programs/configforge/resources/public-assets/_baselines/cis/_data';
const files = await readdir(dataDir);
const jsonFile = files.find((f) => f.toLowerCase().endsWith('.json') && /linux/i.test(f));
if (!jsonFile) {
  console.error('No Linux Azure Policy JSON found in data dir');
  process.exit(1);
}
console.log(`Catalog: ${jsonFile}\n`);

const jsonText = await readFile(join(dataDir, jsonFile), 'utf8');
const parsedJson = JSON.parse(jsonText);
const catalog = parseAzurePolicyCisJson(parsedJson, jsonFile);
if (!catalog) {
  console.error('Failed to parse Azure Policy JSON');
  process.exit(1);
}
console.log(`Catalog rules: ${catalog.rules.length} (${catalog.platform})\n`);

// Mirror of buildLinuxResourceTokens from cis-bulk-lookup.ts
function buildLinuxResourceTokens(r) {
  const high = [];
  const med = [];
  const low = [];
  const paths = new Set();
  let polaritySource = r.name ?? '';

  if (r.name) {
    for (const w of linuxFuzzyTokenize(r.name)) med.push(w);
  }

  function walk(node, depth) {
    if (depth > 4) return;
    const inner = node.properties?.resource;
    const innerType = inner?.type ?? '';
    const innerProps = inner?.properties ?? {};
    const directProps = node.properties ?? {};

    const isHighSignalType =
      innerType === 'Linux/KernelModule' ||
      innerType === 'Linux/User' ||
      node.type === 'Linux/KernelModule' ||
      node.type === 'Linux/User';

    const propName = innerProps.name ?? directProps.name;
    if (propName && typeof propName === 'string') {
      const tokens = linuxFuzzyTokenize(propName);
      if (isHighSignalType) {
        for (const w of tokens) high.push(w);
      } else {
        for (const w of tokens) med.push(w);
      }
      polaritySource += ' ' + propName;
    }

    const rawPath = innerProps.path ?? directProps.path;
    if (rawPath && typeof rawPath === 'string') {
      const normPath = rawPath.toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '');
      paths.add(normPath);
      const segs = normPath.split('/').filter(Boolean);
      for (const s of segs.slice(0, -1)) {
        for (const w of linuxFuzzyTokenize(s)) low.push(w);
      }
      const basename = segs[segs.length - 1];
      if (basename) for (const w of linuxFuzzyTokenize(basename)) high.push(w);
    }

    if (Array.isArray(node.properties?.resources)) {
      for (const child of node.properties.resources) {
        walk(child, depth + 1);
      }
    }
  }
  walk(r, 0);

  return { high, med, low, paths, polaritySource };
}

let matched = 0;
const matches = [];
const misses = [];

for (const r of resources) {
  if (!r?.name) continue;
  const tokens = buildLinuxResourceTokens(r);
  const result = linuxFuzzyMatch(catalog.rules, tokens);
  if (result?.rule) {
    matched++;
    matches.push({
      name: r.name,
      ruleId: result.rule.ruleId,
      title: result.rule.title,
      score: result.score,
      margin: result.margin,
    });
  } else {
    // Find what was close
    let bestScore = 0;
    let bestTitle = null;
    for (const rule of catalog.rules) {
      // Approximate "near" by re-running with very low threshold isn't possible
      // without exposing internals; just leave it blank.
      void rule;
    }
    misses.push({ name: r.name, bestScore, nearTitle: bestTitle });
  }
}

const total = matches.length + misses.length;
const uniqueCatalogRules = new Set(matches.map((m) => m.ruleId));
const coveragePct = (uniqueCatalogRules.size / catalog.rules.length) * 100;
const resourceHitPct = (matched / total) * 100;
console.log(`Resources with a CIS hit:  ${matched} / ${total} (${resourceHitPct.toFixed(2)}%)`);
console.log(`UNIQUE catalog rules hit:  ${uniqueCatalogRules.size} / ${catalog.rules.length} (${coveragePct.toFixed(2)}%)   ← what the Diff tab shows\n`);

console.log('--- Top 20 matches by score ---');
matches.sort((a, b) => b.score - a.score);
for (const m of matches.slice(0, 20)) {
  console.log(`  ${m.score.toFixed(2)} m=${m.margin.toFixed(2)}  ${m.name.padEnd(50)} → ${m.title}`);
}

console.log('\n--- Bottom 10 matches by score ---');
const lowMatches = matches.slice().sort((a, b) => a.score - b.score).slice(0, 10);
for (const m of lowMatches) {
  console.log(`  ${m.score.toFixed(2)} m=${m.margin.toFixed(2)}  ${m.name.padEnd(50)} → ${m.title}`);
}

console.log('\n--- 20 sample misses ---');
for (const m of misses.slice(0, 20)) {
  console.log(`  ${m.name}`);
}
