// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Pure handler for `cfs:deploy:run` and `POST /api/deploy`.
 *
 * Modes:
 *   - `audit`: read-only compliance check against current device state
 *   - `enforce` (default): apply the manifest, then audit
 *
 * Why this is the largest handler in the project
 * -----------------------------------------------
 * Deploy is the only handler that:
 *
 *   1. Mutates the device (oscfg apply spawns CLI; the system state
 *      changes after a successful return).
 *   2. Runs for minutes, not milliseconds, on large manifests
 *      (audit alone can take 30+ s when 350 resources need fallback
 *      reads at 4-way concurrency).
 *   3. Emits progress events that the renderer surfaces as a live UI
 *      ("3 of 350 resources audited…").
 *   4. Supports cancellation — but only at safe boundaries. Mid-CLI
 *      cancellation is intentionally unsupported because killing oscfg
 *      apply mid-run can leave the device in a partially-applied state.
 *
 * Cancellation contract (the careful part)
 * ----------------------------------------
 *
 * `signal: AbortSignal` is consulted at these points only:
 *
 *   audit mode: any safe boundary throws HandlerError(499, 'cancelled').
 *
 *   enforce mode:
 *     - BEFORE applyManifest is invoked → HandlerError(499, 'cancelled')
 *     - AFTER applyManifest starts → cancellation is recorded as
 *       `cancelRequested: true` in the response, but the deploy
 *       completes (audit + snapshot + finalize) so the device + on-disk
 *       state stay consistent. The audit phase still consults the
 *       signal so it stops scheduling new oscfg spawns; partial audit
 *       results are aggregated and `AuditIncomplete` is set.
 *
 * Progress event shape
 * --------------------
 * No `pct`. The CLI work is opaque, and faking a percentage across
 * heterogeneous phases produces lies. Renderer can show a stepped
 * progress UI keyed off `phase` + `phaseIndex`/`phaseCount`.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  applyManifest,
  execResource,
  getResources,
  getRegistrationSnapshot,
  resolveOscfgBinary,
  sanitizeNamespace,
  updateRegistration,
  parseYamlDocument,
  compareDesiredActual,
  normalizePropertiesForCli,
  summarizeCompliance,
  isTransientOscfgError,
  runWithBoundedConcurrency,
  withRetries,
  type ComplianceResult,
  type DesiredResource,
  type RetryHandle,
} from '../oscfg';
import { getHistory, getSnapshot } from '../history';
import { getSystemInfo } from '../system';
import {
  validateManifestPlatform,
  hasMixedPlatformResources,
  detectManifestPlatform,
  extractResourceSummary,
  extractResourcesFull,
  type Platform,
} from '../platform';
import { resolveUserDataDir } from '../runtime/paths';
import { writeAuditResult } from '../manifest/audit-results-store';
import { HandlerError, cliRequiredError } from './errors';
import { _clearManifestsListCache } from './manifests';

// ── Types ─────────────────────────────────────────────────────────────

/** Top-level request shape. `jobId` is opaque to the handler; the host
 * (Electron main / Next.js) uses it for progress correlation. */
export interface DeployRequest {
  name: string;
  mode?: 'audit' | 'enforce';
  /** Reserved — informational only. We re-validate against process.platform. */
  platform?: string;
  /** Reserved — legacy scenario API; ignored. */
  scenarioName?: string;
  /** Opaque correlation id. Echoed in progress events. */
  jobId?: string;
}

export type DeployPhase = 'validate' | 'apply' | 'audit' | 'snapshot' | 'finalize';

export interface DeployProgressEvent {
  phase: DeployPhase;
  phaseIndex: number;
  phaseCount: number;
  message: string;
  /** Resources audited so far (audit/audit-fallback phase only). */
  resourcesCompleted?: number;
  /** Total resources in the manifest (audit/audit-fallback phase only). */
  resourcesTotal?: number;
  /** True when we're inside a phase the host can still cancel. */
  cancellable: boolean;
  /** True once the user has clicked Cancel. The deploy may still
   * complete (post-apply commit) — the flag is purely informational. */
  cancelRequested: boolean;
}

export interface DeployResource {
  name: string;
  type: string;
  status: string;
  reason: string;
}

