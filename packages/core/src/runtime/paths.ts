// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Platform-neutral runtime path resolution.
 *
 * Why this exists
 * ---------------
 * `@configforge/core` runs in two host environments today:
 *
 *   1. Next.js server-side route handlers (web app, current production)
 *   2. Electron main process (desktop app, main branch)
 *
 * Each host has different rules for where on disk to find the bundled
 * `oscfg` binary, the `public/_baselines/*.yaml` reference manifests,
 * the temp directory, and per-user state. Encoding those rules
 * directly in core (`process.cwd()` everywhere) means core knows about
 * its host — which makes core un-portable.
 *
 * Instead, core declares a tiny strategy object (`PathStrategy`) and
 * delegates every "where on disk?" question to the active strategy.
 * The default strategy is the Next.js / dev shape (everything relative
 * to `process.cwd()`), so existing callers continue to work unchanged.
 * Hosts that need different rules — chiefly Electron, which packages
 * binaries via `extraResources` and reads them from
 * `process.resourcesPath` — call `setPathStrategy(electronStrategy)`
 * once at startup.
 */
import { join, resolve } from 'node:path';
import os from 'node:os';

export interface PathStrategy {
  resolveOscfgBinaryDir(platformSubdir: string): string;
  resolvePublicAsset(relativePath: string): string;
  resolveTempDir(): string;
  resolveUserDataDir(): string;
}

const defaultStrategy: PathStrategy = {
  resolveOscfgBinaryDir(platformSubdir) {
    return join(process.cwd(), 'resources', 'oscfg', platformSubdir);
  },
  resolvePublicAsset(relativePath) {
    const cleaned = relativePath.replace(/^\/+/, '');
    const configuredRoot =
      process.env.CONFIGFORGE_TEST_MODE === "1"
        ? process.env.CONFIGFORGE_PUBLIC_ROOT?.trim()
        : undefined;
    const publicRoot = configuredRoot ? resolve(configuredRoot) : resolve(process.cwd(), 'public');
    return resolve(publicRoot, cleaned);
  },
  resolveTempDir() {
    return os.tmpdir();
  },
  resolveUserDataDir() {
    return join(os.homedir(), '.configforge');
  },
};

let activeStrategy: PathStrategy = defaultStrategy;

export function setPathStrategy(strategy: PathStrategy): void {
  activeStrategy = strategy;
}

export function resetPathStrategy(): void {
  activeStrategy = defaultStrategy;
}

export function resolveOscfgBinaryDir(platformSubdir: string): string {
  return activeStrategy.resolveOscfgBinaryDir(platformSubdir);
}

export function resolvePublicAsset(relativePath: string): string {
  return activeStrategy.resolvePublicAsset(relativePath);
}

export function resolveTempDir(): string {
  return activeStrategy.resolveTempDir();
}

export function resolveUserDataDir(): string {
  return activeStrategy.resolveUserDataDir();
}

/** @internal Test-only: read the active strategy. */
export function _getActivePathStrategyForTests(): PathStrategy {
  return activeStrategy;
}
