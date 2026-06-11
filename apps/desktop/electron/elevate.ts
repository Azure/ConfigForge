// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Process elevation — relaunch the app with admin / root privileges.
 *
 * **Why a relaunch instead of in-place elevation.** Neither Windows
 * UAC nor Linux polkit can elevate an already-running process; both
 * require spawning a NEW process under the privileged path. So
 * "elevate" really means: spawn a new instance elevated, then quit
 * the current unprivileged one.
 *
 * **Windows.** `Start-Process -Verb RunAs` triggers the standard UAC
 * consent dialog. We invoke it via PowerShell so we don't have to
 * marshal the COM `ShellExecute` call ourselves.
 *
 * **Linux.** `pkexec` opens a polkit auth dialog. Crucially, Electron
 * (Chromium sandbox) refuses to run as root by default — we MUST pass
 * `--no-sandbox` to the elevated process. The startup hook in
 * `main.ts` adds this switch automatically when `getuid() === 0` so
 * the elevated relaunch boots cleanly. Without `pkexec` installed
 * we fail loud rather than silently no-op.
 *
 * **macOS.** Out of scope for this iteration. macOS has `osascript -e
 * 'do shell script ... with administrator privileges'` but the
 * elevation model differs enough (per-tool sudoers, root-disabled-
 * by-default) that we surface "unsupported" instead of half-handling
 * it. Most macOS workflows don't need root for the OSConfig CLI.
 */
import { app, BrowserWindow } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isRemoteDesktopSession } from './platform-detection';
import { scoped } from './log';

// typed-logger rollout: this module's 6 prior `console.*` calls now
// route through a scoped electron-log wrapper. The scope tag matches
// the `[elevate]` prefix the legacy calls already used, so log output
// is bit-identical aside from going through electron-log's transports.
const log = scoped('elevate');

export type ElevationStatus =
  /** Already running elevated; nothing to do. */
  | 'already-elevated'
  /** Elevated process spawned successfully; current instance will quit shortly. */
  | 'launching'
  /** Required tooling missing (e.g. pkexec on Linux). */
  | 'missing-prerequisite'
  /** Platform doesn't have a supported elevation path (currently macOS). */
  | 'unsupported';

export interface ElevationResult {
  status: ElevationStatus;
  /** Optional human-readable detail for the UI. */
  message?: string;
}

/**
 * Detect whether the current process is already running with admin /
 * root privileges. Cheap synchronous check; safe to call from IPC
 * handlers without hitting the system-info cache.
 */
export function isCurrentProcessElevated(): boolean {
  if (process.platform === 'win32') {
    // Spawn a tiny PS one-liner. `whoami /groups` is faster than
    // building WindowsIdentity but fails silently in some locked-down
    // SKUs; the IsInRole check is the canonical answer.
    const r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
      ],
      { encoding: 'utf-8', timeout: 5000, windowsHide: true },
    );
    if (r.status !== 0 || !r.stdout) return false;
    return r.stdout.trim().toLowerCase() === 'true';
  }
  if (process.platform === 'linux' || process.platform === 'darwin') {
    // process.getuid is undefined on win32; node typings reflect that.
    return typeof process.getuid === 'function' && process.getuid() === 0;
  }
  return false;
}

/**
 * On Linux, when the app launches as root (e.g. via the pkexec
 * relaunch below), Electron's sandbox refuses to start the renderer
 * unless `--no-sandbox` is passed on the command line. This hook
 * detects the situation and adds the switch BEFORE `app.whenReady()`
 * — must be called at the very top of `main.ts` for the same reason
 * `protocol.registerSchemesAsPrivileged` is.
 *
 * No-op on every other platform / when not running as root.
 */
export function enableLinuxRootSandboxBypass(): void {
  if (process.platform !== 'linux') return;
  if (typeof process.getuid !== 'function') return;
  if (process.getuid() !== 0) return;
  app.commandLine.appendSwitch('no-sandbox');
}

/**
 * Spawn an elevated relaunch of the current app and quit the
 * unprivileged instance.
 *
 * Returns BEFORE calling `app.quit()` so the IPC handler can deliver
 * `{ status: 'launching' }` to the renderer. The quit is scheduled on
 * a short timer to let the elevated process actually start (and the
 * UAC / polkit dialog finish painting) before our window dies.
 *
 * If the user dismisses the UAC / polkit prompt, the elevated process
 * never spawns and the current instance still quits — there's no
 * cross-process signal to tell us the user cancelled. The renderer
 * SHOULD warn the user about this before calling.
 */
