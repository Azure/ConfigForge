// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Electron main process — production wireup as of Phase 4-F.
 *
 * Boot sequence (order matters):
 *   1. registerSchemesAsPrivileged BEFORE app.ready — Chromium needs
 *      cfs-blob:// declared as a privileged scheme (standard, secure,
 *      streamable) before any window can load.
 *   2. installElectronPathStrategy after app.ready — wires the runtime
 *      paths abstraction (oscfg binary dir, temp, user data, public
 *      assets) through to Electron's own resource paths in production
 *      and to the repo layout in dev.
 *   3. installBaselineCatalog + registerCfsIpcHandlers — typed IPC
 *      contract for the renderer.
 *   4. registerCfsBlobProtocol — handles cfs-blob://audit-pack/<id>
 *      and cfs-blob://export/<name> for inline iframe preview.
 *   5. createMainWindow — finally open the UI.
 *
 * Security posture (locked from Phase 0, never regress):
 *   - contextIsolation: true
 *   - sandbox: true
 *   - nodeIntegration: false
 *   - will-navigate guard restricts navigation to dev server / file://
 *     / cfs-blob:// only
 *   - setWindowOpenHandler routes external URLs to the user's browser
 */
import { app, BrowserWindow, Menu, nativeTheme, protocol, shell } from 'electron';
import path from 'node:path';
import { rm, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import { installElectronPathStrategy } from './runtime-paths';
import { registerCfsIpcHandlers, installBaselineCatalog } from './ipc-handlers';
import { log } from './log';
// perf W2 / H10: keep `registerCfsAutoUpdaterHandlers` eager so the
// renderer's UpdateBanner can subscribe to `cfs:update:status`
// immediately on first paint (otherwise we hit a race where the
// renderer subscribes before main has a handler registered, and the
// initial `getStatus()` call rejects). The actual update-check HTTP
// request — which pulls electron-updater + electron-log network code
// hot — is deferred to `setTimeout(..., 10_000)` below.
import { registerCfsAutoUpdaterHandlers } from './auto-updater';
import { registerCfsBlobProtocol } from './protocol-handler';
import { isMicaSupported, isRemoteDesktopSession } from './platform-detection';
import { enableLinuxRootSandboxBypass } from './elevate';
import { buildShouldAllowRendererNavigation } from './navigation-guard';
import { BASELINE_CATALOG } from '../src/data/baseline-catalog';

const isDev = process.env.NODE_ENV === 'development';
const VITE_DEV_SERVER_URL = 'http://localhost:5173';
const electronDir = __dirname;

// v0.1.3 Linux elevation: when the app is relaunched as root via
// `pkexec` (the in-app "Elevate" flow in Settings), Chromium's sandbox
// refuses to start the renderer unless `--no-sandbox` is on the
// command line. This must be set BEFORE `app.whenReady()` resolves —
// see `electron/elevate.ts` for the full rationale. No-op on Windows /
// macOS / non-root Linux.
enableLinuxRootSandboxBypass();

/**
 * Mica is only used when the host can actually composite it correctly:
 * Win11 22000+ AND not in an RDP / Azure DevBox / Citrix session. See
 * `electron/platform-detection.ts` for the full rationale (RDP can't
 * transport DirectComposition surfaces; without the RDP guard, every
 * remote teammate gets a blank-white window because their compositor
 * receives solid white where the Mica region should be).
 */
const micaSupported = isMicaSupported();

// v0.1.1 RDP fix — belt-and-suspenders. The primary fix for the
// blank-white-window-on-DevBox bug is gating Mica off (above), but
// hardware-accelerated composition itself is also unreliable over
// RDP: DirectComposition, swap chains, and OcclusionTracking all
// have known transport issues. Disabling GPU acceleration when we
// detect an RDP session falls back to the CPU compositor, which
// produces a plain bitmap that RDP can transport reliably. Cost:
// ~10-30% slower scrolling animations in the remote session, which
// is invisible compared to a blank window. Local sessions are
// unaffected.
//
// Must be called BEFORE app.whenReady() — the GPU process forks
// during ready and can't be reconfigured after.
if (isRemoteDesktopSession()) {
  app.disableHardwareAcceleration();
  // disable-features=CalculateNativeWinOcclusion is the documented
  // workaround for the related Win11 occlusion-tracker bug that
  // freezes painting on remote sessions. Cheap, safe to always set
  // when we're already on the RDP code path.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// Register custom schemes BEFORE app.ready so Chromium treats them as
// privileged (same-origin, supports streams + fetch + iframe loads).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cfs-blob',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

// Phase 10 follow-up: prefix with _ to satisfy no-unused-vars. The
// reference is kept for Phase 11 (electron-updater) which will need a
// handle to the main window to push update notifications.
let _mainWindow: BrowserWindow | null = null;

/**
 * Build the main BrowserWindow.
 *
 * **Mica backdrop (Win11 22000+ only).** When `micaSupported` is true we
 * pass `backgroundMaterial: 'mica'`, which makes the OS composite the
 * desktop wallpaper through the window with a subtle blur. Electron 26+
 * supports this option; we're on 33 so it's first-class. The option is
 * a silent no-op on builds < 22000, but we gate at the app level too so:
 *
 *   1. `backgroundMaterial` only appears in the constructor options on
 *      hosts that can actually render it — keeps the option surface
 *      honest and easy to grep for.
 *   2. The renderer can read a single source-of-truth flag (exposed via
 *      preload, follow-up commit) instead of duplicating the detection.
 *
 * **Cold-start fallback.** `backgroundColor: '#1f1f1f'` is the color the
 * window paints in the brief window between OS frame creation and the
 * first React paint. On non-Mica builds it's also the resting bg if the
 * renderer's body stays opaque (which is the default — the renderer only
 * makes body transparent when the main process confirms Mica is active).
 *
 * **Renderer contract** (per `apps/desktop/src/design/PLATFORM.md`):
 *   - Body background must be transparent ONLY when Mica is confirmed
 *     active by the main process; otherwise Mica's silent-fallback
 *     behavior would expose a black void.
 *   - All legibility (text contrast, focus rings, etc.) MUST be designed
 *     against the SOLID fallback canvas color, not against Mica. Mica is
 *     pure decoration.
 *   - Follow-up: expose `cfs.platform.materialActive` via preload so the
 *     renderer can toggle a `mica-active` class on `documentElement`,
 *     and add `.mica-active body { background: transparent }` to
 *     `foundation.css`. Until then the renderer renders the solid
 *     fallback regardless of platform — which is correct, just not the
 *     fancy variant.
 */
function createMainWindow(): BrowserWindow {
  // v0.1.5: defer-show + theme-adaptive boot color.
  //
  // `show: false` keeps the window invisible until first paint —
  // eliminates the gray-flash-then-fill experience the v0.1.4 build
  // had where users saw an empty `#1f1f1f` rectangle while React
  // hydrated. `ready-to-show` fires once the renderer has painted
  // its first frame (the boot splash from index.html), so by the
  // time the window appears the user already sees branded loading
  // state.
  //
  // `backgroundColor` is what the OS shows during the < 100ms gap
  // between window creation and first paint. We track the OS theme
  // so a dark-mode user doesn't get a white flash, and a light-mode
  // user doesn't get a black flash. The exact colors match the
  // index.html splash + foundation.css canvas tokens so there's
  // zero color shift at any boundary.
  const bootBackground = nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#fafafa';

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: bootBackground,
    show: false,
    autoHideMenuBar: true,
    ...(micaSupported ? { backgroundMaterial: 'mica' as const } : {}),
    // v0.1.0 hot-fix: dropped the custom frameless titlebar that
    // Phase 6 introduced. The frameless approach (`titleBarStyle:
    // 'hidden'` + `titleBarOverlay` + a `<TitleBar>` React drag
    // strip) was visually nicer but had Win11 reliability problems:
    // resizing/minimize/restore occasionally ate cursor input near
    // edges, restoring from minimized rendered with stale Mica
    // composite, and the overlay symbol-color theme update had race
    // conditions on wake-from-sleep. Native frame is reliable;
    // Mica still works through the OS-drawn frame on Win11 22000+.
    //
    // The `<TitleBar>` React component is kept as a no-op stub so
    // re-enabling the custom-titlebar approach in Phase 12+ is a
    // one-line change here + restoring its return value.
    webPreferences: {
      preload: path.join(electronDir, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // v0.1.5 deferred-show wiring with safety fallback.
  //
  // Standard pattern: show the window only after `ready-to-show`
  // fires (= renderer painted its first frame). On a cold boot
  // that's typically 200-600ms after BrowserWindow creation.
  //
  // Safety fallback: if the renderer crashes or Vite/loadFile fails
  // before any frame paints, `ready-to-show` would never fire and
  // the user would see... nothing, with no way to know the app even
  // launched. A 5s timeout calls `win.show()` anyway so the user
  // sees SOMETHING (the bootBackground color, possibly a partially-
  // rendered DOM, or an Electron error page) instead of staring at
  // an empty taskbar icon.
  //
  // We also attach `did-fail-load` so genuine renderer failures
  // surface fast — that's a v0.2.x improvement.
  let shown = false;
  const showOnce = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once('ready-to-show', showOnce);
  setTimeout(showOnce, 5000);

  // Defense-in-depth: refuse to open new windows for arbitrary URLs.
  // External http(s) opens in the default browser; everything else is
  // denied.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Vite outputs to ./dist (relative to apps/desktop/), and esbuild
    // puts main.js at ./dist/electron/main.js, so index.html is one
    // directory up.
    void win.loadFile(path.join(electronDir, '..', 'index.html'));
  }

  win.on('closed', () => {
    _mainWindow = null;
  });

  // v0.1.2: wire fullscreen + standard window keyboard shortcuts.
  //
  // The previous build had `autoHideMenuBar: true` with no application
  // menu defined. That removed every standard accelerator the OS would
  // normally provide (View > Toggle Full Screen / F11, Window > Close /
  // Cmd+W, Edit > Copy/Paste, etc.) — users had no way to enter
  // fullscreen at all.
  //
  // Two-layer wiring so the shortcuts work regardless of menu state:
  //
  //   1. `before-input-event` on `webContents` traps the keystrokes
  //      BEFORE they reach the renderer, so the React tree can't
  //      accidentally intercept (e.g. a contenteditable div catching
  //      F11). This handles F11 (Win/Linux), Ctrl+Cmd+F (macOS), and
  //      Esc to exit fullscreen.
  //
  //   2. We still install a hidden application menu (autoHideMenuBar
  //      stays true so it's invisible by default; Alt reveals it on
  //      Win/Linux, the macOS menu bar shows it as usual). The menu
  //      gives screen readers + keyboard-navigation users a discoverable
  //      surface and lets all the standard Edit/Window shortcuts work
  //      without us hand-rolling each one.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // F11 (Windows + Linux) — toggle fullscreen.
    if (input.key === 'F11' && !input.alt && !input.control && !input.meta && !input.shift) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
      return;
    }

    // Ctrl+Cmd+F (macOS standard) — toggle fullscreen.
    if (process.platform === 'darwin' && input.key === 'f' && input.control && input.meta) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
      return;
    }

    // Escape exits fullscreen if currently fullscreen. We do NOT trap
    // Esc otherwise — the renderer needs it for modals / cancel.
    if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
      return;
    }
  });

  return win;
}

