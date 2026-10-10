import { z } from "zod";
import { accentColorSchema, idSchema } from "./primitives";
import { sceneTimingSchema } from "./timing";
import { narrationSegmentSchema } from "./narration";
import { visualCueSchema } from "./visual";

const sceneBaseShape = {
  id: idSchema,
  accentColor: accentColorSchema,
  timing: sceneTimingSchema,
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
