import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";

/**
 * `script.diff` compares two saved Script Versions of the same Language
 * Edition by element ID. It is a structural read: it never infers that two
 * different IDs are the same element and never returns values or JSON Patch.
 */
export const agentScriptDiffInputSchema = z.strictObject({
  fromScriptVersionId: idSchema,
  toScriptVersionId: idSchema,
});
export type AgentScriptDiffInput = z.infer<typeof agentScriptDiffInputSchema>;

export const agentScriptVersionRefSchema = z.strictObject({
  id: idSchema,
  versionNumber: positiveInt,
});
export type AgentScriptVersionRef = z.infer<typeof agentScriptVersionRefSchema>;

/** A scene that exists on only one side, with its child counts. */
export const agentScriptSceneSummarySchema = z.strictObject({
  id: idSchema,
  index: nonNegativeInt,
  lineCount: nonNegativeInt,
  cueCount: nonNegativeInt,
});
export type AgentScriptSceneSummary = z.infer<
  typeof agentScriptSceneSummarySchema
>;

export const agentScriptUpdatedElementSchema = z.strictObject({
  id: idSchema,
  changedFields: z.array(z.string().min(1)),
});
export type AgentScriptUpdatedElement = z.infer<
  typeof agentScriptUpdatedElementSchema
>;

export const agentScriptUpdatedChildSchema = z.strictObject({
  id: idSchema,
  sceneId: idSchema,
  changedFields: z.array(z.string().min(1)),
});
export type AgentScriptUpdatedChild = z.infer<
  typeof agentScriptUpdatedChildSchema
>;

export const agentScriptSceneMovedSchema = z.strictObject({
  id: idSchema,
  fromIndex: nonNegativeInt,
  toIndex: nonNegativeInt,
});
export type AgentScriptSceneMoved = z.infer<typeof agentScriptSceneMovedSchema>;

export const agentScriptChildEntrySchema = z.strictObject({
  id: idSchema,
  sceneId: idSchema,
  index: nonNegativeInt,
});
export type AgentScriptChildEntry = z.infer<typeof agentScriptChildEntrySchema>;

export const agentScriptChildMovedSchema = z.strictObject({
  id: idSchema,
  fromSceneId: idSchema,
  toSceneId: idSchema,
  fromIndex: nonNegativeInt,
  toIndex: nonNegativeInt,
});
export type AgentScriptChildMoved = z.infer<typeof agentScriptChildMovedSchema>;

const agentScriptChildDiffSchema = z.strictObject({
  added: z.array(agentScriptChildEntrySchema),
  removed: z.array(agentScriptChildEntrySchema),
  updated: z.array(agentScriptUpdatedChildSchema),
  moved: z.array(agentScriptChildMovedSchema),
});

const agentScriptSceneDiffSchema = z.strictObject({
  added: z.array(agentScriptSceneSummarySchema),
  removed: z.array(agentScriptSceneSummarySchema),
  updated: z.array(agentScriptUpdatedElementSchema),
  moved: z.array(agentScriptSceneMovedSchema),
});

export const agentScriptDiffOutputSchema = z.strictObject({
  fromScriptVersion: agentScriptVersionRefSchema,
  toScriptVersion: agentScriptVersionRefSchema,
  scenes: agentScriptSceneDiffSchema,
  lines: agentScriptChildDiffSchema,
  cues: agentScriptChildDiffSchema,
  outsideScopeChangedFields: z.array(z.string().min(1)),
});
export type AgentScriptDiffOutput = z.infer<typeof agentScriptDiffOutputSchema>;
