// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, posix as posixPath, win32 as win32Path } from 'path';
import type { OscfgBinaryInfo } from './types';
import { resolveOscfgBinaryDir } from '../runtime/paths';

/**
 * Resolve the oscfg binary path. Preference:
 *   1. OSCFG_BIN env var (explicit override)
 *   2. Bundled binary (directory provided by the active path strategy:
 *      Next.js `<cwd>/resources/oscfg/<platform>/`, Electron
 *      `<process.resourcesPath>/oscfg/`, tests: as injected)
 *   3. Well-known install locations (winget MSIX alias, WinGet
 *      user-scope Links, Program Files, Linux /usr + /opt + ~/.local/bin)
 *   4. `oscfg` on PATH
 *   5. (Windows only) Get-AppxPackage Microsoft.OSConfig fallback,
 *      handles the case where winget installed via MSIX and the
 *      App Execution Alias is disabled or PATH is stale.
 */
let _cached: OscfgBinaryInfo | null = null;

const WINDOWS_MSIX_PACKAGE = 'Microsoft.OSConfig';

function platformDir(): string {
  if (process.platform === 'win32') return 'win32-x64';
  if (process.platform === 'linux') return 'linux-x64';
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function binaryName(): string {
  return process.platform === 'win32' ? 'oscfg.exe' : 'oscfg';
}

/**
 * Well-known install locations to probe before falling back to PATH or
 * MSIX lookup. Covers the common winget install layouts on Windows
 * and the conventional Linux package paths. Keeping these explicit
 * means we still find oscfg when the user's shell PATH has not been
 * refreshed since `winget install Microsoft.OSConfig`.
 */
function wellKnownInstallPaths(): string[] {
  const name = binaryName();
  const paths: string[] = [];

  if (process.platform === 'win32') {
    // Use win32Path.join so the path separator is `\` regardless of
    // the host running these checks (matters when CI on Linux exercises
    // the Windows branch via setPlatform mock).
    if (process.env.LOCALAPPDATA) {
      // App Execution Alias stub (works via Node spawnSync even though
      // it appears as a 0-byte reparse point on disk).
      paths.push(win32Path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', name));
      // winget user-scope CLI Links (real shim, not an alias).
      paths.push(win32Path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', name));
      // Per-user standalone install (older builds, custom installers).
      paths.push(win32Path.join(process.env.LOCALAPPDATA, 'Programs', 'OSConfig', name));
    }
    if (process.env.ProgramFiles) {
      paths.push(win32Path.join(process.env.ProgramFiles, 'OSConfig', name));
      paths.push(win32Path.join(process.env.ProgramFiles, 'Microsoft', 'OSConfig', name));
    }
    const pfx86 = process.env['ProgramFiles(x86)'];
    if (pfx86) {
      paths.push(win32Path.join(pfx86, 'OSConfig', name));
      paths.push(win32Path.join(pfx86, 'Microsoft', 'OSConfig', name));
    }
  } else if (process.platform === 'linux') {
    paths.push('/usr/local/bin/oscfg');
    paths.push('/usr/bin/oscfg');
    paths.push('/opt/osconfig/bin/oscfg');
    paths.push('/opt/osconfig/oscfg');
    if (process.env.HOME) {
      // posixPath.join guarantees forward-slash separators even when the
      // tests run on Windows, so the path matches what a real Linux
      // process would see.
      paths.push(posixPath.join(process.env.HOME, '.local', 'bin', 'oscfg'));
    }
  }

  return paths;
}

function candidatePaths(): string[] {
  const name = binaryName();
  const sub = platformDir();
  const paths: string[] = [];

  // 1. Env override
  if (process.env.OSCFG_BIN) paths.push(process.env.OSCFG_BIN);

  // 2. Bundled, host-provided strategy. Default: `<cwd>/resources/oscfg/<platform>/`.
  // Electron strategy returns `<process.resourcesPath>/oscfg/<platform>/`.
  paths.push(join(resolveOscfgBinaryDir(sub), name));

  // 3. Legacy fallback for older Next.js standalone packaged layouts,
  // walk up from the compiled module location. The runtime/paths
  // strategy is the preferred path; this keeps pre-strategy production
  // layouts working until they're rebuilt.
  try {
    const here = __dirname;
    paths.push(join(here, '..', '..', '..', 'resources', 'oscfg', sub, name));
    paths.push(join(here, '..', '..', '..', '..', 'resources', 'oscfg', sub, name));
  } catch {
    /* __dirname not available in some bundlers; ignore */
  }

  // 4. Well-known install locations (winget MSIX alias, WinGet Links,
  //    Program Files, Linux /usr + /opt + ~/.local/bin).
  paths.push(...wellKnownInstallPaths());

  return paths;
}

function checkVersion(binPath: string): string | null {
  try {
    const r = spawnSync(binPath, ['--version'], {
      windowsHide: true,
      timeout: 5000,
      encoding: 'utf-8',
    });
    if (r.status === 0) {
      const out = (r.stdout || '').trim() || (r.stderr || '').trim();
      return out || 'unknown';
    }
    // Some binaries print version to stderr and exit 0, or exit 2 on --version.
    // Accept any output as "working".
    const out = (r.stdout || '').trim() || (r.stderr || '').trim();
    if (out) return out;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Locate the Microsoft.OSConfig MSIX install on Windows via
 * `Get-AppxPackage`. Works without administrator privileges and
 * returns the absolute install directory even when the App Execution
 * Alias is disabled in Windows Settings or PATH has not been refreshed
 * since `winget install Microsoft.OSConfig`.
 *
 * One-time cost is ~700ms (PowerShell startup + Appx query). The
 * surrounding `_cached` singleton means this is paid at most once per
 * process per cache lifetime.
 */
function tryFindMsixInstall(): OscfgBinaryInfo | null {
  if (process.platform !== 'win32') return null;
  try {
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-AppxPackage -Name ${WINDOWS_MSIX_PACKAGE} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty InstallLocation`,
      ],
      {
        windowsHide: true,
        timeout: 5000,
        encoding: 'utf-8',
      },
    );
    if (r.status !== 0) return null;
    const installDir = (r.stdout || '').trim().split(/\r?\n/)[0]?.trim();
    if (!installDir) return null;
    const candidate = win32Path.join(installDir, binaryName());
    if (!existsSync(candidate)) return null;
    const version = checkVersion(candidate);
    if (version === null) return null;
    return {
      path: candidate,
      version,
      platform: process.platform,
      source: 'msix',
    };
  } catch {
    return null;
  }
}

/** Resolve the oscfg binary, caching the result. */
export function resolveOscfgBinary(): OscfgBinaryInfo {
  if (_cached) return _cached;

  const wellKnown = new Set(wellKnownInstallPaths());

  for (const p of candidatePaths()) {
    // WindowsApps App Execution Alias stubs report exists=false from
    // fs.existsSync (they are 0-byte reparse points), but Node's
    // spawnSync CAN invoke them and the OS resolves the redirect to
    // the real MSIX install. So for paths in the well-known set, skip
    // the existsSync gate and rely on the version probe instead;
    // spawnSync returns ENOENT immediately when the file truly does
    // not exist, so the cost is minimal.
    const isWellKnown = wellKnown.has(p);
    if (!isWellKnown && !existsSync(p)) continue;
    const version = checkVersion(p);
    if (version === null) continue;
    let source: OscfgBinaryInfo['source'] = 'bundled';
    if (p === process.env.OSCFG_BIN) {
      source = 'env';
    } else if (isWellKnown) {
      source = 'installed';
    }
    _cached = {
      path: p,
      version,
      platform: process.platform,
      source,
    };
    return _cached;
  }

  // 4. PATH fallback
  const name = binaryName();
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    windowsHide: true,
    timeout: 3000,
    encoding: 'utf-8',
  });
  if (onPath.status === 0) {
    const firstLine = (onPath.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (firstLine && existsSync(firstLine)) {
      const version = checkVersion(firstLine) ?? 'unknown';
      _cached = { path: firstLine, version, platform: process.platform, source: 'path' };
      return _cached;
    }
  }

  // 5. Last-ditch: Get-AppxPackage on Windows to find the MSIX install
  //    even when its App Execution Alias is disabled and PATH is stale.
  const msix = tryFindMsixInstall();
  if (msix) {
    _cached = msix;
    return _cached;
  }

  throw new Error(
    `OSConfig CLI not found. Looked at: ${candidatePaths().join(', ')}. ` +
      `Install OSConfig. See INSTALL.md at the repo root or visit https://github.com/microsoft/osconfig/tree/main/docs/cli.`,
  );
}

/** Test-only: clear the cached lookup. */
export function _resetOscfgBinaryCache() {
  _cached = null;
}

/** Test-only export of the well-known path list, for asserting platform coverage. */
export const _wellKnownInstallPathsForTest = wellKnownInstallPaths;
