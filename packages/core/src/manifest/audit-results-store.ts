// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Persisted last-audit-result store, one JSON file per manifest namespace.
 *
 *   ~/.configforge/audit-results/<sanitized-ns>.json
 *
 * Each `DeployResponseData` from `handlers/deploy.ts` (mode='audit' or
 * mode='enforce') is captured here at the end of the run so the audit
 * pack can include the user's most recent device-side audit instead of
 * only the on-demand CIS-vs-user comparison. Overwritten on every new
 * audit — auditors care about the latest snapshot, and the JSONL
 * rationale log already covers per-change history.
 *
 * v0.1.6 — added in response to user feedback that the audit pack
 * "doesn't bring in the last compliance report". The deploy-time
 * results were previously held only in renderer state and discarded
 * on navigation, leaving the audit pack with nothing to load unless
 * a `?against=<id>` URL query was manually supplied.
 *
 * Schema is intentionally permissive (`unknown` for the body) so a
 * deploy.ts response shape change in a future release doesn't require
 * a store migration. Readers (audit-pack PDF + renderer "last audited
 * X minutes ago" badge) extract the fields they need with
 * type-narrowing guards.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { parseLosslessJson, stringifyLosslessJson } from './lossless';

const ENV_OVERRIDE = 'CONFIGFORGE_HOME';
const auditResultLocks = new Map<string, Promise<void>>();

async function withAuditResultLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const previous = auditResultLocks.get(file) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entry = previous.then(() => turn);
  auditResultLocks.set(file, entry);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (auditResultLocks.get(file) === entry) {
      auditResultLocks.delete(file);
    }
  }
}

function configforgeHome(): string {
  return process.env[ENV_OVERRIDE] ?? path.join(os.homedir(), '.configforge');
}

function auditResultsRoot(): string {
  return path.join(configforgeHome(), 'audit-results');
}

/**
 * Same sanitization rules as the rationale store (`[A-Za-z0-9._-]`,
 * collapsed dashes, leading/trailing dots stripped, 96-char cap).
 * Intentionally re-implemented locally so this store can diverge from
 * rationale-store if its constraints ever differ.
 */
function sanitizeNs(ns: string): string {
  if (typeof ns !== 'string') return '';
  const trimmed = ns.trim();
  if (!trimmed) return '';
  const slug = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
  if (!slug || /^\.+$/.test(slug)) return '';
  return slug;
}

function resolvePath(ns: string): string {
  const sanitized = sanitizeNs(ns);
  if (!sanitized) {
    throw new Error(`Invalid namespace for audit-result store: ${JSON.stringify(ns)}`);
  }
  return path.join(auditResultsRoot(), `${sanitized}.json`);
}

/**
 * The persisted audit-result envelope. Wraps the raw `DeployResponseData`
 * from the deploy handler with a recorded-at timestamp + version of the
 * file format itself, so a future schema change can be detected at read
 * time without breaking older files.
 */
export interface PersistedAuditResult {
  /** Always 1 for v0.1.6. Increment on breaking changes to `result`. */
  version: 1;
  /** ISO 8601 timestamp when the audit completed and was written. */
  recordedAt: string;
  /** `audit` (read-only check) vs `enforce` (apply + audit). */
  mode: 'audit' | 'enforce';
  /** Registration revision audited, when the registration supports revisions. */
  registrationRevision?: string;
  /** Raw `DeployResponseData` body, unwrapped from the IPC envelope. */
  result: unknown;
}

/**
 * Persist the last audit-run result for a namespace. Overwrites any
 * previous file. Best-effort: write failures are logged + swallowed
 * because losing the audit-result cache should never block a real
 * deploy or audit from completing successfully.
 *
 * Returns the on-disk path so callers (deploy.ts) can include it in
 * progress logs if useful.
 */
