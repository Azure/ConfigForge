# ConfigForge — Design System

> Phase 5.5 contract. Phase 6's FluentUI swap is gated against this doc.
> Last updated: 2026-05-19 (post-cutover; main is the active Win/Linux line)

This is the single source of truth for how the ConfigForge
Electron renderer looks and feels. It documents:

1. The five Fluent v2 design **principles** we adopt (verbatim from
   Microsoft Learn) and what they mean for a security-baseline tool.
2. The six signature **experiences** (Color, Elevation, Iconography,
   Materials, Geometry, Typography) and how each lands in our
   renderer.
3. The **artifacts** that codify the rules (`tokens.ts`,
   `foundation.css`, `PLATFORM.md`).
4. The **review checklist** Phase 6+ PR reviewers run against any
   visual change.

Source of truth for the rules themselves: the [Microsoft Windows app
design overview](https://learn.microsoft.com/en-us/windows/apps/design/)
and the corresponding signature-experience pages. The full research
artifact (with citations + URL list) is at
`session-state/.../files/phase55-research.md`.

---

## Why this exists

Phase 6 swaps Tailwind primitives for FluentUI v9 components and
adds Mica + a custom titlebar. Without a codified design system,
that swap turns into "FluentUI defaults randomly applied" and
component reviewers have nothing to push back against. This doc
defines the contract; Phase 6 PRs that violate the contract get
flagged before they merge.

The same contract carries through to Phase 7 (Playwright + visual
regressions) and Phase 8 (cross-platform installer parity).

---

## The five principles

We adopt the [five Windows 11 design principles](https://learn.microsoft.com/en-us/windows/apps/design/design-principles)
verbatim. Each principle below has the MS Learn quote, what it
means for our specific app, and a concrete do/don't.

### 1 · Effortless

> *"In Windows 11, you can take what you want, where you want it. Windows is incredibly powerful, while remaining beautifully simple, calm, and free."*

For ConfigForge this means the common operations — audit,
deploy, revert — are one click away from the manifest list. No
modal dialog tree to wade through. Keyboard shortcuts (Enter to
deploy a row, Ctrl+S to save the editor, Esc to close panels)
match Windows conventions.

| ✅ Do | ❌ Don't |
|---|---|
| Surface "Audit / Deploy / Revert" as primary buttons in the manifest editor toolbar | Hide them behind a 3-dot overflow menu |
| Make the "Copy from library" → register → audit flow a single visual sequence | Force the user to navigate through 4 different routes |

### 2 · Calm

> *"Windows 11 is softer and decluttered; it fades into the background to help me stay calm and focused. The experience feels warm, ethereal, and approachable."*

Security tools love red. ConfigForge deliberately reserves
red for confirmed failures, not warnings — neutral grays do the
heavy lifting and Mica makes the window recede into the user's
desktop. Status badges only render when the status is meaningful
(don't paint every row green; leave compliant rows neutral).

| ✅ Do | ❌ Don't |
|---|---|
| Use `colorNeutralBackground2` (`#fafafa` light / `#1f1f1f` dark) as the primary surface | Paint every panel in a "security-themed" red |
| Render only non-compliant rows with the red status chip | Show three colored badges per resource for compliant/non/indeterminate |

### 3 · Personal

> *"Windows 11 adapts seamlessly to the way I use my device. It bends and flexes to my individual needs and preferences."*

Honor `nativeTheme.shouldUseDarkColors` and the system accent
color. Honor `prefers-reduced-motion` and `forced-colors`. Don't
override what the user already told their OS.

| ✅ Do | ❌ Don't |
|---|---|
| Initialize theme from `nativeTheme.shouldUseDarkColors`, listen for `updated` events | Hard-code light mode and force dark theme via a manual settings toggle |
| Disable transitions globally inside `@media (prefers-reduced-motion: reduce)` | Animate the sidebar nav with `transition-duration: 200ms` regardless of preference |

### 4 · Familiar

> *"Windows 11 balances a new, refreshed look and feel with the familiarity of the Windows I already know. There is no learning curve."*

Use FluentUI v9 React components verbatim — `Button`, `Dropdown`,
`DataGrid`, `Toast`, `Toolbar`. Don't invent new interaction
patterns. Window controls (minimize/maximize/close) use Fluent UI
System Icons. Keyboard conventions match Windows: F5 = refresh,
Ctrl+S = save, Del = remove selection.

| ✅ Do | ❌ Don't |
|---|---|
| Use `<Button appearance="primary">` for the primary action | Style a `<div>` to look like a button |
| Use Fluent's `Dropdown` for the platform picker | Build a custom click-outside-to-close menu |

### 5 · Complete + Coherent

> *"Windows 11 offers a visually seamless experience across platforms. I can work in many platforms and still have a consistent Windows experience."*

Linux + Windows + the separate macOS Author flavor need a *coherent* experience,
not an identical one. The design *logic* is shared (same tokens,
same components); only the platform-specific layer differs (Mica
on Win11, solid neutral on Linux; custom titlebar on Win, native
frame on Linux). `PLATFORM.md` is the contract for what degrades
where.

| ✅ Do | ❌ Don't |
|---|---|
| Define a single `tokens.ts` and let `foundation.css` resolve `--cfs-color-*` variables to the right value per OS theme | Maintain `tokens.windows.ts` + `tokens.linux.ts` that drift |
| Conditionally render the custom titlebar based on `isWindows()` | Force a custom titlebar on Linux and clash with the user's window manager theme |

---

## The six signature experiences

### Color

**Brand:** Azure Blue `#0078D4` (matches the existing app palette
and the Microsoft Azure brand). Reserved for primary CTAs,
selection state, and brand text only.

**Surfaces:** five-step elevation ramp from the back-most surface
to the floating one. Light theme: `#FFFFFF → #FAFAFA → #F5F5F5 →
#F0F0F0 → #EBEBEB`. Dark theme: `#292929 → #1F1F1F → #141414 →
#0A0A0A → #000000` (Fluent v2 rule: elevated surfaces are *lighter*
in dark mode, so a card floats above the page).

**Status:** Red `#C50F1F` / `#FF6B6B` for confirmed
non-compliance, Yellow `#8A6404` / `#FCE100` for "audit
incomplete / requires review", Green `#0E700E` / `#54B054` for
compliant. AA contrast verified against the surface ramp.

All hex values exported from `tokens.ts` (`lightColor` /
`darkColor` namespaces) and aliased into `foundation.css`
(`--cfs-color-*` variables) so components don't reference hex
directly.

### Elevation & layering

Three depth tiers, no more:

| Tier | Surface | Shadow token | What it is |
|---|---|---|---|
| 0 | Page background | none | The window itself (Mica on Win11) |
| 1 | Pane / card | `shadow2` | Default content surface |
| 2 | Floating menu / popover | `shadow8` | Dropdown, tooltip, callout |
| 3 | Modal / dialog | `shadow16` | Dialogs, command bar |

Phase 6 reviewers reject components that introduce a 4th tier or
use shadows outside the `tokens.elevation` exports.

### Iconography

`@fluentui/react-icons` is the icon system. Rules:

- Default to `*Regular` variant; use `*Filled` only for selected
  state of a toggle.
- Default size 16×16 in chrome, 20×20 in primary action buttons.
- Window controls: `Subtract`, `Maximize`, `Square`, `Dismiss` — the
  Fluent codepoints for minimize/maximize/restore/close.
- Don't introduce another icon library alongside Fluent icons.

### Materials

| Platform | Window backdrop | How |
|---|---|---|
| Win11 22000+ | Mica | `BrowserWindow({ backgroundMaterial: 'mica' })` (Phase 6) |
| Win10 / Win11 < 22000 | Solid `#FAFAFA` / `#1F1F1F` | foundation.css body bg |
| Linux | Solid neutral | foundation.css body bg, native frame |

**Hard rule (from `PLATFORM.md`):** never make legibility depend on
Mica. Body text contrast must validate against the SOLID fallback
color. Mica is decoration, not load-bearing.

### Geometry

| Scale | Source token | Values |
|---|---|---|
| Spacing | `tokens.spacing` | `0 / 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 32` px |
| Corner radius | `tokens.borderRadius` | `0 / 2 / 4 / 6 / 8 / circular` px |
| Control heights | implicit in Fluent components | `28 / 32 / 40` px |

Components don't pass arbitrary `padding={'14px'}` — they use the
named tokens (`spacing.l` = 16). Phase 6 reviewers grep for
hardcoded `px` values in PR diffs.

### Typography

**Fonts:**

```
font-family: 'Segoe UI Variable Text', 'Segoe UI', Inter, system-ui,
             -apple-system, sans-serif;
```

- Win11: Segoe UI Variable (with Display / Text / Small / Caption
  optical sizes — automatic via the variable font axes)
- Win10: falls through to Segoe UI (variable axes ignored)
- Linux: Inter if installed, otherwise system-ui (Ubuntu = Ubuntu,
  Fedora = Cantarell)

**Type ramp** (Fluent v2 web, exported from `tokens.typography`):

| Role | Size | Line | Weight | Use |
|---|---|---|---|---|
| `display` | 68 | 92 | 600 | Splash hero (rare) |
| `largeTitle` | 40 | 52 | 600 | Page title (rare) |
| `title1` | 32 | 40 | 600 | Section heading |
| `title2` | 28 | 36 | 600 | Sub-section heading |
| `title3` | 24 | 32 | 600 | Card heading |
| `subtitle1` | 20 | 28 | 600 | Group label |
| `subtitle2` | 16 | 22 | 600 | Strong inline |
| `body1` | 14 | 20 | 400 | Default body |
| `body1Strong` | 14 | 20 | 600 | Inline emphasis |
| `body2` | 16 | 22 | 400 | Reading body |
| `caption1` | 12 | 16 | 400 | Metadata |
| `caption2` | 10 | 14 | 400 | Microcopy |

Use the `.cfs-*` utility classes from `foundation.css` (e.g.
`<h1 className="cfs-title1">`) when a component plays a known
semantic role. Use the typescript tokens directly when applying a
ramp value to a JS-driven style.

---

## Artifacts

### `apps/desktop/src/design/tokens.ts`

7.4 KB TypeScript module. Exports `as const` namespaces:

```ts
import {
  spacing,        // none / xxs / xs / sNudge / s / mNudge / m / l / xl / xxl / xxxl
  borderRadius,   // none / small / medium / large / xLarge / circular
  fontFamily,     // base / display / numeric / mono
  typography,     // 12-role type ramp
  lightColor,     // brand / neutral / status / strokes — light theme
  darkColor,      // ... dark theme
  elevation,      // shadow2 / shadow4 / shadow8 / shadow16 / shadow28 / shadow64
  motion,         // durationUltra* / curveEasy* etc.
  activeColors,   // helper: pick light or dark by .dark on documentElement
} from '@/design/tokens';
```

All token names mirror `@fluentui/tokens` v2 verbatim where there's
overlap (`colorBrandBackground`, `spacingHorizontalM`, etc.). When
Phase 6 swaps to FluentUI, the imports change but the token names
don't.

### `apps/desktop/src/design/foundation.css`

7.4 KB stylesheet, loaded ONCE from `main.tsx` before any component
CSS. Establishes:

- `@tailwind base / components / utilities` (existing Tailwind chain
  preserved — Phase 6 migrates components off Tailwind primitives
  but keeps Tailwind for utility classes)
- `--cfs-color-*` CSS variables wired to `:root` (light) and `.dark`
  (dark) — referenced by every component instead of hex values
- Body / scrollbar / focus-ring / selection resets
- `.cfs-display / .cfs-title1 / ...` typography utility classes
- `.cfs-elevation-2 / -4 / -8 / -16 / -28 / -64` shadow utilities
- `.cfs-drag` / `.cfs-no-drag` for the Phase 6 custom titlebar
- `@media (prefers-reduced-motion: reduce)` global override
- `@media (forced-colors: active)` system-color reassignment

### `apps/desktop/src/design/PLATFORM.md`

10 KB doc. The contract for what degrades how. Reviewers reference
it in PR comments when a Windows-flagship feature is missing its
fallback. Covers:

- Detection helpers (`isWindows()`, `isWindows11()`, `isLinux()`,
  `prefersDark()`, `prefersReducedMotion()`, `prefersForcedColors()`)
- Materials (Mica → solid fallback)
- Title bar (custom on Win, native on Linux)
- Fonts (Segoe → Inter → system-ui chain)
- Iconography (`@fluentui/react-icons`, regular vs filled rules)
- Theme (OS-driven via `nativeTheme`, no hard-code light)
- Reduced motion / forced colors / dark mode hand-offs
- Phase 6 reviewer checklist

---

## Phase 6.2 component conventions

The FluentUI v9 swap landed in Phase 6.1. Phase 6.2 codifies the
small set of conventions that emerged from auditing 79
substitutions across 15 files, plus the two domain-specific
wrappers introduced to fill gaps in v9.

### Button sizing

| Size | When to use | Example sites |
|---|---|---|
| **default** (medium implicit) | The vast majority of buttons. Page-level actions, dialog footers, toolbar buttons. | All page primary CTAs (Save, Run, Refresh, etc.) |
| `size="small"` | Inline actions inside a row, banner, or card where a default-size button would dominate. | `<MessageBar>` action buttons (Compliance.tsx, conflict-detector.tsx) |
| `size="large"` | Hero-style CTAs that anchor a page section. Use sparingly — at most one per page. | Diff page "Compare Now" — the entire raison d'être of the page |

Reviewers should challenge any new `size="large"` and prefer
default unless it's an entry-point CTA at the top of a workflow.

### Spinner sizing

| Size | When to use |
|---|---|
| `size="tiny"` | Inline with body text or inside a default-size button as the loading icon. |
| `size="extra-small"` | Adjacent to a label, when the spinner replaces a small icon. |
| `size="small"` | Inside a card or panel that's loading. |
| `size="medium"` | Full-page loading state (Suspense fallbacks, lazy route boundaries). |

Larger sizes (`size="large"`, `size="huge"`) are reserved for
splash / first-launch flows we don't currently have. If you're
reaching for them, reconsider the layout.

### `<TintedSpinner>` (Phase 6.2 wrapper)

FluentUI v9 `<Spinner>` exposes no `intent` prop and inherits the
brand color. When state needs to be communicated by color in
addition to text/position, use `<TintedSpinner intent="success" |
"danger" | "warning" | "info" />`. The wrapper sets
`--circle__color` to the appropriate Fluent palette token so the
spinner reads as part of the success/danger color system.

Use cases: bulk-operation progress strips (Manifests
deploy/delete), inline status badges where motion + color carry
meaning together. Don't use it for "loading…" — that's a vanilla
`<Spinner>`.

### `<DangerButton>` (Phase 6.2 wrapper)

FluentUI v9 Button has no `appearance="danger"` variant; v9
treats danger as a separate component family that hasn't shipped.
Until then, `<DangerButton>` wraps `<Button appearance="primary">`
with Griffel overrides that pin the rest/hover/active/disabled
states to `colorPaletteRedBackground{1,2,3}` from Fluent v2.

Reserve for true destructive actions: Delete, Permanently remove,
Cancel subscription. Discard / undo / cancel-without-saving stay
on `appearance="secondary"` with a confirm dialog if needed —
they're recoverable, so the visual weight should match.

### Filled vs Regular icons

Sidebar nav and any future selectable list use `*Filled` icons
for the active item and `*Regular` for the rest. This is a
semantic distinction — don't mix Outline + Filled within a single
non-stateful icon set (e.g. inside a single button, both icons
should be the same style).

The app-mark itself (the shield/gear glyph in the sidebar header)
uses `*Filled` always — it's a logo, not a state indicator.

---

## Reviewer checklist

PRs that change anything visual must check:

- [ ] No magic colors. Every hex value comes from `tokens.ts` or a
  `--cfs-color-*` variable. Run `git diff --stat` against the PR
  and grep for `#[0-9a-f]{3,8}` matches.
- [ ] No magic spacing/radius. Every `px`/`rem` value either uses
  Tailwind utilities (which already map to the scale) or imports
  from `tokens.spacing` / `tokens.borderRadius`.
- [ ] Has a `.dark` variant where colors differ.
- [ ] Honors `prefers-reduced-motion`. No `transition` rule with a
  hard-coded duration that bypasses the global override.
- [ ] Honors `forced-colors`. No `outline: none`. No raw
  `background-color: <hex>` that survives forced-colors mode.
- [ ] Conditionally renders Windows-only chrome (custom titlebar,
  Mica-aware blur) only when `isWindows()` returns true.
- [ ] Verified in light + dark + Windows High Contrast. Screenshots
  in the PR description.
- [ ] No new icon library imports; use `@fluentui/react-icons`.

---

## Known follow-ups

1. **Ship Inter as a `@font-face` asset?** ~320 KB across 4 weights.
   Currently we rely on system-ui on Linux. Ship if QA flags
   Linux degradation on stock Ubuntu 22.04.
2. **Mica when user disables transparency.** Detector currently
   only checks Windows build number; Win11 has a "Transparency
   effects" toggle in Settings → Personalization. Need to test
   what happens when it's off and tighten the detector if needed.
3. **macOS scope.** In scope only for the Author flavor on `mac-author-build`; Full edition remains Windows + Linux from `main`.
4. **Linux titlebar customization.** Tiling-WM users sometimes
   prefer client-side decorations. Defer past Phase 7.

---

## Citations

Full citation list in
`session-state/.../files/phase55-research.md`. Key sources:

- [Microsoft Windows app design overview](https://learn.microsoft.com/en-us/windows/apps/design/) — entry point
- [Design principles](https://learn.microsoft.com/en-us/windows/apps/design/design-principles) — the 5
- [Color (signature experience)](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/color)
- [Typography](https://learn.microsoft.com/en-us/windows/apps/design/style/typography)
- [Geometry / layout](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry)
- [Iconography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/iconography)
- [Materials (Mica + Acrylic)](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials)
- [Mica (specifically)](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)
- [Motion](https://learn.microsoft.com/en-us/windows/apps/design/motion/)
- [Title bar](https://learn.microsoft.com/en-us/windows/apps/develop/title-bar)
- [@fluentui/tokens v2 source](https://github.com/microsoft/fluentui/tree/master/packages/tokens) —
  exact hex values for every named token
