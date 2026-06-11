// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flatten, getDeep } from './translate-locales.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const localesRoot = path.join(repoRoot, 'apps', 'desktop', 'src', 'locales');
const outputPath = path.join(localesRoot, 'REVIEW.md');
const sourceLocale = 'en';
const targetLocales = ['fr', 'de', 'es'];
const pluralSuffixes = ['_zero', '_one', '_two', '_few', '_many', '_other'];
const placeholderPattern = /\{\{\s*([^}]+?)\s*\}\}/g;
const defaultGlossaryPath = path.join(__dirname, 'locales-glossary.json');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split(/=(.*)/s, 2);
    args[key] = value ?? true;
  }
  return args;
}

async function readJson(file, fallback = undefined) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function discoverNamespaces(root = localesRoot) {
  return (await readdir(path.join(root, sourceLocale)))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

function placeholderNames(value) {
  const names = [];
  for (const match of String(value ?? '').matchAll(placeholderPattern)) names.push(match[1].trim());
  return names.sort();
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function pluralBase(key) {
  for (const suffix of pluralSuffixes) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return null;
}

async function loadCatalogs(root) {
  const namespaces = await discoverNamespaces(root);
  const catalogs = { [sourceLocale]: {} };
  for (const locale of [sourceLocale, ...targetLocales]) {
    catalogs[locale] = {};
    for (const ns of namespaces) {
      catalogs[locale][ns] = await readJson(path.join(root, locale, `${ns}.json`), {});
    }
  }
  return { namespaces, catalogs };
}

async function loadGlossary(flagValue) {
  const glossaryPath = flagValue === true || !flagValue ? defaultGlossaryPath : path.resolve(repoRoot, String(flagValue));
  const terms = await readJson(glossaryPath, []);
  return Array.isArray(terms) ? terms.map(String) : [];
}

function glossaryViolationsFor(enValue, targetValue, glossary) {
  const violations = [];
  for (const term of glossary) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const enHas = new RegExp(escaped, 'i').test(enValue);
    const targetHas = new RegExp(escaped, 'i').test(targetValue);
    if (enHas && !targetHas) violations.push(term);
  }
  return violations;
}

async function analyzeLocales({ root = localesRoot, glossaryPath } = {}) {
  const glossary = await loadGlossary(glossaryPath);
  const { namespaces, catalogs } = await loadCatalogs(root);
  const coverage = [];
  const placeholderIssues = [];
  const lengthWarnings = [];
  const glossaryViolations = [];
  const pluralIssues = [];
  const longest = Object.fromEntries(targetLocales.map((locale) => [locale, []]));

  for (const locale of targetLocales) {
    let total = 0;
    let translated = 0;
    let fallback = 0;
    for (const ns of namespaces) {
      const enRows = flatten(catalogs.en[ns]);
      const target = catalogs[locale][ns] ?? {};
      const enPluralGroups = new Map();
      for (const { key } of enRows) {
        const base = pluralBase(key);
        if (base) {
          if (!enPluralGroups.has(base)) enPluralGroups.set(base, new Set());
          enPluralGroups.get(base).add(key.slice(base.length));
        }
      }
      for (const { key, value: enValue } of enRows) {
        total++;
        const targetValue = getDeep(target, key);
        if (targetValue === undefined || targetValue === enValue || String(targetValue).startsWith('[TODO]')) fallback++;
        else translated++;

        const enPlaceholders = placeholderNames(enValue);
        const targetPlaceholders = placeholderNames(targetValue ?? '');
        if (!arraysEqual(enPlaceholders, targetPlaceholders)) {
          placeholderIssues.push({ locale, namespace: ns, key, en: enPlaceholders, target: targetPlaceholders });
        }

        const targetText = String(targetValue ?? '');
        const ratio = enValue.length === 0 ? 0 : targetText.length / enValue.length;
        longest[locale].push({ namespace: ns, key, value: targetText, length: targetText.length, enLength: enValue.length, ratio });
        if (enValue.length > 20 && ratio > 1.5) {
          lengthWarnings.push({ locale, namespace: ns, key, length: targetText.length, enLength: enValue.length, ratio, value: targetText });
        }

        const violations = glossaryViolationsFor(enValue, targetText, glossary);
        for (const term of violations) glossaryViolations.push({ locale, namespace: ns, key, term });
      }
      for (const [base, suffixes] of enPluralGroups.entries()) {
        for (const suffix of suffixes) {
          const key = `${base}${suffix}`;
          if (getDeep(target, key) === undefined) pluralIssues.push({ locale, namespace: ns, key });
        }
      }
    }
    coverage.push({ locale, translated, fallback, total });
    longest[locale].sort((a, b) => b.length - a.length);
  }
  for (const locale of targetLocales) longest[locale] = longest[locale].slice(0, 20);
  lengthWarnings.sort((a, b) => b.ratio - a.ratio);
  return { coverage, placeholderIssues, lengthWarnings, glossaryViolations, pluralIssues, longest, glossary, namespaces };
}

function mdEscape(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function renderReport(analysis) {
  const lines = [];
  lines.push('# ConfigForge localization review');
  lines.push('');
  lines.push('## Suggested workflow for Amir');
  lines.push('');
  lines.push('1. Run `node scripts/review-locales.mjs --strict` after any translation edit.');
  lines.push('2. Review high-traffic surfaces first: sidebar, common buttons, settings, home, and manifest editor toolbar.');
  lines.push('3. Mark approved namespaces in your tracking system, not in catalog files; keep JSON values clean product text.');
  lines.push('4. File revisions against the namespace/key shown below, then rerun this report before v0.3.61 QA polish.');
  lines.push('');
  lines.push('## Coverage');
  lines.push('');
  lines.push('| Locale | Translated | Fallback/TODO | Total | Coverage |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of analysis.coverage) {
    const pct = row.total ? ((row.translated / row.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${row.locale} | ${row.translated} | ${row.fallback} | ${row.total} | ${pct}% |`);
  }
  lines.push('');
  lines.push('## Placeholder integrity check');
  lines.push('');
  if (!analysis.placeholderIssues.length) {
    lines.push('✅ Clean — all `{{placeholder}}` names and counts match English.');
  } else {
    lines.push('| Locale | Namespace | Key | English placeholders | Target placeholders |');
    lines.push('|---|---|---|---|---|');
    for (const issue of analysis.placeholderIssues) {
      lines.push(`| ${issue.locale} | ${issue.namespace} | ${issue.key} | ${issue.en.join(', ')} | ${issue.target.join(', ')} |`);
    }
  }
  lines.push('');
  lines.push('## Length analysis');
  lines.push('');
  lines.push(`Layout warnings (>150% of English): **${analysis.lengthWarnings.length}**`);
  lines.push('');
  for (const locale of targetLocales) {
    lines.push(`### ${locale}: 20 longest values`);
    lines.push('');
    lines.push('| Namespace | Key | Chars | EN chars | Ratio | Value |');
    lines.push('|---|---|---:|---:|---:|---|');
    for (const item of analysis.longest[locale]) {
      const flag = item.ratio > 1.5 ? ' ⚠️' : '';
      lines.push(`| ${item.namespace} | ${item.key} | ${item.length} | ${item.enLength} | ${(item.ratio * 100).toFixed(0)}%${flag} | ${mdEscape(item.value.slice(0, 180))} |`);
    }
    lines.push('');
  }
  lines.push('## Glossary violations');
  lines.push('');
  if (!analysis.glossaryViolations.length) {
    lines.push('✅ Clean — protected terms remain literal where they appear in English.');
  } else {
    lines.push('| Locale | Namespace | Key | Missing literal term |');
    lines.push('|---|---|---|---|');
    for (const issue of analysis.glossaryViolations) lines.push(`| ${issue.locale} | ${issue.namespace} | ${issue.key} | ${issue.term} |`);
  }
  lines.push('');
  lines.push('## Plural form check');
  lines.push('');
  if (!analysis.pluralIssues.length) {
    lines.push('✅ Clean — plural-suffixed keys present in all target catalogs.');
  } else {
    lines.push('| Locale | Namespace | Missing key |');
    lines.push('|---|---|---|');
    for (const issue of analysis.pluralIssues) lines.push(`| ${issue.locale} | ${issue.namespace} | ${issue.key} |`);
  }
  lines.push('');
  lines.push('## Glossary terms');
  lines.push('');
  lines.push(analysis.glossary.map((term) => `- ${term}`).join('\n'));
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function runReview(options = parseArgs()) {
  const analysis = await analyzeLocales({ glossaryPath: options.glossary });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderReport(analysis), 'utf8');
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
  console.log(
    `Placeholder issues: ${analysis.placeholderIssues.length}; length warnings: ${analysis.lengthWarnings.length}; glossary violations: ${analysis.glossaryViolations.length}; plural issues: ${analysis.pluralIssues.length}`,
  );
  if (options.strict && analysis.placeholderIssues.length) process.exitCode = 1;
  return analysis;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReview().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export { analyzeLocales, placeholderNames, renderReport, runReview };
