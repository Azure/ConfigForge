// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  findUnsafeBuilderConfigLines,
  inspectPublicPackaging,
  isAllowedLockfileResolution,
  isForbiddenPublicAsset,
} from './verify-public-package-assets.mjs';

const guardScript = fileURLToPath(new URL('./verify-public-package-assets.mjs', import.meta.url));

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'configforge-public-policy-'));
  await mkdir(path.join(root, 'apps', 'desktop'), { recursive: true });
  await mkdir(path.join(root, 'public', '_baselines', 'cis'), { recursive: true });
  await writeFile(
    path.join(root, 'apps', 'desktop', 'electron-builder.yml'),
    [
      'extraResources:',
      '  - from: ../../public',
      '    to: public-assets',
      '    filter:',
      "      - '_baselines/**/*.osc.yaml'",
      "      - '_baselines/**/*.csv'",
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(root, 'public', '_baselines', 'cis', 'README.md'),
    '# User-supplied CIS data is not bundled.\n',
    'utf8',
  );
  await writeFile(
    path.join(root, 'package-lock.json'),
    `${JSON.stringify(
      {
        name: 'configforge-public-policy-fixture',
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/example-package': {
            resolved:
              'https://registry.npmjs.org/example-package/-/example-package-1.0.0.tgz',
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return root;
}

test('allows documentation and non-CIS baseline assets', async () => {
  const root = await createFixture();
  try {
    await writeFile(
      path.join(root, 'public', '_baselines', 'sample.osc.yaml'),
      'resources: []\n',
      'utf8',
    );
    assert.deepEqual(await inspectPublicPackaging({ repoRoot: root }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects CIS XCCDF, OVAL, catalog, and derived baseline files', async () => {
  const root = await createFixture();
  try {
    const dataRoot = path.join(root, 'public', '_baselines', 'cis', '_data');
    await mkdir(dataRoot, { recursive: true });
    const filenames = [
      'CIS_Windows_Server_2025-xccdf.xml',
      'CIS_Windows_Server_2025-oval.xml',
      'cis-ws2025-rules.json',
      'cis-ws2025-ms.osc.yaml',
    ];
    for (const filename of filenames) {
      await writeFile(path.join(dataRoot, filename), 'fixture\n', 'utf8');
    }

    const issues = await inspectPublicPackaging({ repoRoot: root });
    assert.deepEqual(
      issues
        .filter((issue) => issue.type === 'asset')
        .map((issue) => path.basename(issue.path))
        .sort(),
      filenames.sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects CIS data patterns outside the conventional CIS directory', () => {
  assert.equal(isForbiddenPublicAsset('_baselines/cis'), true);
  assert.equal(isForbiddenPublicAsset('_baselines/imported/CIS_Benchmark-xccdf.xml'), true);
  assert.equal(isForbiddenPublicAsset('_baselines/imported/cis-rule-catalog.json'), true);
  assert.equal(isForbiddenPublicAsset('_baselines/imported/cis-ws2025-ms.osc.yaml'), true);
  assert.equal(isForbiddenPublicAsset('_baselines/imported/cis-ws2025-ms.csv'), true);
  assert.equal(isForbiddenPublicAsset('_baselines/imported/baseline.osc.yaml'), false);
});

test('rejects CIS-derived packaged baselines outside the conventional CIS directory', async () => {
  const root = await createFixture();
  try {
    const importedRoot = path.join(root, 'public', '_baselines', 'imported');
    await mkdir(importedRoot, { recursive: true });
    const filenames = ['cis-ws2025-ms.osc.yaml', 'cis-ws2025-ms.csv'];
    for (const filename of filenames) {
      await writeFile(path.join(importedRoot, filename), 'fixture\n', 'utf8');
    }

    const issues = await inspectPublicPackaging({ repoRoot: root });
    assert.deepEqual(
      issues
        .filter((issue) => issue.type === 'asset')
        .map((issue) => path.basename(issue.path))
        .sort(),
      filenames.sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects active electron-builder filters for the CIS data directory', () => {
  const matches = findUnsafeBuilderConfigLines(
    [
      '# _baselines/cis/_data is described here but not included',
      "      - '!_baselines/cis'",
      "      - '!_baselines/cis/**/*'",
      "      - '_baselines/cis'",
      "      - '_baselines/cis/_data/**/*'",
      '',
    ].join('\n'),
  );
  assert.deepEqual(matches, [
    {
      line: "      - '_baselines/cis'",
      lineNumber: 4,
    },
    {
      line: "      - '_baselines/cis/_data/**/*'",
      lineNumber: 5,
    },
  ]);
});

test('allows only the public npm registry for remote lockfile resolutions', () => {
  assert.equal(
    isAllowedLockfileResolution(
      'https://registry.npmjs.org/example-package/-/example-package-1.0.0.tgz',
    ),
    true,
  );
  assert.equal(isAllowedLockfileResolution('file:../example-package'), true);
  assert.equal(isAllowedLockfileResolution('link:../example-package'), true);
  assert.equal(isAllowedLockfileResolution('workspace:*'), true);
  assert.equal(isAllowedLockfileResolution('packages/example-package', { link: true }), true);
  assert.equal(isAllowedLockfileResolution('packages/example-package'), false);
  assert.equal(isAllowedLockfileResolution('https://packages.example.invalid/package.tgz'), false);
  assert.equal(isAllowedLockfileResolution('http://registry.npmjs.org/package.tgz'), false);
  assert.equal(isAllowedLockfileResolution('git+https://example.invalid/package.git'), false);
  assert.equal(isAllowedLockfileResolution('git+ssh://git@example.invalid/package.git'), false);
});

test('rejects a non-public lockfile host without printing it', async () => {
  const root = await createFixture();
  const syntheticHost = 'packages.example.invalid';
  try {
    await writeFile(
      path.join(root, 'package-lock.json'),
      `${JSON.stringify(
        {
          name: 'configforge-public-policy-fixture',
          lockfileVersion: 3,
          packages: {
            '': {},
            'node_modules/example-package': {
              resolved: `https://${syntheticHost}/example-package.tgz`,
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const issues = await inspectPublicPackaging({ repoRoot: root });
    const lockfileIssues = issues.filter((issue) => issue.type === 'lockfile');
    assert.equal(lockfileIssues.length, 1);
    assert.match(lockfileIssues[0].detail, /node_modules\/example-package/);
    assert.doesNotMatch(JSON.stringify(lockfileIssues), new RegExp(syntheticHost, 'i'));

    const result = spawnSync(process.execPath, [guardScript, '--root', root], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /package-lock\.json/i);
    assert.match(result.stderr, /node_modules\/example-package/);
    assert.doesNotMatch(result.stderr, new RegExp(syntheticHost, 'i'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('returns a failing process exit code for unsafe packaging input', async () => {
  const root = await createFixture();
  try {
    const dataRoot = path.join(root, 'public', '_baselines', 'cis', '_data');
    await mkdir(dataRoot, { recursive: true });
    await writeFile(path.join(dataRoot, 'cis-rule-catalog.json'), '{}\n', 'utf8');

    const result = spawnSync(process.execPath, [guardScript, '--root', root], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /public packaging policy violations detected/i);
    assert.match(result.stderr, /cis-rule-catalog\.json/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
