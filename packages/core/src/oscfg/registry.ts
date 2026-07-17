// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Registration metadata — ConfigForge's side-store of manifest information
 * that oscfg itself doesn't track (original source YAML, display name,
 * registration timestamp, platform). Files live at
 *   <root>/manifests/<namespace>.json
 *   <root>/manifests/<namespace>.source.yaml
 * where <root> defaults to ~/.configforge but can be overridden with the
 * `CONFIGFORGE_HOME` env var (matches the convention used by history /
 * snapshots / etc.). PR18: the two-file write is now atomic — see
 * `saveRegistration` for the temp-file + rename protocol.
 */

import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'fs/promises';
import type { Stats } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';

export interface ManifestRegistration {
  namespace: string;
  displayName: string;
  platform: 'windows' | 'linux' | 'cross-platform' | 'mixed';
  /** Original registration timestamp. Older records use this as modifiedAt too. */
  registeredAt: string;
  /** Timestamp of the most recent content registration/save. */
  modifiedAt?: string;
  /**
   * Opaque content-registration identity. It changes even when an identical
   * source is saved so audit results can be tied to the exact registration
   * revision without relying only on wall-clock ordering.
   */
  revision?: string;
  source: 'user' | 'library' | 'import';
  sourceId?: string;
  /** Flat {name,type} list captured at register/edit time for fast list rendering. */
  resourceSummary?: Array<{ name: string; type: string }>;
  /**
   * Validation summary captured at register/edit time so the validation page
   * doesn't need to re-parse source YAML on every list call. Optional for
   * back-compat with pre-PR9 registrations — the list endpoint falls back
   * to recomputing from source when this is missing.
   */
  validationSummary?: {
    hasSchema: boolean;
    hasEnforcementValues: boolean;
    hasComplianceCriteria: boolean;
    issues: string[];
  };
  /** ISO timestamp of the last successful `oscfg apply` for this namespace. */
  lastAppliedAt?: string;
  /** ISO timestamp of the last successful `oscfg get resource` read. */
  lastAuditedAt?: string;
}

export interface RegistrationRecoveryBackup {
  namespace: string;
  displayName: string;
  sourceYaml: string;
  source: ManifestRegistration['source'];
  sourceId?: string;
}

export interface DeleteRegistrationOptions {
  requireRecovery?: boolean;
  /**
   * Runs after the registry files are removed but before the namespace lock
   * is released. Keep this callback bounded and catch non-fatal cleanup
   * failures inside it.
   */
  afterDeleteWhileLocked?: () => Promise<void>;
}

export interface DeleteRegistrationResult {
  removed: boolean;
  recovery: RegistrationRecoveryBackup | null;
}

export interface RegistrationSnapshot {
  registration: ManifestRegistration;
  sourceYaml: string | null;
}

/**
 * Root directory for registration files. Reads `CONFIGFORGE_HOME` at call
 * time so tests can relocate the store with `process.env.CONFIGFORGE_HOME`
 * the same way they do for history/snapshots.
 */
function getRoot(): string {
  const home = process.env.CONFIGFORGE_HOME;
  return home ? join(home, 'manifests') : join(homedir(), '.configforge', 'manifests');
}

async function ensureRoot(): Promise<string> {
  const root = getRoot();
  await mkdir(root, { recursive: true });
  return root;
}

/**
 * Per-namespace mutex map. Serializes callers within this Node process.
 * `withNamespaceLock` also takes an exclusive lock file so a second running
 * ConfigForge instance cannot interleave registration mutations.
 */
const namespaceLocks = new Map<string, Promise<void>>();
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_MAX_AGE_MS = 5 * 60_000;
const LOCK_HEARTBEAT_MS = 30_000;
const LOCK_RELEASE_RETRIES = 5;
const activeLockOwners = new Set<string>();
const abandonedLocalLockOwners = new Set<string>();

