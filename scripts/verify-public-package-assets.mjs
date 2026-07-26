// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), '..');
const allowedCisFiles = new Set(['readme.md', '.gitkeep']);
const publicNpmRegistryOrigin = 'https://registry.npmjs.org';

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\/+/, '');
}

function hasToken(value, expected) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .includes(expected);
}

export function isForbiddenPublicAsset(relativePath) {
  const normalized = toPosix(relativePath).toLowerCase();
  if (normalized === '_baselines/cis') return true;
  if (normalized.startsWith('_baselines/cis/')) {
    const remaining = normalized.slice('_baselines/cis/'.length);
    return !allowedCisFiles.has(remaining);
  }

  const extension = path.posix.extname(normalized);
  const filename = path.posix.basename(normalized, extension);
  if (extension === '.xml') {
    return ['cis', 'xccdf', 'oval'].some((token) => hasToken(filename, token));
  }
  if (extension === '.json') {
    const isCisData =
      hasToken(filename, 'cis') &&
      ['benchmark', 'catalog', 'mapping', 'mappings', 'policy', 'rule', 'rules'].some((token) =>
        hasToken(filename, token),
      );
    return isCisData || hasToken(filename, 'xccdf') || hasToken(filename, 'oval');
  }
  return false;
}

export function findUnsafeBuilderConfigLines(contents) {
  return contents
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return false;
      const normalized = trimmed.replaceAll('\\', '/').toLowerCase();
      if (!normalized.includes('_baselines/cis/')) return false;
      return !/^-+\s*['"]?!_baselines\/cis\//.test(normalized);
    });
}

export function isAllowedLockfileResolution(resolved) {
  if (typeof resolved !== 'string' || !/^https?:/i.test(resolved)) return true;

  try {
    const url = new URL(resolved);
    return (
      url.origin.toLowerCase() === publicNpmRegistryOrigin &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

async function collectFiles(root, relative = '') {
  const current = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(root, child);
      if (nested) files.push(...nested);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(child);
    }
  }
  return files;
}

async function inspectPackageLock(repoRoot) {
  const lockfilePath = path.join(repoRoot, 'package-lock.json');
  let lockfile;
  try {
    lockfile = JSON.parse(await readFile(lockfilePath, 'utf8'));
  } catch (error) {
    return [
      {
        type: error?.code === 'ENOENT' ? 'missing' : 'lockfile',
        path: 'package-lock.json',
        detail:
          error?.code === 'ENOENT'
            ? 'Package lockfile does not exist.'
            : 'Package lockfile could not be parsed.',
      },
    ];
  }

  if (
    lockfile === null ||
    typeof lockfile !== 'object' ||
    lockfile.packages === null ||
    typeof lockfile.packages !== 'object' ||
    Array.isArray(lockfile.packages)
  ) {
    return [
      {
        type: 'lockfile',
        path: 'package-lock.json',
        detail: 'Package lockfile does not contain package metadata.',
      },
    ];
  }

  const violationCount = Object.values(lockfile.packages).filter(
    (metadata) =>
      metadata !== null &&
      typeof metadata === 'object' &&
      !isAllowedLockfileResolution(metadata.resolved),
  ).length;

  if (violationCount === 0) return [];
  return [
    {
      type: 'lockfile',
      path: 'package-lock.json',
      detail: `${violationCount} resolved package URL(s) do not use the required public npm registry.`,
    },
  ];
}

async function findBuilderConfigs(repoRoot) {
  const desktopRoot = path.join(repoRoot, 'apps', 'desktop');
  let entries;
  try {
    entries = await readdir(desktopRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && /^electron-builder(?:\.[^.]+)?\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(desktopRoot, entry.name));
}

export async function inspectPublicPackaging({ repoRoot = defaultRepoRoot } = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const publicRoot = path.join(resolvedRoot, 'public');
  const issues = await inspectPackageLock(resolvedRoot);
  const publicFiles = await collectFiles(publicRoot);

  if (publicFiles === null) {
    issues.push({
      type: 'missing',
      path: 'public',
      detail: 'Public asset root does not exist.',
    });
  } else {
    for (const relativePath of publicFiles) {
      if (isForbiddenPublicAsset(relativePath)) {
        issues.push({
          type: 'asset',
          path: toPosix(path.join('public', relativePath)),
          detail: 'CIS benchmark content must not enter packaged public assets.',
        });
      }
    }
  }

  const configs = await findBuilderConfigs(resolvedRoot);
  if (configs === null || configs.length === 0) {
    issues.push({
      type: 'missing',
      path: 'apps/desktop/electron-builder*.yml',
      detail: 'No electron-builder configuration was found.',
    });
  } else {
    for (const configPath of configs) {
      const contents = await readFile(configPath, 'utf8');
      for (const match of findUnsafeBuilderConfigLines(contents)) {
        issues.push({
          type: 'config',
          path: toPosix(path.relative(resolvedRoot, configPath)),
          lineNumber: match.lineNumber,
          detail: match.line.trim(),
        });
      }
    }
  }

  return issues;
}

function parseArgs(args) {
  let repoRoot = defaultRepoRoot;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--root') {
      if (!args[index + 1]) throw new Error('--root requires a path.');
      repoRoot = args[index + 1];
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      return { help: true, repoRoot };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { help: false, repoRoot };
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  const invoked = path.normalize(path.resolve(process.argv[1])).toLowerCase();
  return invoked === path.normalize(scriptPath).toLowerCase();
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`verify-public-package-assets: ${error.message}`);
    console.error('Usage: node scripts/verify-public-package-assets.mjs [--root <repo>]');
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log('Usage: node scripts/verify-public-package-assets.mjs [--root <repo>]');
    return;
  }

  const issues = await inspectPublicPackaging({ repoRoot: options.repoRoot });
  if (issues.length === 0) {
    console.log('OK — public packaging and lockfile policies passed.');
    return;
  }

  console.error('ERROR: public packaging policy violations detected:');
  for (const issue of issues) {
    const location = issue.lineNumber ? `${issue.path}:${issue.lineNumber}` : issue.path;
    console.error(`- ${location}: ${issue.detail}`);
  }
  process.exitCode = 1;
}

if (isDirectInvocation()) {
  await main();
}
