// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Audit which CIS rules are matched against a manifest's source YAML and by
// which stage (registry-exact, non-registry-index, xccdf-fuzzy). Dumps the
// fuzzy-only matches sorted by ratio so the user can sanity-check borderline
// matches after tweaking the matcher threshold or token logic.
//
// Usage:
//   node scripts/audit-cis-matches.mjs <namespace>
// Example:
//   node scripts/audit-cis-matches.mjs Windows-Server-2025---Member-Server

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ns = process.argv[2];
if (!ns) {
  console.error('usage: node scripts/audit-cis-matches.mjs <namespace>');
  process.exit(1);
}

const yamlPath = join(homedir(), '.configforge', 'manifests', `${ns}.source.yaml`);
console.log(`Loading manifest: ${yamlPath}`);

const yamlText = await readFile(yamlPath, 'utf8');
const jsYaml = await import('js-yaml');
const manifest = jsYaml.load(yamlText);
const resources = manifest?.resources ?? [];
console.log(`Resources in manifest: ${resources.length}`);

const corePath = join(process.cwd(), 'packages', 'core', 'dist');
const xccdfModule = await import(pathToFileURL(join(corePath, 'cis', 'xccdf-parser.js')).href);
const dataModule = await import(pathToFileURL(join(corePath, 'cis', 'data.js')).href);

const {
  getOrParseXccdfCatalog,
  discoverXccdfFiles,
  canonicalRegistryPath,
  lookupNonRegistryInXccdf,
  fuzzyMatchXccdfTitle,
  bestFuzzyMatchXccdfTitle,
  extractCspPathWords,
  splitPascalCase,
  stripCspCategoryPrefix,
} = xccdfModule;

const dataDir = dataModule.getCisDataDir();
const discovered = await discoverXccdfFiles(dataDir);
const valid = discovered.filter((d) => d.ovalPath !== null);
console.log(`Discovered XCCDF pairs: ${valid.map((d) => d.filename).join(', ')}`);
// Auto-pick: prefer Azure Compute if present (matches what the installed app does).
const chosen = valid.find((d) => /Azure_Compute/i.test(d.filename)) ?? valid[0];
if (!chosen) {
  console.error('No XCCDF+OVAL pairs discovered. Drop benchmark files into', dataDir);
  process.exit(1);
}
console.log(`Using benchmark: ${chosen.filename}`);
const catalog = await getOrParseXccdfCatalog(chosen.xccdfPath, chosen.ovalPath);
console.log(`Benchmark rules: ${catalog.rules.length}`);

const stats = {
  total: catalog.rules.length,
  registryExact: new Set(),
  nonRegistryIndex: new Set(),
  xccdfFuzzy: new Set(),
};
const fuzzyMatches = [];

for (const r of resources) {
  const type = String(r.type ?? '');
  const name = String(r.name ?? '');
  const inner = r.properties?.resource ?? {};
  const innerProps = inner.properties ?? {};
  const innerType = String(inner.type ?? '');
  const keyPath = innerProps.keyPath ?? r.properties?.keyPath ?? null;
  const valueName = innerProps.valueName ?? r.properties?.valueName ?? null;
  const cspPath = innerProps.path ?? null;
  const propertyName = innerProps.name ?? r.properties?.name ?? null;
  const propertySubcategory = innerProps.subcategory ?? r.properties?.subcategory ?? null;

  // Stage 1: registry exact (match production logic)
  if (keyPath && valueName) {
    const firstSlash = keyPath.indexOf('\\');
    if (firstSlash > 0) {
      const hive = keyPath.substring(0, firstSlash);
      const key = keyPath.substring(firstSlash + 1);
      const canon = canonicalRegistryPath(hive, key, valueName).canonical;
      const indices = catalog.registryIndex?.get(canon);
      if (indices && indices.length > 0) {
        const rule = catalog.rules[indices[0]];
        stats.registryExact.add(rule.ruleId);
        continue;
      }
    }
  }

  // Stage 2: non-registry indices (UserRights, AuditPolicy, AccountPolicy)
  const nonReg = lookupNonRegistryInXccdf(
    catalog,
    innerType,
    name,
    propertyName ?? undefined,
    propertySubcategory ?? undefined,
    cspPath ?? undefined,
  );
  if (nonReg) {
    stats.nonRegistryIndex.add(nonReg.ruleId);
    continue;
  }

  // Stage 3: xccdf fuzzy
  const isCsp = innerType.endsWith('/CSP');
  const cspWords = isCsp && cspPath ? extractCspPathWords(cspPath) : [];
  const fuzzyName = isCsp && cspPath ? stripCspCategoryPrefix(name, cspPath) : name;
  const hit = fuzzyMatchXccdfTitle(catalog, fuzzyName, 0.8, cspWords);
  if (hit) {
    stats.xccdfFuzzy.add(hit.ruleId);
    const best = bestFuzzyMatchXccdfTitle(catalog, fuzzyName, cspWords);
    fuzzyMatches.push({
      resource: name,
      type: innerType,
      cspPath: cspPath ?? '',
      ruleId: hit.ruleId,
      title: hit.title,
      ratio: best?.ratio ?? 0,
      words: best?.words ?? [],
    });
  }
}

const matched = new Set([
  ...stats.registryExact,
  ...stats.nonRegistryIndex,
  ...stats.xccdfFuzzy,
]);
console.log(`\n=== Coverage ===`);
console.log(`Total benchmark rules: ${stats.total}`);
console.log(`Unique rules matched:  ${matched.size}`);
console.log(`Coverage:              ${((matched.size / stats.total) * 100).toFixed(2)}%`);
console.log(`\n=== Breakdown (unique rule IDs per stage) ===`);
console.log(`  registry-exact:      ${stats.registryExact.size}`);
console.log(`  non-registry-index:  ${stats.nonRegistryIndex.size}`);
console.log(`  xccdf-fuzzy:         ${stats.xccdfFuzzy.size}`);

console.log(`\n=== Fuzzy-only matches (sorted by ratio ASC) ===`);
fuzzyMatches.sort((a, b) => a.ratio - b.ratio);
for (const m of fuzzyMatches) {
  console.log(`ratio=${m.ratio.toFixed(2)}  ${m.resource}  →  ${m.ruleId}: ${m.title}`);
  console.log(`    words=[${m.words.join(',')}]`);
  if (m.cspPath) console.log(`    cspPath=${m.cspPath}`);
}