interface LockState {
  age: number;
  fileIdentity: string;
  identity: string;
  owner: string | null;
  pid: number | null;
  recordReadable: boolean;
}

function lockFileIdentity(info: Stats): string {
  return `${info.dev}-${info.ino}-${Math.trunc(info.birthtimeMs)}`;
}

function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 does not terminate the process; it only checks existence.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function readLockState(lockPath: string): Promise<LockState | null> {
  let handle;
  try {
    handle = await open(lockPath, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let info: Awaited<ReturnType<typeof stat>>;
  let raw: string | null = null;
  try {
    info = await handle.stat();
    raw = await handle.readFile('utf-8').catch(() => null);
  } finally {
    await handle.close().catch(() => {});
  }

  let owner: string | null = null;
  let ownerPid: number | null = null;
  let recordReadable = false;
  try {
    const parsed = JSON.parse(raw ?? '') as {
      owner?: unknown;
      pid?: unknown;
    };
    recordReadable = true;
    if (typeof parsed.owner === 'string' && parsed.owner) {
      owner = parsed.owner;
    }
    if (typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0) {
      ownerPid = parsed.pid;
    }
  } catch {
    // A process can crash between exclusive create and writing its owner
    // record. Only age-based cleanup is safe for that incomplete lock.
  }
  return {
    age: Date.now() - info.mtimeMs,
    fileIdentity: lockFileIdentity(info),
    identity: owner ?? `unowned-${info.ino}-${info.size}-${Math.trunc(info.mtimeMs)}`,
    owner,
    pid: ownerPid,
    recordReadable,
  };
}

function lockIdentityHash(identity: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function abandonmentMarkerPath(lockPath: string): string {
  return `${lockPath}.abandoned`;
}

async function hasPersistedAbandonment(lockPath: string, state: LockState): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(abandonmentMarkerPath(lockPath), 'utf-8')) as {
      fileIdentity?: unknown;
      owner?: unknown;
    };
    if (parsed.fileIdentity !== state.fileIdentity) return false;
    return (
      !state.recordReadable || (typeof parsed.owner === 'string' && parsed.owner === state.owner)
    );
  } catch {
    return false;
  }
}

async function isAbandonedLock(lockPath: string, state: LockState): Promise<boolean> {
  if (state.owner !== null && activeLockOwners.has(state.owner)) {
    return false;
  }
  if (
    state.owner !== null &&
    abandonedLocalLockOwners.has(state.owner) &&
    !activeLockOwners.has(state.owner)
  ) {
    return true;
  }
  if (await hasPersistedAbandonment(lockPath, state)) return true;
  if (state.age >= LOCK_MAX_AGE_MS) return true;
  if (state.pid !== null) return !isProcessRunning(state.pid);
  return false;
}

interface ReaperElection {
  close: () => Promise<void>;
  directory: string;
  generation: number;
  prefix: string;
}

async function readReaperOwner(path: string): Promise<{
  age: number;
  observed: string | null;
  pid: number | null;
}> {
  const info = await stat(path);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as {
      observed?: unknown;
      pid?: unknown;
    };
    return {
      age: Date.now() - info.mtimeMs,
      observed: typeof parsed.observed === 'string' ? parsed.observed : null,
      pid:
        typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0
          ? parsed.pid
          : null,
    };
  } catch {
    return {
      age: Date.now() - info.mtimeMs,
      observed: null,
      pid: null,
    };
  }
}

