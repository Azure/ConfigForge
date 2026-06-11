// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// End-to-end Azure Policy fuzzy-matcher audit.
//
// Runs the same logic as cis-bulk-lookup.ts's Azure Policy branch against
// a real Azure Policy JSON catalog + a real Linux manifest, and reports
// coverage % + per-rule matches.
//
// Usage:
//   node scripts/audit-azure-policy.mjs <manifest-namespace>
// Example:
//   node scripts/audit-azure-policy.mjs Azure-Local-SFF---Linux-Security-Baseline

import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ns = process.argv[2];
if (!ns) {
  console.error('usage: node scripts/audit-azure-policy.mjs <namespace>');
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
const { splitPascalCase, stripCspCategoryPrefix, extractCspPathWords } = await import(
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

// Replay the cis-bulk-lookup.ts Azure Policy branch matcher per-resource.
let matched = 0;
const matches = [];
const misses = [];

function walkResources(list) {
  for (const r of list) {
    if (Array.isArray(r?.resources)) walkResources(r.resources);
    if (!r?.name || !r?.type) continue;
    const innerType = r.type;
    const isCsp = innerType.endsWith('/CSP');
    const cspPath = r.properties?.cspPath ?? null;
    const baseName = isCsp ? stripCspCategoryPrefix(r.name, cspPath) : r.name;
    const nameWords = splitPascalCase(baseName);
    const cspWords = isCsp && cspPath ? extractCspPathWords(cspPath) : [];
    const wordSet = new Set([...nameWords, ...cspWords]);
    const words = Array.from(wordSet);
    if (words.length === 0) {
      misses.push({ name: r.name, reason: 'no-words' });
      continue;
    }
    let bestRatio = 0;
    let best = null;
    for (const rule of catalog.rules) {
      const titleWordSet = new Set(splitPascalCase(rule.title));
      const matchedWords = words.filter((w) => titleWordSet.has(w));
      const ratio = matchedWords.length / words.length;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = rule;
      }
    }
    if (bestRatio >= 0.8 && best) {
      matched++;
      matches.push({ name: r.name, ruleId: best.ruleId, title: best.title, ratio: bestRatio });
    } else {
      misses.push({ name: r.name, bestRatio, nearTitle: best?.title ?? null });
    }
  }
}

walkResources(resources);

const totalResources = matches.length + misses.length;
const uniqueCatalogRules = new Set(matches.map((m) => m.ruleId));
const coveragePct = (uniqueCatalogRules.size / catalog.rules.length) * 100;
const resourceHitPct = (matched / totalResources) * 100;
console.log(`Resources with a CIS hit:  ${matched} / ${totalResources} (${resourceHitPct.toFixed(2)}%)`);
console.log(`UNIQUE catalog rules hit:  ${uniqueCatalogRules.size} / ${catalog.rules.length} (${coveragePct.toFixed(2)}%)   ← what the Diff tab shows\n`);
console.log('--- Top 10 matches by ratio ---');
matches.sort((a, b) => b.ratio - a.ratio);
for (const m of matches.slice(0, 10)) {
  console.log(`  ${m.ratio.toFixed(2)}  ${m.name.padEnd(40)} → ${m.title}`);
}
console.log('\n--- Bottom 10 matches by ratio (closest to threshold) ---');
const lowMatches = matches.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 10);
for (const m of lowMatches) {
  console.log(`  ${m.ratio.toFixed(2)}  ${m.name.padEnd(40)} → ${m.title}`);
}
console.log('\n--- Sample 10 misses (closest to threshold) ---');
const closeMisses = misses
  .filter((m) => typeof m.bestRatio === 'number')
  .sort((a, b) => b.bestRatio - a.bestRatio)
  .slice(0, 10);
for (const m of closeMisses) {
  console.log(`  ${m.bestRatio.toFixed(2)}  ${m.name.padEnd(40)} → (best near: ${m.nearTitle})`);
}
