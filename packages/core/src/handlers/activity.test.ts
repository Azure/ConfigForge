// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRecentActivity } from './activity';
import { resetPathStrategy, setPathStrategy } from '../runtime/paths';

const testRoot = join(
  process.cwd(),
  `.configforge-activity-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
);

async function writeHistoryActivity(name: string, message: string): Promise<void> {
  const manifestDir = join(testRoot, 'history', name);
  const snapshot = join(manifestDir, '2026-07-18T08-00-00-000Z.osc.yaml');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(snapshot, 'resources: []\n', 'utf8');
  await writeFile(`${snapshot}.meta`, JSON.stringify({ message }), 'utf8');
}

async function writeDeviceActivities(): Promise<void> {
  const snapshotDir = join(testRoot, 'snapshots');
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(
    join(snapshotDir, 'device-audit.pre-deploy.json'),
    JSON.stringify({
      timestamp: '2026-07-18T09:00:00.000Z',
      method: 'manifest',
      mode: 'audit',
    }),
    'utf8',
  );
  await writeFile(join(snapshotDir, 'device-revert.reverted.json'), '{}', 'utf8');
}

describe('getRecentActivity flavor filtering', () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
    setPathStrategy({
      resolveOscfgBinaryDir: () => testRoot,
      resolvePublicAsset: () => testRoot,
      resolveTempDir: () => testRoot,
      resolveUserDataDir: () => testRoot,
    });
  });

  afterEach(async () => {
    resetPathStrategy();
    await rm(testRoot, { recursive: true, force: true });
  });

  it('returns registration, modification, import, and template history without device activity', async () => {
    await Promise.all([
      writeHistoryActivity('registered', 'Manifest registered'),
      writeHistoryActivity('modified', 'AccountLockoutThreshold modified'),
      writeHistoryActivity('imported', 'Manifest registered'),
      writeHistoryActivity('templated', 'Manifest registered'),
      writeDeviceActivities(),
    ]);

    const activities = await getRecentActivity(10, false);

    expect(activities).toHaveLength(4);
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'registered', message: 'Manifest registered' }),
        expect.objectContaining({
          type: 'registered',
          message: 'AccountLockoutThreshold modified',
        }),
        expect.objectContaining({
          type: 'registered',
          name: 'imported',
          message: 'Manifest registered',
        }),
        expect.objectContaining({
          type: 'registered',
          name: 'templated',
          message: 'Manifest registered',
        }),
      ]),
    );
    expect(activities.some(({ type }) => type !== 'registered')).toBe(false);
  });

  it('preserves deploy, audit, and revert records for the full flavor', async () => {
    await writeDeviceActivities();

    const activities = await getRecentActivity();

    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'deployed-audit', name: 'device-audit' }),
        expect.objectContaining({ type: 'reverted', name: 'device-revert' }),
      ]),
    );
  });
});
