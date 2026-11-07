import { DEFAULT_STANDING_LAYOUT, type StandingLayout } from "@kakeai/contracts";

export interface StandingPlacement {
  scale: number;
  /** Distance from the outer stage edge, as a percentage of the stage width. */
  insetPercent: number;
  /** Vertical nudge, as a percentage of the character's own height. */
  shiftPercent: number;
}

const INSET_PERCENT = { tight: 0, margin: 3, center: 8 } as const;
const SHIFT_PERCENT = { up: -6, standard: 0, down: 5 } as const;

/**
 * Converts the discrete Standing Layout into stage CSS values. Left and right
 * characters mirror the inset; the stage keeps the side fixed.
 */
export function resolveStandingPlacement(standing?: StandingLayout): StandingPlacement {
  const layout = standing ?? DEFAULT_STANDING_LAYOUT;
  return {
    scale: layout.scale,
    insetPercent: INSET_PERCENT[layout.edge],
    shiftPercent: SHIFT_PERCENT[layout.vertical],
  };
}
