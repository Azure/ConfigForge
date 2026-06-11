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

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export interface ManifestRegistration {
  namespace: string;
  displayName: string;
  platform: 'windows' | 'linux' | 'cross-platform' | 'mixed';
  registeredAt: string;
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
 * Per-namespace mutex map. Serializes concurrent saveRegistration /
 * updateRegistration calls for the same namespace within a single Node
 * process so two parallel writers can't interleave their .json/.yaml
 * pairs. Cross-process coordination is out of scope (registry is local
 * to one Node server) but the temp+rename protocol below is itself
 * crash-safe even without locking.
 */
const namespaceLocks = new Map<string, Promise<void>>();

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
    return await fn();
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

export async function deleteRegistration(namespace: string): Promise<void> {
  return withNamespaceLock(namespace, async () => {
    const root = getRoot();
    for (const suffix of ['.json', '.source.yaml']) {
      try {
        await unlink(join(root, `${namespace}${suffix}`));
      } catch {
        // best-effort
      }
    }
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
): Promise<ManifestRegistration | null> {
  return withNamespaceLock(namespace, async () => {
    const existing = await getRegistration(namespace);
    if (!existing) return null;
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
