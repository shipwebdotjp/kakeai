import { z } from "zod";
import { nonNegativeInt } from "./primitives";

export const cueLayerSchema = z.enum(["background", "card", "standing", "overlay"]);
export type CueLayer = z.infer<typeof cueLayerSchema>;
export const CUE_LAYERS = cueLayerSchema.options;

export const transitionPresetSchema = z.enum(["none", "fade"]);
export type TransitionPreset = z.infer<typeof transitionPresetSchema>;

export const transitionEdgeSchema = z
  .strictObject({
    preset: transitionPresetSchema,
    durationMs: nonNegativeInt,
  })
  .superRefine((edge, ctx) => {
    if (edge.preset === "none" && edge.durationMs !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "preset: none は durationMs: 0 を要求します",
        path: ["durationMs"],
      });
    }
  });

export const cueTransitionSchema = z.strictObject({
  enter: transitionEdgeSchema,
  exit: transitionEdgeSchema,
});

export type TransitionEdge = z.infer<typeof transitionEdgeSchema>;
export type CueTransition = z.infer<typeof cueTransitionSchema>;

export interface TransitionPolicy {
  presets: readonly TransitionPreset[];
  defaultEnter: TransitionEdge;
  defaultExit: TransitionEdge;
  maxDurationMs: number;
}

export const DEFAULT_TRANSITION_POLICY: TransitionPolicy = {
  presets: ["none", "fade"],
  defaultEnter: { preset: "fade", durationMs: 350 },
  defaultExit: { preset: "none", durationMs: 0 },
  maxDurationMs: 1000,
};
