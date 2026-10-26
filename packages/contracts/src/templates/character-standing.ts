import { z } from "zod";
import { idSchema } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import type { VisualTemplateDefinition } from "./shared";

export const standingSideSchema = z.enum(["left", "right"]);
export type StandingSide = z.infer<typeof standingSideSchema>;

export const standingEdgeSchema = z.enum(["tight", "margin", "center"]);
export type StandingEdge = z.infer<typeof standingEdgeSchema>;

export const standingVerticalSchema = z.enum(["up", "standard", "down"]);
export type StandingVertical = z.infer<typeof standingVerticalSchema>;

export const DEFAULT_STANDING_EDGE: StandingEdge = "margin";
export const DEFAULT_STANDING_VERTICAL: StandingVertical = "standard";

export const characterStandingV1InputSchema = z.strictObject({
  characterId: idSchema,
  appearanceId: idSchema,
  side: standingSideSchema,
  scale: z.number().positive(),
  edge: standingEdgeSchema.default(DEFAULT_STANDING_EDGE),
  vertical: standingVerticalSchema.default(DEFAULT_STANDING_VERTICAL),
});

export const characterStandingV1: VisualTemplateDefinition = {
  id: "character.standing",
  version: 1,
  inputSchema: characterStandingV1InputSchema,
  layers: ["standing"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "立ち絵", description: "左右1体ずつ立ち絵を表示し表情を切り替える", category: "character" },
  exampleInput: {
    characterId: "<characterId>",
    appearanceId: "<appearanceId>",
    side: "left",
    scale: 1,
    edge: "tight",
    vertical: "standard",
  } satisfies z.input<typeof characterStandingV1InputSchema>,
  collectAssetRefs: () => [],
};
