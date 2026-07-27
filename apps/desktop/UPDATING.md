# ConfigForge — Auto-update & Dependency Bumps

> Two distinct topics that share the same file:
>
> 1. **Auto-update flow** — how `electron-updater` ships the
>    in-app upgrade UX (Phase 11).
> 2. **Dependency pinning rules** — how to bump `electron`,
>    `electron-builder`, FluentUI, security tooling, etc. while
>    preserving the supply-chain guarantees introduced in v0.2.1 (CF-SEC-011 / 014).

---

## Part 1 — Auto-update (electron-updater)

`electron-updater` wires up against GitHub Releases. After
launch, the app silently checks for updates ~10 seconds later
and surfaces an in-app banner when a newer version is
available. Documented separately because it has subtle host
+ signing constraints.

## Update flow

```
                Phase 11 update flow
                ─────────────────────
   App launches
        │
        │ ~10s later
        ▼
   autoUpdater.checkForUpdates()  (main)
        │
        │ HTTP GET <release-host>/latest.yml
        ▼
   GitHub Releases (or your publish target)
        │
        │ {version: X.Y.Z, files: [...]}
        ▼
   ┌─────────────────────────────────────┐
   │ State events forwarded to renderer  │
   │ via cfs:update:status IPC           │
   └─────────────────────────────────────┘
        │
        ▼
   <UpdateBanner /> renders contextual CTA:
        ├── 'available'   → "Download" button
        ├── 'downloading' → progress bar
        ├── 'downloaded'  → "Restart to install" button
        └── 'error'       → "Retry" button

   User clicks Download
        │
        ▼
   cfs.update.download()  (renderer → main)
        │
        ▼
   autoUpdater.downloadUpdate()  (downloads in background)
        │
        ▼
   'update-downloaded' fires → banner switches to Restart CTA

   User clicks Restart
        │
        ▼
   cfs.update.quitAndInstall()  (renderer → main)
        │
        ▼
   autoUpdater.quitAndInstall(isSilent=true, isForceRunAfter=true)
        │  (current process quits, installer runs, new version boots)
        ▼
   New version running with all user state intact
```

## When auto-update is enabled

Auto-update fires only when ALL of these are true:

| Condition | Why |
|---|---|
| `app.isPackaged === true` | Dev mode (`electron .`) doesn't have an installer to update |
| `NODE_ENV` is `production` or unset | Tests + dev should never trigger network requests |
| `process.platform` is `win32` or `linux` (with `APPIMAGE` env) | macOS Author releases are separate and currently unsigned/not notarized; Linux deb/rpm/tar.gz update via package manager |

If any check fails, the renderer receives a `'unsupported'`
status with a human-readable reason and the banner stays
hidden. Logged to electron-log so you can inspect it via the
log file (Windows: `~/AppData/Roaming/ConfigForge/logs/main.log`,
Linux: `~/.config/ConfigForge/logs/main.log`).

## Where the update bits live

| File | Role |
|---|---|
| `apps/desktop/electron/auto-updater.ts` | Main-process state machine wiring electron-updater events ↔ IPC. Skip-condition checks. Configures electron-log. |
| `apps/desktop/electron/main.ts` | Calls `registerCfsAutoUpdaterHandlers()` + `scheduleAutoUpdateCheck()` in `app.whenReady()`. |
| `apps/desktop/electron/preload.ts` | Exposes `cfs.update.{getStatus, onStatus, check, download, quitAndInstall}` to the renderer. |
| `apps/desktop/src/components/UpdateBanner.tsx` | FluentUI MessageBar that renders a contextual CTA per state. |
| `apps/desktop/src/components/Layout.tsx` | Hosts `<UpdateBanner />` between `<TitleBar />` and the main app shell. |
| `apps/desktop/electron-builder.yml` | `publish: { provider: github, owner: Azure, repo: ConfigForge }` — makes packaged apps read `latest.yml` / `latest-linux.yml` from the canonical Microsoft repository. |

## Disabled by default in dev

`scheduleAutoUpdateCheck()` early-returns when `app.isPackaged === false`,
so `npm run desktop:dev` never makes network requests to check
for updates. The `<UpdateBanner />` renders nothing in that
state. To exercise the update UI in dev, mock the renderer
side via the test harness (`apps/desktop/vitest.setup.ts`
stubs `window.cfs.update`) — see `UpdateBanner.test.tsx` for
examples.

## Signing caveats

### Windows: packaged updater is wired, but builds are unsigned

ConfigForge release builds are **unsigned** by design. Windows refuses to
silently install an unsigned binary, so the **first install** of the NSIS
installer triggers the standard "Unknown publisher" / SmartScreen warning.
For updater installs, Windows expects the downloaded installer to satisfy OS
trust and silent-install requirements, including certificate compatibility
with the currently running binary. The auto-updater code still runs on
packaged Windows builds; it does not skip Windows based on signing state.
Expect unsigned public installers to fail those requirements. Update by
downloading and reinstalling the newer release manually. If you build and
self-sign your own installer locally (`scripts/generate-dev-cert.ps1`),
auto-update works on that single machine where the cert is trusted, but not
across users.

