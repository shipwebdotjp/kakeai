import { z } from "zod";
import { accentColorSchema, idSchema, nonNegativeInt } from "./primitives";
import { sceneTimingSchema } from "./timing";
import { narrationSegmentSchema } from "./narration";
import { visualCueSchema } from "./visual";

export const sceneTransitionPresetSchema = z.enum(["cut", "fade", "crossfade"]);
export type SceneTransitionPreset = z.infer<typeof sceneTransitionPresetSchema>;

export const sceneTransitionEdgeSchema = z
  .strictObject({
    preset: sceneTransitionPresetSchema,
    durationMs: nonNegativeInt,
  })
  .superRefine((edge, ctx) => {
    if (edge.preset === "cut" && edge.durationMs !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "preset: cut は durationMs: 0 を要求します",
        path: ["durationMs"],
      });
    }
    if (edge.preset !== "cut" && edge.durationMs === 0) {
      ctx.addIssue({
        code: "custom",
        message: "preset: fade/crossfade は durationMs > 0 を要求します",
        path: ["durationMs"],
      });
    }
  });

export const sceneTransitionSchema = z.strictObject({
  enter: sceneTransitionEdgeSchema,
});

export type SceneTransition = z.infer<typeof sceneTransitionSchema>;
export type SceneTransitionEdge = z.infer<typeof sceneTransitionEdgeSchema>;

const sceneBaseShape = {
  id: idSchema,
  accentColor: accentColorSchema,
  timing: sceneTimingSchema,
  transition: sceneTransitionSchema.optional(),
  lines: z.array(narrationSegmentSchema),
  visualCues: z.array(visualCueSchema),
};

export const introSceneSchema = z.strictObject({
  kind: z.literal("intro"),
  ...sceneBaseShape,
});

export const pointSceneSchema = z.strictObject({
  kind: z.literal("point"),
  ...sceneBaseShape,
});

export const outroSceneSchema = z.strictObject({
  kind: z.literal("outro"),
  ...sceneBaseShape,
});

export const sceneSchema = z.discriminatedUnion("kind", [
  introSceneSchema,
  pointSceneSchema,
  outroSceneSchema,
]);

export type Scene = z.infer<typeof sceneSchema>;
export type IntroScene = z.infer<typeof introSceneSchema>;
export type PointScene = z.infer<typeof pointSceneSchema>;
export type OutroScene = z.infer<typeof outroSceneSchema>;
