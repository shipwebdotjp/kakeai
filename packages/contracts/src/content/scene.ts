import { z } from "zod";
import { accentColorSchema, idSchema, nonNegativeInt, positiveInt } from "./primitives";
import { themeAccentTokenSchema } from "./theme";
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

export const sceneLabelSchema = z
  .string()
  .trim()
  .min(1, { message: "Scene Label は必須です" });

export const sceneAccentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("theme"),
    token: themeAccentTokenSchema,
  }),
  z.strictObject({
    kind: z.literal("custom"),
    color: accentColorSchema,
  }),
]);
export type SceneAccent = z.infer<typeof sceneAccentSchema>;

const sceneBaseShape = {
  id: idSchema,
  label: sceneLabelSchema,
  accent: sceneAccentSchema,
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

const insertTimingSchema = z.strictObject({
  mode: z.literal("fixed"),
  durationMs: positiveInt,
});

export const insertSceneSchema = z.strictObject({
  kind: z.literal("insert"),
  ...sceneBaseShape,
  timing: insertTimingSchema,
  lines: z.array(narrationSegmentSchema).length(0),
  mainVisualCueId: idSchema,
  embeddedAudio: z.boolean(),
});

export const sceneSchema = z.discriminatedUnion("kind", [
  introSceneSchema,
  pointSceneSchema,
  outroSceneSchema,
  insertSceneSchema,
]);

export type Scene = z.infer<typeof sceneSchema>;
export type IntroScene = z.infer<typeof introSceneSchema>;
export type PointScene = z.infer<typeof pointSceneSchema>;
export type OutroScene = z.infer<typeof outroSceneSchema>;
export type InsertScene = z.infer<typeof insertSceneSchema>;
