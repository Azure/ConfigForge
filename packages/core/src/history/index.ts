// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Manifest version-history snapshots.
 *
 * Layout:  ~/.configforge/history/<sanitized-manifest-name>/<timestamp>.osc.yaml
 *          ~/.configforge/history/<sanitized-manifest-name>/<timestamp>.osc.yaml.meta  (optional JSON)
 *
 * Override the root with the CONFIGFORGE_HOME env var (used by tests).
 *
 * Backwards compatibility:
 *   Snapshots written by the previous PowerShell-based implementation used
 *   `${manifestName}_${ts}.osc.yaml` filenames. Those are still listed,
 *   read, and deleted correctly because the id is derived as
 *   `basename.replace(/\.osc\.yaml$/, '')` either way; getSnapshot /
 *   deleteSnapshot rebuild the filename from `${id}.osc.yaml`.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { createHash, randomBytes } from 'crypto';
import path from 'path';
import os from 'os';
import { isValidNamespace } from '../oscfg';
import { resolveAuthor } from './author';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  manifestName: string;
  timestamp: string;
  content: string;
  message?: string;
  size?: number;
  /**
   * PR27: change-author capture. Optional so old `.meta` sidecars without
   * these fields still parse cleanly. `author` is the resolved display
   * name (env var → git config → OS user → 'unknown'); `authorEmail`
   * may be empty when only a name was available. `rationale` is the
   * one-shot "why this change?" text the user supplied at save time.
   */
  author?: string;
  authorEmail?: string;
  rationale?: string;
}

/**
 * Options accepted by createSnapshot/saveSnapshot. All fields are optional;
 * when `author`/`authorEmail` are not provided we resolve them via
 * `resolveAuthor()`. Pass an empty string to opt out (e.g. for synthetic
 * test fixtures that should write no author at all).
 */
export interface SnapshotOptions {
  message?: string;
  author?: string;
  authorEmail?: string;
  rationale?: string;
}

/** Same shape as HistoryEntry but without the `content` payload. */
export type HistoryEntryMeta = Omit<HistoryEntry, 'content'>;

// ── Roots / paths ────────────────────────────────────────────────────────────

const ENV_OVERRIDE = 'CONFIGFORGE_HOME';
const ENV_MAX_COUNT = 'CONFIGFORGE_HISTORY_MAX_COUNT';
/** Default snapshot retention: keep the newest N per manifest. Override via
 *  CONFIGFORGE_HISTORY_MAX_COUNT (set to `0` or `-1` to disable pruning). */
const DEFAULT_MAX_COUNT = 50;

function configforgeHome(): string {
  return process.env[ENV_OVERRIDE] ?? path.join(os.homedir(), '.configforge');
}

function historyRoot(): string {
  return path.join(configforgeHome(), 'history');
}

function maxRetention(): number {
  const raw = process.env[ENV_MAX_COUNT];
  if (raw === undefined) return DEFAULT_MAX_COUNT;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_MAX_COUNT;
  return n; // <= 0 disables pruning
}

function assertValidName(name: string): void {
  if (!isValidNamespace(name)) {
    throw new Error(
      `Invalid manifest name: ${JSON.stringify(name)}. ` +
        `Allowed characters: A-Z a-z 0-9 . _ - (1-96 chars).`,
    );
  }
  // isValidNamespace allows '.' and '..' because '.' is in the character
  // class. Reject any name composed entirely of dots — those are filesystem
  // path traversal vectors even though they pass the regex.
  if (/^\.+$/.test(name)) {
    throw new Error(`Invalid manifest name: ${JSON.stringify(name)}`);
  }
}

/**
 * Validate a snapshot id. Allowed: ASCII printable except path separators,
 * 1-256 chars, no leading dot. We are deliberately permissive (legacy ids
 * include the manifest name) but reject anything that could escape the
 * manifest directory.
 */
