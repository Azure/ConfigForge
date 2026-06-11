// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Button, type ButtonProps, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';

/**
 * Phase 6.2 — Button styled for destructive actions.
 *
 * FluentUI v9 Button has no `appearance="danger"` variant — only
 * primary / secondary / outline / subtle / transparent. Phase 6.1
 * faked it with inline CSS-var overrides on appearance="primary",
 * which works but bypasses Griffel and makes hover/active states
 * incorrect (they keep the brand-blue hover color).
 *
 * This wrapper sets the full state machine (rest / hover / active
 * / disabled) using the Fluent v2 status-danger palette tokens
 * (`colorPaletteRedBackground{1,2,3}`, `colorNeutralForegroundOnBrand`,
 * etc.), so the button gets correct danger styling in both light
 * and dark themes including hover/active feedback.
 *
 * Use sparingly — destructive actions like Bulk Delete, Cancel
 * subscription, Delete account, etc. Should NOT be used for
 * cancel-without-saving or "Discard changes" — those are
 * secondary appearance.
 *
 * Usage:
 *   <DangerButton onClick={handleDelete} icon={<DeleteRegular />}>
 *     Delete {n} items
 *   </DangerButton>
 *
 * The Fluent design language reserves red for true destructive
 * actions; warnings are orange/amber. If the action is reversible
 * within the session (e.g. moves to trash), a secondary button
 * with a confirm dialog is the more appropriate pattern.
 */

const useStyles = makeStyles({
  root: {
    backgroundColor: tokens.colorPaletteRedBackground3,
    // Griffel doesn't support `borderColor` shorthand — use the four
    // longhands so it can correctly atomicize each side.
    borderTopColor: tokens.colorPaletteRedBackground3,
    borderRightColor: tokens.colorPaletteRedBackground3,
    borderBottomColor: tokens.colorPaletteRedBackground3,
    borderLeftColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': {
      backgroundColor: tokens.colorPaletteRedForeground1,
      borderTopColor: tokens.colorPaletteRedForeground1,
      borderRightColor: tokens.colorPaletteRedForeground1,
      borderBottomColor: tokens.colorPaletteRedForeground1,
      borderLeftColor: tokens.colorPaletteRedForeground1,
      color: tokens.colorNeutralForegroundOnBrand,
    },
    ':hover:active': {
      backgroundColor: tokens.colorPaletteRedForeground3,
      borderTopColor: tokens.colorPaletteRedForeground3,
      borderRightColor: tokens.colorPaletteRedForeground3,
      borderBottomColor: tokens.colorPaletteRedForeground3,
      borderLeftColor: tokens.colorPaletteRedForeground3,
      color: tokens.colorNeutralForegroundOnBrand,
    },
    ':disabled': {
      backgroundColor: tokens.colorNeutralBackgroundDisabled,
      borderTopColor: tokens.colorTransparentStrokeDisabled,
      borderRightColor: tokens.colorTransparentStrokeDisabled,
      borderBottomColor: tokens.colorTransparentStrokeDisabled,
      borderLeftColor: tokens.colorTransparentStrokeDisabled,
      color: tokens.colorNeutralForegroundDisabled,
    },
  },
});

export function DangerButton({ className, ...rest }: ButtonProps) {
  const styles = useStyles();
  return <Button {...rest} appearance="primary" className={mergeClasses(styles.root, className)} />;
}
