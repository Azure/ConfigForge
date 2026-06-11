// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Fluent v2-aligned design tokens for the ConfigForge renderer.
 *
 * Phase 5.5 — single source of truth for spacing / radii / type / color
 * / elevation / motion. Imported by every component as the canonical
 * design system; magic numbers in component CSS are a code smell that
 * Phase 6 reviewers should flag.
 *
 * Token names mirror @fluentui/tokens v2 where there's overlap, so
 * Phase 6's FluentUI component swap can substitute Fluent's runtime
 * tokens without renaming. Numeric scales (spacing/radius/elevation)
 * and the type ramp are taken from the Fluent v2 web theme; light and
 * dark color palettes mirror @fluentui/tokens webLightTheme /
 * webDarkTheme with the brand ramp pinned to Azure Blue (#0078D4) to
 * match the existing app palette.
 *
 * Sources:
 *   https://github.com/microsoft/fluentui/blob/master/packages/tokens
 *   https://learn.microsoft.com/en-us/windows/apps/design/
 *
 * Brand color: Azure Blue #0078D4 (matches the app's existing palette).
 */

export const spacing = {
  none: '0',
  xxs: '2px',
  xs: '4px',
  sNudge: '6px',
  s: '8px',
  mNudge: '10px',
  m: '12px',
  l: '16px',
  xl: '20px',
  xxl: '24px',
  xxxl: '32px',
} as const;

export const borderRadius = {
  none: '0',
  small: '2px',
  medium: '4px',
  large: '6px',
  xLarge: '8px',
  circular: '10000px',
} as const;

export const fontFamily = {
  // Windows: Segoe UI Variable (Display/Text/Small) → Segoe UI fallback
  // Linux: Inter (if installed) → system-ui
  base: '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, -apple-system, sans-serif',
  display: '"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif',
  numeric: '"Segoe UI Variable Text", ui-monospace, SFMono-Regular, "Cascadia Code", monospace',
  mono: '"Cascadia Code", "Fira Code", ui-monospace, monospace',
} as const;

// Type ramp — { fontSize, lineHeight, fontWeight }
export const typography = {
  display: { fontSize: '68px', lineHeight: '92px', fontWeight: 600 },
  largeTitle: { fontSize: '40px', lineHeight: '52px', fontWeight: 600 },
  title1: { fontSize: '32px', lineHeight: '40px', fontWeight: 600 },
  title2: { fontSize: '28px', lineHeight: '36px', fontWeight: 600 },
  title3: { fontSize: '24px', lineHeight: '32px', fontWeight: 600 },
  subtitle1: { fontSize: '20px', lineHeight: '28px', fontWeight: 600 },
  subtitle2: { fontSize: '16px', lineHeight: '22px', fontWeight: 600 },
  body1: { fontSize: '14px', lineHeight: '20px', fontWeight: 400 },
  body1Strong: { fontSize: '14px', lineHeight: '20px', fontWeight: 600 },
  body2: { fontSize: '16px', lineHeight: '22px', fontWeight: 400 },
  caption1: { fontSize: '12px', lineHeight: '16px', fontWeight: 400 },
  caption2: { fontSize: '10px', lineHeight: '14px', fontWeight: 400 },
} as const;

export const lightColor = {
  // Brand
  colorBrandBackground: '#0078D4', // Azure Blue
  colorBrandBackgroundHover: '#0063B1',
  colorBrandBackgroundPressed: '#004E8C',
  colorBrandForeground1: '#0078D4',
  colorBrandForegroundOnLight: '#0078D4',

  // Neutral surfaces
  colorNeutralBackground1: '#FFFFFF',
  colorNeutralBackground2: '#FAFAFA',
  colorNeutralBackground3: '#F5F5F5',
  colorNeutralBackground4: '#F0F0F0',
  colorNeutralBackground5: '#EBEBEB',

  // Neutral foregrounds
  colorNeutralForeground1: '#242424',
  colorNeutralForeground2: '#424242',
  colorNeutralForeground3: '#616161',
  colorNeutralForegroundDisabled: '#A6A6A6',

  // Neutral strokes
  colorNeutralStroke1: '#D1D1D1',
  colorNeutralStroke2: '#E0E0E0',
  colorNeutralStrokeAccessible: '#616161',

  // Status
  colorPaletteRedForeground1: '#C50F1F',
  colorPaletteRedBackground1: '#FDF2F2',
  colorPaletteYellowForeground1: '#8A6404',
  colorPaletteYellowBackground1: '#FFF9E5',
  colorPaletteGreenForeground1: '#0E700E',
  colorPaletteGreenBackground1: '#F1FAF1',
} as const;

/**
 * Dark theme palette — mirrors webDarkTheme from @fluentui/tokens v2.
 *
 * Surface ramp goes darkest-at-bottom (Background3 = #141414) to
 * lightest-on-top (Background1 = #292929) following Fluent's "elevated
 * surfaces are lighter in dark mode" rule, so cards/dialogs visually
 * float above page chrome. Brand stays pinned to Azure Blue for
 * cross-theme consistency. Status colors are picked for AA contrast
 * against Background1 (#292929):
 *   Red    fg #FF6B6B on #3F1517  (≈ 5.6:1)
 *   Yellow fg #FCE100 on #352800  (≈ 11.4:1)
 *   Green  fg #54B054 on #0F2C0F  (≈ 4.8:1)
 */
export const darkColor = {
  // Brand — pinned to Azure Blue across themes for cross-theme parity
  colorBrandBackground: '#0078D4',
  colorBrandBackgroundHover: '#2B88D8',
  colorBrandBackgroundPressed: '#005A9E',
  colorBrandForeground1: '#3AA0F3',
  colorBrandForegroundOnLight: '#0078D4',

  // Neutral surfaces (Fluent v2 dark — elevated = lighter)
  colorNeutralBackground1: '#292929',
  colorNeutralBackground2: '#1F1F1F',
  colorNeutralBackground3: '#141414',
  colorNeutralBackground4: '#0A0A0A',
  colorNeutralBackground5: '#000000',

  // Neutral foregrounds
  colorNeutralForeground1: '#FFFFFF',
  colorNeutralForeground2: '#D6D6D6',
  colorNeutralForeground3: '#ADADAD',
  colorNeutralForegroundDisabled: '#5C5C5C',

  // Neutral strokes
  colorNeutralStroke1: '#666666',
  colorNeutralStroke2: '#525252',
  colorNeutralStrokeAccessible: '#ADADAD',

  // Status — AA-tuned against #292929 surface
  colorPaletteRedForeground1: '#FF6B6B',
  colorPaletteRedBackground1: '#3F1517',
  colorPaletteYellowForeground1: '#FCE100',
  colorPaletteYellowBackground1: '#352800',
  colorPaletteGreenForeground1: '#54B054',
  colorPaletteGreenBackground1: '#0F2C0F',
} as const;

export const elevation = {
  shadow2: '0 1px 2px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)',
  shadow4: '0 2px 4px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)',
  shadow8: '0 4px 8px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)',
  shadow16: '0 8px 16px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)',
  shadow28: '0 14px 28px rgba(0,0,0,0.24), 0 0 8px rgba(0,0,0,0.20)',
  shadow64: '0 32px 64px rgba(0,0,0,0.24), 0 0 8px rgba(0,0,0,0.20)',
} as const;

export const motion = {
  durationUltraFast: '50ms',
  durationFaster: '100ms',
  durationFast: '150ms',
  durationNormal: '200ms',
  durationSlow: '300ms',
  durationSlower: '400ms',
  durationUltraSlow: '500ms',
  curveEasyEase: 'cubic-bezier(0.33, 0.0, 0.67, 1)',
  curveLinear: 'linear',
  curveAccelerateMax: 'cubic-bezier(0.7, 0.0, 1.0, 0.5)',
  curveDecelerateMax: 'cubic-bezier(0.0, 0.0, 0.0, 1)',
} as const;

/**
 * Helper: pick light or dark based on `.dark` class on documentElement.
 * Returns lightColor in non-DOM contexts (SSR, tests) so token reads
 * never throw before hydration.
 */
export function activeColors(): typeof lightColor | typeof darkColor {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return darkColor;
  }
  return lightColor;
}

// Type exports for component prop typing
export type SpacingToken = keyof typeof spacing;
export type BorderRadiusToken = keyof typeof borderRadius;
export type FontFamilyToken = keyof typeof fontFamily;
export type TypographyRole = keyof typeof typography;
export type LightColorToken = keyof typeof lightColor;
export type DarkColorToken = keyof typeof darkColor;
export type ElevationToken = keyof typeof elevation;
export type MotionToken = keyof typeof motion;