### Linux AppImage: no signing required

AppImage's update model uses a delta from `latest-linux.yml`
without code signing. As long as the AppImage is downloaded over
HTTPS from a trusted source (GitHub Releases qualifies), the
update is accepted.

### Linux deb / rpm / tar.gz: manual update

These three formats can't auto-update — deb/rpm are managed by
the system package manager (apt/dnf), and tar.gz is a portable
extract. `electron-updater` recognizes this and reports
`'unsupported'` with a clear reason; the banner stays hidden.
Users on these targets re-download manually from GitHub
Releases.

## CI publish flow

`.github/workflows/release.yml` runs on tag push (`v*.*.*`):

1. Builds installers on `windows-latest` + `ubuntu-latest`
2. Each runner builds with `--publish never` so checksums and SBOMs can be generated first.
3. The workflow uploads installers, `latest*.yml`, `SHA256SUMS-*.txt`, and SBOMs to the draft GitHub Release via `gh release upload`.
4. The release remains a **draft** until a human reviews + clicks Publish in the GitHub UI
5. Once published, running ConfigForge instances see the
   new version on their next 10-second post-launch check

Note: the `latest*.yml` files are what electron-updater fetches
to determine "is there a newer version?". electron-builder
generates them automatically — you don't write them by hand.
The schema is `{version, files: [{url, sha512, size}],
releaseDate, ...}`.

## Disabling auto-update for a build

If you want to ship a build that NEVER auto-updates (kiosk
deployment, offline-only environment, etc.):

1. Set `publish: null` in `electron-builder.yml` before building
2. Or set `app.isPackaged = false` (don't do this; it breaks
   other things)
3. Or build with `NODE_ENV=ci` so the skip condition fires

Long-term: a Settings page toggle that calls a
`cfs.update.setEnabled(false)` IPC channel would persist this
preference into `~/.configforge/settings.json`. No Settings toggle is exposed yet.

## Manual "Check for updates" trigger

For users who want to check on demand (rather than waiting for
the 10s post-launch poll), expose a button in your Settings
page that calls:

```typescript
import { cfs } from '../lib/cfs';

async function manualCheck() {
  const status = await cfs.update.check();
  // status.state === 'available' | 'not-available' | 'error' | ...
}
```

The banner subscribes to the same `cfs:update:status` event
stream regardless of whether the check was scheduled or
manual, so the user gets the same UX either way.

## Testing the update flow end-to-end

End-to-end testing is harder than testing individual states
because it requires:

1. An installer at version N (Linux AppImage, or a locally self-signed
   Windows build — unsigned public Windows installers are expected to fail OS
   trust or silent-install requirements)
2. An installer at version N+1 hosted somewhere
   electron-updater can fetch
3. The currently-running app at version N pointing at the
   feed that lists version N+1

For Phase 11 we ship per-state vitest coverage (8 tests in
`apps/desktop/src/components/UpdateBanner.test.tsx`) and
document the manual end-to-end test:

1. Build and install version N on a test machine.
2. Bump the app version to N+1.
3. Build locally: `npm run desktop:dist:win` (Windows auto-update only works with a locally trusted self-signed cert — see `scripts/generate-dev-cert.ps1`; otherwise test the Linux AppImage path).
4. Create the N+1 GitHub Release and assets, verify them while the release is
   a draft, then publish the release. For private testing, use a test feed
   that the running app can access.
5. Launch version N — within 10–15 seconds the UpdateBanner should appear with
   the N+1 version.
6. Click Download → progress bar → "Restart to install" → app quits, installer runs silently, N+1 boots.

If the banner never appears, check:
   - `latest.yml` exists in the release at the expected URL
   - (self-signed Windows only) the current app's cert chain matches
     the new installer's
   - electron-log file (`~/AppData/Roaming/ConfigForge/logs/main.log`)
     for any electron-updater errors

## Phase 12+ ideas (not yet planned)

- **Settings page UI** for "auto-check for updates" toggle +
  "Check for updates now" button (currently the renderer has
  the API but no UI surface beyond the banner)
- **Update channels** (alpha / beta / stable) via
  `autoUpdater.channel` — useful once we have a real release
  cadence
- **Differential updates** — electron-updater supports them on
  Windows via the blockmap files we already produce; just need
  to verify the publisher creates them correctly
- **Telemetry** for update success/failure rates (potential future, opt-in only; none collected today — see [PRIVACY.md](../../PRIVACY.md))

---

## Part 2 — Dependency pinning rules

The supply-chain hardening that landed in v0.2.1 (CF-SEC-011 +
CF-SEC-014) is enforced by the release workflow but relies on
contributors picking the right specifier when bumping a package.
The rules:

### Pin specifiers by category

