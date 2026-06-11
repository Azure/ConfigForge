// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Resolve the "change author" for a manifest history entry / rationale row.
 *
 * Resolution order (first to produce a name wins):
 *
 *   1. CONFIGFORGE_AUTHOR env var. Format: "Name <email>" or just "Name".
 *   2. `git config user.name` + `git config user.email` — best-effort, any
 *      failure (no git, missing config, non-zero exit) silently falls
 *      through to the next strategy.
 *   3. `os.userInfo().username` for name, '' for email.
 *   4. Final fallback: `{ name: 'unknown', email: '' }`.
 *
 * Never throws — all error paths are caught and turned into a fallback.
 * The result is cached for the lifetime of the process so we don't fork
 * `git` twice in a hot path. Tests can call `_resetAuthorCacheForTests`
 * to flush the cache between cases.
 */
import { exec } from 'child_process';
import os from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ResolvedAuthor {
  name: string;
  email: string;
}

let cached: ResolvedAuthor | null = null;
let inFlight: Promise<ResolvedAuthor> | null = null;

/**
 * Parse a `"Name <email>"` or bare-name string into `{name, email}`.
 * Whitespace is trimmed; empty strings produce `{name: '', email: ''}`.
 */
function parseAuthorString(raw: string): ResolvedAuthor {
  const trimmed = raw.trim();
  if (!trimmed) return { name: '', email: '' };
  const match = trimmed.match(/^(.*?)\s*<\s*([^<>]+?)\s*>\s*$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: trimmed, email: '' };
}

async function readGitConfig(key: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git config --get ${key}`, {
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function resolveAuthorUncached(): Promise<ResolvedAuthor> {
  // 1) Env var
  try {
    const env = process.env.CONFIGFORGE_AUTHOR;
    if (env && env.trim()) {
      const parsed = parseAuthorString(env);
      if (parsed.name) return parsed;
    }
  } catch {
    /* ignore — fall through */
  }

  // 2) git config user.name / user.email
  try {
    const [gitName, gitEmail] = await Promise.all([
      readGitConfig('user.name'),
      readGitConfig('user.email'),
    ]);
    if (gitName) {
      return { name: gitName, email: gitEmail };
    }
  } catch {
    /* ignore */
  }

  // 3) os user info
  try {
    const info = os.userInfo();
    if (info?.username) {
      return { name: info.username, email: '' };
    }
  } catch {
    /* ignore */
  }

  // 4) Final fallback
  return { name: 'unknown', email: '' };
}

/**
 * Resolve the change author. Cached for the process lifetime — repeated
 * calls return the same result without re-shelling `git`.
 */
export async function resolveAuthor(): Promise<ResolvedAuthor> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const result = await resolveAuthorUncached();
      cached = result;
      return result;
    } catch {
      const fallback: ResolvedAuthor = { name: 'unknown', email: '' };
      cached = fallback;
      return fallback;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** @internal Test-only — flushes the cached author so the next call re-resolves. */
export function _resetAuthorCacheForTests(): void {
  cached = null;
  inFlight = null;
}

/** @internal Test-only — exposes the env-string parser without re-resolving. */
export function _parseAuthorStringForTests(raw: string): ResolvedAuthor {
  return parseAuthorString(raw);
}
