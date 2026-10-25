import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "./content/primitives";
import { audioTakeSourceSchema } from "./content/narration";
import { audioCueRangeSchema, audioCueRoleSchema } from "./content/audio";
import { cueLayerSchema, cueTransitionSchema, transitionEdgeSchema } from "./content/layers";
import { templateRefSchema } from "./content/nested";
import { standingEdgeSchema, standingSideSchema, standingVerticalSchema } from "./templates";
import { sceneAccentSchema, sceneTransitionEdgeSchema } from "./content/scene";
import { sceneTimingSchema } from "./content/timing";

export const SCRIPT_EDIT_ERROR_CODES = {
  TARGET_NOT_FOUND: "EDIT_TARGET_NOT_FOUND",
  PRECONDITION_FAILED: "EDIT_PRECONDITION_FAILED",
  INVALID_INPUT: "EDIT_INVALID_INPUT",
  UNSUPPORTED_TEMPLATE: "EDIT_UNSUPPORTED_TEMPLATE",
  ID_GENERATION_FAILED: "EDIT_ID_GENERATION_FAILED",
} as const;

export type ScriptEditErrorCode =
  (typeof SCRIPT_EDIT_ERROR_CODES)[keyof typeof SCRIPT_EDIT_ERROR_CODES];

export const scriptEditErrorCodes = Object.values(SCRIPT_EDIT_ERROR_CODES) as [
  ScriptEditErrorCode,
  ...ScriptEditErrorCode[],
];

export const scriptOperationCreatedSchema = z.strictObject({
  sceneIds: z.array(idSchema),
  lineIds: z.array(idSchema),
  cueIds: z.array(idSchema),
  audioCueIds: z.array(idSchema),
  audioTakeIds: z.array(idSchema),
  characterIds: z.array(idSchema),
  appearanceIds: z.array(idSchema),
  speakerIds: z.array(idSchema),
});
export type ScriptOperationCreated = z.infer<typeof scriptOperationCreatedSchema>;

export const scriptIdRefSchema = z.union([
  idSchema,
  z.strictObject({ key: z.string().min(1) }),
]);
export type ScriptIdRef = z.infer<typeof scriptIdRefSchema>;

export const scriptCueRangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scene") }),
  z.strictObject({
    kind: z.literal("lines"),
    startLineId: scriptIdRefSchema,
    endLineId: scriptIdRefSchema,
  }),
  z.strictObject({
    kind: z.literal("offset"),
    startMs: nonNegativeInt,
    endMs: nonNegativeInt,
  }),
]);
export type ScriptCueRange = z.infer<typeof scriptCueRangeSchema>;

const scriptKeySchema = z.string().min(1);
const sceneIndexSchema = nonNegativeInt;

