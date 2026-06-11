// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const localesRoot = path.join(repoRoot, 'apps', 'desktop', 'src', 'locales');
const sourceLocale = 'en';
const targetLocales = ['fr', 'de', 'es'];
const placeholderToken = /\{\{\s*[^}]+\s*\}\}/g;
const defaultGlossaryPath = path.join(__dirname, 'locales-glossary.json');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      args[body] = true;
    } else {
      args[body.slice(0, eq)] = body.slice(eq + 1);
    }
  }
  return args;
}

async function readJson(file, fallback = undefined) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function flatten(obj, prefix = '') {
  const rows = [];
  for (const [key, value] of Object.entries(obj ?? {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      rows.push(...flatten(value, next));
    } else {
      rows.push({ key: next, value: String(value ?? '') });
    }
  }
  return rows;
}

function getDeep(obj, dotted) {
  let cursor = obj;
  for (const part of dotted.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setDeep(obj, dotted, value) {
  const parts = dotted.split('.');
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function orderLikeSource(source, target) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = orderLikeSource(value, target?.[key] ?? {});
    } else if (target && Object.prototype.hasOwnProperty.call(target, key)) {
      out[key] = target[key];
    }
  }
  for (const [key, value] of Object.entries(target ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = value;
  }
  return out;
}

function extractPlaceholders(text) {
  const placeholders = [];
  const masked = text.replace(placeholderToken, (match) => {
    const token = `__CFS_PH_${placeholders.length}__`;
    placeholders.push({ token, value: match });
    return token;
  });
  return { masked, placeholders };
}

function restorePlaceholders(text, placeholders) {
  let restored = text;
  for (const { token, value } of placeholders) restored = restored.replaceAll(token, value);
  return restored;
}

function protectGlossary(text, glossary) {
  const protectedTerms = [];
  let masked = text;
  const terms = [...glossary].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masked = masked.replace(new RegExp(escaped, 'gi'), (match) => {
      const token = `__CFS_GL_${protectedTerms.length}__`;
      protectedTerms.push({ token, value: match });
      return token;
    });
  }
  return { masked, protectedTerms };
}

function restoreGlossary(text, protectedTerms) {
  let restored = text;
  for (const { token, value } of protectedTerms) restored = restored.replaceAll(token, value);
  return restored;
}

async function loadGlossary(flagValue) {
  const glossaryPath = flagValue === true || !flagValue ? defaultGlossaryPath : path.resolve(repoRoot, String(flagValue));
  const data = await readJson(glossaryPath, []);
  if (!Array.isArray(data)) throw new Error(`Glossary must be a JSON array: ${glossaryPath}`);
  return data.map(String);
}

async function translateAzure(texts, locale) {
  const key = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION;
  if (!key || !region) {
    throw new Error('Azure provider requires AZURE_TRANSLATOR_KEY and AZURE_TRANSLATOR_REGION.');
  }
  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(locale)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
    },
    body: JSON.stringify(texts.map((Text) => ({ Text }))),
  });
  if (!response.ok) throw new Error(`Azure Translator failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  return payload.map((item) => item.translations?.[0]?.text ?? '');
}

async function translateDeepL(texts, locale) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('DeepL provider requires DEEPL_API_KEY.');
  const target = locale === 'en' ? 'EN-US' : locale.toUpperCase();
  const body = new URLSearchParams();
  for (const text of texts) body.append('text', text);
  body.set('target_lang', target);
  body.set('preserve_formatting', '1');
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const response = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}` },
    body,
  });
  if (!response.ok) throw new Error(`DeepL failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  return payload.translations.map((item) => item.text ?? '');
}

async function translateBatch(provider, texts, locale) {
  if (provider === 'passthrough') return texts.map((text) => `[TODO] ${text}`);
  if (provider === 'azure') return translateAzure(texts, locale);
  if (provider === 'deepl') return translateDeepL(texts, locale);
  throw new Error(`Provider ${provider} does not translate directly.`);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function exportManualCsv(namespaces, glossary, csvPath) {
  const lines = ['namespace,key,en,fr,de,es'];
  for (const ns of namespaces) {
    const source = await readJson(path.join(localesRoot, sourceLocale, `${ns}.json`), {});
    for (const row of flatten(source)) {
      const values = [ns, row.key, row.value];
      for (const locale of targetLocales) {
        const target = await readJson(path.join(localesRoot, locale, `${ns}.json`), {});
        values.push(getDeep(target, row.key) ?? '');
      }
      lines.push(values.map(csvEscape).join(','));
    }
  }
  await writeFile(csvPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote manual translation CSV: ${csvPath}`);
  void glossary;
}

