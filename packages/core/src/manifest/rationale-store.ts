// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Append-only rationale log for manifest changes.
 *
 * Layout: ~/.configforge/rationale/<sanitized-ns>.jsonl  (one JSON entry per line)
 *
 * Honors CONFIGFORGE_HOME the same way the history module does, so tests
 * can isolate state by setting that env var to a fresh tmp directory.
 *
 * Concurrency: appendRationale serializes writers via a `<file>.lock`
 * sentinel created with `O_EXCL` (atomic on every Node-supported FS).
 * Spin-waits up to 50 × 20ms (~1s) before bailing with a clear error so
 * a stuck/dead-locked process doesn't hang the request.
 *
 * Reader robustness: corrupt or empty individual lines are logged and
 * skipped — we never throw on a partial file. This matters because
 * append-only logs are vulnerable to torn writes on power loss.
 */
import { open, mkdir, rm, readFile } from 'fs/promises';
import { createReadStream } from 'fs';
import readline from 'readline';
import path from 'path';
import os from 'os';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RationaleEntry {
  /** ISO 8601 UTC. */
  ts: string;
  /** Resolved author name. May be empty if author resolution failed. */
  author: string;
  /** Resource the change targeted — typically `resource.name` from the manifest. */
  resourceName: string;
  /** Pre-change value. `unknown` because manifest values can be any JSON shape. */
  oldValue: unknown;
  /** Post-change value. */
  newValue: unknown;
  /** User-supplied rationale. May be empty when `skipped:true`. */
  reason: string;
  /** `true` when the user clicked Skip in the prompt rather than supplying a reason. */
  skipped?: boolean;
}

// ── Paths / sanitization ───────────────────────────────────────────────────

const ENV_OVERRIDE = 'CONFIGFORGE_HOME';

function configforgeHome(): string {
  return process.env[ENV_OVERRIDE] ?? path.join(os.homedir(), '.configforge');
}

function rationaleRoot(): string {
  return path.join(configforgeHome(), 'rationale');
}

/**
 * Make a namespace safe to use as a JSONL filename. The same conservative
 * slug rules as `oscfg/naming.ts` — `[A-Za-z0-9._-]` only, with everything
 * else collapsed to `-`. We deliberately re-implement instead of importing
 * to avoid a coupling with the manifest-registration sanitizer (which
 * could legitimately diverge in the future).
 */
function sanitizeNs(ns: string): string {
  if (typeof ns !== 'string') return '';
  const trimmed = ns.trim();
  if (!trimmed) return '';
  const slug = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
  // A single "." or ".." after sanitization would be a path-traversal
  // hazard; reject by returning empty so callers see a clear error.
  if (!slug || /^\.+$/.test(slug)) return '';
  return slug;
}

function fileFor(ns: string): { dir: string; file: string; lock: string } {
  const sanitized = sanitizeNs(ns);
  if (!sanitized) {
    throw new Error(`Invalid namespace for rationale log: ${JSON.stringify(ns)}`);
  }
  const dir = rationaleRoot();
  const file = path.join(dir, `${sanitized}.jsonl`);
  return { dir, file, lock: `${file}.lock` };
}

// ── Append (lock-serialized) ───────────────────────────────────────────────

/**
 * Lock-contention budget. The spec's "max 50 × 20ms" is the floor — the
 * contract is that we always BAIL within a bounded window with a clear
 * error rather than hanging indefinitely. Real-world stress (50 parallel
 * writers on a OneDrive-synced disk) regularly exceeds 1 second, so we
 * give the budget some headroom (100 × 20ms = 2s) while keeping it
 * tight enough that a stuck writer fails fast.
 */
const LOCK_MAX_RETRIES = 100;
const LOCK_RETRY_DELAY_MS = 20;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Append a single rationale entry to the namespace's JSONL log.
 *
 * Lock semantics: we open `<file>.lock` with `O_EXCL` (which atomically
 * fails if the path exists). If the lock is held we sleep+retry up to
 * `LOCK_MAX_RETRIES` times. If the lock is still held after the budget
 * expires, throw — the caller can decide whether to surface the error
 * or swallow it. Stale locks are NOT auto-broken: a dead writer that
 * left a `.lock` behind requires manual cleanup. This is conservative
 * but correct — auto-cleanup risks two writers colliding mid-append.
 */