async function acquireReaperElection(
  lockPath: string,
  observedIdentity: string,
): Promise<ReaperElection | null> {
  const directory = dirname(lockPath);
  const prefix = `${basename(lockPath)}.reaper-${lockIdentityHash(observedIdentity)}-`;
  const generations = (await readdir(directory))
    .filter((name) => name.startsWith(prefix))
    .map((name) => Number.parseInt(name.slice(prefix.length), 10))
    .filter((generation) => Number.isInteger(generation) && generation >= 0)
    .sort((left, right) => left - right);
  const highest = generations.at(-1);

  if (highest !== undefined) {
    const current = await readReaperOwner(join(directory, `${prefix}${highest}`)).catch(() => null);
    if (
      current &&
      ((current.pid !== null && isProcessRunning(current.pid) && current.age < LOCK_MAX_AGE_MS) ||
        (current.pid === null && current.age < LOCK_MAX_AGE_MS))
    ) {
      return null;
    }
  }

  const generation = (highest ?? -1) + 1;
  const electionPath = join(directory, `${prefix}${generation}`);
  let election;
  try {
    election = await open(electionPath, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
  try {
    await election.writeFile(
      JSON.stringify({
        pid: process.pid,
        observed: observedIdentity,
        createdAt: new Date().toISOString(),
      }),
      'utf-8',
    );
  } catch (err) {
    await election.close().catch(() => {});
    await unlink(electionPath).catch(() => {});
    throw err;
  }
  return {
    close: () => election.close(),
    directory,
    generation,
    prefix,
  };
}

async function isLatestReaperElection(election: ReaperElection): Promise<boolean> {
  const generations = (await readdir(election.directory))
    .filter((name) => name.startsWith(election.prefix))
    .map((name) => Number.parseInt(name.slice(election.prefix.length), 10))
    .filter((generation) => Number.isInteger(generation) && generation >= 0);
  return Math.max(-1, ...generations) === election.generation;
}

async function cleanupReaperElections(election: ReaperElection): Promise<void> {
  await election.close().catch(() => {});
  const names = await readdir(election.directory).catch(() => []);
  await Promise.all(
    names
      .filter((name) => name.startsWith(election.prefix))
      .filter((name) => {
        const generation = Number.parseInt(name.slice(election.prefix.length), 10);
        return Number.isInteger(generation) && generation <= election.generation;
      })
      .map((name) => unlink(join(election.directory, name)).catch(() => {})),
  );
}

/**
 * Reclaim an abandoned canonical lock through a per-identity reaper election.
 * Election generations are append-only: if a reaper crashes, a later process
 * creates the next generation instead of deleting/replacing its election.
 * This keeps stale-election recovery identity-safe.
 *
 * @internal Exported for the cross-process race regression test.
 */
export async function _removeAbandonedRegistrationLock(lockPath: string): Promise<boolean> {
  const observed = await readLockState(lockPath);
  if (!observed) return true;
  if (!(await isAbandonedLock(lockPath, observed))) return false;

  const election = await acquireReaperElection(lockPath, observed.identity);
  if (!election) return false;
  try {
    if (!(await isLatestReaperElection(election))) return false;
    const current = await readLockState(lockPath);
    if (!current) return true;
    if (current.identity !== observed.identity || current.fileIdentity !== observed.fileIdentity) {
      return false;
    }
    if (!(await isAbandonedLock(lockPath, current))) return false;
    if (!(await isLatestReaperElection(election))) return false;
    try {
      await unlink(lockPath);
      if (current.owner) abandonedLocalLockOwners.delete(current.owner);
      await unlink(abandonmentMarkerPath(lockPath)).catch(() => {});
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT';
    }
  } finally {
    await cleanupReaperElections(election);
  }
}

async function releaseOwnedLock(
  lockPath: string,
  owner: string,
  fileIdentity: string,
  close: () => Promise<void>,
): Promise<void> {
  await close().catch(() => {});
  activeLockOwners.delete(owner);

  for (let attempt = 0; attempt < LOCK_RELEASE_RETRIES; attempt += 1) {
    try {
      const current = await readLockState(lockPath);
      if (!current) {
        abandonedLocalLockOwners.delete(owner);
        return;
      }
      if (!current.recordReadable || current.owner === null) {
        throw new Error('manifest namespace lock record is temporarily unreadable');
      }
      if (current.owner !== owner) {
        abandonedLocalLockOwners.delete(owner);
        return;
      }
      await unlink(lockPath);
      abandonedLocalLockOwners.delete(owner);
      await unlink(abandonmentMarkerPath(lockPath)).catch(() => {});
      return;
    } catch {
      if (attempt + 1 < LOCK_RELEASE_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  }

  abandonedLocalLockOwners.add(owner);
  let markerPersisted = false;
  try {
    await writeFile(
      abandonmentMarkerPath(lockPath),
      JSON.stringify({
        fileIdentity,
        owner,
        abandonedAt: new Date().toISOString(),
      }),
      'utf-8',
    );
    markerPersisted = true;
  } catch {
    // The warning below surfaces both lock-release and marker failures.
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[registry] Failed to release manifest namespace lock owned by ${owner}; ` +
      (markerPersisted
        ? 'an abandonment marker was persisted for safe recovery.'
        : 'automatic recovery could not be persisted.'),
  );
}

async function cleanupFailedLockAcquisition(
  lockPath: string,
  owner: string,
  ownedFileIdentity: string | null,
  close: () => Promise<void>,
): Promise<void> {
  await close().catch(() => {});
  activeLockOwners.delete(owner);
  abandonedLocalLockOwners.delete(owner);

  let stillOwned = false;
  try {
    const current = await readLockState(lockPath);
    if (!current) return;
    stillOwned =
      current.owner === owner ||
      (ownedFileIdentity !== null && current.fileIdentity === ownedFileIdentity);
  } catch {
    // A verification read may be the operation that failed. Fall back to file
    // identity from stat rather than either leaking the lock or unlinking a
    // replacement created by another process.
    try {
      stillOwned = lockFileIdentity(await stat(lockPath)) === ownedFileIdentity;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      return;
    }
  }

  if (!stillOwned) return;
  await unlink(lockPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  });
  await unlink(abandonmentMarkerPath(lockPath)).catch(() => {});
}

async function acquireCrossProcessLock(namespace: string): Promise<() => Promise<void>> {
  const root = await ensureRoot();
  const lockPath = join(root, `${namespace}.lock`);
  const startedAt = Date.now();

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const lockRecord = JSON.stringify({
        pid: process.pid,
        owner,
        createdAt: new Date().toISOString(),
      });
      let ownedFileIdentity: string | null = null;
      try {
        ownedFileIdentity = lockFileIdentity(await handle.stat());
        await handle.writeFile(lockRecord, 'utf-8');
        const state = await readLockState(lockPath);
        if (!state || state.owner !== owner || state.fileIdentity !== ownedFileIdentity) {
          throw new Error(`Manifest namespace lock "${namespace}" changed during acquisition`);
        }
        activeLockOwners.add(owner);
        const heartbeat = setInterval(() => {
          const now = new Date();
          void utimes(lockPath, now, now).catch(() => {});
        }, LOCK_HEARTBEAT_MS);
        heartbeat.unref();
        return () =>
          releaseOwnedLock(lockPath, owner, state.fileIdentity, async () => {
            clearInterval(heartbeat);
            await handle.close();
          });
      } catch (err) {
        if (!ownedFileIdentity) {
          // If the first fstat failed, persist the unique owner token while
          // the exclusive-create handle is still open. Cleanup can then
          // identify this file without risking a concurrently replaced lock.
          await handle.writeFile(lockRecord, 'utf-8').catch(() => {});
        }
        await cleanupFailedLockAcquisition(lockPath, owner, ownedFileIdentity, () =>
          handle.close(),
        );
        throw err;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (await _removeAbandonedRegistrationLock(lockPath)) continue;
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for manifest namespace lock "${namespace}"`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function withNamespaceLock<T>(ns: string, fn: () => Promise<T>): Promise<T> {
  const previous = namespaceLocks.get(ns) ?? Promise.resolve();
  let release!: () => void;
  const myTurn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const myEntry: Promise<void> = previous.then(() => myTurn);
  namespaceLocks.set(ns, myEntry);
  try {
    await previous;
    const releaseCrossProcessLock = await acquireCrossProcessLock(ns);
    try {
      return await fn();
    } finally {
      await releaseCrossProcessLock();
    }
  } finally {
    release();
    // If no one chained behind us, drop the entry so the map stays bounded.
    if (namespaceLocks.get(ns) === myEntry) {
      namespaceLocks.delete(ns);
    }
  }
}

/**
 * Write `content` to `dest` atomically: write to a temp sibling first,
 * fsync-via-rename onto the final path. On POSIX this is atomic; on
 * Windows `rename` is implemented as MoveFileEx which is atomic for
 * same-volume renames (which this always is — same parent directory).
 */
async function atomicWrite(dest: string, content: string): Promise<void> {
  // Make the temp name unpredictable enough to survive concurrent writers
  // chaining through the lock above (in case the mutex is bypassed by an
  // external process touching the same dir).
  const tmp = `${dest}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  try {
    await rename(tmp, dest);
  } catch (err) {
    // Best-effort cleanup of the orphaned temp on rename failure.
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Persist a registration's metadata + source YAML. The two files MUST stay
 * in lockstep — both describe the same manifest revision. PR18 protocol:
 *
 *   1. Write `<ns>.source.yaml.<rand>.tmp` → rename → `<ns>.source.yaml`
 *   2. Write `<ns>.json.<rand>.tmp` → rename → `<ns>.json`  (commit marker)
 *
 * If we crash between step 1 and step 2, the YAML is updated but the
 * JSON still points at the previous revision. That's fine for readers
 * (they key off the JSON). The next successful `saveRegistration`
 * overwrites the orphaned YAML.
 *
 * If we crash mid-rename, the temp file may be left behind. It will be
 * cleaned up by the next call (rename is idempotent — a fresh temp
 * suffix is generated each time) or, worst case, sits as a `.tmp`
 * sibling that `listRegistrations` ignores (it filters on `.json`).
 */
export async function saveRegistration(
  reg: ManifestRegistration,
  yamlContent: string,
): Promise<void> {
  const ns = reg.namespace;
  return withNamespaceLock(ns, async () => {
    const root = await ensureRoot();
    const jsonPath = join(root, `${ns}.json`);
    const yamlPath = join(root, `${ns}.source.yaml`);
    // Order matters: YAML first (so on-disk yaml is at-least-as-new as json),
    // JSON last (it's the commit marker that readers key off).
    await atomicWrite(yamlPath, yamlContent);
    await atomicWrite(jsonPath, JSON.stringify(reg, null, 2));
  });
}

/**
 * Persist a registration only when its namespace is still absent.
 *
 * Undo uses this stricter create-only operation instead of
 * `saveRegistration`, whose normal edit semantics intentionally overwrite.
 * The existence check and both writes run under the same per-namespace lock
 * used by save/update/delete, so a concurrent registration in this process
 * either wins first (and this returns false without touching it) or runs
 * after this complete registration has committed.
 */
export async function saveRegistrationIfAbsent(
  reg: ManifestRegistration,
  yamlContent: string,
): Promise<boolean> {
  const ns = reg.namespace;
  return withNamespaceLock(ns, async () => {
    const root = await ensureRoot();
    const jsonPath = join(root, `${ns}.json`);
    const yamlPath = join(root, `${ns}.source.yaml`);
    try {
      await stat(jsonPath);
      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    await atomicWrite(yamlPath, yamlContent);
    await atomicWrite(jsonPath, JSON.stringify(reg, null, 2));
    return true;
  });
}

export async function getRegistration(namespace: string): Promise<ManifestRegistration | null> {
  try {
    const raw = await readFile(join(getRoot(), `${namespace}.json`), 'utf-8');
    return JSON.parse(raw) as ManifestRegistration;
  } catch {
    return null;
  }
}

export async function getRegistrationSource(namespace: string): Promise<string | null> {
  try {
    return await readFile(join(getRoot(), `${namespace}.source.yaml`), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read registration metadata and source from one committed revision.
 * Saving and deleting use the same namespace lock, so callers never observe
 * metadata from one revision paired with another revision's YAML.
 */
export async function getRegistrationSnapshot(
  namespace: string,
): Promise<RegistrationSnapshot | null> {
  return withNamespaceLock(namespace, async () => {
    const registration = await getRegistration(namespace);
    if (!registration) return null;
    return {
      registration,
      sourceYaml: await getRegistrationSource(namespace),
    };
  });
}

export async function deleteRegistration(
  namespace: string,
  options: DeleteRegistrationOptions = {},
): Promise<DeleteRegistrationResult> {
  return withNamespaceLock(namespace, async () => {
    const root = getRoot();
    const registration = await getRegistration(namespace);
    const sourceYaml = await getRegistrationSource(namespace);
    const recovery =
      registration && typeof sourceYaml === 'string' && sourceYaml.trim()
        ? {
            namespace,
            displayName: registration.displayName ?? namespace,
            sourceYaml,
            source: registration.source,
            ...(registration.sourceId ? { sourceId: registration.sourceId } : {}),
          }
        : null;

    if (options.requireRecovery === true && !recovery) {
      return { removed: false, recovery: null };
    }

    // The JSON metadata is the registration's commit marker. Remove it first:
    // if that unlink fails, leave the source and all downstream state intact.
    // Once it succeeds, the manifest is logically deleted and the in-memory
    // recovery payload is sufficient even if best-effort source cleanup is
    // temporarily blocked (for example by antivirus on Windows).
    let removed = false;
    try {
      await unlink(join(root, `${namespace}.json`));
      removed = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (options.requireRecovery === true) throw err;
        return { removed: false, recovery };
      }
      // If metadata was captured but disappeared before unlink completed,
      // the registration is already logically absent.
      removed = registration !== null;
    }

    try {
      await unlink(join(root, `${namespace}.source.yaml`));
      removed = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Do not turn a committed, recoverable deletion into a reported
        // failure. A later save/undo atomically replaces this orphaned source.
        // eslint-disable-next-line no-console
        console.warn(
          `[registry] Source cleanup deferred for deleted registration "${namespace}":`,
          err,
        );
      }
    }
    await options.afterDeleteWhileLocked?.();
    return { removed, recovery };
  });
}

/**
 * Patch an existing registration's metadata (timestamps, summary). No-op if
 * the namespace isn't registered — callers that need strict existence checks
 * should call `getRegistration` first. PR18: write is now atomic via
 * temp+rename, serialized with the same per-namespace lock.
 */
export async function updateRegistration(
  namespace: string,
  patch: Partial<ManifestRegistration>,
  options?: { expectedRevision?: string | null },
): Promise<ManifestRegistration | null> {
  return withNamespaceLock(namespace, async () => {
    const existing = await getRegistration(namespace);
    if (!existing) return null;
    if (
      options?.expectedRevision !== undefined &&
      (existing.revision ?? null) !== options.expectedRevision
    ) {
      return null;
    }
    const updated: ManifestRegistration = { ...existing, ...patch, namespace };
    const root = await ensureRoot();
    await atomicWrite(join(root, `${namespace}.json`), JSON.stringify(updated, null, 2));
    return updated;
  });
}

export async function listRegistrations(): Promise<ManifestRegistration[]> {
  const root = getRoot();
  try {
    await stat(root);
  } catch {
    return [];
  }
  const entries = await readdir(root);
  // Filter on `.json` exactly so leftover `.json.<rand>.tmp` files from a
  // crashed write don't surface as "registrations".
  const jsonFiles = entries.filter((f) => f.endsWith('.json') && !f.includes('.tmp'));
  const results = await Promise.all(
    jsonFiles.map(async (f) => {
      try {
        const raw = await readFile(join(root, f), 'utf-8');
        return JSON.parse(raw) as ManifestRegistration;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is ManifestRegistration => r !== null);
}