async function importManualCsv(csvPath, dryRun) {
  const rows = parseCsv(await readFile(csvPath, 'utf8'));
  const header = rows.shift();
  if (!header || header.join(',') !== 'namespace,key,en,fr,de,es') {
    throw new Error('Manual import CSV header must be: namespace,key,en,fr,de,es');
  }
  let changes = 0;
  for (const locale of targetLocales) {
    const byNs = new Map();
    for (const row of rows) {
      const [ns, key, , fr, de, es] = row;
      const value = { fr, de, es }[locale];
      if (!value) continue;
      if (!byNs.has(ns)) byNs.set(ns, await readJson(path.join(localesRoot, locale, `${ns}.json`), {}));
      const target = byNs.get(ns);
      if (getDeep(target, key) === undefined) {
        setDeep(target, key, value);
        changes++;
      }
    }
    for (const [ns, target] of byNs) {
      const source = await readJson(path.join(localesRoot, sourceLocale, `${ns}.json`), {});
      if (!dryRun) await writeJson(path.join(localesRoot, locale, `${ns}.json`), orderLikeSource(source, target));
    }
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}Imported ${changes} manual translations.`);
}

async function discoverNamespaces() {
  return (await readdir(path.join(localesRoot, sourceLocale)))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

async function runTranslate(options = parseArgs()) {
  const provider = options.provider;
  if (!provider) throw new Error('Missing --provider flag. Use --provider=azure|deepl|passthrough|manual.');
  if (!['azure', 'deepl', 'passthrough', 'manual'].includes(provider)) throw new Error(`Unsupported --provider: ${provider}`);

  const dryRun = Boolean(options['dry-run']);
  const glossary = await loadGlossary(options.glossary);
  const namespaces = await discoverNamespaces();

  if (provider === 'manual') {
    const csvPath = path.resolve(repoRoot, String(options.csv ?? 'apps/desktop/src/locales/manual-translations.csv'));
    if (options.import) return importManualCsv(path.resolve(repoRoot, String(options.import)), dryRun);
    return exportManualCsv(namespaces, glossary, csvPath);
  }

  let totalMissing = 0;
  for (const ns of namespaces) {
    const sourcePath = path.join(localesRoot, sourceLocale, `${ns}.json`);
    const source = await readJson(sourcePath, {});
    const rows = flatten(source);
    for (const locale of targetLocales) {
      const targetPath = path.join(localesRoot, locale, `${ns}.json`);
      const target = await readJson(targetPath, {});
      const missing = rows.filter(({ key }) => getDeep(target, key) === undefined);
      if (!missing.length) {
        if (!dryRun) await writeJson(targetPath, orderLikeSource(source, target));
        continue;
      }
      totalMissing += missing.length;
      const prepared = missing.map(({ value }) => {
        const ph = extractPlaceholders(value);
        const gl = protectGlossary(ph.masked, glossary);
        return { ph, gl, text: gl.masked };
      });
      const translated = await translateBatch(provider, prepared.map((p) => p.text), locale);
      for (let i = 0; i < missing.length; i++) {
        let value = restoreGlossary(translated[i], prepared[i].gl.protectedTerms);
        value = restorePlaceholders(value, prepared[i].ph.placeholders);
        setDeep(target, missing[i].key, value);
      }
      const ordered = orderLikeSource(source, target);
      if (dryRun) {
        console.log(`[dry-run] ${locale}/${ns}.json: ${missing.length} missing keys would be translated.`);
      } else {
        await writeJson(targetPath, ordered);
      }
    }
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}${totalMissing} missing keys processed with provider=${provider}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTranslate().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export {
  extractPlaceholders,
  flatten,
  getDeep,
  orderLikeSource,
  protectGlossary,
  restoreGlossary,
  restorePlaceholders,
  runTranslate,
  setDeep,
};