export interface DeployResponseData {
  Name: string;
  Deployed: boolean;
  DeployError?: string | null;
  Hostname: string;
  Timestamp: string;
  TotalResources: number;
  Compliant: number;
  NonCompliant: number;
  Indeterminate: number;
  Errors: number;
  Resources: DeployResource[];
  DeployMethod: 'Manifest';
  DeployMode: 'audit' | 'enforce';
  AuditIncomplete: boolean;
  AuditRetries: number;
  FallbackUsed?: number;
}

export interface DeployResponse {
  message: string;
  warning?: string;
  /** True if the user requested cancellation at any point. */
  cancelRequested: boolean;
  /** True if the entire deploy was aborted before commit (audit only).
   *  Enforce mode is never `cancelled: true` once apply has run; it
   *  surfaces partial state via `cancelRequested + AuditIncomplete`. */
  cancelled: boolean;
  data: DeployResponseData;
}

export interface DeployOptions {
  onProgress?: (event: DeployProgressEvent) => void;
  signal?: AbortSignal;
}

// ── Internal helpers (mirror the original route) ──────────────────────

/**
 * Resolve the snapshots directory through the active path strategy
 * (Next.js default vs. Electron host). Must be a function — not a
 * module-level constant — because tests and Electron call
 * `setPathStrategy()` AFTER this module is loaded, and a constant
 * captured at import time would freeze the wrong path. revert.ts /
 * activity.ts use the same abstraction (resolveUserDataDir); see H1
 * audit finding for why divergence broke revert under non-default
 * strategies.
 */
function getSnapshotDir(): string {
  return path.join(resolveUserDataDir(), 'snapshots');
}

async function ensureSnapshotDir() {
  await mkdir(getSnapshotDir(), { recursive: true });
}

// ── v0.3.1 (#4): Mid-deploy interruption recovery ─────────────────────

export interface InterruptedDeploy {
  namespace: string;
  displayName: string;
  startedAt: string;
  sentinelPath: string;
}

/**
 * Scan the snapshot dir for `<ns>.deploy-in-progress` sentinels left
 * behind by a deploy that didn't reach `finalize`. Called on app
 * startup; any survivors mean the device may be in a partially-
 * applied state and the user should be prompted to audit or revert.
 *
 * The caller is responsible for surfacing these to the UI and for
 * clearing the sentinel once the user has acted (via
 * `dismissInterruptedDeploy`).
 */
