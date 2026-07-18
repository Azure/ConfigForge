// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:activity:recent` and `GET /api/activity`.
 *
 * Scans `~/.configforge/history/` for authoring events and, when
 * requested, `~/.configforge/snapshots/` for deploy / audit / revert
 * events. Returns the most recent records sorted descending by
 * timestamp.
 *
 * Tolerant of missing directories: returns an empty array if the
 * user has never registered or deployed anything.
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveUserDataDir } from '../runtime/paths';
import type { ActivityItem } from './contract';

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function getHistoryActivities(historyDir: string): Promise<ActivityItem[]> {
  if (!(await dirExists(historyDir))) return [];

  const activities: ActivityItem[] = [];
  const manifests = await readdir(historyDir, { withFileTypes: true });

  for (const entry of manifests) {
    if (!entry.isDirectory()) continue;
    const manifestDir = join(historyDir, entry.name);
    try {
      const files = await readdir(manifestDir, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.osc.yaml')) continue;
        const filePath = join(manifestDir, file.name);
        const fileStat = await stat(filePath);

        let message: string | undefined;
        const metaPath = `${filePath}.meta`;
        if (await fileExists(metaPath)) {
          try {
            const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as { message?: string };
            message = meta.message;
          } catch {
            // ignore meta parse errors
          }
        }

        activities.push({
          type: 'registered',
          name: entry.name,
          timestamp: fileStat.mtime.toISOString(),
          message: message ?? `Registered manifest '${entry.name}'`,
        });
      }
    } catch {
      // skip unreadable directories
    }
  }

  return activities;
}

async function getSnapshotActivities(snapshotDir: string): Promise<ActivityItem[]> {
  if (!(await dirExists(snapshotDir))) return [];

  const activities: ActivityItem[] = [];
  const files = await readdir(snapshotDir, { withFileTypes: true });

  for (const file of files) {
    if (!file.isFile()) continue;

    const filePath = join(snapshotDir, file.name);
    const fileStat = await stat(filePath);

    if (file.name.endsWith('.pre-deploy.json')) {
      const manifestName = file.name.replace('.pre-deploy.json', '');

      let snapshotTimestamp = fileStat.mtime.toISOString();
      let method = 'manifest';
      let deployMode = '';
      try {
        const data = JSON.parse(await readFile(filePath, 'utf-8')) as {
          timestamp?: string;
          method?: string;
          mode?: string;
        };
        if (data.timestamp) snapshotTimestamp = data.timestamp;
        if (data.method) method = data.method;
        if (data.mode) deployMode = data.mode;
      } catch {
        // use file mtime
      }

      const modeLabel =
        deployMode === 'audit' ? 'audited' : deployMode === 'enforce' ? 'enforced' : 'deployed';
      const activityType =
        deployMode === 'audit'
          ? 'deployed-audit'
          : deployMode === 'enforce'
            ? 'deployed-enforce'
            : 'deployed';

      activities.push({
        type: activityType as ActivityItem['type'],
        name: manifestName,
        timestamp: snapshotTimestamp,
        message: `${modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1)} ${
          method === 'scenario' ? 'scenario' : 'manifest'
        } '${manifestName}'`,
      });
    } else if (file.name.endsWith('.reverted.json')) {
      const manifestName = file.name.replace('.reverted.json', '');
      activities.push({
        type: 'reverted',
        name: manifestName,
        timestamp: fileStat.mtime.toISOString(),
        message: `Reverted manifest '${manifestName}'`,
      });
    }
  }

  return activities;
}

export async function getRecentActivity(
  limit = 10,
  includeDeviceActivity = true,
): Promise<ActivityItem[]> {
  const userDataDir = resolveUserDataDir();
  const historyDir = join(userDataDir, 'history');
  const snapshotDir = join(userDataDir, 'snapshots');

  const [historyActivities, snapshotActivities] = await Promise.all([
    getHistoryActivities(historyDir),
    includeDeviceActivity ? getSnapshotActivities(snapshotDir) : Promise.resolve([]),
  ]);

  return [...historyActivities, ...snapshotActivities]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}