| Category | Specifier | Why |
|---|---|---|
| `electron` | **tilde** (`~42.0.1`) | Minor / major bumps need security review (V8, Chromium CVEs). Patch bumps land automatically. **CF-SEC-014.** |
| `electron-builder` | **tilde** (`~26.8.1`) | Release tooling. Combined with `npx --no-install` (CF-SEC-011), this constrains the release toolchain to the locked version. |
| `@cyclonedx/cyclonedx-npm` | **exact** (no `^` / `~`) | SBOM generator. Reproducible SBOMs require exact pinning so the same `npm ci` produces byte-identical metadata. Bump via `npm install --save-exact`. |
| `prettier`, `eslint-config-prettier` | **exact** | Formatter divergence between contributors / CI is painful. Bump via `npm install --save-exact`. |
| Everything else (React, FluentUI, `js-yaml`, `pdfkit`, etc.) | **caret** (`^`) — default npm behaviour | Standard SemVer trust. |

When bumping a tilde- or exact-pinned package, **explicitly state
the specifier** in the PR description so reviewers can spot a
silent downgrade to caret.

### Bump workflow

Routine bump of a caret-pinned dep:

```bash
# Always within the apps/desktop workspace so package-lock.json
# updates at the root.
cd apps/desktop
npm install @fluentui/react-components@latest
```

Bump of a tilde-pinned dep (electron / electron-builder):

```bash
cd apps/desktop
npm install --save-exact electron@42.0.2     # then hand-edit to ~42.0.2
# (npm has no built-in --save-tilde flag — easiest path is
# --save-exact then change the leading char in package.json,
# then re-run `npm install` to refresh the lockfile entry.)
```

Bump of an exact-pinned dep (cyclonedx / prettier):

```bash
cd apps/desktop   # or root, depending on where the dep lives
npm install --save-exact @cyclonedx/cyclonedx-npm@2.0.0
```

After any bump, run the local pre-PR gate:

```bash
npm ci                                     # confirm lockfile reproduces
npm run lint
npm test
npm run desktop:build
npm audit --omit=dev --audit-level=high   # CF-SEC-014 — release gate
```

### npm bug #4828 — Windows lockfile caveat

The `package-lock.json` carries platform-specific optional
binaries (notably the Linux Rollup binary needed by `vite` on
`ubuntu-latest` CI). npm bug
[#4828](https://github.com/npm/cli/issues/4828) silently drops
optional binaries for *other* platforms when you run
`npm install` on a fresh Windows checkout without
`--include=optional`. The result: CI on `ubuntu-latest` fails
to resolve `@rollup/rollup-linux-x64-gnu`, with a confusing
error that points at Vite rather than at the lockfile.

**The safe paths:**

1. **`npm ci`** for routine work. It is read-only on the
   lockfile and reproduces exactly what's checked in. This is
   the recommended default on every contributor machine.
2. **`npm install <pkg>` (additive)** when bumping a single
   dependency. The additive form preserves existing lockfile
   entries (including the cross-platform optionals) and only
   touches the entries it has to change.
3. **`npm install --include=optional`** if you genuinely need
   to rebuild the lockfile from scratch on Windows. This forces
   npm to retain the Linux-only optional entries instead of
   pruning them.

**The unsafe path** (do not do this on Windows):

```bash
# DON'T — drops the Linux Rollup binary from the lockfile.
rm -rf node_modules package-lock.json
npm install
```

The same anti-pattern on Linux is fine — it just produces a
lockfile missing the Windows-only optionals, which CI's Linux
runner doesn't notice but the Windows runner then chokes on
the next push. The symmetric rule: **never regenerate the
lockfile on a single-OS box; always use the additive form**.

### When to bump

| Trigger | Action |
|---|---|
| `npm audit --omit=dev --audit-level=high` flags a high/critical advisory | Bump immediately. The release workflow will refuse to ship otherwise. |
| Electron releases a security patch | Bump `electron` tilde-version, run the smoke test in [`PACKAGING.md`](./PACKAGING.md), and tag a release. |
| Electron releases a minor (e.g. 42 → 43) | Separate PR, run full test suite + Playwright E2E, audit any preload API changes. |
| FluentUI releases a minor with prop changes | Caret already permits; verify rendering didn't break + bump. |
| You need a new feature from a newer version | Bump targeted; document the user-visible impact in the PR description. |

### Where pins live

- **`apps/desktop/package.json`** — `electron`, `electron-builder`,
  FluentUI, React, Vite, `pdfkit`, `electron-log`,
  `electron-updater`, `monaco-editor`. Most app-facing pins.
- **Root `package.json`** — workspace-wide devDeps:
  `@cyclonedx/cyclonedx-npm`, `prettier`, `eslint`,
  `eslint-config-prettier`, `vitest`, `playwright`, `typescript`.
- **`packages/core/package.json`** — `js-yaml` only (core stays
  dependency-light by design; everything else is `devDependencies`).

Reviewers: when a PR touches any of these files, eyeball the
specifier characters for `electron` / `electron-builder` (must
be `~`) and for the exact-pinned tooling (must have no `^` or
`~` prefix).