const ID_RE = /^[A-Za-z0-9._\-:+]{1,256}$/;
function assertValidId(id: string): void {
  if (!ID_RE.test(id) || id.startsWith('.')) {
    throw new Error(`Invalid snapshot id: ${JSON.stringify(id)}`);
  }
}

function manifestDir(name: string): string {
  assertValidName(name);
  return path.join(historyRoot(), name);
}

/**
 * Resolve a relative file inside `dir` and verify the resolved path stays
 * inside `dir`. Defense in depth even after id validation.
 */
function safeJoin(dir: string, file: string): string {
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, file);
  const root = resolvedDir + path.sep;
  if (resolved !== resolvedDir && !resolved.startsWith(root)) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}

let lastSnapshotTimestamp = '';
let sameTimestampSequence = 0;

function snapshotIdForTimestamp(isoTs: string): string {
  if (isoTs === lastSnapshotTimestamp) {
    sameTimestampSequence += 1;
  } else {
    lastSnapshotTimestamp = isoTs;
    sameTimestampSequence = 0;
  }
  // Sequence keeps same-millisecond saves ordered; entropy still protects
  // against collisions across process restarts.
  const sequence = sameTimestampSequence.toString(16).padStart(8, '0');
  const entropy = randomBytes(4).toString('hex');
  return `${isoTs.replace(/:/g, '-')}.${sequence}${entropy}`;
}

function filenameFromId(id: string): string {
  return `${id}.osc.yaml`;
}

function idFromFilename(filename: string): string {
  return filename.replace(/\.osc\.yaml$/i, '');
}

/**
 * Best-effort timestamp recovery from a snapshot id. Works for both new
 * (`2026-04-21T00-20-00.000Z`) and legacy (`name_2026-04-21T00-20-00.000Z`)
 * id formats. Returns null if no parseable timestamp is found.
 */
export function timestampFromId(id: string): string | null {
  // saveSnapshot stores timestamps with `:` replaced by `-`, optionally
  // followed by `.<random-hex>` (collision suffix). We anchor the match at
  // the start of the id (or right after a `_` separator for legacy ids)
  // so the timestamp can be followed by a suffix or end-of-string.
  const m = id.match(/(?:^|_)(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z)(?=$|[._-])/);
  if (!m) return null;
  const datePart = m[1].slice(0, 10);
  const timeRestored = m[1].slice(10).replace(/-/g, ':');
  const parsed = Date.parse(datePart + timeRestored);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

// ── Public API ───────────────────────────────────────────────────────────────

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Read the newest existing snapshot for `dir` (yaml file with the largest
 * filename-embedded timestamp). Returns null if the dir is empty or
 * unreadable. Used by saveSnapshot to dedupe identical successive saves.
 */
async function readNewestSnapshot(
  dir: string,
): Promise<{ id: string; file: string; content: string } | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  let bestId: string | null = null;
  let bestKey: string | null = null;
  for (const f of names) {
    if (!f.endsWith('.osc.yaml')) continue;
    const id = idFromFilename(f);
    // Sort key: parsed timestamp first, then id as tie-breaker.
    const ts = timestampFromId(id) ?? '';
    const key = ts ? `${ts}|${id}` : id;
    if (bestKey === null || key > bestKey) {
      bestKey = key;
      bestId = id;
    }
  }
  if (!bestId) return null;
  const file = safeJoin(dir, filenameFromId(bestId));
  try {
    const content = await readFile(file, 'utf8');
    return { id: bestId, file, content };
  } catch {
    return null;
  }
}

/**
 * Prune the manifest's snapshot directory to at most `keep` entries
 * (newest by parsed timestamp). No-op if `keep <= 0` (disabled) or count
 * already <= keep. Returns the number of entries removed. Best-effort:
 * filesystem errors during individual deletes are logged, not thrown.
 */
