import { z } from "zod";
import { AGENT_PREVIEW_IMAGE_BASE64_MAX } from "./protocol";
import { contentDocumentSchema } from "../content/document";
import { idSchema, nonNegativeInt, positiveInt } from "../content/primitives";

/**
 * A saved Script Version addressed by an absolute time or by a line. The line
 * form is resolved against that version's resolved timeline, so an agent never
 * reuses a time computed from an older version. `timeMs` and `lineId` are
 * mutually exclusive and `offsetMs` is only meaningful with `lineId`.
 */
export const agentPreviewScriptFrameSavedInputSchema = z
  .strictObject({
    scriptVersionId: idSchema,
    timeMs: nonNegativeInt.optional(),
    lineId: idSchema.optional(),
    offsetMs: nonNegativeInt.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.timeMs !== undefined && value.lineId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["lineId"],
        message: "timeMs と lineId は同時に指定できません。",
      });
    }
    if (value.timeMs === undefined && value.lineId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["timeMs"],
        message: "timeMs または lineId を指定してください。",
      });
    }
    if (value.lineId === undefined && value.offsetMs !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["offsetMs"],
        message: "offsetMs は lineId と一緒に指定してください。",
      });
    }
  });

/**
 * `preview.scriptFrame` rasterizes a saved ScriptVersion or an unsaved draft
 * ContentDocument with the same HTML compiler as the Web UI and render worker,
 * seeking to a resolved absolute time without creating a render Job,
 * ScriptVersion, or Artifact.
 */
export const agentPreviewScriptFrameInputSchema = z.union([
  agentPreviewScriptFrameSavedInputSchema,
  z.strictObject({
    content: contentDocumentSchema,
    languageEditionId: idSchema.optional(),
    timeMs: nonNegativeInt,
  }),
]);
export const agentPreviewScriptFrameOutputSchema = z.strictObject({
  scriptVersionId: idSchema.nullable(),
  requestedTimeMs: nonNegativeInt,
  // Present only for the saved-version line form. The absolute-time form and
  // the unsaved draft form omit both fields.
  resolvedLineId: idSchema.optional(),
  resolvedTimeMs: nonNegativeInt.optional(),
  durationMs: nonNegativeInt,
  width: positiveInt,
  height: positiveInt,
  mimeType: z.literal("image/png"),
  imageBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentPreviewScriptFrameInput = z.output<
  typeof agentPreviewScriptFrameInputSchema
>;
export type AgentPreviewScriptFrameOutput = z.infer<
  typeof agentPreviewScriptFrameOutputSchema
>;
