import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "./content/primitives";
import { sceneAccentSchema, sceneTransitionEdgeSchema } from "./content/scene";
import { sceneTimingSchema } from "./content/timing";

export const scriptIdRefSchema = z.union([
  idSchema,
  z.strictObject({ key: z.string().min(1) }),
]);
export type ScriptIdRef = z.infer<typeof scriptIdRefSchema>;

const scriptKeySchema = z.string().min(1);
const sceneIndexSchema = nonNegativeInt;

export const newNarrationLineInputSchema = z.strictObject({
  captionText: z.string().optional(),
  speechText: z.string().optional(),
  speakerId: z.string().min(1).nullable().optional(),
  expressionId: z.string().min(1).nullable().optional(),
  gapBeforeMs: nonNegativeInt.optional(),
});
export type NewNarrationLineInput = z.infer<typeof newNarrationLineInputSchema>;

const sceneAddCommonShape = {
  op: z.literal("scene.add"),
  key: scriptKeySchema.optional(),
  index: sceneIndexSchema.optional(),
  label: z.string().optional(),
};

export const sceneAddPointOperationSchema = z.strictObject({
  ...sceneAddCommonShape,
  kind: z.literal("point"),
  lines: z.array(newNarrationLineInputSchema).optional(),
});

export const sceneAddInsertOperationSchema = z.strictObject({
  ...sceneAddCommonShape,
  kind: z.literal("insert"),
  assetId: idSchema,
  durationMs: positiveInt,
  embeddedAudio: z.boolean().optional(),
});

export const sceneRemoveOperationSchema = z.strictObject({
  op: z.literal("scene.remove"),
  sceneId: scriptIdRefSchema,
});

export const sceneMoveOperationSchema = z.strictObject({
  op: z.literal("scene.move"),
  sceneId: scriptIdRefSchema,
  index: sceneIndexSchema,
});

export const sceneSetLabelOperationSchema = z.strictObject({
  op: z.literal("scene.setLabel"),
  sceneId: scriptIdRefSchema,
  label: z.string().trim().min(1),
});

export const sceneSetAccentOperationSchema = z.strictObject({
  op: z.literal("scene.setAccent"),
  sceneId: scriptIdRefSchema,
  accent: sceneAccentSchema,
});

export const sceneSetTimingOperationSchema = z.strictObject({
  op: z.literal("scene.setTiming"),
  sceneId: scriptIdRefSchema,
  timing: sceneTimingSchema,
});

export const sceneSetTransitionOperationSchema = z.strictObject({
  op: z.literal("scene.setTransition"),
  sceneId: scriptIdRefSchema,
  enter: sceneTransitionEdgeSchema,
});

export const scriptOperationSchema = z.union([
  sceneAddPointOperationSchema,
  sceneAddInsertOperationSchema,
  sceneRemoveOperationSchema,
  sceneMoveOperationSchema,
  sceneSetLabelOperationSchema,
  sceneSetAccentOperationSchema,
  sceneSetTimingOperationSchema,
  sceneSetTransitionOperationSchema,
]);
export type ScriptOperation = z.infer<typeof scriptOperationSchema>;
export type SceneAddPointOperation = z.infer<typeof sceneAddPointOperationSchema>;
export type SceneAddInsertOperation = z.infer<typeof sceneAddInsertOperationSchema>;
export type SceneRemoveOperation = z.infer<typeof sceneRemoveOperationSchema>;
export type SceneMoveOperation = z.infer<typeof sceneMoveOperationSchema>;
export type SceneSetLabelOperation = z.infer<typeof sceneSetLabelOperationSchema>;
export type SceneSetAccentOperation = z.infer<typeof sceneSetAccentOperationSchema>;
export type SceneSetTimingOperation = z.infer<typeof sceneSetTimingOperationSchema>;
export type SceneSetTransitionOperation = z.infer<typeof sceneSetTransitionOperationSchema>;

export const scriptOperationsSchema = z.array(scriptOperationSchema);
