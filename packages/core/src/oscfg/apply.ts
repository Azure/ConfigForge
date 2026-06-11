// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { runOscfg } from './runner';
import { normalizeManifestRegistryTypesInYaml } from './registry-types';
import type { OscfgApplyOptions, OscfgResult } from './types';

/**
 * Conservative byte threshold under which `--content` is safe to pass on
 * the command line. Windows' CreateProcessW caps the full command line at
 * 32,767 wchars; once we account for the binary path, `apply --content`,
 * `-n <namespace>`, and `--dry-run`, ~8 KB of payload is the safe ceiling.
 *
 * Above this we transparently fall back to writing a temp file and
 * passing `-f`, restoring big-baseline support that was silently broken
 * since the move to `--content` (oscfg 1.3.9). Linux's ARG_MAX is much
 * higher (typically 128 KB-2 MB) but we use the same threshold there for
 * consistency and so a single code path handles both OSes.
 *
 * @internal
 */
export const INLINE_CONTENT_BYTE_LIMIT = 8 * 1024;

/**
 * Plan how `applyManifest` will dispatch to the CLI for a given options
 * shape. Pure: no I/O, no spawn. Used internally by `applyManifest` and
 * exported with `@internal` JSDoc so tests can assert dispatch decisions
 * without owning the shell layer.
 *
 * @internal
 */
export type ApplyPlan =
  | { mode: 'inline'; args: string[] }
  | { mode: 'file'; args: string[]; content: string; tempFilePlaceholder: string }
  | { mode: 'error'; error: string };

/** @internal */
export function planApply(opts: OscfgApplyOptions): ApplyPlan {
  if (opts.file) {
    const args = ['apply', '-f', opts.file];
    if (opts.namespace) args.push('-n', opts.namespace);
    if (opts.dryRun) args.push('--dry-run');
    return { mode: 'inline', args };
  }
  if (opts.content === undefined) {
    return { mode: 'error', error: 'Either file or content must be provided' };
  }
  // PR19: Normalize Win32-style REG_* valueTypes (REG_DWORD, REG_SZ, ...)
  // to the DSC-style names oscfg's Registry provider accepts (Dword,
  // String, ...). Without this, every Defender / WS / LAPS baseline that
  // ships REG_* fails on enforce with "os error 87".
  const content = normalizeManifestRegistryTypesInYaml(opts.content);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= INLINE_CONTENT_BYTE_LIMIT) {
    const args = ['apply', '--content', content];
    if (opts.namespace) args.push('-n', opts.namespace);
    if (opts.dryRun) args.push('--dry-run');
    return { mode: 'inline', args };
  }
  // File-mode fallback. The placeholder is replaced with the real temp
  // path right before spawn, keeping `planApply` pure.
  const placeholder = '<TEMP_FILE>';
  const args = ['apply', '-f', placeholder];
  if (opts.namespace) args.push('-n', opts.namespace);
  if (opts.dryRun) args.push('--dry-run');
  return { mode: 'file', args, content, tempFilePlaceholder: placeholder };
}

/**
 * Apply a configuration to the system.
 *   oscfg apply -f <file> [-n <namespace>]           (file mode)
 *   oscfg apply --content <yaml> [-n <namespace>]    (inline mode, oscfg 1.3.9+)
 *
 * `content` is preferred for small manifests (no temp file write/cleanup,
 * faster). For payloads larger than `INLINE_CONTENT_BYTE_LIMIT` we
 * transparently fall back to a temp file and pass `-f` instead - this is
 * the difference between "works" and "ENAMETOOLONG" on Windows for any
 * baseline beyond a few hundred resources (e.g. WS2025 baselines at
 * ~130 KB are 4x the OS command-line limit).
 */
export async function applyManifest(
  opts: OscfgApplyOptions,
): Promise<OscfgResult<{ stdout: string; stderr: string }>> {
  const plan = planApply(opts);
  if (plan.mode === 'error') {
    return { success: false, data: null, error: plan.error, exitCode: -1 };
  }

  let tempFile: string | null = null;
  let args = plan.args;
  if (plan.mode === 'file') {
    tempFile = await writeContentToTempFile(plan.content);
    args = plan.args.map((a) => (a === plan.tempFilePlaceholder ? tempFile! : a));
  }

  try {
    const result = await runOscfg<string>(args, {
      timeoutMs: opts.timeoutMs ?? 120_000,
      parseJson: false,
    });
    const stdout = result.stdout ?? (typeof result.data === 'string' ? result.data : '');
    const stderr = result.stderr ?? '';
    if (!result.success) {
      return {
        success: false,
        data: null,
        error: result.error,
        exitCode: result.exitCode,
        stdout,
        stderr,
      };
    }
    return {
      success: true,
      data: { stdout, stderr },
      error: null,
      exitCode: result.exitCode,
      stdout,
      stderr,
    };
  } finally {
    if (tempFile) {
      // Best-effort: temp files are namespaced + random so leftovers from
      // a crash are harmless, but clean up on the happy path.
      await unlink(tempFile).catch(() => {});
    }
  }
}

/**
 * Write the manifest content to a process-unique temp file and return the
 * path. The caller is responsible for unlinking after `oscfg apply` reads
 * it.
 *
 * @internal
 */
async function writeContentToTempFile(content: string): Promise<string> {
  const dir = join(tmpdir(), 'configforge-apply');
  await mkdir(dir, { recursive: true });
  const filename = `apply-${process.pid}-${randomBytes(4).toString('hex')}.osc.yaml`;
  const path = join(dir, filename);
  await writeFile(path, content, 'utf8');
  return path;
}