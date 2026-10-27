import {
  AGENT_DIAGNOSE_READ_TIMEOUT_MS,
  AGENT_PREVIEW_READ_TIMEOUT_MS,
  AGENT_READ_TIMEOUT_MS,
} from "./protocol";
import { z } from "zod";
import { scriptOperationNames } from "../script-operation";

export const scriptOperationCategorySchema = z.enum([
  "scene",
  "line",
  "cue",
  "standing",
  "character",
  "speaker",
  "audio",
  "document",
]);
export type ScriptOperationCategory = z.infer<
  typeof scriptOperationCategorySchema
>;

export const agentOperationCatalogEntrySchema = z.strictObject({
  name: z.enum(scriptOperationNames),
  category: scriptOperationCategorySchema,
});
export type AgentOperationCatalogEntry = z.infer<
  typeof agentOperationCatalogEntrySchema
>;

/** Operations exposed by the A3 local control socket and later bindings. */
export const agentOperationNames = [
  "schema.get",
  "template.get",
  "work.list",
  "work.get",
  "work.create",
  "work.update",
  "work.clone",
  "edition.create",
  "script.get",
  "script.listVersions",
  "script.validate",
  "script.subtitles",
  "script.save",
  "script.edit",
  "script.restore",
  "asset.list",
  "asset.get",
  "asset.import",
  "asset.tag",
  "render.start",
  "job.get",
  "job.list",
  "job.cancel",
  "artifact.get",
  "composition.list",
  "composition.get",
  "composition.draft.get",
  "composition.authoringContext",
  "composition.create",
  "composition.draft.save",
  "composition.publish",
  "tts.create",
  "tts.createBulk",
  "tts.attachBulk",
  "character.list",
  "character.get",
  "character.setVoices",
  "character.create",
  "character.update",
  "theme.list",
  "theme.get",
  "theme.diagnose",
  "theme.create",
  "theme.draft.get",
  "theme.draft.save",
  "theme.publish",
  "font.list",
  "faceSet.list",
  "faceSet.get",
  "voiceAdapter.list",
  "voiceProfile.list",
  "voiceProfile.get",
  "voiceProfile.listVoices",
  "voiceProfile.listModels",
  "voiceProfile.create",
  "voiceProfile.update",
  "preview.frame",
  "preview.scriptFrame",
  "preview.assetFrame",
  "preview.theme",
  "preview.thumbnail",
  "thumbnail.listTemplates",
  "thumbnail.list",
  "thumbnail.get",
  "thumbnail.appearance",
  "thumbnail.create",
  "thumbnail.update",
  "thumbnail.setPrimary",
  "thumbnail.image",
] as const;
export type AgentOperationName = (typeof agentOperationNames)[number];

export const agentReadOperationNames = [
  "schema.get",
  "template.get",
  "work.list",
  "work.get",
  "script.get",
  "script.listVersions",
  "script.validate",
  "script.subtitles",
  "asset.list",
  "asset.get",
  "job.get",
  "job.list",
  "artifact.get",
  "composition.list",
  "composition.get",
  "composition.draft.get",
  "composition.authoringContext",
  "character.list",
  "character.get",
  "theme.list",
  "theme.get",
  "theme.diagnose",
  "theme.draft.get",
  "font.list",
  "faceSet.list",
  "faceSet.get",
  "voiceAdapter.list",
  "voiceProfile.list",
  "voiceProfile.get",
  "voiceProfile.listVoices",
  "voiceProfile.listModels",
  "preview.frame",
  "preview.scriptFrame",
  "preview.assetFrame",
  "preview.theme",
  "preview.thumbnail",
  "thumbnail.listTemplates",
  "thumbnail.list",
  "thumbnail.get",
  "thumbnail.appearance",
  "thumbnail.image",
] as const satisfies readonly AgentOperationName[];

export const agentMutationOperationNames = [
  "work.create",
  "work.update",
  "work.clone",
  "edition.create",
  "script.save",
  "script.edit",
  "script.restore",
  "asset.import",
  "asset.tag",
  "render.start",
  "job.cancel",
  "composition.create",
  "composition.draft.save",
  "composition.publish",
  "tts.create",
  "tts.createBulk",
  "tts.attachBulk",
  "voiceProfile.create",
  "voiceProfile.update",
  "character.setVoices",
  "character.create",
  "character.update",
  "theme.create",
  "theme.draft.save",
  "theme.publish",
  "thumbnail.create",
  "thumbnail.update",
  "thumbnail.setPrimary",
] as const satisfies readonly AgentOperationName[];

/**
 * Mutations that enqueue a Job and return before the work is done. Callers poll
 * `job.get` (or the MCP binding's `job_wait`) with the returned Job id or ids.
 */
export const agentLongRunningOperationNames = [
  "asset.import",
  "render.start",
  "tts.create",
  "tts.createBulk",
] as const satisfies readonly AgentOperationName[];

