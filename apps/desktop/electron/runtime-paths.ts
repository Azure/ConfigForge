// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Electron host — path strategy wiring.
 *
 * Tells `@configforge/core` where to find on-disk resources when running
 * inside the packaged Electron app. Called once from main.ts at
 * startup, BEFORE any core function that might resolve a path.
 *
 * Layout assumptions (set by electron-builder.yml):
 *   - resources/oscfg/<platform>-x64/  → bundled via `extraResources`
 *     and copied to `<app.getAppPath()>/../oscfg/<platform>-x64/`
 *     which is `<process.resourcesPath>/oscfg/<platform>-x64/` at runtime.
 *   - public/_baselines/                → bundled as-is inside the asar
 *     (no asarUnpack needed; readFile from inside asar works).
 *   - ~/.configforge/                   → user-scoped state, same path
 *     as the Next.js / dev shape so users can switch hosts without
 *     losing manifests/history/rationale.
 *   - app.getPath('temp')               → OS-standard temp dir for
 *     PDF generation, audit-pack staging.
 */
import { app } from 'electron';
import path from 'node:path';
import { setPathStrategy, type PathStrategy } from '@configforge/core/runtime/paths';

export function installElectronPathStrategy(): void {
  // In dev (NODE_ENV=development) the app is loaded from source via
  // `electron .`, so process.resourcesPath points at the parent's
  // `node_modules/electron/dist/resources`. Falling back to the repo's
  // own `resources/oscfg/` keeps `npm run desktop:dev` working without
  // packaging.
  //
  // app.getAppPath() in dev returns the esbuild output directory
  // (`apps/desktop/dist/electron`). Walk up to find the workspace
  // root by looking for the `public/_baselines` directory.
  const isDev = process.env.NODE_ENV === 'development';
  const appPath = app.getAppPath();
  // In dev, appPath = apps/desktop/dist/electron — 4 levels up is the repo root.
  // In packaged, appPath = <asar> — the fallback to ../.. is fine since we
  // don't use repoRoot in production.
  const repoRoot = isDev
    ? path.resolve(appPath, '..', '..', '..', '..')
    : path.resolve(appPath, '..', '..');
  const resourcesRoot = isDev
    ? path.join(repoRoot, 'resources')
    : path.join(process.resourcesPath, 'oscfg-resources');

  // public/_baselines/ ships via extraResources to
  // <process.resourcesPath>/public-assets/ at install time.
  // In dev, point at the repo's public/ tree. Tests and explicitly isolated
  // hosts may override only this root before Electron starts; normal runtime
  // behavior is unchanged when the variable is absent or empty.
  const configuredPublicRoot =
    !app.isPackaged && process.env.CONFIGFORGE_TEST_MODE === "1"
      ? process.env.CONFIGFORGE_PUBLIC_ROOT?.trim()
      : undefined;
  const publicRoot = configuredPublicRoot
    ? path.resolve(configuredPublicRoot)
    : isDev
      ? path.join(repoRoot, 'public')
      : path.join(process.resourcesPath, 'public-assets');

  const strategy: PathStrategy = {
    resolveOscfgBinaryDir(platformSubdir) {
      return path.join(resourcesRoot, 'oscfg', platformSubdir);
    },
    resolvePublicAsset(relativePath) {
      const cleaned = relativePath.replace(/^\/+/, '');
      return path.join(publicRoot, cleaned);
    },
    resolveTempDir() {
      // Electron's `app.getPath('temp')` is per-user, OS-standard, and
      // already created. Same as os.tmpdir() on most platforms but
      // explicitly host-blessed.
      return app.getPath('temp');
    },
    resolveUserDataDir() {
      // Deliberately NOT app.getPath('userData') — we keep ~/.configforge
      // so a user who tries both the web app and the desktop app sees
      // the same manifests / history / rationale.
      return path.join(app.getPath('home'), '.configforge');
    },
  };

  setPathStrategy(strategy);
}