export async function writeAuditResult(
  ns: string,
  mode: 'audit' | 'enforce',
  result: unknown,
  registrationRevision?: string,
): Promise<string | null> {
  try {
    const file = resolvePath(ns);
    return await withAuditResultLock(file, async () => {
      await mkdir(auditResultsRoot(), { recursive: true });
      const envelope: PersistedAuditResult = {
        version: 1,
        recordedAt: new Date().toISOString(),
        mode,
        ...(registrationRevision ? { registrationRevision } : {}),
        result,
      };
      // Atomic write via rename keeps concurrent readers from seeing a
      // half-written file. The per-file lock also serializes registration
      // cleanup with a completing audit so cleanup cannot unlink a newer run.
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
      const serialized = stringifyLosslessJson(envelope, 2);
      if (serialized === undefined) {
        throw new Error('Audit result could not be serialized');
      }
      await writeFile(tmp, serialized, 'utf-8');
      // fs.rename on Win replaces the target atomically when both are
      // on the same volume (which they always are — both live in
      // `~/.configforge/audit-results/`).
      await rename(tmp, file);
      return file;
    });
  } catch (err) {
    // Don't throw — the audit result already came back to the user;
    // failing to cache it is a degraded-mode condition, not an error.
    // eslint-disable-next-line no-console
    console.warn(`[audit-results] write failed for ${ns}:`, err);
    return null;
  }
}

/**
 * Read the most recent persisted audit result for a namespace.
 * Returns `null` when the file doesn't exist (= no audit has been
 * run yet) OR when the file is unparseable / has an unknown schema
 * version. Both conditions are treated identically by callers ("no
 * cached compliance available") so a corrupt file never crashes the
 * audit-pack or settings page.
 */
export async function readAuditResult(ns: string): Promise<PersistedAuditResult | null> {
  let file: string;
  try {
    file = resolvePath(ns);
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = await readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // eslint-disable-next-line no-console
    console.warn(`[audit-results] read failed for ${ns}:`, err);
    return null;
  }
  try {
    const parsed = parseLosslessJson(raw) as Partial<PersistedAuditResult>;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.recordedAt !== 'string' ||
      (parsed.registrationRevision !== undefined &&
        typeof parsed.registrationRevision !== 'string') ||
      (parsed.mode !== 'audit' && parsed.mode !== 'enforce')
    ) {
      // eslint-disable-next-line no-console
      console.warn(`[audit-results] ${file}: schema mismatch, ignoring`);
      return null;
    }

    return parsed as PersistedAuditResult;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[audit-results] ${file}: parse failed (${(err as Error).message})`);
    return null;
  }
}

export interface CurrentAuditRegistration {
  modifiedAt: string;
  revision?: string;
}

function auditMatchesRegistration(
  audit: PersistedAuditResult,
  registration: CurrentAuditRegistration,
): boolean {
  if (registration.revision) {
    return audit.registrationRevision === registration.revision;
  }

  const auditTime = Date.parse(audit.recordedAt);
  const modifiedTime = Date.parse(registration.modifiedAt);
  // Preserve legacy behavior for malformed historical timestamps. New
  // registrations always carry a revision, so this branch is compatibility
  // only and must not hide otherwise usable historical audit data.
  if (!Number.isFinite(auditTime) || !Number.isFinite(modifiedTime)) return true;
  return auditTime >= modifiedTime;
}

/**
 * Read an audit only when it describes the supplied registration revision.
 * This is the single freshness boundary for list/detail, Audit Pack, and IPC.
 * Stale files are left in place and safely ignored; a later audit overwrites
 * them. Avoiding read-then-delete also prevents cross-process races.
 */
export async function readAuditResultForRegistration(
  ns: string,
  registration: CurrentAuditRegistration,
): Promise<PersistedAuditResult | null> {
  const audit = await readAuditResult(ns);
  return audit && auditMatchesRegistration(audit, registration) ? audit : null;
}

/**
 * Delete the audit-result cache for a namespace. Called when the
 * manifest itself is deleted so we don't leave orphaned audit data.
 * Best-effort — missing file is not an error.
 */
export async function deleteAuditResult(ns: string): Promise<void> {
  let file: string;
  try {
    file = resolvePath(ns);
  } catch {
    return;
  }
  await withAuditResultLock(file, async () => {
    try {
      await rm(file, { force: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[audit-results] delete failed for ${ns}:`, err);
    }
  });
}

/**
 * Best-effort removal of an audit that cannot describe the current
 * registration. The same lock used by writers makes the freshness check and
 * deletion one operation: a matching audit that is already finishing wins
 * first and is retained; one that starts later is written after cleanup.
 */
