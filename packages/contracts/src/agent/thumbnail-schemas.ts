import { AGENT_PREVIEW_IMAGE_BASE64_MAX, agentEmptyInputSchema } from "./protocol";
import { agentThumbnailTemplateContractSchema } from "./template";
import { z } from "zod";
import { idSchema, positiveInt } from "../content/primitives";
import { thumbnailSchema } from "../dto";
import {
  createThumbnailRequestSchema,
  saveThumbnailRequestSchema,
  thumbnailPreviewRequestSchema,
} from "../requests";
import {
  resolvedThumbnailAppearanceSchema,
  thumbnailAppearanceSchema,
} from "../thumbnail/appearance";

/**
 * Thumbnail templates are a separate registry from the VisualTemplates that
 * `schema.get` lists. The list operation is the catalogue: it returns the
 * input contract (JSON Schema and example) of every bundled template, so an
 * agent never has to copy a template contract into a skill.
 */
export const agentThumbnailListTemplatesInputSchema = agentEmptyInputSchema;
export const agentThumbnailListTemplatesOutputSchema = z.strictObject({
  templates: z.array(agentThumbnailTemplateContractSchema),
});
export type AgentThumbnailListTemplatesOutput = z.infer<
  typeof agentThumbnailListTemplatesOutputSchema
>;

/**
 * Thumbnail candidates of one Language Edition. The `Thumbnail` DTO already
 * carries `isPrimary` and `appearanceOverride`, so the list needs no pointer.
 */
export const agentThumbnailListInputSchema = z.strictObject({
  languageEditionId: idSchema,
});
export const agentThumbnailListOutputSchema = z.strictObject({
  thumbnails: z.array(thumbnailSchema),
});
export type AgentThumbnailListOutput = z.infer<
  typeof agentThumbnailListOutputSchema
>;

export const agentThumbnailGetInputSchema = z.strictObject({
  thumbnailId: idSchema,
});
export const agentThumbnailGetOutputSchema = z.strictObject({
  thumbnail: thumbnailSchema,
});
export type AgentThumbnailGetOutput = z.infer<
  typeof agentThumbnailGetOutputSchema
>;

/** The Edition common Appearance is read-only for agents; saving stays human. */
export const agentThumbnailAppearanceInputSchema = z.strictObject({
  languageEditionId: idSchema,
});
// The same shape as `thumbnailAppearanceViewSchema`, but declared strict so an
// internal field added to the DTO later cannot leak into the agent contract.
export const agentThumbnailAppearanceOutputSchema = z.strictObject({
  appearance: thumbnailAppearanceSchema.nullable(),
  defaults: resolvedThumbnailAppearanceSchema,
  resolved: resolvedThumbnailAppearanceSchema,
});
export type AgentThumbnailAppearanceOutput = z.infer<
  typeof agentThumbnailAppearanceOutputSchema
>;

/** Same body as the HTTP create, plus the target Language Edition. */
export const agentThumbnailCreateInputSchema = createThumbnailRequestSchema.extend({
  languageEditionId: idSchema,
});
export const agentThumbnailCreateOutputSchema = z.strictObject({
  thumbnail: thumbnailSchema,
});
export type AgentThumbnailCreateOutput = z.infer<
  typeof agentThumbnailCreateOutputSchema
>;

/** Same body as the HTTP save (last-write-wins), plus the candidate id. */
export const agentThumbnailUpdateInputSchema = saveThumbnailRequestSchema.extend({
  thumbnailId: idSchema,
});
export const agentThumbnailUpdateOutputSchema = z.strictObject({
  thumbnail: thumbnailSchema,
});
export type AgentThumbnailUpdateOutput = z.infer<
  typeof agentThumbnailUpdateOutputSchema
>;

/** Commits the candidate used for publication; null clears the selection. */
export const agentThumbnailSetPrimaryInputSchema = z.strictObject({
  languageEditionId: idSchema,
  thumbnailId: idSchema.nullable(),
});
export const agentThumbnailSetPrimaryOutputSchema = z.strictObject({
  thumbnail: thumbnailSchema.nullable(),
});
export type AgentThumbnailSetPrimaryOutput = z.infer<
  typeof agentThumbnailSetPrimaryOutputSchema
>;

/**
 * `preview.thumbnail` rasterizes an unsaved draft with the same compiler and
 * headless PNG path as the saved candidate image. Nothing is written.
 */
export const agentPreviewThumbnailInputSchema = thumbnailPreviewRequestSchema.extend({
  languageEditionId: idSchema,
});
export const agentPreviewThumbnailOutputSchema = z.strictObject({
  languageEditionId: idSchema,
  width: positiveInt,
  height: positiveInt,
  mimeType: z.literal("image/png"),
  pngBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentPreviewThumbnailOutput = z.infer<
  typeof agentPreviewThumbnailOutputSchema
>;

/**
 * `thumbnail.image` returns the PNG of a saved candidate. The image is
 * generated on demand (ADR 0060): no Job, Artifact or file is created.
 */
export const agentThumbnailImageInputSchema = z.strictObject({
  thumbnailId: idSchema,
});
export const agentThumbnailImageOutputSchema = z.strictObject({
  thumbnailId: idSchema,
  filename: z.string().min(1),
  width: positiveInt,
  height: positiveInt,
  mimeType: z.literal("image/png"),
  pngBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentThumbnailImageOutput = z.infer<
  typeof agentThumbnailImageOutputSchema
>;