export async function relaunchElevated(): Promise<ElevationResult> {
  if (isCurrentProcessElevated()) {
    return {
      status: 'already-elevated',
      message: 'The app is already running with elevated privileges.',
    };
  }

  const exe = process.execPath;

  if (process.platform === 'win32') {
    // PowerShell `Start-Process -Verb RunAs <self>` triggers the
    // standard UAC consent dialog. We use single-quoted PS string
    // literals and escape any embedded single quotes by doubling
    // them, which is the PS-correct escape (NOT backslash).
    //
    // v0.1.4 fix — DO NOT pass `-NonInteractive` to PowerShell here.
    // UAC IS a system-level interactive prompt; the
    // `-NonInteractive` flag refuses any interactive activity and
    // silently no-ops the elevation request, with no PS output and
    // no UAC dialog. v0.1.3 had this flag set and produced the
    // "click button → nothing happens" failure mode reported on
    // Windows.
    //
    // We also use `-PassThru -ErrorAction Stop` on Start-Process so
    // PS exits non-zero when the user dismisses the UAC dialog.
    // That lets us listen for the exit code and KEEP the
    // unprivileged app running on cancel — far better UX than the
    // v0.1.3 behavior where we quit unconditionally on a 2s timer
    // regardless of whether elevation actually succeeded.
    const safeExe = exe.replace(/'/g, "''");
    // v0.1.7 fix — propagate RDP detection across UAC. UAC's
    // consent.exe broker spawns the new elevated process via
    // CreateProcessAsUser, and the user-shell-set environment
    // variables (`SESSIONNAME`, `CLIENTNAME`) are NOT reliably
    // inherited. The unprivileged process detects RDP fine, but the
    // elevated process sees an empty SESSIONNAME, fails the RDP
    // check, enables Mica, and renders blank-white through the RDP
    // framebuffer (the same v0.1.0 bug, just hitting the elevated
    // window). Command-line arguments DO survive ShellExecute, so
    // pass `--rdp-session` explicitly when we know we're in RDP and
    // let `platform-detection.isRemoteDesktopSession()` pick it up
    // on the elevated side.
    const argList = isRemoteDesktopSession() ? "-ArgumentList '--rdp-session' " : '';
    const psCommand =
      `try { ` +
      `  $p = Start-Process -FilePath '${safeExe}' ${argList}-Verb RunAs -PassThru -ErrorAction Stop; ` +
      `  if ($p) { exit 0 } else { exit 1 } ` +
      `} catch { ` +
      `  exit 2 ` +
      `}`;
    // v0.1.7 belt-and-suspenders — `windowsHide: true` on the spawn
    // option *should* hide the PS console, but on certain enterprise
    // SKUs (managed Windows with custom GPO around console hosts) the
    // console flashes visible for ~50ms before windowsHide takes
    // effect. Adding `-WindowStyle Hidden` to the PS invocation itself
    // closes that gap; PS applies the flag synchronously at startup,
    // before windowsHide gets a chance to lose the race.
    const child = spawn(
      'powershell',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCommand],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    // Listen for PS exit. Only quit our unprivileged instance when
    // PS reports a successful Start-Process (exit 0). On user-
    // cancel (exit 2 — UAC dismissed) or other failure (exit 1),
    // we stay running so the user can retry.
    return new Promise<ElevationResult>((resolve) => {
      let resolved = false;
      const finish = (result: ElevationResult) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      // 60s safety cap — `Start-Process -Verb RunAs` blocks until
      // the user responds to UAC. If the user walks away from the
      // dialog without dismissing it, we don't want to hang forever.
      const timeoutId = setTimeout(() => {
        finish({
          status: 'launching',
          message:
            'Elevation request sent. The app will close shortly when the elevated instance starts.',
        });
      }, 60_000);

      child.on('exit', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          finish({
            status: 'launching',
            message:
              'Elevation accepted. The unprivileged window will close shortly while the elevated instance starts.',
          });
          // Now and only now schedule the quit. The new elevated
          // process is already running; this window can safely die.
          hideAndQuit();
        } else if (code === 2) {
          // User clicked No / closed the UAC dialog.
          finish({
            status: 'unsupported',
            message:
              'The UAC prompt was dismissed. ConfigForge is still running with normal privileges — click "Restart as Administrator" again to retry.',
          });
        } else {
          finish({
            status: 'unsupported',
            message:
              `PowerShell could not launch the elevated process (exit code ${code ?? 'null'}). Check the Windows Event Viewer for ShellExecute errors, or relaunch the app from an Administrator PowerShell as a workaround.`,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        finish({
          status: 'unsupported',
          message: `Failed to spawn PowerShell: ${err.message}`,
        });
      });
    });
  }

  if (process.platform === 'linux') {
    // pkexec is part of polkit. Most modern Linuxes have it preinstalled,
    // but minimal cloud images / containers may not. Fail loud here
    // rather than spawning into the void.
    const pkexec = which('pkexec');
    if (!pkexec) {
      return {
        status: 'missing-prerequisite',
        message:
          '`pkexec` not found on PATH. Install policykit-1 (Debian/Ubuntu) ' +
          'or polkit (Fedora/RHEL/Arch) to enable in-app elevation, ' +
          'or relaunch the app from a root shell.',
      };
    }

    // v0.2.1b: ensure the X server lets root connect.
    //
    // Even after forwarding DISPLAY + XAUTHORITY, Ubuntu 22.04
    // GNOME-on-Wayland frequently rejects root's X11 connection
    // because the mutter Xauthority cookie is bound to the user's
    // UID. The standard workaround is `xhost +SI:localuser:root`,
    // which adds root as an authorized local user for the duration
    // of the elevated session. We run it best-effort: if xhost
    // isn't installed or the command fails, we still try the
    // pkexec call (it works on classic X11 sessions even without
    // this) and log the failure to stderr.
    const xhost = which('xhost');
    if (xhost) {
      try {
        const xr = spawnSync(xhost, ['+SI:localuser:root'], {
          encoding: 'utf-8',
          timeout: 3000,
        });
        if (xr.status !== 0) {
          log.warn(
            `xhost +SI:localuser:root exited ${xr.status}; ` +
              `stderr: ${(xr.stderr || '').trim()}`,
          );
        }
      } catch (e) {
        log.warn(`xhost invocation threw: ${(e as Error).message}`);
      }
    }

    // v0.2.1 fix: build argv via buildLinuxElevationArgv so AppImage
    // installs use the .AppImage file path (not the FUSE-mount
    // process.execPath, which pkexec can't reliably re-execute as
    // root), and so the elevated Electron process inherits DISPLAY /
    // XAUTHORITY / WAYLAND_DISPLAY / XDG_RUNTIME_DIR /
    // DBUS_SESSION_BUS_ADDRESS / etc. Without those env vars pkexec
    // succeeds but the elevated Electron renderer dies before
    // producing an exit code, which Node reports as `code: null`.
    const args = buildLinuxElevationArgv(exe, process.env, {
      isRdp: isRemoteDesktopSession(),
    });

    // v0.2.1b: capture stderr instead of discarding it, so when the
    // elevated process dies we can see the actual error message
    // instead of just "exited with code null". The elevated process
    // closes its stderr quickly so the read is bounded.
    log.info(
      `spawning: ${pkexec} ${args.map((a) => (a.includes('=') ? a : `"${a}"`)).join(' ')}`,
    );
    const child = spawn(pkexec, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let capturedStdout = '';
    let capturedStderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      capturedStdout += chunk.toString('utf-8');
      if (capturedStdout.length > 4096) capturedStdout = capturedStdout.slice(-4096);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      capturedStderr += chunk.toString('utf-8');
      if (capturedStderr.length > 4096) capturedStderr = capturedStderr.slice(-4096);
    });

    return new Promise<ElevationResult>((resolve) => {
      let resolved = false;
      const finish = (result: ElevationResult) => {
        if (resolved) return;
        resolved = true;
        // Always revoke the xhost grant on exit, regardless of outcome.
        if (xhost) {
          try {
            spawnSync(xhost, ['-SI:localuser:root'], { timeout: 3000 });
          } catch {
            /* ignore */
          }
        }
        resolve(result);
      };

      const timeoutId = setTimeout(() => {
        finish({
          status: 'launching',
          message:
            'Elevation request sent. The app will close shortly when the elevated instance starts.',
        });
      }, 60_000);

      child.on('exit', (code, signal) => {
        clearTimeout(timeoutId);
        // Log full diagnostic to the main-process console so the user
        // (or a support tech with a debug build) can read it from the
        // launcher terminal.
        log.info(
          `pkexec exit code=${code ?? 'null'} signal=${signal ?? 'none'}`,
        );
        if (capturedStdout) log.info(`pkexec stdout:\n${capturedStdout}`);
        if (capturedStderr) log.warn(`pkexec stderr:\n${capturedStderr}`);

        if (code === 0) {
          finish({
            status: 'launching',
            message:
              'Authentication accepted. The unprivileged window will close shortly while the elevated instance starts.',
          });
          hideAndQuit();
        } else if (code === 126) {
          finish({
            status: 'unsupported',
            message:
              'The polkit prompt was dismissed. ConfigForge is still running with normal privileges, click "Restart as Administrator" again to retry.',
          });
        } else if (code === 127) {
          finish({
            status: 'unsupported',
            message:
              'The current user is not authorized by polkit to elevate. Ask your administrator to grant the org.freedesktop.policykit.exec action, or relaunch the app from a root shell.',
          });
        } else {
          // Build a diagnostic-rich message: include exit code,
          // signal, and the tail of captured stderr so the renderer
          // toast surfaces something actionable instead of the
          // useless "exited with code null".
          const sigPart = signal ? `, killed by signal ${signal}` : '';
          const stderrTail = capturedStderr.trim();
          const stderrPart = stderrTail
            ? `\n\nCaptured error output:\n${stderrTail.slice(-1024)}`
            : '\n\nNo stderr was captured. Check /var/log/auth.log for polkit details, ' +
              'or relaunch the app from a root shell with `sudo configforge --no-sandbox`.';
          finish({
            status: 'unsupported',
            message: `pkexec exited (code=${code ?? 'null'}${sigPart}).${stderrPart}`,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        finish({
          status: 'unsupported',
          message: `Failed to spawn pkexec: ${err.message}`,
        });
      });
    });
  }

  // macOS, FreeBSD, etc.
  return {
    status: 'unsupported',
    message: `In-app elevation is not supported on ${process.platform}. Relaunch the app from a sudo shell instead.`,
  };
}

/**
 * Hide every BrowserWindow then quit on a short delay.
 *
 * **Why hide first.** On Windows, after UAC is accepted the new
 * elevated Electron process spawns alongside the old unprivileged
 * one. The old window stays visible until `app.quit()` actually
 * runs, and the new process's startup splash shows almost
 * immediately — so for 1-2 seconds the user sees TWO ConfigForge
 * windows side by side. The new one looks blank because it's still
 * on the splash, which reads as "the elevation prompt spawned a new
 * blank window" (the original v0.1.6 bug report). Hiding the old
 * window the instant we know elevation succeeded means only the new
 * elevated window is ever visible to the user.
 *
 * **Why a 100ms delay before quit.** `finish()` resolves the
 * `relaunchElevated` Promise; Electron's IPC layer serializes that
 * resolution back to the renderer at the next microtask. If we call
 * `app.quit()` synchronously the renderer process can be torn down
 * before the response flushes, leaving the renderer's `await
 * cfs.system.elevate()` hanging in the heartbeat between hide and
 * teardown. 100ms is enough for the response to round-trip and for
 * Windows to settle focus on the new elevated process; it's also
 * short enough that the user perceives the old window as
 * disappearing instantly.
 *
 * The previous 2-second delay (`scheduleQuit` in v0.1.4) was a
 * v0.1.3 leftover meant to give UAC time to render. Since v0.1.4 we
 * only reach this branch AFTER PowerShell exits 0 — which is AFTER
 * UAC was already dismissed — so the 2-second buffer served no
 * purpose and just made the side-by-side window overlap longer.
 */
function hideAndQuit(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    // Guard against destroyed windows — `hide()` on a destroyed
    // window throws "Object has been destroyed".
    if (!win.isDestroyed()) win.hide();
  }
  setTimeout(() => {
    app.quit();
  }, 100);
}

/**
 * Build the argv that pkexec runs to relaunch the app elevated on
 * Linux. Extracted as a pure function so the test suite can verify
 * the AppImage detection + GUI env forwarding without spawning
 * pkexec or actually elevating.
 *
 * AppImage detection: when an AppImage launches, AppRun sets
 * `APPIMAGE` to the absolute path of the .AppImage file on disk and
 * `APPDIR` to the FUSE squashfs mount that hosts the actual binary.
 * `process.execPath` points INTO the FUSE mount, which the elevated
 * process can't necessarily read (FUSE mounts are owned by the user
 * who mounted them, and pkexec changes UID). Relaunching the
 * .AppImage file itself triggers a fresh AppImage mount + boot under
 * root, which is the right thing to do.
 *
 * GUI env forwarding: pkexec resets the environment to root's defaults
 * by design (security hardening, see polkit man page). That means
 * the elevated Electron process has no DISPLAY (X11), no XAUTHORITY
 * (X cookie), no WAYLAND_DISPLAY, and no XDG_RUNTIME_DIR. The
 * renderer subprocess can't connect to the display server and exits
 * before producing an exit code -- Node reports that as `code: null`
 * on the child.exit event, which is the failure mode Amir
 * reported: "pkexec exited with code null".
 *
 * Wrapping the target in `/usr/bin/env KEY=VAL ... binary` forwards
 * the user's display env across the pkexec boundary so the elevated
 * GUI can actually render. `/usr/bin/env` is on pkexec's trusted
 * path on every Linux distribution.
 *
 * isRdp argument is forwarded so the caller can supply it from
 * `isRemoteDesktopSession()` without this pure function importing
 * the platform-detection module (which makes it harder to test).
 */
export function buildLinuxElevationArgv(
  execPath: string,
  env: NodeJS.ProcessEnv,
  options: { isRdp?: boolean } = {},
): string[] {
  const target = env.APPIMAGE ?? execPath;

  const forwardKeys = [
    // Display server selection
    'DISPLAY',
    'XAUTHORITY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'XDG_SESSION_TYPE',
    // GNOME on Ubuntu 22.04 needs the session bus address to be
    // forwarded; without it gnome-keyring auth + the org.freedesktop
    // portals fail and the renderer can die before it finishes the
    // chromium startup sequence.
    'DBUS_SESSION_BUS_ADDRESS',
    // Ubuntu 22.04 mutter writes the XWayland X cookie to a per-user
    // file referenced by XAUTHORITY; covers the case where DISPLAY is
    // set but XAUTHORITY isn't (Wayland-with-XWayland default).
    'GDMSESSION',
    'XDG_CURRENT_DESKTOP',
  ];
  const envForwards: string[] = [];
  for (const k of forwardKeys) {
    const v = env[k];
    if (v) envForwards.push(`${k}=${v}`);
  }

  /*
   * Ubuntu 22.04 GNOME-on-Wayland often has DISPLAY=:0 set (for the
   * XWayland bridge) but no XAUTHORITY env var; mutter generates a
   * cookie at /run/user/$UID/.mutter-Xwaylandauth.XXXXXX with a random
   * suffix per session. Without XAUTHORITY the elevated process tries
   * /root/.Xauthority which doesn't exist, so X connections fail and
   * Chromium dies before producing an exit code.
   *
   * Best-effort fix: when DISPLAY is set but XAUTHORITY isn't,
   * fall back to $HOME/.Xauthority (works on classic X11 sessions
   * and Ubuntu LightDM users). For Mutter Wayland users with no
   * .Xauthority at all, this is a no-op and they still need xhost.
   */
  if (env.DISPLAY && !env.XAUTHORITY && env.HOME) {
    envForwards.push(`XAUTHORITY=${env.HOME}/.Xauthority`);
  }

  const args: string[] = [];
  if (envForwards.length > 0) {
    args.push('/usr/bin/env', ...envForwards);
  }
  args.push(target, '--no-sandbox');
  if (options.isRdp) args.push('--rdp-session');
  return args;
}

/**
 * Cross-platform `which` — returns the absolute path of an executable
 * on PATH, or null if not found. We don't use the npm `which` package
 * because it pulls in extra dependencies for what's a 10-line check.
 *
 * @internal — exported for testability.
 */
export function which(cmd: string): string | null {
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT?.split(';') ?? ['.EXE']) : [''];
  const dirs = (process.env.PATH ?? '').split(sep).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      // Use forward-slash join to keep the implementation OS-agnostic;
      // both Win and POSIX accept forward slashes in absolute paths.
      const candidate = `${dir}/${cmd}${ext}`.replace(/\\/g, '/');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