async function pruneToRetention(dir: string, keep: number): Promise<number> {
  if (keep <= 0) return 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const entries = names
    .filter((f) => f.endsWith('.osc.yaml'))
    .map((f) => {
      const id = idFromFilename(f);
      return { id, file: f, timestamp: timestampFromId(id) ?? '' };
    });
  if (entries.length <= keep) return 0;
  // Sort newest first, then drop everything past `keep`.
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
  const losers = entries.slice(keep);
  let removed = 0;
  for (const l of losers) {
    try {
      await rm(safeJoin(dir, l.file), { force: true });
      await rm(safeJoin(dir, `${l.file}.meta`), { force: true });
      removed++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[history] retention prune failed for ${l.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return removed;
}

/**
 * Save a point-in-time snapshot of a manifest.
 *
 * Two side-effects beyond the basic write:
 *   1. **Dedupe** — if the newest existing snapshot has identical content
 *      (sha256 match), no new file is written and the existing entry is
 *      returned. This prevents register-spam from creating dozens of
 *      byte-identical snapshots. The dedupe check intentionally only
 *      compares the IMMEDIATE PREDECESSOR (not the whole history) so the
 *      operation stays O(1) regardless of history size.
 *   2. **Retention** — after a successful new write, oldest entries beyond
 *      CONFIGFORGE_HISTORY_MAX_COUNT (default 50) are pruned. Set to `0`
 *      or `-1` to disable pruning.
 *
 * `messageOrOptions` may be:
 *   - `undefined` / a bare string — legacy signature, used by every call
 *     site predating PR27. No author/rationale resolution happens; only
 *     `message` is stored in the meta sidecar.
 *   - a {message?, author?, authorEmail?, rationale?} object — PR27 form.
 *     Any of `author` / `authorEmail` left undefined are filled in from
 *     `resolveAuthor()`. Pass an explicit empty string to opt out.
 *
 * `createSnapshot` is the recommended new API for the structured form;
 * `saveSnapshot` is preserved verbatim for back-compat.
 */
export async function saveSnapshot(
  manifestName: string,
  content: string,
  messageOrOptions?: string | SnapshotOptions,
): Promise<HistoryEntry> {
  // Legacy positional form: do NOT auto-resolve author — preserves the
  // pre-PR27 contract exactly. Callers who want author metadata must use
  // the options-object form (or call createSnapshot).
  const isLegacyForm = typeof messageOrOptions === 'string' || messageOrOptions === undefined;
  const opts: SnapshotOptions = isLegacyForm
    ? { message: messageOrOptions as string | undefined }
    : messageOrOptions;

  let author = opts.author;
  let authorEmail = opts.authorEmail;
  if (!isLegacyForm && (author === undefined || authorEmail === undefined)) {
    try {
      const resolved = await resolveAuthor();
      if (author === undefined) author = resolved.name;
      if (authorEmail === undefined) authorEmail = resolved.email;
    } catch (err) {
      // resolveAuthor is documented as never-throws, but be defensive
      // anyway — author metadata is best-effort.
      // eslint-disable-next-line no-console
      console.warn(`[history] resolveAuthor failed: ${err instanceof Error ? err.message : err}`);
      if (author === undefined) author = '';
      if (authorEmail === undefined) authorEmail = '';
    }
  }

  const message = opts.message;
  const rationale = opts.rationale;

  const dir = manifestDir(manifestName);
  await mkdir(dir, { recursive: true });

  // 1) Dedupe against immediate predecessor.
  const incomingHash = sha256Hex(content);
  const newest = await readNewestSnapshot(dir);
  if (newest && sha256Hex(newest.content) === incomingHash) {
    // Return the existing entry. We deliberately do NOT update its message
    // / author / rationale even if the caller passed different values —
    // metadata-only changes are rare and a true rewrite can be requested
    // by deleting the snapshot first.
    const existingMeta = await readMetaSidecar(safeJoin(dir, `${filenameFromId(newest.id)}.meta`));
    let existingSize: number | undefined;
    try {
      existingSize = (await stat(newest.file)).size;
    } catch {
      /* fine */
    }
    return {
      id: newest.id,
      manifestName,
      timestamp: timestampFromId(newest.id) ?? new Date().toISOString(),
      content: newest.content,
      message: existingMeta.message,
      author: existingMeta.author,
      authorEmail: existingMeta.authorEmail,
      rationale: existingMeta.rationale,
      size: existingSize,
    };
  }

  // 2) Write the new entry.
  // v0.2.21: atomic write (temp + rename) so a disk-full or process
  // kill mid-write doesn't leave a truncated/corrupt snapshot file
  // at the canonical path. Matches the pattern used by
  // `registry.ts:atomicWrite` and `audit-results-store.ts`. Without
  // this, a later `readNewestSnapshot` or `rollback` could
  // re-apply a corrupt YAML to the customer's machine.
  const ts = new Date().toISOString();
  const id = snapshotIdForTimestamp(ts);
  const file = safeJoin(dir, filenameFromId(id));
  const fileTmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(fileTmp, content, 'utf8');
  await rename(fileTmp, file);

  // Always write a sidecar when ANY meta field is non-empty. Previously we
  // only wrote when message was set; PR27 broadens this so author/rationale
  // alone are enough to justify the sidecar.
  const meta: Record<string, unknown> = {};
  if (message != null && message !== '') meta.message = message;
  if (author) meta.author = author;
  if (authorEmail) meta.authorEmail = authorEmail;
  if (rationale != null && rationale !== '') meta.rationale = rationale;
  if (Object.keys(meta).length > 0) {
    const metaFile = safeJoin(dir, `${filenameFromId(id)}.meta`);
    const metaTmp = `${metaFile}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(metaTmp, JSON.stringify(meta), 'utf8');
    await rename(metaTmp, metaFile);
  }

  // 3) Retention sweep — best-effort, never blocks the save success.
  //
  // v0.3.1 (#23): retention is now persisted in the settings store
  // (`packages/core/src/handlers/settings.ts`) so the user can
  // configure it from the Settings UI. The env-var override
  // (`CONFIGFORGE_HISTORY_MAX_RETENTION`) still wins; we keep
  // `maxRetention()` as a synchronous fallback for callers that
  // haven't yet been migrated to async, but the actual prune below
  // resolves through the settings store.
  void (async () => {
    // Env-var override wins (including 0/-1 to disable pruning) — preserves
    // legacy behavior and existing test contracts. When the env var is
    // unset, defer to the persisted settings store for the user's choice.
    let n: number = maxRetention();
    if (process.env[ENV_MAX_COUNT] === undefined) {
      try {
        // Lazy import to avoid a circular dep between history and the
        // settings handler.
        const { resolveHistoryRetention } = await import('../handlers/settings');
        n = await resolveHistoryRetention();
      } catch {
        /* fall back to default already in `n` */
      }
    }
    await pruneToRetention(dir, n).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[history] retention sweep failed: ${err instanceof Error ? err.message : err}`);
    });
  })();

  return {
    id,
    manifestName,
    timestamp: ts,
    content,
    message: message || undefined,
    author: author || undefined,
    authorEmail: authorEmail || undefined,
    rationale: rationale || undefined,
    size: Buffer.byteLength(content, 'utf8'),
  };
}

