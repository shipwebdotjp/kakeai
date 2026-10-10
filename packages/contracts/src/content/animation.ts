import { z } from "zod";
import { nonNegativeInt } from "./primitives";

export const animationPresetSchema = z.enum([
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scale-in",
  "pulse",
]);
export type AnimationPreset = z.infer<typeof animationPresetSchema>;
export const ANIMATION_PRESETS = animationPresetSchema.options;

export const animationSpecSchema = z
  .strictObject({
    preset: animationPresetSchema,
    durationMs: nonNegativeInt,
  })
  .superRefine((spec, ctx) => {
    if (spec.preset === "none" && spec.durationMs !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "preset: none は durationMs: 0 を要求します",
        path: ["durationMs"],
      });
    }
  });
export type AnimationSpec = z.infer<typeof animationSpecSchema>;

export interface AnimationPolicy {
  presets: readonly AnimationPreset[];
  defaultDurationMs: number;
  maxDurationMs: number;
}

export const DEFAULT_ANIMATION_POLICY: AnimationPolicy = {
  presets: [...ANIMATION_PRESETS],
  defaultDurationMs: 400,
  maxDurationMs: 2000,
};