/**
 * Version-creating operations whose required `requestId` makes a replay safe.
 * Bindings use this list to advertise `idempotentHint` without keeping a
 * second classification. The request id is idempotent on the created version
 * (`ScriptVersion.agentRequestId`), not through the Job ledger.
 */
export const agentRequestIdRequiredOperationNames = [
  "script.edit",
  "script.restore",
  "tts.attachBulk",
] as const satisfies readonly AgentOperationName[];

export function isAgentRequestIdRequiredOperation(operation: string): boolean {
  return (agentRequestIdRequiredOperationNames as readonly string[]).includes(
    operation,
  );
}

export function isAgentOperationName(
  value: string,
): value is AgentOperationName {
  return (agentOperationNames as readonly string[]).includes(value);
}

export function isAgentMutationOperation(operation: string): boolean {
  return (agentMutationOperationNames as readonly string[]).includes(operation);
}

export function isAgentLongRunningOperation(operation: string): boolean {
  return (agentLongRunningOperationNames as readonly string[]).includes(
    operation,
  );
}

/**
 * Read operations whose output contains image bytes. Bindings surface these
 * as standard image content blocks and let CLI `--out` write the bytes to a
 * file. The list is shared so bindings do not keep a second operation list.
 */
export const agentImagePreviewOperationNames = [
  "preview.frame",
  "preview.scriptFrame",
  "preview.assetFrame",
  "preview.theme",
  "preview.thumbnail",
  "thumbnail.image",
] as const satisfies readonly AgentOperationName[];
export type AgentImagePreviewOperationName =
  (typeof agentImagePreviewOperationNames)[number];

export function isAgentImagePreviewOperation(
  operation: string,
): operation is AgentImagePreviewOperationName {
  return (agentImagePreviewOperationNames as readonly string[]).includes(
    operation,
  );
}

/**
 * Non-image reads that exceed the standard budget for a known reason. The font
 * catalog may wait for the first `system_profiler` scan, and diagnosis may
 * launch Chromium to verify faces.
 */
const AGENT_SLOW_READ_TIMEOUT_MS: Partial<Record<AgentOperationName, number>> = {
  "font.list": AGENT_PREVIEW_READ_TIMEOUT_MS,
  "theme.diagnose": AGENT_DIAGNOSE_READ_TIMEOUT_MS,
};

/** The extended read timeout for an operation, or undefined for the default. */
export function agentOperationReadTimeoutMs(
  operation: string,
): number | undefined {
  if (isAgentImagePreviewOperation(operation)) {
    return AGENT_PREVIEW_READ_TIMEOUT_MS;
  }
  return isAgentOperationName(operation)
    ? AGENT_SLOW_READ_TIMEOUT_MS[operation]
    : undefined;
}

/** Shared server/client read-timeout policy; an explicit override wins. */
export function resolveAgentReadTimeoutMs(
  operation: string,
  overrideMs: number | undefined,
): number {
  return (
    overrideMs ??
    agentOperationReadTimeoutMs(operation) ??
    AGENT_READ_TIMEOUT_MS
  );
}

const AGENT_IMAGE_BASE64_FIELDS = ["pngBase64", "imageBase64"] as const;

/** Returns the image bytes from any preview output, without a binding-local list. */
export function agentImageBase64Of(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  for (const field of AGENT_IMAGE_BASE64_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Returns the output without its image bytes, for the MCP text summary. */
export function agentImageMetadataOf(
  output: unknown,
): Record<string, unknown> | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const {
    pngBase64: _png,
    imageBase64: _image,
    ...metadata
  } = output as Record<string, unknown>;
  return metadata;
}

export const agentOperationKindSchema = z.enum(["read", "mutation"]);
export type AgentOperationKind = z.infer<typeof agentOperationKindSchema>;

/**
 * Serialisable catalog of every operation a binding may expose. `kind` is
 * derived from the read/mutation lists and `longRunning` marks Job-returning
 * operations, so bindings never keep a second operation list.
 */
export const agentOperationDescriptorSchema = z.strictObject({
  name: z.enum(agentOperationNames),
  kind: agentOperationKindSchema,
  longRunning: z.boolean(),
});
export type AgentOperationDescriptor = z.infer<
  typeof agentOperationDescriptorSchema
>;

export const agentOperationCatalog: readonly AgentOperationDescriptor[] =
  agentOperationNames.map((name) => ({
    name,
    kind: isAgentMutationOperation(name) ? "mutation" : "read",
    longRunning: isAgentLongRunningOperation(name),
  }));

export const agentWarningCodes = [
  "chart_categories_overflow",
  "chart_negative_value",
  "chart_series_overflow",
  "cue_removed_after_line_removal",
  "cue_removed_after_split",
  "cue_line_refs_reset",
  "draft_cue_range_reset",
  "insert_video_without_audio",
  "offset_range_clamped",
  "offset_range_out_of_scene",
  "table_cell_overflow",
  "table_columns_overflow",
  "table_rows_overflow",
  "text_overflow",
] as const;
export type AgentWarningCode = (typeof agentWarningCodes)[number];
export const agentWarningCodeSchema = z.enum(agentWarningCodes);
