import { z } from "zod";
import { idSchema } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import {
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
  standingEdgeSchema,
  standingSideSchema,
  standingVerticalSchema,
} from "../content/standing-layout";
import type { VisualTemplateDefinition } from "./shared";

export const characterStandingV1InputSchema = z.strictObject({
  characterId: idSchema,
  appearanceId: idSchema,
  side: standingSideSchema,
  /** Optional legacy/composition override; resolved from the Appearance. */
  scale: z.number().finite().positive().optional(),
  edge: standingEdgeSchema.optional(),
  vertical: standingVerticalSchema.optional(),
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
