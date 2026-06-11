// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handlers for the `revert` mutation channel.
 *
 * Revert semantics:
 *   - If a pre-deploy snapshot exists with `manifestYaml`, re-apply
 *     that YAML to restore the previously-applied configuration
 *     contract.
 *   - Otherwise, delete the namespace (stop enforcing). We do NOT
 *     promise to restore arbitrary prior system state — oscfg only
 *     tracks managed resources.
 *
 * Snapshot files live under `<userDataDir>/snapshots/<namespace>.pre-deploy.json`
 * (host-injected via the runtime/paths strategy).
 */
import { readFile, unlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  applyManifest,
  deleteNamespace,
  deleteRegistration,
  parseYamlDocument,
  sanitizeNamespace,
} from '../oscfg';
import {
  hasMixedPlatformResources,
  validateManifestPlatform,
  validateManifestSchema,
  type Platform,
} from '../platform';
import { resolveUserDataDir, resolveTempDir } from '../runtime/paths';
import { HandlerError } from './errors';

export interface RevertRequest {
  name: string;
}

export interface RevertResult {
  message: string;
  data: {
    Reverted: true;
    Method: 'reapply-manifest' | 'delete-namespace';
    preDeployTimestamp?: string;
  };
}

interface PreDeploySnapshot {
  name: string;
  manifestYaml?: string;
  timestamp?: string;
}

export async function revertManifest(req: RevertRequest): Promise<RevertResult> {
  if (!req || typeof req.name !== 'string' || req.name.length === 0) {
    throw new HandlerError(400, 'name is required');
  }
  const namespace = sanitizeNamespace(req.name);
  const snapshotDir = path.join(resolveUserDataDir(), 'snapshots');
  const snapshotPath = path.join(snapshotDir, `${namespace}.pre-deploy.json`);

  let snapshot: PreDeploySnapshot | null = null;
  try {
    const raw = await readFile(snapshotPath, 'utf-8');
    snapshot = JSON.parse(raw) as PreDeploySnapshot;
  } catch {
    snapshot = null;
  }

  if (snapshot && typeof snapshot.manifestYaml === 'string') {
    // ── H6: re-validate the snapshot YAML before applying ──────────
    // The snapshot was written by an earlier deploy, but disk state
    // can drift (manual edits, partial writes, version mismatches),
    // so we run the same pre-apply checks that registerManifest does:
    // schema → mixed-platform rejection → host-platform match.
    // Failing fast keeps revert from pushing broken or wrong-platform
    // YAML through `oscfg apply` and corrupting the device.
    const validationError = validateSnapshotYaml(snapshot.manifestYaml);
    if (validationError) {
      throw new HandlerError(
        500,
        `Cannot revert "${req.name}": pre-deploy snapshot failed re-validation — ${validationError}. ` +
          `The snapshot file may be corrupted; delete it and re-deploy if you want a fresh starting point.`,
      );
    }

    await mkdir(snapshotDir, { recursive: true });
    const tempFile = path.join(
      resolveTempDir(),
      `configforge-revert-${namespace}-${Date.now()}.osc.yaml`,
    );
    await writeFile(tempFile, snapshot.manifestYaml, 'utf-8');
    const result = await applyManifest({ file: tempFile, namespace });
    await unlink(tempFile).catch(() => {
      // best-effort temp cleanup
    });
    if (!result.success) {
      throw new HandlerError(500, result.error ?? 'apply failed');
    }
    await unlink(snapshotPath).catch(() => {
      // best-effort snapshot cleanup
    });
    return {
      message: `Manifest "${req.name}" reverted — previous YAML re-applied.`,
      data: {
        Reverted: true,
        Method: 'reapply-manifest',
        preDeployTimestamp: snapshot.timestamp,
      },
    };
  }

  // No usable snapshot — fall back to namespace deletion.
  const result = await deleteNamespace(namespace);
  if (!result.success) {
    throw new HandlerError(500, result.error ?? 'delete namespace failed');
  }
  await deleteRegistration(namespace);
  if (snapshot) {
    await unlink(snapshotPath).catch(() => {});
  }

  const noSnapshotMessage = snapshot
    ? `Manifest "${req.name}" unregistered — enforcement removed.`
    : `Manifest "${req.name}" unregistered — no pre-deploy snapshot found, so OSConfig enforcement was removed but previous values could not be re-applied.`;
  return {
    message: noSnapshotMessage,
    data: {
      Reverted: true,
      Method: 'delete-namespace',
    },
  };
}

// Suppress lint-warning unused import (os/tmpdir kept for parity reference).
void os;

// ── H6: pre-revert validation ───────────────────────────────────────
//
// Mirrors the pipeline in handlers/manifests.ts:registerManifest:
//   1. YAML must parse to an object with a valid resources[] array.
//   2. Manifest must not mix Windows and Linux resource types.
//   3. Manifest's resource types must be valid for the host OS.
//
// Returns an error string, or null when the snapshot is safe to apply.
function platformFromProcess(): Platform {
  return process.platform === 'win32' ? 'windows' : 'linux';
}

function validateSnapshotYaml(rawYaml: string): string | null {
  let parsed: unknown;
  try {
    parsed = parseYamlDocument(rawYaml);
  } catch (err) {
    const m = err instanceof Error ? err.message : 'YAML parse failed';
    return `snapshot YAML is malformed (${m})`;
  }

  const schemaErrors = validateManifestSchema(parsed);
  if (schemaErrors.length) {
    return `snapshot manifest schema is invalid (${schemaErrors.join('; ')})`;
  }

  const resources = ((parsed as Record<string, unknown> | null)?.resources ?? []) as unknown[];

  if (hasMixedPlatformResources(resources)) {
    return 'snapshot mixes Windows and Linux resource types';
  }

  const host = platformFromProcess();
  const platformErrors = validateManifestPlatform(resources, host);
  if (platformErrors.length) {
    return `snapshot targets a different platform than this machine (${host}): ${platformErrors.join('; ')}`;
  }

  return null;
}
