// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Phase 11 — Auto-update wiring.
 *
 * Layers on top of electron-updater. The renderer drives the UX
 * (a non-intrusive banner near the top of the window) by listening
 * to `cfs:update:status` events from main and triggering download
 * + install via the `cfs:update:*` IPC channels exposed in the
 * preload bridge.
 *
 * Update flow:
 *
 *   1. App boots. `scheduleAutoUpdateCheck()` waits ~10s after
 *      window creation, then calls `autoUpdater.checkForUpdates()`.
 *   2. electron-updater fetches `latest.yml` (Win) or
 *      `latest-linux.yml` from the GitHub Release for the current
 *      version (configured via `electron-builder.yml#publish`).
 *   3. If a newer version is available, we emit a 'available'
 *      status to the renderer, which shows the UpdateBanner with a
 *      Download button.
 *   4. User clicks Download → renderer calls
 *      `cfs.update.downloadAndInstall()` → main calls
 *      `autoUpdater.downloadUpdate()`.
 *   5. Progress events are forwarded to the renderer so the banner
 *      can show a progress bar.
 *   6. On 'update-downloaded' the banner switches to "Restart to
 *      install". User clicks Restart → renderer calls
 *      `cfs.update.quitAndInstall()` → main calls
 *      `autoUpdater.quitAndInstall()`.
 *
 * Skip conditions (auto-update disabled):
 *   - NODE_ENV !== 'production' (dev/test)
 *   - app.isPackaged === false (running from `electron .`)
 *   - process.platform === 'linux' AND process.env.APPIMAGE is
 *     unset (electron-updater can only auto-update AppImage on
 *     Linux; deb/rpm/tar.gz users update via package manager or
 *     manual download)
 *   - process.platform === 'darwin' (out of scope for v0.1)
 *   - process.platform === 'win32' AND the installer is unsigned
 *     (Windows blocks unsigned auto-update with no useful error;
 *     we silently skip rather than confuse the user)
 *
 * Signed-update caveat for Windows: the installer must be signed
 * with a cert whose public key chain matches the cert used to
 * sign the currently-running binary. Release builds are unsigned by
 * design, so Windows auto-update is effectively disabled (it silently
 * skips, per the gate above); a locally self-signed build
 * (apps/desktop/scripts/generate-dev-cert.ps1) auto-updates fine within
 * a single dev's machine but fails across users.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import log from 'electron-log';

/**
 * Wire log output for electron-updater. Routes to electron-log
 * (~/AppData/Roaming/<app-name>/logs/main.log on Windows,
 * ~/.config/<app-name>/logs/main.log on Linux). Without this
 * electron-updater errors disappear into the void.
 */
function configureLogging(): void {
  log.transports.file.level = 'info';
  // electron-updater types its logger as a structural Logger; cast
  // is safe because electron-log implements the same shape.
  autoUpdater.logger = log as unknown as typeof autoUpdater.logger;
  // Don't auto-download — we want the renderer to drive that
  // explicitly via cfs.update.downloadAndInstall(). This gives
  // the user a chance to defer / pause the bandwidth.
  autoUpdater.autoDownload = false;
  // Don't auto-install on quit — we want explicit user consent
  // via the "Restart to install" button.
  autoUpdater.autoInstallOnAppQuit = false;
}

/**
 * State bag the renderer subscribes to. Each field maps to one of
 * autoUpdater's events. Only one of `availableInfo` / `progress` /
 * `downloadedInfo` / `error` is populated at a time depending on
 * `state`.
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: string }
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'not-available'; info: UpdateInfo }
  | { state: 'downloading'; progress: ProgressInfo }
  | { state: 'downloaded'; info: UpdateInfo }
  | { state: 'error'; message: string };

let lastStatus: UpdateStatus = { state: 'idle' };

/**
 * v0.1.0 hot-fix: when set, the next 'error' event from
 * `autoUpdater` will be logged but NOT broadcast to the renderer.
 * Used by `scheduleAutoUpdateCheck()` so a failed bootstrap check
 * doesn't paint a giant red banner on first launch.
 *
 * Why a flag (rather than just catching the rejected promise):
 * `autoUpdater` emits its 'error' event synchronously from inside
 * `checkForUpdates()`, BEFORE the returned promise rejects. So our
 * `.catch()` runs too late — the renderer has already received the
 * broadcast and is painting the banner.
 */
let suppressNextError = false;

/**
 * `electron-updater`'s HTTP error messages stringify with the
 * entire raw response — status line + body + every response
 * header + Set-Cookie cookies. That's catastrophic UX in a
 * MessageBar; v0.1.0's first install showed users a 250px-tall
 * red banner full of `_gh_sess=...` and `Strict-Transport-...`
 * crud, which made the actual app look broken / blank.
 *
 * This boils common failure modes down to one-liners. Falls back
 * to the first line of the original message, capped at 200 chars,
 * for anything we don't recognize.
 */