export async function listInterruptedDeploys(): Promise<InterruptedDeploy[]> {
  const dir = getSnapshotDir();
  try {
    const { readdir, readFile } = await import('node:fs/promises');
    const entries = await readdir(dir).catch(() => [] as string[]);
    const out: InterruptedDeploy[] = [];
    for (const name of entries) {
      if (!name.endsWith('.deploy-in-progress')) continue;
      const sentinelPath = path.join(dir, name);
      try {
        const raw = await readFile(sentinelPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<InterruptedDeploy>;
        if (typeof parsed.namespace === 'string') {
          out.push({
            namespace: parsed.namespace,
            displayName: parsed.displayName ?? parsed.namespace,
            startedAt: parsed.startedAt ?? '',
            sentinelPath,
          });
        }
      } catch {
        // Malformed sentinel — still surface as recovery candidate,
        // using the namespace inferred from filename.
        const inferredNs = name.replace(/\.deploy-in-progress$/, '');
        out.push({
          namespace: inferredNs,
          displayName: inferredNs,
          startedAt: '',
          sentinelPath,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Remove a deploy-in-progress sentinel (user dismissed the banner). */
export async function dismissInterruptedDeploy(namespace: string): Promise<void> {
  // CF-SEC: validate namespace before path construction to prevent
  // path traversal. The IPC handler validates type+shape but not value.
  if (typeof namespace !== 'string' || !namespace.length) return;
  // Reject path traversal sequences and any path separator.
  if (
    namespace.includes('..') ||
    namespace.includes('/') ||
    namespace.includes('\\') ||
    namespace.includes('\0') ||
    !/^[A-Za-z0-9._-]+$/.test(namespace)
  ) {
    return;
  }
  const sentinelPath = path.join(getSnapshotDir(), `${namespace}.deploy-in-progress`);
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(sentinelPath);
  } catch {
    /* not present; idempotent */
  }
}

// ── Per-namespace deploy serialization (M2) ───────────────────────────

/**
 * Per-namespace mutex map for runDeploy. Two concurrent deploys for the
 * same namespace would race on apply + pre-deploy.json (last writer
 * wins, leaving an inconsistent snapshot vs. on-device state). We
 * serialize them here so the second deploy waits its turn rather than
 * erroring out — modeled on `withNamespaceLock` in oscfg/registry.ts.
 *
 * Cross-process coordination is out of scope: deploys go through a
 * single Node.js host (Next.js server or Electron main process).
 */
const deployLocks = new Map<string, Promise<void>>();

export async function withDeployLock<T>(namespace: string, fn: () => Promise<T>): Promise<T> {
  const previous = deployLocks.get(namespace) ?? Promise.resolve();
  let release!: () => void;
  const myTurn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const myEntry: Promise<void> = previous.then(() => myTurn);
  deployLocks.set(namespace, myEntry);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (deployLocks.get(namespace) === myEntry) {
      deployLocks.delete(namespace);
    }
  }
}

/** @internal Test-only — clear all in-flight deploy locks. */
export function _clearDeployLocksForTests(): void {
  deployLocks.clear();
}

function platformFromProcess(): Platform {
  return process.platform === 'win32' ? 'windows' : 'linux';
}

function indexActualsByName(bulk: unknown[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const entry of bulk) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name : '';
    if (!name) continue;
    const props = (e.properties ?? e) as Record<string, unknown>;
    out.set(name, { ...e, properties: props });
  }
  return out;
}

async function execGetSingle(
  desired: DesiredResource,
): Promise<{ actual: Record<string, unknown> | null; error: string | null }> {
  const cliProps = normalizePropertiesForCli(desired.type, desired.properties);
  const result = await execResource({
    mode: 'get',
    type: desired.type,
    name: desired.name,
    properties: cliProps,
  });
  if (!result.success) {
    return { actual: null, error: result.error ?? 'CLI error' };
  }
  const raw = result.data as Record<string, unknown> | null;
  if (!raw) return { actual: null, error: 'Empty CLI response' };
  return { actual: raw, error: null };
}

interface AuditOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

async function auditResources(
  desired: DesiredResource[],
  bulkResources: unknown[] | null,
  opts: AuditOptions = {},
): Promise<{
  results: ComplianceResult[];
  fallbackUsed: number;
  fallbackErrors: number;
  fallbackRetries: number;
  /** True iff the audit was cut short by the cancellation signal. */
  cancelled: boolean;
}> {
  const actualIndex = bulkResources ? indexActualsByName(bulkResources) : new Map();

  const results: ComplianceResult[] = new Array(desired.length);
  const needsFallback: number[] = [];

  desired.forEach((d, i) => {
    const hit = actualIndex.get(d.name);
    if (hit) {
      results[i] = compareDesiredActual(d, hit);
    } else {
      needsFallback.push(i);
    }
  });

  const CONCURRENCY = parseInt(process.env.CONFIGFORGE_AUDIT_CONCURRENCY ?? '4', 10) || 4;
  const RETRIES = parseInt(process.env.CONFIGFORGE_AUDIT_RETRIES ?? '3', 10) || 3;

  let fallbackErrors = 0;
  let fallbackRetries = 0;
  let completedFromBulk = desired.length - needsFallback.length;
  // Emit at-least-once before any fallback runs so the UI sees the bulk hit-rate.
  if (opts.onProgress && needsFallback.length > 0) {
    opts.onProgress(completedFromBulk, desired.length);
  }

  const tasks = needsFallback.map((idx) => async () => {
    const d = desired[idx];
    const handle: RetryHandle = { attempts: 0, retried: false };
    try {
      const v = await withRetries(
        async () => {
          const r = await execGetSingle(d);
          if (!r.actual) throw new Error(r.error ?? 'Empty CLI response');
          return r;
        },
        {
          attempts: RETRIES,
          baseDelayMs: 150,
          maxDelayMs: 1500,
          shouldRetry: isTransientOscfgError,
          signal: opts.signal,
        },
        handle,
      );
      if (handle.retried) fallbackRetries++;
      completedFromBulk++;
      opts.onProgress?.(completedFromBulk, desired.length);
      return { idx, d, value: v, error: null as string | null };
    } catch (err) {
      if (handle.retried) fallbackRetries++;
      completedFromBulk++;
      opts.onProgress?.(completedFromBulk, desired.length);
      const msg = err instanceof Error ? err.message : String(err);
      return { idx, d, value: null, error: msg };
    }
  });

  const settled = await runWithBoundedConcurrency(tasks, {
    concurrency: CONCURRENCY,
    signal: opts.signal,
  });

  for (const s of settled) {
    if (!s) continue; // unstarted slot due to cancellation
    if (!s.ok) {
      const e = s.error instanceof Error ? s.error.message : String(s.error);
      // eslint-disable-next-line no-console
      console.warn(`[audit] queue task threw outside its handler: ${e}`);
      continue;
    }
    const { idx, d, value, error } = s.value;
    if (value && value.actual) {
      results[idx] = compareDesiredActual(d, value.actual);
    } else {
      fallbackErrors++;
      results[idx] = compareDesiredActual(d, null);
      results[idx] = {
        ...results[idx],
        reason: `Audit could not be completed — ${error ?? 'unknown CLI error'}.`,
      };
    }
  }

  // Repair any slots left undefined (skipped due to cancellation, or
  // by the defensive `continue` above).
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = compareDesiredActual(desired[i], null);
      if (opts.signal?.aborted) {
        results[i] = {
          ...results[i],
          reason: 'Audit cancelled before this resource could be checked.',
        };
        fallbackErrors++;
      }
    }
  }

  return {
    results,
    fallbackUsed: needsFallback.length,
    fallbackErrors,
    fallbackRetries,
    cancelled: !!opts.signal?.aborted,
  };
}

function toUiResources(results: ComplianceResult[]): DeployResource[] {
  return results.map((r) => ({
    name: r.name,
    type: r.type,
    status: r.status,
    reason: r.reason,
  }));
}

function loadDesiredFromSource(yaml: string | null): DesiredResource[] | null {
  if (!yaml) return null;
  try {
    const doc = parseYamlDocument(yaml) as Record<string, unknown>;
    const rs = Array.isArray(doc?.resources) ? (doc.resources as unknown[]) : [];
    return extractResourcesFull(rs);
  } catch {
    return null;
  }
}

async function loadPreDeploySnapshotYaml(namespace: string): Promise<string | null> {
  let history: Awaited<ReturnType<typeof getHistory>> = [];
  try {
    history = await getHistory(namespace);
  } catch {
    return null;
  }
  const previous = history[1];
  if (!previous) return null;
  try {
    const entry = await getSnapshot(namespace, previous.id);
    return entry?.content ?? null;
  } catch {
    return null;
  }
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new HandlerError(499, 'Deploy cancelled');
  }
}

function emit(opts: DeployOptions, event: Omit<DeployProgressEvent, 'cancelRequested'>): void {
  if (!opts.onProgress) return;
  opts.onProgress({
    ...event,
    cancelRequested: !!opts.signal?.aborted,
  });
}

// ── Entry point ───────────────────────────────────────────────────────

/**
 * Run the deploy handler. Throws `HandlerError` on validation failures
 * (400/403/404) and on pre-apply cancellation (499). Post-apply
 * problems are surfaced via the response envelope (Deployed=false +
 * DeployError + warning), preserving compatibility with the existing
 * Next.js route's response shape.
 *
 * Concurrency: Wrapped in a per-namespace mutex so two concurrent
 * deploys for the same name serialize rather than race on apply +
 * pre-deploy.json. Different namespaces still run in parallel.
 */
export async function runDeploy(
  req: DeployRequest,
  opts: DeployOptions = {},
): Promise<DeployResponse> {
  if (!req.name) {
    throw new HandlerError(400, 'name is required');
  }
  // Preflight: refuse to start a deploy/audit job if the OSConfig CLI
  // isn't installed. Without this the user gets deep into the deploy
  // state machine, sees a phase emit "Auditing N resources…", and
  // then a raw spawn error. cliRequiredError gives the renderer a
  // typed signal (status:412, code:'CLI_REQUIRED') so the install
  // modal can open instead of a toast.
  try {
    resolveOscfgBinary();
  } catch {
    throw cliRequiredError(
      'Install OSConfig and use "Recheck" to enable deploy/audit on this device.',
    );
  }
  const namespace = sanitizeNamespace(req.name);
  return withDeployLock(namespace, () => runDeployInner(req, opts, namespace));
}

async function runDeployInner(
  req: DeployRequest,
  opts: DeployOptions,
  namespace: string,
): Promise<DeployResponse> {
  const mode: 'audit' | 'enforce' = req.mode ?? 'enforce';
  const hostname = process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'localhost';
  // Capture the registration revision once before either audit path starts.
  // If the source is saved while work is in flight, the persisted audit keeps
  // this older revision and list/get correctly ignore it.
  const registrationSnapshot = await getRegistrationSnapshot(namespace);
  const reg = registrationSnapshot?.registration ?? null;
  const sourceYaml = registrationSnapshot?.sourceYaml ?? null;

  // ── AUDIT path ────────────────────────────────────────────────────
  if (mode === 'audit') {
    const phaseCount = 3;
    emit(opts, {
      phase: 'validate',
      phaseIndex: 1,
      phaseCount,
      message: `Validating "${req.name}"…`,
      cancellable: true,
    });
    checkCancelled(opts.signal);

    const host = process.platform === 'win32' ? 'windows' : 'linux';
    if (reg && reg.platform !== 'cross-platform') {
      if (reg.platform === 'mixed') {
        throw new HandlerError(
          400,
          'This manifest mixes Windows and Linux resources. Split it into per-platform manifests before auditing.',
        );
      }
      if (reg.platform !== host) {
        throw new HandlerError(
          400,
          `This manifest targets ${reg.platform}, but this host is ${host}. Audit on a ${reg.platform} machine instead.`,
        );
      }
    }

    const desired = loadDesiredFromSource(sourceYaml);
    if (!desired) {
      throw new HandlerError(
        404,
        reg
          ? `"${req.name}" is registered but its source YAML isn't readable. Re-register the manifest and try again.`
          : `Audit failed — "${req.name}" is not registered on this device. Register it first.`,
      );
    }
    if (desired.length === 0) {
      throw new HandlerError(
        400,
        `"${req.name}" has no resources to audit. Add at least one resource to the manifest before auditing.`,
      );
    }

    checkCancelled(opts.signal);
    emit(opts, {
      phase: 'audit',
      phaseIndex: 2,
      phaseCount,
      message: `Auditing ${desired.length} resources…`,
      resourcesCompleted: 0,
      resourcesTotal: desired.length,
      cancellable: true,
    });

    const bulk = await getResources({ namespace });
    const bulkResources = bulk.success ? (bulk.data ?? []) : null;
    const audit = await auditResources(desired, bulkResources, {
      signal: opts.signal,
      onProgress: (completed, total) =>
        emit(opts, {
          phase: 'audit',
          phaseIndex: 2,
          phaseCount,
          message: `Auditing ${completed} of ${total} resources…`,
          resourcesCompleted: completed,
          resourcesTotal: total,
          cancellable: true,
        }),
    });

    if (audit.cancelled) {
      // Audit mode is fully cancellable — don't return a half-baked
      // response, throw 499 so the caller knows nothing was committed
      // (and there's no commit to roll back; this is read-only).
      throw new HandlerError(499, 'Audit cancelled');
    }

    const counts = summarizeCompliance(audit.results);
    const ui = toUiResources(audit.results);

    let warning: string | undefined;
    const bulkFailed = !bulk.success;
    const bulkEmpty = bulk.success && (bulk.data?.length ?? 0) === 0;
    if (audit.fallbackErrors > 0) {
      warning =
        `Audit partial — ${audit.fallbackErrors} of ${desired.length} resources could not be read from the device` +
        (bulk.error ? ` (${bulk.error})` : '') +
        (audit.fallbackRetries > 0
          ? ` (${audit.fallbackRetries} resources required a retry)`
          : '') +
        `. Those resources are reported as "could not read" until they can be audited.`;
    } else if (audit.fallbackRetries > 0) {
      warning =
        `Audit completed cleanly, but ${audit.fallbackRetries} resources required a retry due to transient CLI errors. ` +
        `If you see this regularly, lower CONFIGFORGE_AUDIT_CONCURRENCY (default: 4).`;
    } else if (bulkFailed) {
      warning = `The bulk audit call errored (${bulk.error ?? 'unknown CLI error'}); compliance was computed per-resource instead. Results are accurate but one or more CLI providers reported errors.`;
    } else if (bulkEmpty) {
      warning = reg?.lastAppliedAt
        ? `The CLI returned no resources for this namespace even though it was previously applied. Compliance was computed per-resource directly against the device.`
        : `"${req.name}" is registered but has not been deployed on this device. Compliance was computed by reading each resource directly — deploy (enforce) to bring the device into the desired state.`;
    }

    emit(opts, {
      phase: 'finalize',
      phaseIndex: 3,
      phaseCount,
      message: 'Finalising audit…',
      cancellable: false,
    });

    updateRegistration(
      namespace,
      { lastAuditedAt: new Date().toISOString() },
      { expectedRevision: reg?.revision ?? null },
    ).catch((err) => {
      console.warn(`[deploy] failed to persist registration metadata for ${namespace}:`, err);
    });

    const totalCounted =
      counts.compliant + counts.noncompliant + counts.indeterminate + counts.errors;

    const auditResponse: DeployResponse = {
      message:
        totalCounted === 0
          ? `Audit failed for "${req.name}" on ${hostname}`
          : `Audited "${req.name}" on ${hostname}`,
      warning,
      cancelRequested: !!opts.signal?.aborted,
      cancelled: false,
      data: {
        Name: namespace,
        Deployed: !!reg?.lastAppliedAt,
        Hostname: hostname,
        Timestamp: new Date().toISOString(),
        TotalResources: ui.length,
        Compliant: counts.compliant,
        NonCompliant: counts.noncompliant,
        Indeterminate: counts.indeterminate,
        Errors: counts.errors,
        Resources: ui,
        DeployMethod: 'Manifest',
        DeployMode: 'audit' as const,
        AuditIncomplete: audit.fallbackErrors > 0,
        AuditRetries: audit.fallbackRetries,
        FallbackUsed: audit.fallbackUsed,
      },
    };

    // v0.1.6: persist the audit result so the audit pack PDF can
    // pick up the user's most recent device-side audit instead of
    // only the on-demand CIS-vs-user re-comparison. Best-effort —
    // never blocks the response.
    await writeAuditResult(namespace, 'audit', auditResponse.data, reg?.revision);
    _clearManifestsListCache();

    return auditResponse;
  }

  // ── ENFORCE path ──────────────────────────────────────────────────
  const phaseCount = 5;
  emit(opts, {
    phase: 'validate',
    phaseIndex: 1,
    phaseCount,
    message: `Validating "${req.name}"…`,
    cancellable: true,
  });
  checkCancelled(opts.signal);

  // Admin pre-check.
  try {
    const sys = await getSystemInfo();
    if (!sys.isAdmin) {
      throw new HandlerError(
        403,
        process.platform === 'win32'
          ? 'Administrator privileges are required to deploy manifests. Please run ConfigForge as Administrator.'
          : 'Root privileges are required to deploy manifests. Please run ConfigForge with sudo.',
      );
    }
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    // best-effort; if probe fails for non-handler reasons, let CLI surface the error
  }

  if (!sourceYaml) {
    throw new HandlerError(
      404,
      `No source YAML found for "${req.name}". Register the manifest first (POST /api/manifests with content or uri), then deploy.`,
    );
  }

  const parsed = parseYamlDocument(sourceYaml);
  const resources = (parsed as Record<string, unknown>).resources ?? [];
  if (hasMixedPlatformResources(resources as unknown[])) {
    throw new HandlerError(400, 'Manifest mixes Windows and Linux resource types');
  }
  const platform = platformFromProcess();
  const errs = validateManifestPlatform(resources as unknown[], platform);
  if (errs.length) {
    throw new HandlerError(
      400,
      `Manifest targets a different platform than this machine (${platform}):\n${errs.join('\n')}`,
    );
  }

  // Last chance to bail out before we touch the device.
  checkCancelled(opts.signal);

  const snapshotYaml = await loadPreDeploySnapshotYaml(namespace);

  // ── PRE-APPLY SNAPSHOT (H8) ───────────────────────────────────────
  // Write the pre-deploy snapshot BEFORE applyManifest so that if apply
  // partially succeeds and the user later wants to revert, the snapshot
  // file is guaranteed to exist. Previously the snapshot write happened
  // AFTER apply with errors swallowed, which meant a write failure left
  // the user unable to restore their prior YAML — revert would fall
  // through to delete-namespace. Fail-fast on write errors: better to
  // refuse the deploy than to apply something the user can't revert.
  emit(opts, {
    phase: 'snapshot',
    phaseIndex: 2,
    phaseCount,
    message: 'Saving pre-deploy snapshot for revert…',
    cancellable: true,
  });
  try {
    await ensureSnapshotDir();
    const snapshotBody = JSON.stringify(
      {
        name: namespace,
        displayName: req.name,
        method: 'manifest',
        mode,
        timestamp: new Date().toISOString(),
        ...(snapshotYaml ? { manifestYaml: snapshotYaml } : {}),
      },
      null,
      2,
    );
    const snapshotDir = getSnapshotDir();
    // Latest-pointer file (unchanged — revert handler reads this).
    await writeFile(path.join(snapshotDir, `${namespace}.pre-deploy.json`), snapshotBody, 'utf-8');
    // v0.3.1 (#2): also write a timestamped copy so the user retains
    // multiple revert levels. Filename collides only at sub-second
    // granularity — extraordinarily unlikely in practice, and even
    // then the second write just overwrites the first. The latest-
    // pointer above always reflects the most recent state, so revert
    // semantics are unchanged. Future UI can surface the timestamped
    // copies for "revert to which version?" choice.
    const isoStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const timestampedPath = path.join(snapshotDir, `${namespace}.pre-deploy-${isoStamp}.json`);
    await writeFile(timestampedPath, snapshotBody, 'utf-8').catch((err) => {
      // Not fatal — the latest-pointer above is the authoritative one
      // for revert. Log and continue.
      console.warn(
        `[deploy] timestamped snapshot write failed for ${namespace}:`,
        err instanceof Error ? err.message : err,
      );
    });
    // v0.3.1 (#2): prune timestamped copies beyond the retention
    // count. The latest-pointer file is excluded from pruning.
    void (async () => {
      try {
        const { resolveSnapshotRetention } = await import('./settings');
        const retention = await resolveSnapshotRetention();
        const { readdir, rm, stat } = await import('node:fs/promises');
        const entries = await readdir(snapshotDir).catch(() => [] as string[]);
        const prefix = `${namespace}.pre-deploy-`;
        const suffix = '.json';
        const matching: { name: string; mtime: number }[] = [];
        for (const name of entries) {
          if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
          if (name === `${namespace}.pre-deploy.json`) continue;
          try {
            const s = await stat(path.join(snapshotDir, name));
            matching.push({ name, mtime: s.mtimeMs });
          } catch {
            /* race */
          }
        }
        matching.sort((a, b) => b.mtime - a.mtime); // newest first
        const stale = matching.slice(retention);
        for (const f of stale) {
          await rm(path.join(snapshotDir, f.name), { force: true }).catch(() => {});
        }
      } catch (err) {
        console.warn(
          `[deploy] snapshot rotation prune failed for ${namespace}:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[deploy] aborting deploy of "${namespace}" — pre-deploy snapshot write failed: ${msg}`,
    );
    throw new HandlerError(
      500,
      `Aborted before applying "${req.name}": pre-deploy snapshot write failed (${msg}). ` +
        `Refusing to apply the manifest because revert would have nothing to roll back to.`,
    );
  }

  // v0.3.1 (#4): mid-deploy interruption sentinel. Write a marker file
  // BEFORE applyManifest so we can detect an interrupted enforce on
  // the next app startup (process killed, power loss, OOM). Removed
  // in the finalize block whether the deploy succeeds OR fails — the
  // only state we care about is "deploy was actively running when
  // the app died." A surviving sentinel means the device may be in a
  // partially-applied state and the dashboard banner should prompt
  // for audit/revert.
  const sentinelPath = path.join(getSnapshotDir(), `${namespace}.deploy-in-progress`);
  if (mode === 'enforce') {
    try {
      await writeFile(
        sentinelPath,
        JSON.stringify({
          namespace,
          displayName: req.name,
          startedAt: new Date().toISOString(),
        }),
        'utf-8',
      );
    } catch (err) {
      // Not fatal — sentinel is a recovery aid, not a precondition.
      console.warn(
        `[deploy] could not write in-progress sentinel for ${namespace}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Snapshot is durable — last cancel check before the device mutation.
  checkCancelled(opts.signal);

  emit(opts, {
    phase: 'apply',
    phaseIndex: 3,
    phaseCount,
    message: `Applying "${req.name}" to ${hostname}…`,
    cancellable: false,
  });

  // ── COMMIT SECTION (non-cancellable) ──────────────────────────────
  let deployed = false;
  let deployError: string | null = null;
  const applyResult = await applyManifest({ content: sourceYaml, namespace });
  if (!applyResult.success) {
    deployError = applyResult.error;
    const check = await getResources({ namespace });
    if (check.success && (check.data?.length ?? 0) > 0) deployed = true;
  } else {
    deployed = true;
  }

  // Post-apply: cancellation can be REQUESTED but cannot ABORT — we
  // commit the audit + finalize phases so the on-disk and on-device
  // state stay consistent.
  const desired = extractResourcesFull(resources as unknown[]);

  emit(opts, {
    phase: 'audit',
    phaseIndex: 4,
    phaseCount,
    message: `Auditing ${desired.length} resources…`,
    resourcesCompleted: 0,
    resourcesTotal: desired.length,
    cancellable: false,
  });

  const statusResult = await getResources({ namespace });
  const bulkResources = statusResult.success ? (statusResult.data ?? []) : null;
  const audit = await auditResources(desired, bulkResources, {
    signal: opts.signal,
    onProgress: (completed, total) =>
      emit(opts, {
        phase: 'audit',
        phaseIndex: 4,
        phaseCount,
        message: `Auditing ${completed} of ${total} resources…`,
        resourcesCompleted: completed,
        resourcesTotal: total,
        cancellable: false,
      }),
  });
  const counts = summarizeCompliance(audit.results);
  const ui = toUiResources(audit.results);

  if (deployed) {
    const now = new Date().toISOString();
    const patch: Parameters<typeof updateRegistration>[1] = {
      lastAppliedAt: now,
      lastAuditedAt: now,
    };
    const src = extractResourceSummary(resources as unknown[]);
    if (src.length) patch.resourceSummary = src;
    const mfPlatform = detectManifestPlatform(resources as unknown[]);
    if (mfPlatform) patch.platform = mfPlatform;
    updateRegistration(namespace, patch, {
      expectedRevision: reg?.revision ?? null,
    }).catch((err) => {
      console.warn(`[deploy] failed to persist registration metadata for ${namespace}:`, err);
    });
  }

  emit(opts, {
    phase: 'finalize',
    phaseIndex: 5,
    phaseCount,
    message: 'Finalising deploy…',
    cancellable: false,
  });

  // v0.3.1 (#4): clear the in-progress sentinel. Whether the apply
  // succeeded or failed, we've reached a settled state — the only
  // case the sentinel survives is a hard process death, which is
  // exactly what the startup banner detects.
  if (mode === 'enforce') {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(sentinelPath);
    } catch {
      /* sentinel may not exist; ignore */
    }
  }

  let warning: string | undefined;
  if (audit.fallbackErrors > 0) {
    warning =
      `Deploy completed but ${audit.fallbackErrors} of ${desired.length} resources could not be verified` +
      (statusResult.error ? ` (${statusResult.error})` : '') +
      (audit.fallbackRetries > 0 ? ` (${audit.fallbackRetries} required a retry)` : '') +
      `. Those are reported as "could not read" until they can be audited.`;
  } else if (opts.signal?.aborted) {
    warning =
      'Deploy completed before cancellation could take effect. Audit results are based on what was reachable before cancellation.';
  }

  const enforceResponse: DeployResponse = {
    message: deployed
      ? `Manifest "${req.name}" enforced on ${hostname}${deployError ? ' (with warnings)' : ''}`
      : `Deployment failed: ${deployError ?? 'unknown error'}`,
    warning,
    cancelRequested: !!opts.signal?.aborted,
    cancelled: false,
    data: {
      Name: namespace,
      Deployed: deployed,
      DeployError: deployError,
      Hostname: hostname,
      Timestamp: new Date().toISOString(),
      TotalResources: ui.length,
      Compliant: counts.compliant,
      NonCompliant: counts.noncompliant,
      Indeterminate: counts.indeterminate,
      Errors: counts.errors,
      Resources: ui,
      DeployMethod: 'Manifest',
      DeployMode: mode,
      AuditIncomplete: audit.fallbackErrors > 0,
      AuditRetries: audit.fallbackRetries,
    },
  };

  // v0.1.6: same persistence as the audit-only path. The post-apply
  // audit phase produced authoritative device-side compliance state;
  // cache it so the audit pack PDF + the renderer "last audited"
  // badge can read it.
  await writeAuditResult(namespace, 'enforce', enforceResponse.data, reg?.revision);
  _clearManifestsListCache();

  return enforceResponse;
}
