// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * v0.3.1 (#23) — userData-side settings store.
 *
 * Single home for user preferences that the **main process** needs
 * to read. Renderer-only preferences (theme, dismissal flags) stay
 * in localStorage; this store is for anything where the main-process
 * side of the IPC needs to honor a customer choice.
 *
 * Layout: `<userData>/settings.json`
 *
 *   {
 *     "schemaVersion": 1,
 *     "historyRetention": 20,
 *     "preDeploySnapshotRetention": 5,
 *     "auditPackPiiWarningDismissed": false
 *   }
 *
 * Reads are file-system cached with a 1-second TTL (the file is
 * polled on every IPC; we don't want every history-prune to hit
 * disk). Writes are atomic via temp + rename.
 *
 * Env vars continue to override the persisted value when set:
 *   - CONFIGFORGE_HISTORY_MAX_RETENTION  → overrides historyRetention
 *   - CFS_PRE_DEPLOY_SNAPSHOT_RETENTION  → overrides preDeploySnapshotRetention
 *
 * The override discipline is intentional: power users / CI run with
 * env vars and don't have to clear them on the UI side.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface UserSettings {
  schemaVersion: 1;
  /** Manifest version history retention (count). Range: 5-1000. */
  historyRetention: number;
  /** Pre-deploy snapshot retention (count). Range: 1-50. */
  preDeploySnapshotRetention: number;
  /** Whether the user dismissed the audit-pack hostname PII warning. */
  auditPackPiiWarningDismissed: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = Object.freeze({
  schemaVersion: 1,
  historyRetention: 20,
  preDeploySnapshotRetention: 5,
  auditPackPiiWarningDismissed: false,
});

const CACHE_TTL_MS = 1_000;
let cached: { data: UserSettings; readAt: number } | null = null;

/**
 * Resolves the settings file path. Honors `CONFIGFORGE_HOME` for
 * tests (same convention as `history/index.ts` and
 * `manifest/rationale-store.ts`).
 */
function settingsPath(): string {
  const home =
    process.env.CONFIGFORGE_HOME ?? path.join(os.homedir(), '.configforge');
  return path.join(home, 'settings.json');
}

/** Clamp a numeric value to a range. Returns the default if input is invalid. */
function clampNum(v: unknown, min: number, max: number, defaultV: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return defaultV;
  const n = Math.floor(v);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function coerceSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    schemaVersion: 1,
    historyRetention: clampNum(r.historyRetention, 5, 1000, DEFAULT_SETTINGS.historyRetention),
    preDeploySnapshotRetention: clampNum(
      r.preDeploySnapshotRetention,
      1,
      50,
      DEFAULT_SETTINGS.preDeploySnapshotRetention,
    ),
    auditPackPiiWarningDismissed: r.auditPackPiiWarningDismissed === true,
  };
}

export function _resetSettingsCacheForTests(): void {
  cached = null;
}

/**
 * Read the current settings. Cached for `CACHE_TTL_MS`. Returns
 * defaults if the file doesn't exist or is malformed.
 */
export async function getSettings(): Promise<UserSettings> {
  const now = Date.now();
  if (cached && now - cached.readAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const raw = await readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const data = coerceSettings(parsed);
    cached = { data, readAt: now };
    return data;
  } catch {
    const data = { ...DEFAULT_SETTINGS };
    cached = { data, readAt: now };
    return data;
  }
}

/**
 * Merge `patch` into the persisted settings and atomically rewrite
 * the file. Returns the post-merge settings.
 */
export async function setSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const next = coerceSettings({ ...current, ...patch });
  const file = settingsPath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  await rename(tmp, file);
  cached = { data: next, readAt: Date.now() };
  return next;
}

/**
 * Resolve the effective history-retention value, honoring the
 * env-var override (`CONFIGFORGE_HISTORY_MAX_RETENTION`).
 */
export async function resolveHistoryRetention(): Promise<number> {
  const env = process.env.CONFIGFORGE_HISTORY_MAX_RETENTION;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const s = await getSettings();
  return s.historyRetention;
}

/**
 * Resolve the effective pre-deploy snapshot retention.
 */
export async function resolveSnapshotRetention(): Promise<number> {
  const env = process.env.CFS_PRE_DEPLOY_SNAPSHOT_RETENTION;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const s = await getSettings();
  return s.preDeploySnapshotRetention;
}