/**
 * `createSnapshot` is the PR27-style API: structured options only, no
 * positional message. It's a thin wrapper around `saveSnapshot` to give
 * new call sites a clean signature without breaking the legacy one.
 */
export async function createSnapshot(
  manifestName: string,
  content: string,
  options: SnapshotOptions = {},
): Promise<HistoryEntry> {
  return saveSnapshot(manifestName, content, options);
}

/**
 * Parse a `.meta` sidecar JSON file defensively. Old sidecars only had
 * `{ message }`; PR27 added `author`, `authorEmail`, `rationale`. Any
 * field with the wrong type — including the whole file being non-JSON —
 * is treated as absent so we never poison a read on a partial meta.
 */
interface MetaSidecar {
  message?: string;
  author?: string;
  authorEmail?: string;
  rationale?: string;
}

async function readMetaSidecar(metaPath: string): Promise<MetaSidecar> {
  try {
    const raw = await readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: MetaSidecar = {};
    if (typeof parsed.message === 'string') out.message = parsed.message;
    if (typeof parsed.author === 'string') out.author = parsed.author;
    if (typeof parsed.authorEmail === 'string') out.authorEmail = parsed.authorEmail;
    if (typeof parsed.rationale === 'string') out.rationale = parsed.rationale;
    return out;
  } catch {
    return {};
  }
}