/**
 * Build the application menu.
 *
 * Kept hidden via `autoHideMenuBar: true` on the BrowserWindow so the
 * default Win/Linux UI looks chromeless, but installing the menu is
 * still important because:
 *   - macOS REQUIRES an application menu (otherwise the OS shows the
 *     "default Electron" menu, which has irrelevant items).
 *   - Standard accelerators (Cmd+Q, Cmd+W, Cmd+M, Cmd+C/V/X, etc.)
 *     only fire when a corresponding menu item exists with that role.
 *   - Screen readers and Alt-menu users on Windows can still reach
 *     File / Edit / View / Window / Help.
 *
 * `role` items use Electron's built-in localized labels, so this menu
 * works in every UI language without a translation table.
 */
function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu (no-op on Win/Linux).
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: '&File',
      submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        // Native fullscreen toggle. Electron auto-binds the platform
        // accelerator (F11 on Win/Linux, Ctrl+Cmd+F on macOS).
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: '&Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? ([
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ] as Electron.MenuItemConstructorOptions[])
          : ([{ role: 'close' as const }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

app.whenReady().then(() => {
  installElectronPathStrategy();
  installBaselineCatalog(BASELINE_CATALOG);
  registerCfsIpcHandlers();
  registerCfsAutoUpdaterHandlers();
  registerCfsBlobProtocol();

  // v0.3.0 (#22): catchall handlers for unhandled exceptions in the
  // main process. Without these, a stray throw from an IPC handler
  // after the response was sent — or an `unhandledRejection` from a
  // fire-and-forget `updateRegistration` call inside `deploy.ts` —
  // crashes the app with no user-visible signal. During private
  // preview we'd rather log + keep running than silently die.
  process.on('uncaughtException', (err) => {
    try {
      log.error('[main] uncaughtException:', err?.message ?? String(err), err?.stack);
    } catch {
      /* logger itself failed; swallow */
    }
  });
  process.on('unhandledRejection', (reason) => {
    try {
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;
      log.error('[main] unhandledRejection:', msg, stack);
    } catch {
      /* logger itself failed; swallow */
    }
  });

  // v0.3.0 (#21): sweep stale rationale lock files. A process killed
  // mid-`appendRationale` leaves `<ns>.jsonl.lock` on disk; the next
  // save then spin-waits ~1s and bails with "could not acquire lock"
  // — a confusing error for the user that requires manual cleanup
  // they typically can't do (managed machines, hidden userData
  // dirs). Sweep at startup: anything older than 5 minutes is by
  // definition orphaned because the in-process lock is held for
  // milliseconds. Best-effort; logged but never throws.
  void (async () => {
    try {
      const root = path.join(
        process.env.CONFIGFORGE_HOME ?? path.join(os.homedir(), '.configforge'),
        'rationale',
      );
      const entries = await readdir(root).catch(() => [] as string[]);
      const cutoff = Date.now() - 5 * 60_000;
      let cleaned = 0;
      for (const name of entries) {
        if (!name.endsWith('.lock')) continue;
        const full = path.join(root, name);
        try {
          const s = await stat(full);
          if (s.mtimeMs < cutoff) {
            await rm(full, { force: true });
            cleaned++;
          }
        } catch {
          /* race with another writer; skip */
        }
      }
      if (cleaned > 0) log.info(`[main] swept ${cleaned} stale rationale lock file(s)`);
    } catch (err) {
      log.warn('[main] stale-lock sweep failed:', err instanceof Error ? err.message : String(err));
    }
  })();

  // v0.1.2: install the application menu so standard accelerators
  // (F11/Ctrl+Cmd+F fullscreen, Cmd+Q quit, Cmd+W close, copy/paste)
  // work. autoHideMenuBar on the BrowserWindow keeps it visually hidden
  // on Win/Linux. See buildApplicationMenu() for the rationale.
  Menu.setApplicationMenu(buildApplicationMenu());

  _mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      _mainWindow = createMainWindow();
    }
  });

  // Phase 11: schedule the first auto-update check ~10 seconds after
  // the window paints. perf W2 / H10: dynamic-import the schedule
  // function so the actual electron-updater HTTP fetch (and its
  // transitive logger config) doesn't compete with first paint. The
  // IPC handlers (`cfs:update:get-status`, etc.) were registered
  // eagerly above so the renderer can subscribe immediately.
  // Skipped in dev (NODE_ENV !== 'production') and on Linux
  // non-AppImage targets — see auto-updater.ts for the full guard
  // logic.
  setTimeout(() => {
    void import('./auto-updater.js').then(({ scheduleAutoUpdateCheck }) => {
      scheduleAutoUpdateCheck();
    });
  }, 10_000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Belt-and-suspenders: refuse to navigate the renderer to anywhere
// outside the bundled UI. Allowed origins:
//   - dev:        http://localhost:5173 (Vite dev server, exact origin)
//   - prod:       packaged index.html file:// URL (exact path, with
//                 optional `#/route` SPA fragment)
//   - everywhere: cfs-blob:// (handled by registerCfsBlobProtocol,
//                 which enforces its own route + format allowlist)
//
// CF-SEC-001 — the previous `startsWith('file://')` allowlist let any
// local file path through (e.g. `file:///etc/passwd`,
// `file://server/share/...`). Even with contextIsolation + sandbox the
// renderer could navigate to arbitrary local content. The guard now
// matches the packaged index.html exactly and rejects every other
// scheme. See `navigation-guard.ts` for the standalone (testable)
// implementation.
const shouldAllowRendererNavigation = buildShouldAllowRendererNavigation({
  electronDir,
  isDev,
  devServerUrl: VITE_DEV_SERVER_URL,
});

app.on('web-contents-created', (_evt, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (!shouldAllowRendererNavigation(navigationUrl)) {
      // eslint-disable-next-line no-console
      console.warn('[main] blocked navigation to', navigationUrl);
      event.preventDefault();
    }
  });
});
