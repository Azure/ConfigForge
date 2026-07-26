// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SYNTHETIC_BENCHMARK_NAME = 'Industry Benchmark — Windows Server 2025';
export const SYNTHETIC_BENCHMARK_FILENAME = 'industry-benchmark-windows-server-2025.json';

const FIXTURE_BASELINES = [
  {
    filename: 'ws2025-member-server.osc.yaml',
    namespace: 'Windows-Server-2025---Member-Server',
    displayName: 'Windows Server 2025 - Member Server',
    sourceId: 'ws2025-member-server',
    benchmarkSource: true,
  },
  {
    filename: 'ws2019-domain-member.osc.yaml',
    namespace: 'Windows-Server-2019---Member-Server',
    displayName: 'Windows Server 2019 - Member Server',
    sourceId: 'ws2019-domain-member',
    benchmarkSource: false,
  },
];

function parseYamlScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

export function extractTopLevelResources(source) {
  const resources = [];
  let current = null;

  for (const line of source.split(/\r?\n/)) {
    const nameMatch = /^ {2}- name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch) {
      current = { name: parseYamlScalar(nameMatch[1]), type: '' };
      resources.push(current);
      continue;
    }

    const typeMatch = /^ {4}type:\s*(.+?)\s*$/.exec(line);
    if (current && typeMatch && !current.type) {
      current.type = parseYamlScalar(typeMatch[1]);
    }
  }

  if (resources.length === 0 || resources.some((resource) => !resource.name || !resource.type)) {
    throw new Error('Screenshot fixture baseline has incomplete top-level resources');
  }

  return resources;
}

export function humanizeResourceName(name) {
  return name
    .replace(/[_./-]+/g, ' ')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSyntheticBenchmarkCatalog(resources, appVersion) {
  const settings = resources.map((resource, index) => {
    const section = `1.${index + 1}`;
    return {
      ruleId: `industry-benchmark-ws2025-${String(index + 1).padStart(4, '0')}`,
      name: `${section} Synthetic check — ${humanizeResourceName(resource.name)};DesiredObjectValue`,
      value: 'Synthetic screenshot fixture',
    };
  });

  return {
    standard: 'Industry Benchmark',
    baselineSettings: [
      {
        name: SYNTHETIC_BENCHMARK_NAME,
        version: `${appVersion} synthetic fixture`,
        settings,
      },
    ],
  };
}

export function containsProhibitedBenchmarkTerms(value) {
  return /\b(?:CIS|XCCDF|OVAL)\b/i.test(value);
}

function pathIsInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function registrationFor(baseline, resources, timestamp, appVersion) {
  return {
    namespace: baseline.namespace,
    displayName: baseline.displayName,
    platform: 'windows',
    registeredAt: timestamp,
    modifiedAt: timestamp,
    revision: `screenshot-fixture-${appVersion}-${baseline.sourceId}`,
    source: 'library',
    sourceId: baseline.sourceId,
    resourceSummary: resources,
    validationSummary: {
      hasSchema: true,
      hasEnforcementValues: true,
      hasComplianceCriteria: true,
      issues: [],
    },
  };
}

export async function createScreenshotFixtures({
  repoRoot,
  appVersion,
  timestamp = new Date().toISOString(),
}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'configforge-screenshot-fixtures-'));

  try {
    if (pathIsInside(repoRoot, tempRoot)) {
      throw new Error('Refusing to create screenshot fixtures inside the repository');
    }

    const publicRoot = path.join(tempRoot, 'public');
    const publicBaselinesDir = path.join(publicRoot, '_baselines');
    const cisDataDir = path.join(publicBaselinesDir, 'cis', '_data');
    const fixtureHome = path.join(tempRoot, 'home');
    const configForgeHome = path.join(fixtureHome, '.configforge');
    const manifestsDir = path.join(configForgeHome, 'manifests');
    const electronUserDataDir = path.join(tempRoot, 'electron-user-data');
    const runtimeTempDir = path.join(tempRoot, 'runtime-temp');
    const xdgConfigHome = path.join(fixtureHome, '.config');
    const appDataDir = path.join(fixtureHome, 'AppData', 'Roaming');
    const localAppDataDir = path.join(fixtureHome, 'AppData', 'Local');

    await Promise.all([
      mkdir(publicBaselinesDir, { recursive: true }),
      mkdir(cisDataDir, { recursive: true }),
      mkdir(manifestsDir, { recursive: true }),
      mkdir(electronUserDataDir, { recursive: true }),
      mkdir(runtimeTempDir, { recursive: true }),
      mkdir(xdgConfigHome, { recursive: true }),
      mkdir(appDataDir, { recursive: true }),
      mkdir(localAppDataDir, { recursive: true }),
    ]);

    let benchmarkResources = null;
    for (const baseline of FIXTURE_BASELINES) {
      const sourcePath = path.join(repoRoot, 'public', '_baselines', baseline.filename);
      const fixturePath = path.join(publicBaselinesDir, baseline.filename);
      const source = await readFile(sourcePath, 'utf-8');
      const resources = extractTopLevelResources(source);

      await copyFile(sourcePath, fixturePath);
      await writeFile(
        path.join(manifestsDir, `${baseline.namespace}.source.yaml`),
        source,
        'utf-8',
      );
      await writeFile(
        path.join(manifestsDir, `${baseline.namespace}.json`),
        `${JSON.stringify(
          registrationFor(baseline, resources, timestamp, appVersion),
          null,
          2,
        )}\n`,
        'utf-8',
      );

      if (baseline.benchmarkSource) {
        benchmarkResources = resources;
      }
    }

    if (!benchmarkResources) {
      throw new Error('WS2025 screenshot fixture baseline was not loaded');
    }

    const catalog = buildSyntheticBenchmarkCatalog(benchmarkResources, appVersion);
    const serializedCatalog = `${JSON.stringify(catalog, null, 2)}\n`;
    if (containsProhibitedBenchmarkTerms(serializedCatalog)) {
      throw new Error('Synthetic screenshot catalog contains a prohibited benchmark term');
    }
    await writeFile(
      path.join(cisDataDir, SYNTHETIC_BENCHMARK_FILENAME),
      serializedCatalog,
      'utf-8',
    );

    return {
      appVersion,
      tempRoot,
      publicRoot,
      fixtureHome,
      configForgeHome,
      manifestsDir,
      electronUserDataDir,
      runtimeTempDir,
      xdgConfigHome,
      appDataDir,
      localAppDataDir,
      benchmarkName: SYNTHETIC_BENCHMARK_NAME,
      benchmarkFilename: SYNTHETIC_BENCHMARK_FILENAME,
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupScreenshotFixtures(fixtures) {
  if (!fixtures?.tempRoot) return;
  await rm(fixtures.tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
