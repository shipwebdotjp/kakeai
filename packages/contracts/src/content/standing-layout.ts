import { z } from "zod";

/**
 * The discrete placement vocabulary shared by the character.standing template
 * and the per-appearance Standing Layout.
 */
export const standingSideSchema = z.enum(["left", "right"]);
export type StandingSide = z.infer<typeof standingSideSchema>;

export const standingEdgeSchema = z.enum(["tight", "margin", "center"]);
export type StandingEdge = z.infer<typeof standingEdgeSchema>;

export const standingVerticalSchema = z.enum(["up", "standard", "down"]);
export type StandingVertical = z.infer<typeof standingVerticalSchema>;

export const DEFAULT_STANDING_EDGE: StandingEdge = "margin";
export const DEFAULT_STANDING_VERTICAL: StandingVertical = "standard";
export const DEFAULT_STANDING_SCALE = 1;

/**
 * The natural framing of one Character Appearance when it is shown standing.
 * It is a default, not a constraint: a standing Cue may still override each
 * field for a legacy scene or a deliberate composition adjustment.
 */
export const standingLayoutSchema = z.strictObject({
  scale: z.number().finite().positive(),
  edge: standingEdgeSchema,
  vertical: standingVerticalSchema,
});

export type StandingLayout = z.infer<typeof standingLayoutSchema>;

export const DEFAULT_STANDING_LAYOUT: StandingLayout = {
  scale: DEFAULT_STANDING_SCALE,
  edge: DEFAULT_STANDING_EDGE,
  vertical: DEFAULT_STANDING_VERTICAL,
};

export interface StandingLayoutSource {
  standing?: StandingLayout | undefined;
}

export function resolveStandingLayout(
  appearance: StandingLayoutSource | undefined,
): StandingLayout {
  return { ...(appearance?.standing ?? DEFAULT_STANDING_LAYOUT) };
}