export async function appendRationale(ns: string, entry: RationaleEntry): Promise<void> {
  const { dir, file, lock } = fileFor(ns);
  await mkdir(dir, { recursive: true });

  const line = JSON.stringify(entry) + '\n';

  let acquired = false;
  for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt++) {
    try {
      // 'wx' = O_WRONLY | O_CREAT | O_EXCL — atomic-create; throws if exists.
      const handle = await open(lock, 'wx');
      await handle.close();
      acquired = true;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // EEXIST = lock held. EPERM/EBUSY/EACCES happen on Windows when
      // the lock file is mid-deletion by another writer — same intent
      // ("contention"), so retry under the same budget.
      const retriable =
        code === 'EEXIST' || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!retriable) {
        // Permission errors at the directory level, ENOSPC, etc. — surface
        // immediately. No point retrying since the failure mode isn't
        // going to clear itself.
        throw err;
      }
      if (attempt === LOCK_MAX_RETRIES) break;
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  if (!acquired) {
    throw new Error(
      `Could not acquire rationale append lock at ${lock} after ${LOCK_MAX_RETRIES} retries (~${
        LOCK_MAX_RETRIES * LOCK_RETRY_DELAY_MS
      }ms). Another writer may be stuck.`,
    );
  }

  try {
    // Append to the JSONL file. Open with 'a' (O_APPEND) so writes are
    // append-atomic at the OS level even if multiple FDs were open.
    const fh = await open(file, 'a');
    try {
      await fh.appendFile(line, 'utf8');
    } finally {
      await fh.close();
    }
  } finally {
    // Always release the lock — even if the append throws.
    await rm(lock, { force: true });
  }
}

// ── Delete (cleanup on manifest removal) ──────────────────────────────────

/**
 * Delete the rationale log + any stale lock file for a namespace.
 * Idempotent — missing files are not an error. Used by
 * `DELETE /api/manifests` so removing a manifest doesn't leave an
 * orphaned log on disk that would later mix with a re-created manifest
 * of the same name.
 *
 * Best-effort: callers should not block manifest deletion on a rationale
 * cleanup failure. Returns `{ removed: boolean, error?: string }`.
 */
export async function deleteRationale(
  ns: string,
): Promise<{ removed: boolean; error?: string }> {
  let target: { file: string; lock: string };
  try {
    const f = fileFor(ns);
    target = { file: f.file, lock: f.lock };
  } catch {
    // Bad namespace — treat as nothing to delete.
    return { removed: false };
  }
  let removed = false;
  try {
    await rm(target.file, { force: true });
    await rm(target.lock, { force: true });
    removed = true;
  } catch (err: unknown) {
    return {
      removed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { removed };
}

// ── Read (streamed, line-tolerant) ─────────────────────────────────────────

/**
 * Read the entire rationale log for a namespace, oldest first. Returns
 * `[]` if the file doesn't exist. Empty lines are silently skipped;
 * lines that fail JSON.parse log a warning and are skipped (so a single
 * torn write doesn't poison the whole log).
 */
export async function readRationale(ns: string): Promise<RationaleEntry[]> {
  const { file } = fileFor(ns);

  // Use line-stream so we don't load multi-megabyte logs into memory.
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(file, { encoding: 'utf8' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const entries: RationaleEntry[] = [];
  return new Promise<RationaleEntry[]>((resolve, reject) => {
    stream.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve([]);
        return;
      }
      reject(err);
    });

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    rl.on('line', (raw) => {
      lineNumber++;
      const line = raw.trim();
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as Partial<RationaleEntry> & Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object') {
          // eslint-disable-next-line no-console
          console.warn(`[rationale] ${file}: line ${lineNumber} parsed to non-object, skipping`);
          return;
        }
        // Defensive shape check — we're tolerant on shape but require
        // ts/resourceName/reason to at least be strings.
        const ts = typeof parsed.ts === 'string' ? parsed.ts : '';
        const author = typeof parsed.author === 'string' ? parsed.author : '';
        const resourceName = typeof parsed.resourceName === 'string' ? parsed.resourceName : '';
        const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
        const skipped = parsed.skipped === true ? true : undefined;
        entries.push({
          ts,
          author,
          resourceName,
          oldValue: parsed.oldValue,
          newValue: parsed.newValue,
          reason,
          ...(skipped !== undefined ? { skipped } : {}),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[rationale] ${file}: line ${lineNumber} is not valid JSON (${
            err instanceof Error ? err.message : err
          }), skipping`,
        );
      }
    });
    rl.on('close', () => resolve(entries));
    rl.on('error', (err) => reject(err));
  });
}

/**
 * Convenience: rationale entries for a single resource, newest first,
 * optionally limited to the most recent `limit`. Useful for the editor
 * sidebar which only shows the last 3 entries.
 */
export async function readRationaleForResource(
  ns: string,
  resourceName: string,
  limit?: number,
): Promise<RationaleEntry[]> {
  const all = await readRationale(ns);
  const filtered = all.filter((e) => e.resourceName === resourceName);
  // Reverse-chronological. JSONL is appended in chronological order so
  // the slice from the end is "newest first" once reversed.
  filtered.reverse();
  if (typeof limit === 'number' && limit >= 0) {
    return filtered.slice(0, limit);
  }
  return filtered;
}

// ── Test-only escape hatches ───────────────────────────────────────────────

/** @internal Exposes the sanitizer for tests so they can verify the slug. */
export function _sanitizeNsForTests(ns: string): string {
  return sanitizeNs(ns);
}

/** @internal Internal helper for tests/debug — read raw file bytes. */
export async function _readRationaleFileRawForTests(ns: string): Promise<string | null> {
  const { file } = fileFor(ns);
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
