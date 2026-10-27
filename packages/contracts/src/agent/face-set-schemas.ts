import { AGENT_PREVIEW_IMAGE_BASE64_MAX, agentEmptyInputSchema } from "./protocol";
import { z } from "zod";
import { idSchema, positiveInt } from "../content/primitives";
import {
  createFaceSetRequestSchema,
  expressionPresetSchema,
  faceLayerSchema,
  faceSetSchema,
  faceSetUsagesSchema,
} from "../face-set";

export const agentFaceSetListInputSchema = agentEmptyInputSchema;
export const agentFaceSetListOutputSchema = z.strictObject({
  faceSets: z.array(faceSetSchema),
});

export const agentFaceSetGetInputSchema = z.strictObject({
  faceSetId: idSchema,
  /** Omit to read the latest revision; set it to pin a specific version. */
  version: positiveInt.optional(),
});
export const agentFaceSetGetOutputSchema = z.strictObject({
  faceSet: faceSetSchema,
});

/**
 * A new Face Set library entry (C9). Like `character.create` and
 * `voiceProfile.create`, it has no `requestId`: a timed-out create is checked
 * through `faceSet.list` before retrying.
 */
export const agentFaceSetCreateInputSchema = createFaceSetRequestSchema;
export const agentFaceSetCreateOutputSchema = z.strictObject({
  faceSet: faceSetSchema,
});

/**
 * A partial Face Set edit (C10). Every member is optional; an omitted member
 * is left unchanged, and only a provided `layers` / `expressions` that differs
 * from the latest revision creates a new immutable revision. The library
 * Characters that reference the Face Set follow the latest revision
 * immediately, while saved works keep their pinned `faceSetVersion`. A
 * name-only change never consumes a revision. The merge reads the current row
 * inside the write transaction, so a concurrent edit is not overwritten with a
 * stale snapshot.
 */
export const agentFaceSetUpdateInputSchema = z
  .strictObject({
    faceSetId: idSchema,
    name: z.string().trim().min(1).optional(),
    layers: z.array(faceLayerSchema).max(50).optional(),
    expressions: z.array(expressionPresetSchema).max(50).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.layers !== undefined ||
      value.expressions !== undefined,
    {
      message: "更新する項目を1つ以上指定してください。",
      path: [],
    },
  );
export const agentFaceSetUpdateOutputSchema = z.strictObject({
  faceSet: faceSetSchema,
});

/** The library Appearances that reference a Face Set, for impact/dimension checks. */
export const agentFaceSetUsagesInputSchema = z.strictObject({
  faceSetId: idSchema,
});
export const agentFaceSetUsagesOutputSchema = z.strictObject({
  usages: faceSetUsagesSchema,
});

/**
 * `preview.faceSet` composites an unsaved draft over a base image and returns
 * a PNG (C11). It writes nothing: no Face Set, revision, Job or Artifact. The
 * base image and the expression layers are drawn at the base image's pixel
 * size; the caller checks the expression id and layer dimensions with
 * `faceSet.get` and the write operations.
 */
export const agentPreviewFaceSetInputSchema = z.strictObject({
  layers: z.array(faceLayerSchema).max(50),
  expressions: z.array(expressionPresetSchema).max(50),
  /** Omit to render the required `normal` expression. */
  expressionId: idSchema.optional(),
  /** A ready image Asset the layers are drawn over. */
  baseAssetId: idSchema,
});
export const agentPreviewFaceSetOutputSchema = z.strictObject({
  width: positiveInt,
  height: positiveInt,
  mimeType: z.literal("image/png"),
  pngBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentPreviewFaceSetInput = z.infer<
  typeof agentPreviewFaceSetInputSchema
>;
export type AgentPreviewFaceSetOutput = z.infer<
  typeof agentPreviewFaceSetOutputSchema
>;