/**
 * List all snapshots for a manifest, newest first, **without** loading
 * the full YAML content. Use getSnapshot(name, id) to fetch one.
 */
export async function getHistory(manifestName: string): Promise<HistoryEntryMeta[]> {
  const dir = manifestDir(manifestName);

  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const entries: HistoryEntryMeta[] = [];
  for (const file of names) {
    if (!file.endsWith('.osc.yaml')) continue;
    const id = idFromFilename(file);
    const fullPath = safeJoin(dir, file);
    let st;
    try {
      st = await stat(fullPath);
    } catch {
      continue; // raced deletion
    }
    if (!st.isFile()) continue;

    const meta = await readMetaSidecar(safeJoin(dir, `${file}.meta`));

    const ts = timestampFromId(id) ?? st.mtime.toISOString();
    entries.push({
      id,
      manifestName,
      timestamp: ts,
      message: meta.message,
      author: meta.author,
      authorEmail: meta.authorEmail,
      rationale: meta.rationale,
      size: st.size,
    });
  }

  // Sort newest first by parsed timestamp (deterministic, OneDrive-safe).
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
  return entries;
}

/** Retrieve a specific snapshot by id, including full content. */
export async function getSnapshot(manifestName: string, id: string): Promise<HistoryEntry | null> {
  const dir = manifestDir(manifestName);
  assertValidId(id);
  const file = safeJoin(dir, filenameFromId(id));

  let st;
  try {
    st = await stat(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  if (!st.isFile()) return null;

  const content = await readFile(file, 'utf8');

  const meta = await readMetaSidecar(safeJoin(dir, `${filenameFromId(id)}.meta`));

  const ts = timestampFromId(id) ?? st.mtime.toISOString();
  return {
    id,
    manifestName,
    timestamp: ts,
    content,
    message: meta.message,
    author: meta.author,
    authorEmail: meta.authorEmail,
    rationale: meta.rationale,
    size: st.size,
  };
}

/** Delete a specific snapshot. No-op if it doesn't exist. */
export async function deleteSnapshot(manifestName: string, id: string): Promise<void> {
  const dir = manifestDir(manifestName);
  assertValidId(id);
  const file = safeJoin(dir, filenameFromId(id));
  const metaFile = safeJoin(dir, `${filenameFromId(id)}.meta`);
  await rm(file, { force: true });
  await rm(metaFile, { force: true });
}

/**
 * v0.2.21: delete the entire history directory for a manifest.
 *
 * Called by `deleteManifest` so re-registering a previously-deleted
 * manifest under the same namespace doesn't surface ghost snapshots
 * from the prior registration on the History page. Best-effort:
 * silently swallows errors so a missing dir or in-flight write
 * doesn't fail the parent delete operation.
 */
export async function deleteHistoryForManifest(manifestName: string): Promise<void> {
  try {
    const dir = manifestDir(manifestName);
    await rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort: surface no error to caller
  }
}

/** Get snapshot content for rollback / re-registration. */
export async function rollback(manifestName: string, id: string): Promise<string> {
  const entry = await getSnapshot(manifestName, id);
  if (!entry) {
    throw new Error(`Snapshot '${id}' not found for manifest '${manifestName}'`);
  }
  return entry.content;
}