function sanitizeUpdateError(err: Error): string {
  const raw = err.message || String(err);
  // Strip the "Headers: { ... }" block fpm logs after the message.
  const head = raw.split(/\r?\n?Headers:/)[0];
  if (/HttpError:\s*404/i.test(head)) {
    return 'Could not reach the update server (404). The release feed is unavailable from this network.';
  }
  if (/HttpError:\s*40[13]/i.test(head)) {
    return 'Update server denied access. Sign-in may be required.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(head)) {
    return 'Could not reach the update server (no network connection).';
  }
  // Fallback — first non-empty line, capped at 200 chars.
  const firstLine = head.split(/\r?\n/).find((l) => l.trim().length > 0) ?? head;
  return firstLine.slice(0, 200);
}

/** Push the latest status to every open renderer. */
function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send('cfs:update:status', status);
      } catch {
        /* renderer disconnected */
      }
    }
  }
}

/**
 * Returns null if auto-update is supported on this host, or a
 * human-readable reason string if it should be skipped. Keep the
 * checks explicit — silent skips are the worst possible UX.
 */
function isAutoUpdateSupported(): string | null {
  if (!app.isPackaged) {
    return 'auto-update disabled in dev (run a packaged build to test)';
  }
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== undefined) {
    return `auto-update disabled when NODE_ENV=${process.env.NODE_ENV}`;
  }
  if (process.platform === 'darwin') {
    // out of scope per DESIGN.md
    return 'auto-update on macOS is not yet supported in this app';
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return 'auto-update on Linux is only supported when running the AppImage build (deb/rpm/tar.gz update via your package manager or by re-downloading)';
  }
  return null;
}

/**
 * Wire all autoUpdater event listeners + the IPC channels the
 * renderer uses. Idempotent — safe to call once on app startup.
 */
export function registerCfsAutoUpdaterHandlers(): void {
  configureLogging();

  // ── Event forwarders ─────────────────────────────────────────
  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast({ state: 'available', info });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    broadcast({ state: 'not-available', info });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    broadcast({ state: 'downloading', progress });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    broadcast({ state: 'downloaded', info });
  });

  autoUpdater.on('error', (err: Error) => {
    if (suppressNextError) {
      suppressNextError = false;
      log.warn('[auto-updater] error suppressed (scheduled check):', err.message);
      return;
    }
    broadcast({ state: 'error', message: sanitizeUpdateError(err) });
  });

  // ── IPC: renderer-driven actions ─────────────────────────────

  // Snapshot of the current status. Useful for renderer mount —
  // the banner can show whatever state we're in even if it
  // missed the original event push.
  ipcMain.handle('cfs:update:get-status', () => lastStatus);

  // Manual re-check (e.g. Settings page "Check for updates"
  // button). Returns the resulting promise so the renderer can
  // await + show error if any.
  ipcMain.handle('cfs:update:check', async () => {
    const skip = isAutoUpdateSupported();
    if (skip) {
      const status: UpdateStatus = { state: 'unsupported', reason: skip };
      broadcast(status);
      return status;
    }
    try {
      await autoUpdater.checkForUpdates();
      return lastStatus;
    } catch (err) {
      const message = sanitizeUpdateError(err instanceof Error ? err : new Error(String(err)));
      broadcast({ state: 'error', message });
      return lastStatus;
    }
  });

  // User clicked Download. autoDownload is off, so this is the
  // explicit trigger.
  ipcMain.handle('cfs:update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      const message = sanitizeUpdateError(err instanceof Error ? err : new Error(String(err)));
      broadcast({ state: 'error', message });
      return { ok: false, error: message };
    }
  });

  // User clicked Restart to install. autoUpdater quits the
  // current process and replaces it with the new version.
  ipcMain.handle('cfs:update:quit-and-install', () => {
    // `isSilent: true` skips the installer UI on Windows;
    // `isForceRunAfter: true` boots the new version automatically.
    // Both nice for the "click Restart, app comes back" UX.
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  });
}

/**
 * Schedule the initial auto-update check ~10s after window paint.
 * Delays so first paint isn't competing with the GitHub fetch.
 *
 * If unsupported on this host, broadcasts a one-shot 'unsupported'
 * status and bails. The renderer banner stays hidden in that case.
 */
export function scheduleAutoUpdateCheck(): void {
  const skip = isAutoUpdateSupported();
  if (skip) {
    log.info(`[auto-updater] ${skip}`);
    broadcast({ state: 'unsupported', reason: skip });
    return;
  }

  log.info('[auto-updater] checking for updates…');
  setTimeout(() => {
    // Tell the 'error' handler to swallow the next emit. autoUpdater
    // emits 'error' synchronously inside checkForUpdates() before
    // the returned promise rejects, so a plain .catch() runs too
    // late to prevent the banner.
    suppressNextError = true;
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('[auto-updater] scheduled check failed (silent):', message);
    }).finally(() => {
      // Defensive: if no 'error' event ever fired (e.g. the call
      // resolved cleanly), make sure the flag doesn't linger and
      // accidentally swallow a later legitimate error. Reset on
      // next tick so the synchronous error handler still gets to
      // see the flag set.
      setTimeout(() => { suppressNextError = false; }, 0);
    });
  }, 10_000);
}
