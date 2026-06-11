// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Windows XCCDF audit using the existing Windows fuzzy matcher.
// Verifies no regression after Linux changes by exercising the
// non-Linux code path in cis-bulk-lookup.ts.
//
// Usage:
//   node scripts/audit-windows-xccdf.mjs <manifest-namespace>

import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ns = process.argv[2];
if (!ns) {
  console.error('usage: node scripts/audit-windows-xccdf.mjs <namespace>');
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
const {
  parseXccdfCatalog,
  fuzzyMatchXccdfTitle,
  canonicalRegistryPath,
  lookupNonRegistryInXccdf,
  stripCspCategoryPrefix,
  extractCspPathWords,
} = await import(
  pathToFileURL(join(corePath, 'cis', 'xccdf-parser.js')).href
);

const dataDir = 'C:/Users/amirbredy/AppData/Local/Programs/configforge/resources/public-assets/_baselines/cis/_data';
const files = await readdir(dataDir);
const xccdfFile = files.find((f) => /xccdf/i.test(f) && /windows/i.test(f));
if (!xccdfFile) {
  console.error('No Windows XCCDF file found');
  process.exit(1);
}
console.log(`Catalog: ${xccdfFile}\n`);

const ovalFile = files.find((f) => /oval/i.test(f) && /windows/i.test(f));
const catalog = await parseXccdfCatalog(
  join(dataDir, xccdfFile),
  ovalFile ? join(dataDir, ovalFile) : null,
);
if (!catalog) {
  console.error('Failed to parse XCCDF');
  process.exit(1);
}
console.log(`Catalog rules: ${catalog.rules.length} (${catalog.platform})\n`);

// Build registry-key -> ruleId inversion (mirrors cis-bulk-lookup.ts)
const xccdfRuleIdByRegistryPath = new Map();
for (const [canon, indices] of catalog.registryIndex.entries()) {
  for (const idx of indices) {
    const rule = catalog.rules[idx];
    if (rule) xccdfRuleIdByRegistryPath.set(canon, rule.ruleId);
  }
}

let matched = 0;
const matches = [];
const misses = [];

for (const r of resources) {
  if (!r?.name) continue;
  const inner = r.properties?.resource;
  const innerType = inner?.type ?? '';
  const innerProps = inner?.properties ?? {};
  const registryKeyPath = innerProps.keyPath ?? r.properties?.keyPath ?? null;
  const registryValueName = innerProps.valueName ?? r.properties?.valueName ?? null;
  const cspPath = innerProps.path ?? null;
  const propertyName = innerProps.name ?? r.properties?.name ?? null;
  const propertySubcategory = innerProps.subcategory ?? r.properties?.subcategory ?? null;

  let xccdfHit = null;

  // (i) registry exact match
  if (registryKeyPath) {
    const firstSlash = registryKeyPath.indexOf('\\');
    if (firstSlash > 0) {
      const hive = registryKeyPath.substring(0, firstSlash);
      const key = registryKeyPath.substring(firstSlash + 1);
      const canon = canonicalRegistryPath(hive, key, registryValueName ?? '').canonical;
      const ruleId = xccdfRuleIdByRegistryPath.get(canon);
      if (ruleId) xccdfHit = catalog.rules.find((r) => r.ruleId === ruleId) ?? null;
    }
  }
  // (ii) non-registry indices
  if (!xccdfHit) {
    xccdfHit = lookupNonRegistryInXccdf(
      catalog,
      innerType,
      r.name,
      propertyName ?? undefined,
      propertySubcategory ?? undefined,
      cspPath ?? undefined,
    );
  }
  // (iii) fuzzy title
  if (!xccdfHit) {
    const isCsp = innerType.endsWith('/CSP');
    const cspWords = isCsp && cspPath ? extractCspPathWords(cspPath) : [];
    const fuzzyName = isCsp ? stripCspCategoryPrefix(r.name, cspPath) : r.name;
    xccdfHit = fuzzyMatchXccdfTitle(catalog, fuzzyName, 0.8, cspWords);
  }

  if (xccdfHit) {
    matched++;
    matches.push({ name: r.name, ruleId: xccdfHit.ruleId, title: xccdfHit.title });
  } else {
    misses.push({ name: r.name });
  }
}

const total = matches.length + misses.length;
const uniqueRules = new Set(matches.map((m) => m.ruleId));
const coveragePct = (uniqueRules.size / catalog.rules.length) * 100;
const resourceHitPct = (matched / total) * 100;
console.log(`Resources with a CIS hit:  ${matched} / ${total} (${resourceHitPct.toFixed(2)}%)`);
console.log(`UNIQUE catalog rules hit:  ${uniqueRules.size} / ${catalog.rules.length} (${coveragePct.toFixed(2)}%)\n`);
console.log(`First 5 matches:`);
for (const m of matches.slice(0, 5)) console.log(`  ${m.name} → ${m.title}`);
console.log(`\nFirst 5 misses:`);
for (const m of misses.slice(0, 5)) console.log(`  ${m.name}`);