export const newNarrationLineInputSchema = z.strictObject({
  captionText: z.string().optional(),
  speechText: z.string().optional(),
  // `scene.add`'s initial lines take a concrete Speaker ID only. Keyed refs
  // are supported by the standalone `line.add` / `line.setSpeaker` operations.
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

export const sceneSplitAtLineOperationSchema = z.strictObject({
  op: z.literal("scene.splitAtLine"),
  key: scriptKeySchema.optional(),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  label: z.string().optional(),
});

export const lineSplitPartSchema = z.strictObject({
  captionText: z.string(),
  speechText: z.string(),
});
export type LineSplitPart = z.infer<typeof lineSplitPartSchema>;

export const lineSplitOperationSchema = z.strictObject({
  op: z.literal("line.split"),
  key: scriptKeySchema.optional(),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  first: lineSplitPartSchema,
  second: lineSplitPartSchema,
});

export const lineAddOperationSchema = z.strictObject({
  op: z.literal("line.add"),
  key: scriptKeySchema.optional(),
  sceneId: scriptIdRefSchema,
  index: nonNegativeInt.optional(),
  captionText: z.string().optional(),
  speechText: z.string().optional(),
  speakerId: scriptIdRefSchema.nullable().optional(),
  expressionId: z.string().min(1).nullable().optional(),
  gapBeforeMs: nonNegativeInt.optional(),
});

export const lineRemoveOperationSchema = z.strictObject({
  op: z.literal("line.remove"),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
});

export const lineMoveOperationSchema = z.strictObject({
  op: z.literal("line.move"),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  index: nonNegativeInt,
});

export const lineSetTextOperationSchema = z
  .strictObject({
    op: z.literal("line.setText"),
    sceneId: scriptIdRefSchema,
    lineId: scriptIdRefSchema,
    captionText: z.string().optional(),
    speechText: z.string().optional(),
  })
  .refine(
    (value) => value.captionText !== undefined || value.speechText !== undefined,
    { message: "captionTextまたはspeechTextが必要です", path: ["captionText"] },
  );

export const lineSetSpeakerOperationSchema = z.strictObject({
  op: z.literal("line.setSpeaker"),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  speakerId: scriptIdRefSchema.nullable(),
});

export const lineSetExpressionOperationSchema = z.strictObject({
  op: z.literal("line.setExpression"),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  expressionId: z.string().min(1).nullable(),
});

export const lineSetGapOperationSchema = z.strictObject({
  op: z.literal("line.setGap"),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  gapBeforeMs: nonNegativeInt,
});

export const lineAssignTakeOperationSchema = z.strictObject({
  op: z.literal("line.assignTake"),
  key: scriptKeySchema.optional(),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  assetId: idSchema,
  source: audioTakeSourceSchema,
});

export const lineSelectTakeOperationSchema = z.strictObject({
  op: z.literal("line.selectTake"),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  takeId: scriptIdRefSchema.nullable(),
});

export const lineRemoveTakeOperationSchema = z.strictObject({
  op: z.literal("line.removeTake"),
  sceneId: scriptIdRefSchema,
  lineId: scriptIdRefSchema,
  takeId: scriptIdRefSchema,
});

export const cueAddOperationSchema = z.strictObject({
  op: z.literal("cue.add"),
  key: scriptKeySchema.optional(),
  sceneId: scriptIdRefSchema,
  template: templateRefSchema,
  range: scriptCueRangeSchema,
  layer: cueLayerSchema,
  order: nonNegativeInt.optional(),
  transition: cueTransitionSchema.optional(),
  input: z.unknown(),
});

export const cueRemoveOperationSchema = z.strictObject({
  op: z.literal("cue.remove"),
  sceneId: scriptIdRefSchema,
  cueId: scriptIdRefSchema,
});

export const cueSetRangeOperationSchema = z.strictObject({
  op: z.literal("cue.setRange"),
  sceneId: scriptIdRefSchema,
  cueId: scriptIdRefSchema,
  range: scriptCueRangeSchema,
});

export const cueSetInputOperationSchema = z.strictObject({
  op: z.literal("cue.setInput"),
  sceneId: scriptIdRefSchema,
  cueId: scriptIdRefSchema,
  input: z.unknown(),
  replace: z.boolean().optional(),
});

export const cueSetPlacementOperationSchema = z.strictObject({
  op: z.literal("cue.setPlacement"),
  sceneId: scriptIdRefSchema,
  cueId: scriptIdRefSchema,
  layer: cueLayerSchema,
  order: nonNegativeInt,
});

export const cueSetTransitionOperationSchema = z
  .strictObject({
    op: z.literal("cue.setTransition"),
    sceneId: scriptIdRefSchema,
    cueId: scriptIdRefSchema,
    enter: transitionEdgeSchema.optional(),
    exit: transitionEdgeSchema.optional(),
  })
  .refine((value) => value.enter !== undefined || value.exit !== undefined, {
    message: "enterまたはexitが必要です",
    path: ["enter"],
  });

export const cueMoveOperationSchema = z.strictObject({
  op: z.literal("cue.move"),
  sceneId: scriptIdRefSchema,
  cueId: scriptIdRefSchema,
  toSceneId: scriptIdRefSchema,
});

export const cueCopyOperationSchema = z.strictObject({
  op: z.literal("cue.copy"),
  key: scriptKeySchema.optional(),
  sceneId: scriptIdRefSchema,
  cueId: scriptIdRefSchema,
  toSceneIds: z.array(scriptIdRefSchema).min(1),
});

export const standingSetOperationSchema = z.strictObject({
  op: z.literal("standing.set"),
  key: scriptKeySchema.optional(),
  sceneId: scriptIdRefSchema,
  side: standingSideSchema,
  characterId: idSchema,
  appearanceId: idSchema,
  scale: z.number().finite().positive().optional(),
  edge: standingEdgeSchema.optional(),
  vertical: standingVerticalSchema.optional(),
  transition: cueTransitionSchema.optional(),
});

export const standingRemoveOperationSchema = z.strictObject({
  op: z.literal("standing.remove"),
  sceneId: scriptIdRefSchema,
  side: standingSideSchema,
});

export const audioAddOperationSchema = z.strictObject({
  op: z.literal("audio.add"),
  key: scriptKeySchema.optional(),
  role: audioCueRoleSchema,
  assetId: idSchema,
  range: audioCueRangeSchema,
  gainDb: z.number().finite().optional(),
  loop: z.boolean().optional(),
});

export const audioSetOperationSchema = z
  .strictObject({
    op: z.literal("audio.set"),
    audioCueId: scriptIdRefSchema,
    role: audioCueRoleSchema.optional(),
    assetId: idSchema.optional(),
    range: audioCueRangeSchema.optional(),
    gainDb: z.number().finite().nullable().optional(),
    loop: z.boolean().nullable().optional(),
  })
  .refine(
    (value) =>
      value.role !== undefined ||
      value.assetId !== undefined ||
      value.range !== undefined ||
      value.gainDb !== undefined ||
      value.loop !== undefined,
    { message: "変更する項目が必要です", path: ["role"] },
  );

export const audioRemoveOperationSchema = z.strictObject({
  op: z.literal("audio.remove"),
  audioCueId: scriptIdRefSchema,
});

export const characterAddFromLibraryOperationSchema = z.strictObject({
  op: z.literal("character.addFromLibrary"),
  libraryCharacterId: idSchema,
});

export const speakerAddOperationSchema = z.strictObject({
  op: z.literal("speaker.add"),
  key: scriptKeySchema.optional(),
  name: z.string().trim().min(1),
  voiceProfileId: idSchema,
});

export const speakerSetVoiceProfileOperationSchema = z.strictObject({
  op: z.literal("speaker.setVoiceProfile"),
  speakerId: scriptIdRefSchema,
  voiceProfileId: idSchema.nullable(),
});

export const documentSetVisualThemeOperationSchema = z.strictObject({
  op: z.literal("document.setVisualTheme"),
  id: idSchema,
  version: positiveInt,
});

const scriptOperationSchemas = [
  sceneAddPointOperationSchema,
  sceneAddInsertOperationSchema,
  sceneRemoveOperationSchema,
  sceneMoveOperationSchema,
  sceneSetLabelOperationSchema,
  sceneSetAccentOperationSchema,
  sceneSetTimingOperationSchema,
  sceneSetTransitionOperationSchema,
  sceneSplitAtLineOperationSchema,
  lineSplitOperationSchema,
  lineAddOperationSchema,
  lineRemoveOperationSchema,
  lineMoveOperationSchema,
  lineSetTextOperationSchema,
  lineSetSpeakerOperationSchema,
  lineSetExpressionOperationSchema,
  lineSetGapOperationSchema,
  lineAssignTakeOperationSchema,
  lineSelectTakeOperationSchema,
  lineRemoveTakeOperationSchema,
  cueAddOperationSchema,
  cueRemoveOperationSchema,
  cueSetRangeOperationSchema,
  cueSetInputOperationSchema,
  cueSetPlacementOperationSchema,
  cueSetTransitionOperationSchema,
  cueMoveOperationSchema,
  cueCopyOperationSchema,
  standingSetOperationSchema,
  standingRemoveOperationSchema,
  audioAddOperationSchema,
  audioSetOperationSchema,
  audioRemoveOperationSchema,
  characterAddFromLibraryOperationSchema,
  speakerAddOperationSchema,
  speakerSetVoiceProfileOperationSchema,
  documentSetVisualThemeOperationSchema,
] as const;

export const scriptOperationSchema = z.union(scriptOperationSchemas);
export type ScriptOperation = z.infer<typeof scriptOperationSchema>;
export type ScriptOperationName = ScriptOperation["op"];

/**
 * Both scene.add variants share the same operation name, so the catalog is
 * de-duplicated. Consumers must see one entry per `op` value.
 */
export const scriptOperationNames = [
  ...new Set(scriptOperationSchemas.map((schema) => schema.shape.op.value)),
] as [ScriptOperationName, ...ScriptOperationName[]];
export type SceneAddPointOperation = z.infer<typeof sceneAddPointOperationSchema>;
export type SceneAddInsertOperation = z.infer<typeof sceneAddInsertOperationSchema>;
export type SceneRemoveOperation = z.infer<typeof sceneRemoveOperationSchema>;
export type SceneMoveOperation = z.infer<typeof sceneMoveOperationSchema>;
export type SceneSetLabelOperation = z.infer<typeof sceneSetLabelOperationSchema>;
export type SceneSetAccentOperation = z.infer<typeof sceneSetAccentOperationSchema>;
export type SceneSetTimingOperation = z.infer<typeof sceneSetTimingOperationSchema>;
export type SceneSetTransitionOperation = z.infer<typeof sceneSetTransitionOperationSchema>;
export type SceneSplitAtLineOperation = z.infer<typeof sceneSplitAtLineOperationSchema>;
export type LineSplitOperation = z.infer<typeof lineSplitOperationSchema>;
export type LineAddOperation = z.infer<typeof lineAddOperationSchema>;
export type LineRemoveOperation = z.infer<typeof lineRemoveOperationSchema>;
export type LineMoveOperation = z.infer<typeof lineMoveOperationSchema>;
export type LineSetTextOperation = z.infer<typeof lineSetTextOperationSchema>;
export type LineSetSpeakerOperation = z.infer<typeof lineSetSpeakerOperationSchema>;
export type LineSetExpressionOperation = z.infer<typeof lineSetExpressionOperationSchema>;
export type LineSetGapOperation = z.infer<typeof lineSetGapOperationSchema>;
export type LineAssignTakeOperation = z.infer<typeof lineAssignTakeOperationSchema>;
export type LineSelectTakeOperation = z.infer<typeof lineSelectTakeOperationSchema>;
export type LineRemoveTakeOperation = z.infer<typeof lineRemoveTakeOperationSchema>;
export type CueAddOperation = z.infer<typeof cueAddOperationSchema>;
export type CueRemoveOperation = z.infer<typeof cueRemoveOperationSchema>;
export type CueSetRangeOperation = z.infer<typeof cueSetRangeOperationSchema>;
export type CueSetInputOperation = z.infer<typeof cueSetInputOperationSchema>;
export type CueSetPlacementOperation = z.infer<typeof cueSetPlacementOperationSchema>;
export type CueSetTransitionOperation = z.infer<typeof cueSetTransitionOperationSchema>;
export type CueMoveOperation = z.infer<typeof cueMoveOperationSchema>;
export type CueCopyOperation = z.infer<typeof cueCopyOperationSchema>;
export type StandingSetOperation = z.infer<typeof standingSetOperationSchema>;
export type StandingRemoveOperation = z.infer<typeof standingRemoveOperationSchema>;
export type AudioAddOperation = z.infer<typeof audioAddOperationSchema>;
export type AudioSetOperation = z.infer<typeof audioSetOperationSchema>;
export type AudioRemoveOperation = z.infer<typeof audioRemoveOperationSchema>;
export type CharacterAddFromLibraryOperation = z.infer<
  typeof characterAddFromLibraryOperationSchema
>;
export type SpeakerAddOperation = z.infer<typeof speakerAddOperationSchema>;
export type SpeakerSetVoiceProfileOperation = z.infer<
  typeof speakerSetVoiceProfileOperationSchema
>;
export type DocumentSetVisualThemeOperation = z.infer<
  typeof documentSetVisualThemeOperationSchema
>;

export const scriptOperationsSchema = z.array(scriptOperationSchema);
