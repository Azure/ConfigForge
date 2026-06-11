# Platform Adaptation Rules

ConfigForge targets Windows 10 / 11 and Linux (Ubuntu 22.04+ / Fedora 39+ verified) from the `main` branch. A separate macOS author-only flavor lives on the `mac-author-build` branch (see ["macOS author flavor"](#macos-author-flavor) below). Some experiences are Windows-flagship and degrade on other platforms; this doc lists the rules so reviewers can flag missing fallbacks.

> **Audience:** anyone reviewing renderer / Electron PRs. If you change anything in `apps/desktop/src/`, this doc is the contract that says whether your change needs a Linux or Win10 fallback.

## Detection

Renderer-side detection happens in `apps/desktop/src/lib/platform.ts` (Phase 6 will add this). The detector exposes:

- `isWindows()` — `navigator.userAgent` contains `"Windows"` OR Electron `process.platform === 'win32'`
- `isWindows11()` — Windows AND `Math.floor(<build>) >= 22000` from `os.release()` exposed via preload
- `isLinux()` — `process.platform === 'linux'`
- `prefersDark()` — `window.matchMedia('(prefers-color-scheme: dark)').matches`
- `prefersReducedMotion()` — `window.matchMedia('(prefers-reduced-motion: reduce)').matches`
- `prefersForcedColors()` — `window.matchMedia('(forced-colors: active)').matches`

**Rule:** detect once at app boot, expose via a React context, and never call `navigator.userAgent` directly in component code. This keeps platform branches greppable (`isWindows(` or `useIsWindows()`) and unit-testable.

## Materials (Mica + Acrylic)

| Platform | Window backdrop | Implementation |
|---|---|---|
| Win11 22000+ | Mica (semi-transparent over desktop wallpaper) | `BrowserWindow({ backgroundMaterial: 'mica' })` in `main.ts` |
| Win10 / Win11 < 22000 | Solid neutral (`#FAFAFA` light / `#1F1F1F` dark) | Default `BrowserWindow`, body bg from `foundation.css` |
| Linux | Solid neutral | Default `BrowserWindow` (KDE / GNOME may add their own decoration) |

**Rule:** never make legibility depend on Mica. Body text contrast must be valid against the SOLID fallback color — design and verify against `--cfs-color-bg-canvas` first, then layer Mica on top as a progressive enhancement.

**Rule:** the renderer body must have a transparent background ONLY when the main process confirms Mica is active. If `backgroundMaterial: 'mica'` is set on a build that doesn't support it, Electron silently falls back to opaque — but a transparent body would show through to a black void. The main process should pass a `cfs.platform.materialActive` flag the renderer reads before applying transparency.

## Title bar

| Platform | Style | Implementation |
|---|---|---|
| Windows | Custom (frameless), drag region in our chrome, Fluent UI window control glyphs | `BrowserWindow({ titleBarStyle: 'hidden' })`, `<TitleBar>` component in Phase 6 with `-webkit-app-region: drag` |
| Linux | Native frame | Default `BrowserWindow` (Linux DEs decorate windows themselves; overriding produces inconsistencies with users' window manager themes) |

**Rule:** the Phase 6 `<TitleBar>` component is conditionally rendered based on `isWindows()`. On Linux, the OS draws the title bar — do NOT try to render a custom one for visual consistency, it will fight the user's window manager (especially on tiling WMs).

**Rule:** any element inside the custom titlebar that needs to be clickable (window controls, app menu) must opt OUT of the drag region with `-webkit-app-region: no-drag`. Otherwise the user can't click them.

## Fonts

Font fallback chain (Windows-first, Linux-graceful):

```css
font-family: 'Segoe UI Variable Text', 'Segoe UI', Inter, system-ui, -apple-system, sans-serif;
```

| Platform | What renders | Notes |
|---|---|---|
| Win11 | Segoe UI Variable Text | Variable font with Display / Text / Small / Caption optical sizes |
| Win10 | Segoe UI | Variable axes ignored; falls through to static face |
| Ubuntu / Fedora | Inter (if installed) → system-ui (fall-through) | Inter is a freely-available SIL Open Font; ship it as a static asset OR rely on the user/distro |
| Any | system-ui (last resort) | Always renders something; prevents Times New Roman fallback |

**Rule:** ship Inter as a `@font-face` declaration in `foundation.css` if we want guaranteed Linux parity (Phase 6 decision — currently default to `system-ui` to keep the bundle lean). See open questions at the bottom.

**Rule:** never set `font-family` on a per-component basis. Always inherit from the body so the cascade picks up the right platform face.

## Iconography

Phase 6 adopts `@fluentui/react-icons` (system icon set). The font is bundled with the package; identical glyphs render on Windows + Linux.

For window controls (minimize / maximize / close), the Fluent UI System Icons codepoints are:

- Minimize: U+E921 (Mdl2.ChromeMinimize)
- Maximize: U+E922 (Mdl2.ChromeMaximize)
- Restore: U+E923 (Mdl2.ChromeRestore)
- Close: U+E8BB (Mdl2.ChromeClose)

**Rule:** the Phase 6 titlebar uses the actual `@fluentui/react-icons` components (`Subtract`, `Maximize`, `Square`, `Dismiss`) NOT raw codepoints — bundling the icon component is type-safe and tree-shakable. The codepoints above are documented for reference only (e.g. when reading Microsoft design specs).

**Rule:** prefer the regular-weight icons (`Foo20Regular`) over filled (`Foo20Filled`) for chrome / non-active states; use filled only for selected / active states. This matches Fluent UI 2's iconography guidance.

## Theme

| Source | Behavior |
|---|---|
| OS theme | `nativeTheme.shouldUseDarkColors` (Electron main) → forwarded via preload event → renderer toggles `.dark` class on `<html>` |
| User override (Phase 6 settings) | localStorage key `configforge-theme` ∈ `{light, dark, system}`. `system` defers to `nativeTheme`. |
| `prefers-color-scheme` (renderer) | Used as the initial value before `nativeTheme` is read; harmonizes via inline script in `index.html` so we don't flash the wrong theme on cold start |

**Rule:** never assume light theme. Every component CSS rule that defines a color must have a `.dark` variant where it differs, OR derive the value from a `--cfs-color-*` token whose `.dark` variant already exists in `foundation.css`.

**Rule:** the inline script in `index.html` runs SYNCHRONOUSLY before any React hydration to set the initial `.dark` class. Do not move this logic into a React effect — it will cause a one-frame light/dark flash that's especially jarring on dark systems.

## Reduced motion

Honor `prefers-reduced-motion: reduce` globally — `foundation.css` sets `animation-duration: 0ms !important; transition-duration: 0ms !important` for all elements when active. No per-component opt-in needed.

**Rule:** if a component genuinely needs motion to convey meaning (e.g. a progress spinner), it must use `@media (prefers-reduced-motion: no-preference)` to scope its animation, NOT bypass the global override with `!important`. Spinners can be replaced with a static "Loading…" label when reduced motion is active.

## High contrast / forced colors

Honor `forced-colors: active` — `foundation.css` re-assigns the `--cfs-color-*` variables to system colors (`Canvas`, `CanvasText`, `Highlight`, `ButtonBorder`, `GrayText`). Inline component overrides should use `var(--cfs-color-*)` not raw hex so they automatically respect the override.

**Rule:** test the renderer in Windows High Contrast (Settings → Accessibility → Contrast themes) before shipping. Visual regressions there are not acceptable. The `Aquatic`, `Desert`, `Dusk`, and `Night Sky` built-in themes are the four to verify against.

**Rule:** in `forced-colors: active`, browser-applied colors win regardless of CSS `color`/`background-color` — but `box-shadow`, `outline`, and SVG `fill` do NOT translate. If a component relies on a box-shadow for visual structure (e.g. a card edge), add an explicit `border: 1px solid ButtonBorder` inside `@media (forced-colors: active)` so the structure remains visible.

## What does NOT degrade

These elements look identical across platforms:

- Spacing scale, type scale, corner radii, motion durations (CSS-driven, no platform branching)
- All FluentUI components (the package is platform-neutral)
- Sidebar, content area, footer chrome (CSS only, no platform branches)
- IPC behavior — `cfs.*` runs identically; only the OS dialogs (`showSaveDialog`, `showMessageBox`) inherit the OS look
- Keyboard shortcuts (Phase 6 will use `accelerator` strings like `'CmdOrCtrl+S'` so they Just Work)

## macOS author flavor

The macOS build is **not** produced from `main`. It lives on its own branch — `mac-author-build` — with a parallel electron-builder config (`apps/desktop/electron-builder.author.yml`) and a distinct flavor identity.

| Aspect | `main` (Win + Linux) | `mac-author-build` (macOS author) |
|---|---|---|
| `appId` | `community.configforge` | `community.configforge.author` |
| `productName` | `ConfigForge` | `ConfigForge Author` |
| Target | NSIS / zip / AppImage / deb / rpm / tar.gz | `.dmg` (arm64 — Apple Silicon, Intel via Rosetta) |
| Code signing | None — unsigned (no signing in CI; optional local self-sign via `scripts/generate-dev-cert.ps1`) | `identity: null` (unsigned — preview build, users right-click → Open past Gatekeeper) |
| Bundled CLI | None (BYO-CLI per v0.2.0 contract) | None |
| Preload namespaces | Full surface (`cfs.deploy`, `cfs.elevation`, `cfs.health`, `cfs.auditResults`, …) | **Drops `deploy`, `elevation`, `health`, `auditResults`** — the author flavor cannot apply / audit / enforce on a device, so those handlers are tree-shaken out at build time |

**Rule:** renderer code that may run on either flavor must use the `safeCfs(key)` / `hasCfsNamespace(key)` helpers from `apps/desktop/src/lib/cfs.ts` (CF-SEC-015) instead of bare `cfs.deploy.X()` / `cfs.health.Y()`. Direct calls into dropped namespaces throw on macOS. See the root `AGENTS.md` "Things to never do" list.

**Rule:** branch parity is maintained by cherry-pick. **Do not cross-merge** `main` ↔ `mac-author-build`. Mac-flavor-specific changes (anything that touches `electron-builder.author.yml`, the deploy/elevation/health drop list, or the unsigned-Gatekeeper UX) belong on `mac-author-build`. Everything else lands on `main` first and gets cherry-picked across.

**Rule:** Mac branch CI is `workflow_dispatch` only — trigger with `gh workflow run "PR check" --ref mac-author-build` after a push. This is intentional: it keeps the auto-fire CI minute budget on `main`, the active Win/Linux line.

Mac titlebar / Mica / Linux-frame guidance below applies to the Win + Linux build. The macOS author flavor uses Electron's default titlebar treatment on macOS (the traffic-light controls in the top-left); there is no custom `<TitleBar />` rendered.

## Reviewer checklist (PR template)

- [ ] No magic colors — every hex value comes from `tokens.ts` or `--cfs-color-*`
- [ ] Honors `prefers-reduced-motion` (no `transition` rules with hardcoded durations bypassing the global override)
- [ ] Honors `forced-colors` (no `outline: none` or inline color values that survive forced-colors mode; box-shadow-driven structure has a border fallback)
- [ ] Has `.dark` variants where colors differ
- [ ] Conditionally renders Windows-only chrome (custom titlebar, Mica-aware blur) only when `isWindows()` returns true
- [ ] No `font-family` overrides at the component level
- [ ] Drag regions inside the custom titlebar correctly opt clickable elements out via `-webkit-app-region: no-drag`
- [ ] Verified in light + dark + high-contrast on a Windows VM AND Linux VM (or screenshots in PR)

## Open questions for Phase 6

1. **Should we ship Inter as a `@font-face` asset?** Pros: guaranteed visual parity on Linux distros without Inter pre-installed (most Ubuntu / Fedora installs do NOT include it). Cons: ~80 KB per weight × ~4 weights = ~320 KB added to the bundle. Recommendation: ship Inter only if the design team flags noticeable degradation in QA on a stock Ubuntu 22.04 VM.
2. **Mica fallback chain on Win11 builds where Mica is disabled by user (`SystemUsesLightTheme` registry edge cases)?** Currently we assume Mica works on `>= 22000` — need to verify what happens on a Win11 box with transparency effects disabled in Settings.
3. **macOS in scope at all?** Yes — but only as the author-only flavor on the `mac-author-build` branch (see ["macOS author flavor"](#macos-author-flavor) above). `process.platform === 'darwin'` cleanly falls through the existing detector, and the renderer doesn't need to branch for macOS in the deploy/elevation/health code paths because those namespaces are tree-shaken out of the mac build entirely. Authoring + library + diff + audit-pack PDF features render identically.
4. **Custom Linux titlebar opt-in?** Some Linux power users on tiling WMs (i3, Sway) prefer client-side decorations. Worth a settings toggle? Probably not in Phase 6 — log as a Phase 7+ feature request.
