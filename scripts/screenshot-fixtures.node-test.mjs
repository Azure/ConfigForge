// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SYNTHETIC_BENCHMARK_FILENAME,
  SYNTHETIC_BENCHMARK_NAME,
  buildSyntheticBenchmarkCatalog,
  cleanupScreenshotFixtures,
  containsProhibitedBenchmarkTerms,
  createScreenshotFixtures,
  extractTopLevelResources,
  humanizeResourceName,
} from './screenshot-fixtures.mjs';

const SAMPLE_WS2025 = `$schema: https://example.invalid/schema.json
resources:
  - name: AllowAnonymousSIDOrNameTranslation
    type: Microsoft.OSConfig/Test
    properties:
      resource:
        type: Microsoft.Windows/AccountPolicy
  - name: NetworkAccess_DoNotAllowAnonymousEnumerationOfSAMAccounts
    type: Microsoft.OSConfig/Test
  - name: RunAllAdministratorsInAdminApprovalMode
    type: Microsoft.OSConfig/Test
`;

const SAMPLE_WS2019 = `resources:
  - name: AuditAccountLockout
    type: Microsoft.Windows/AuditPolicy
  - name: MinimumPasswordLength
    type: Microsoft.Windows/AccountPolicy
`;

test('builds synthetic rule titles only from top-level resource names', () => {
  const resources = extractTopLevelResources(SAMPLE_WS2025);
  assert.deepEqual(resources, [
    {
      name: 'AllowAnonymousSIDOrNameTranslation',
      type: 'Microsoft.OSConfig/Test',
    },
    {
      name: 'NetworkAccess_DoNotAllowAnonymousEnumerationOfSAMAccounts',
      type: 'Microsoft.OSConfig/Test',
    },
    {
      name: 'RunAllAdministratorsInAdminApprovalMode',
      type: 'Microsoft.OSConfig/Test',
    },
  ]);
  assert.equal(
    humanizeResourceName('NetworkAccess_DoNotAllowAnonymousEnumerationOfSAMAccounts'),
    'Network Access Do Not Allow Anonymous Enumeration Of SAM Accounts',
  );

  const catalog = buildSyntheticBenchmarkCatalog(resources, '0.3.93');
  assert.equal(catalog.standard, 'Industry Benchmark');
  assert.equal(catalog.baselineSettings[0].name, SYNTHETIC_BENCHMARK_NAME);
  assert.equal(catalog.baselineSettings[0].settings.length, resources.length);
  assert.match(
    catalog.baselineSettings[0].settings[0].name,
    /^1\.1 Synthetic check — Allow Anonymous SID Or Name Translation;/,
  );
  assert.equal(containsProhibitedBenchmarkTerms(JSON.stringify(catalog)), false);
  assert.equal(containsProhibitedBenchmarkTerms('Admin Approval Mode'), false);
  assert.equal(containsProhibitedBenchmarkTerms('CIS Benchmark'), true);
  assert.equal(containsProhibitedBenchmarkTerms('XCCDF catalog'), true);
  assert.equal(containsProhibitedBenchmarkTerms('OVAL definitions'), true);
});

test('creates and cleans an isolated public root and manifest home', async (t) => {
  const fakeRepo = await mkdtemp(path.join(os.tmpdir(), 'configforge-screenshot-test-repo-'));
  let fixtures = null;
  t.after(async () => {
    if (fixtures) await cleanupScreenshotFixtures(fixtures);
    await rm(fakeRepo, { recursive: true, force: true });
  });

  const baselinesDir = path.join(fakeRepo, 'public', '_baselines');
  await mkdir(baselinesDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(baselinesDir, 'ws2025-member-server.osc.yaml'),
      SAMPLE_WS2025,
      'utf-8',
    ),
    writeFile(
      path.join(baselinesDir, 'ws2019-domain-member.osc.yaml'),
      SAMPLE_WS2019,
      'utf-8',
    ),
  ]);

  fixtures = await createScreenshotFixtures({
    repoRoot: fakeRepo,
    appVersion: '0.3.93',
    timestamp: '2026-07-25T12:00:00.000Z',
  });

  const relativePublicRoot = path.relative(fakeRepo, fixtures.publicRoot);
  assert.ok(relativePublicRoot.startsWith('..') || path.isAbsolute(relativePublicRoot));
  assert.equal(path.dirname(fixtures.configForgeHome), fixtures.fixtureHome);
  assert.equal(path.basename(fixtures.configForgeHome), '.configforge');

  const catalogPath = path.join(
    fixtures.publicRoot,
    '_baselines',
    'cis',
    '_data',
    SYNTHETIC_BENCHMARK_FILENAME,
  );
  const catalog = JSON.parse(await readFile(catalogPath, 'utf-8'));
  assert.equal(catalog.baselineSettings[0].name, SYNTHETIC_BENCHMARK_NAME);
  assert.equal(catalog.baselineSettings[0].settings.length, 3);

  const registrationPath = path.join(
    fixtures.manifestsDir,
    'Windows-Server-2025---Member-Server.json',
  );
  const registration = JSON.parse(await readFile(registrationPath, 'utf-8'));
  assert.equal(registration.displayName, 'Windows Server 2025 - Member Server');
  assert.equal(registration.resourceSummary.length, 3);
  assert.equal(registration.revision, 'screenshot-fixture-0.3.93-ws2025-member-server');

  await access(
    path.join(
      fixtures.manifestsDir,
      'Windows-Server-2025---Member-Server.source.yaml',
    ),
  );
  await access(
    path.join(
      fixtures.publicRoot,
      '_baselines',
      'ws2025-member-server.osc.yaml',
    ),
  );
  await access(fixtures.runtimeTempDir);

  const fixtureRoot = fixtures.tempRoot;
  await cleanupScreenshotFixtures(fixtures);
  fixtures = null;
  await assert.rejects(access(fixtureRoot));
});
