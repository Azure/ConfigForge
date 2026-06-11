// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Spinner, type SpinnerProps, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';

/**
 * Phase 6.2 — Spinner with intent tinting.
 *
 * FluentUI v9's `<Spinner>` is monochrome — it inherits the brand
 * color and exposes no `intent` prop. Phase 6.1 swapped the
 * Manifests bulk-progress spinners to vanilla `<Spinner>` and lost
 * the original emerald-600 (deploying) / red-600 (deleting) tint
 * cues. This wrapper restores them by overriding the spinner's
 * SVG `--circle__color` via Griffel.
 *
 * Implementation note: FluentUI v9 Spinner uses a CSS custom
 * property `--circle__color` for the rotating indicator. Setting
 * a CSS color on the wrapper element doesn't reach the SVG;
 * setting `--circle__color` directly on the wrapper does, and is
 * scoped to the descendant SVG by the Griffel selector below.
 *
 * Usage:
 *   <TintedSpinner intent="success" size="tiny" />
 *   <TintedSpinner intent="danger" size="tiny" />
 *   <TintedSpinner intent="info" size="tiny" />  // = default brand
 *
 * For the default brand color, just use vanilla `<Spinner>` —
 * this wrapper is for cases where state needs to be communicated
 * via color in addition to position/text.
 */

export type TintedSpinnerIntent = 'success' | 'danger' | 'warning' | 'info';

export interface TintedSpinnerProps extends Omit<SpinnerProps, 'children'> {
  /** Color cue. Defaults to 'info' (brand color). */
  intent?: TintedSpinnerIntent;
}

const useStyles = makeStyles({
  success: {
    '--circle__color': tokens.colorPaletteGreenForeground1,
  },
  danger: {
    '--circle__color': tokens.colorPaletteRedForeground1,
  },
  warning: {
    '--circle__color': tokens.colorPaletteDarkOrangeForeground1,
  },
  info: {
    '--circle__color': tokens.colorBrandForeground1,
  },
});

export function TintedSpinner({ intent = 'info', className, ...rest }: TintedSpinnerProps) {
  const styles = useStyles();
  return <Spinner className={mergeClasses(styles[intent], className)} {...rest} />;
}
