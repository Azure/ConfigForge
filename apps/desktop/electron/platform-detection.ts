// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Platform detection helpers used by both `main.ts` (BrowserWindow
 * construction) and `ipc-handlers.ts` (renderer-facing platform
 * snapshot). Extracted into its own module so it can be unit-tested
 * — main.ts has too many top-level Electron side-effects to import
 * from a vitest worker.
 *
 * All functions return `false` on non-Windows platforms; remote-session
 * concepts are Windows-specific in the way they affect us (xrdp on Linux
 * and Screen Sharing on macOS don't have the same DirectComposition
 * transport problem).
 */
import os from 'node:os';

/**
 * Win11 22000+ detection.
 *
 * `os.release()` returns the NT kernel string (e.g. `"10.0.22631"`).
 * Win11 is still NT 10.0; the build number is what distinguishes 11 from
 * 10. Build 22000 is the Win11 RTM cutoff (Sun Valley) used by Microsoft
 * everywhere, including the official Electron docs for `backgroundMaterial`.
 *
 * `_env` is accepted for API symmetry with `isRemoteDesktopSession` (so
 * a test can stub the whole detection module with a single call shape)
 * but is intentionally unused — the OS version is read from `os.release()`,
 * not from environment variables.
 */
export function isWindows11OrLater(_env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  const release = os.release();
  const parts = release.split('.');
  const build = parseInt(parts[2] ?? '0', 10);
  return parts[0] === '10' && build >= 22000;
}

/**
 * Detect whether the current process is running inside a Windows Remote
 * Desktop session (mstsc, Windows App, Azure Virtual Desktop, Azure
 * DevBox cloud PC).
 *
 * **Why this matters for us.** `backgroundMaterial: 'mica'` (and any
 * other DWM DirectComposition-backed effect) is composited on the
 * **host** GPU and then the OS tries to transport the result through
 * the RDP framebuffer channel. Microsoft's RDP graphics pipeline does
 * not transport DirectComposition translucency surfaces correctly —
 * the affected regions arrive at the client as solid white, producing
 * a window that looks completely blank even though the renderer painted
 * normally (CDP `Page.captureScreenshot` confirms the content is there).
 * This bites Azure DevBox users hard; v0.1.0 shipped with Mica
 * unconditionally enabled and produced a blank-white window for every
 * teammate connecting via Windows App / mstsc.
 *
 * **Detection signals (in priority order).**
 *   1. **`--rdp-session` command-line flag.** Set by `elevate.ts` when
 *      it relaunches the app under UAC and detected RDP itself. UAC's
 *      `consent.exe` broker spawns the elevated child via
 *      `CreateProcessAsUser`, which does NOT reliably propagate the
 *      shell env vars below — so the elevated process otherwise misses
 *      RDP, enables Mica, and renders blank-white. v0.1.7 fix.
 *   2. **`SESSIONNAME` env var** starts with `"rdp-"` (case-insensitive).
 *      Local console sessions report `"Console"`. mstsc reports
 *      `"RDP-Tcp#N"`; Azure DevBox reports `"rdp-sxs..."`; Windows App
 *      follows the same convention.
 *   3. **`CLIENTNAME` env var** is set to a non-empty value other than
 *      `"Console"`. RDP sets this to the originating client's hostname;
 *      local sessions either don't set it or set it to "Console".
 *
 * **Known limitations.** This heuristic does NOT cover every remote-
 * display stack. Untested:
 *   - Some Citrix XenDesktop configurations leave `SESSIONNAME` as
 *     `"Console"` and don't set `CLIENTNAME` for ICA sessions.
 *   - Game-streaming protocols (Parsec, Sunshine, Moonlight) don't
 *     set RDP env vars because they don't go through RDP.
 *   - Linux/macOS remote-display stacks (xrdp, Screen Sharing) — we
 *     return `false` on non-Windows because Mica is a Windows-only
 *     concept anyway.
 *
 * If a non-RDP remote-display user reports a similar blank-window bug,
 * the right next step is to add a Windows-native signal via
 * `GetSystemMetrics(SM_REMOTESESSION)` through a small native add-on
 * or `wts.dll` FFI — currently out of scope for the hotfix.
 *
 * Returns `false` on non-Windows platforms.
 */
export function isRemoteDesktopSession(
  env = process.env,
  platform = process.platform,
  argv: readonly string[] = process.argv,
): boolean {
  if (platform !== 'win32') return false;
  // 1. Explicit flag from the unprivileged parent during UAC relaunch.
  //    Authoritative — it was set by code that just confirmed RDP via
  //    its own (uncorrupted) env vars.
  if (argv.includes('--rdp-session')) return true;
  // 2. Standard RDP shell env var.
  const sessionName = env.SESSIONNAME?.toLowerCase() ?? '';
  if (sessionName.startsWith('rdp-')) return true;
  // 3. Client hostname env var (set when ANY client connects via RDP,
  //    even if SESSIONNAME isn't an `rdp-*` form).
  const clientName = env.CLIENTNAME?.trim() ?? '';
  if (clientName.length > 0 && clientName.toLowerCase() !== 'console') return true;
  return false;
}

/**
 * Mica is only used when the host can actually composite it correctly:
 * Win11 22000+ AND not in an RDP session. See `isRemoteDesktopSession`
 * for the full RDP rationale.
 */
export function isMicaSupported(
  env = process.env,
  platform = process.platform,
  argv: readonly string[] = process.argv,
): boolean {
  return isWindows11OrLater(env, platform) && !isRemoteDesktopSession(env, platform, argv);
}
