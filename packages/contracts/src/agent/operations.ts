import {
  AGENT_PREVIEW_IMAGE_BASE64_MAX,
  agentEmptyInputSchema,
} from "./protocol";
import { agentSchemaGetResultSchema } from "./schema";
import { agentTemplateInputContractSchema } from "./template";
import { z } from "zod";
import { agentRequestIdSchema } from "../agent-request";
import { contentDocumentSchema } from "../content/document";
import {
  idSchema,
  localeSchema,
  nonNegativeInt,
  positiveInt,
} from "../content/primitives";
import {
  artifactSchema,
  assetSchema,
  bulkTtsJobExclusionSchema,
  bulkTtsJobsResultSchema,
  jobKindSchema,
  jobSchema,
  previewTimelineSchema,
  scriptVersionSchema,
  scriptVersionSummarySchema,
  workSchema,
} from "../dto";
import { assetTagsSchema } from "../asset";
import { assetListInputSchema, assetListPageSchema } from "../asset-list";
import { assetMetadataPatchSchema } from "../requests";
import { characterLibraryEntrySchema } from "../character-library";
import { characterNamesSchema, characterVoicesSchema } from "../content/character";
import { faceSetSchema } from "../face-set";
import {
  createVoiceProfileRequestSchema,
  modelListSchema,
  updateVoiceProfileRequestSchema,
  voiceAdapterIdSchema,
  voiceIdSchema,
  voiceListSchema,
  voiceProfileExtrasSchema,
  voiceProfileSchema,
} from "../voice-profile";
import {
  compositionAuthoringContextSchema,
  compositionDraftFilesSchema,
  compositionDraftSchema,
  compositionManifestSchema,
  compositionSchema,
  compositionVersionSchema,
} from "../composition";
import { warningSchema } from "../error";
import {
  compositionAuthoringContextRequestSchema,
  createCompositionRequestSchema,
  createTtsJobRequestSchema,
  publishCompositionRequestSchema,
  saveScriptVersionRequestSchema,
  updateCompositionDraftRequestSchema,
} from "../requests";
import {
  scriptOperationCreatedSchema,
  scriptOperationsSchema,
} from "../script-operation";

export const scriptEditRequestSchema = z.strictObject({
  baseScriptVersionId: idSchema,
  requestId: z.string().trim().min(1),
  operations: scriptOperationsSchema,
  authorAgentId: z.string().trim().min(1).optional(),
});
export type ScriptEditRequest = z.infer<typeof scriptEditRequestSchema>;

export const scriptEditResultSchema = z.strictObject({
  scriptVersion: scriptVersionSchema,
  created: scriptOperationCreatedSchema,
  warnings: z.array(warningSchema),
  timeline: previewTimelineSchema,
  replay: z.boolean(),
});
export type ScriptEditResult = z.infer<typeof scriptEditResultSchema>;

/**
 * `script.save` shares the HTTP save body (`sourceScriptVersionId`, `content`)
 * and adds the target Edition. `baseScriptVersionId` is an optional guard: when
 * it is given, the save only succeeds while that version is the current one.
 * Omitting it keeps the last-write-wins behaviour of the HTTP save.
 */
export const scriptSaveRequestSchema = saveScriptVersionRequestSchema.extend({
  languageEditionId: idSchema,
  baseScriptVersionId: idSchema.optional(),
  authorAgentId: z.string().trim().min(1).optional(),
});
export type ScriptSaveRequest = z.infer<typeof scriptSaveRequestSchema>;

export const scriptSaveResultSchema = z.strictObject({
  scriptVersion: scriptVersionSchema,
  warnings: z.array(warningSchema),
});
export type ScriptSaveResult = z.infer<typeof scriptSaveResultSchema>;

export const scriptValidateRequestSchema = z.union([
  z.strictObject({ content: contentDocumentSchema }),
  z.strictObject({
    baseScriptVersionId: idSchema,
    operations: scriptOperationsSchema,
  }),
]);
export type ScriptValidateRequest = z.infer<typeof scriptValidateRequestSchema>;

export const scriptValidateResultSchema = z.strictObject({
  warnings: z.array(warningSchema),
  timeline: previewTimelineSchema,
});
export type ScriptValidateResult = z.infer<typeof scriptValidateResultSchema>;

/** SRT bytes are derived on demand from a saved Script Version. */
export const agentScriptSubtitlesInputSchema = z.strictObject({
  scriptVersionId: idSchema,
});
export const agentScriptSubtitlesOutputSchema = z.strictObject({
  scriptVersionId: idSchema,
  filename: z.string().min(1),
  mimeType: z.literal("application/x-subrip"),
  byteSize: nonNegativeInt,
  srt: z.string(),
});
export type AgentScriptSubtitlesOutput = z.infer<
  typeof agentScriptSubtitlesOutputSchema
>;

export * from "./thumbnail-schemas";

export const agentSchemaGetInputSchema = agentEmptyInputSchema;
export const agentSchemaGetOutputSchema = agentSchemaGetResultSchema;

export const agentTemplateGetInputSchema = z.strictObject({
  id: idSchema,
  version: positiveInt,
});
export const agentTemplateGetOutputSchema = z.strictObject({
  template: agentTemplateInputContractSchema,
});

export const agentWorkListInputSchema = agentEmptyInputSchema;
export const agentWorkListOutputSchema = z.strictObject({
  works: z.array(workSchema),
});

export const agentWorkGetInputSchema = z.strictObject({ workId: idSchema });
export const agentWorkGetOutputSchema = z.strictObject({ work: workSchema });

export { DEFAULT_AGENT_LOCALE } from "./defaults";
export const agentWorkCreateInputSchema = z.strictObject({
  title: z.string().trim().min(1),
  locale: localeSchema.optional(),
});
export const agentWorkCreateOutputSchema = z.strictObject({ work: workSchema });

export const agentWorkUpdateInputSchema = z.strictObject({
  workId: idSchema,
  title: z.string().trim().min(1),
});
export const agentWorkUpdateOutputSchema = z.strictObject({ work: workSchema });

/**
 * Clones the primary edition's current version into a new child Work. The
 * operation has no `requestId`; a timed-out clone is checked through
 * `work.list` (`parentWorkId` / `createdAt`) before retrying.
 */
export const agentWorkCloneInputSchema = z.strictObject({
  workId: idSchema,
  title: z.string().trim().min(1),
});
export const agentWorkCloneOutputSchema = z.strictObject({ work: workSchema });

export const agentEditionCreateInputSchema = z.strictObject({
  workId: idSchema,
  locale: localeSchema,
  sourceEditionId: idSchema,
});
export const agentEditionCreateOutputSchema = z.strictObject({
  work: workSchema,
});

export const agentScriptGetInputSchema = z
  .strictObject({
    scriptVersionId: idSchema.optional(),
    languageEditionId: idSchema.optional(),
  })
  .refine(
    (value) =>
      (value.scriptVersionId === undefined) !==
      (value.languageEditionId === undefined),
    {
      message:
        "scriptVersionId または languageEditionId のどちらか一方を指定してください。",
      path: ["scriptVersionId"],
    },
  );
export const agentScriptGetOutputSchema = z.strictObject({
  scriptVersion: scriptVersionSchema,
});

/**
 * The Edition's ScriptVersion history, newest first. The current version id is
 * included so a restore can pass it as a base guard without a second read.
 * The full history is returned: an edition's version count is expected to stay
 * small. Add pagination here if long-lived editions make the payload large.
 */
export const agentScriptListVersionsInputSchema = z.strictObject({
  languageEditionId: idSchema,
});
export const agentScriptListVersionsOutputSchema = z.strictObject({
  languageEditionId: idSchema,
  currentScriptVersionId: idSchema,
  scriptVersions: z.array(scriptVersionSummarySchema),
});
export type ScriptListVersionsResult = z.infer<
  typeof agentScriptListVersionsOutputSchema
>;

export const agentScriptValidateInputSchema = scriptValidateRequestSchema;
export const agentScriptValidateOutputSchema = scriptValidateResultSchema;

export const agentScriptSaveInputSchema = scriptSaveRequestSchema;
export const agentScriptSaveOutputSchema = scriptSaveResultSchema;

export const agentScriptEditInputSchema = scriptEditRequestSchema;
export const agentScriptEditOutputSchema = scriptEditResultSchema;

/**
 * Restores an earlier ScriptVersion as a new version. The caller sends the
 * source version id, never a ContentDocument. `requestId` is required and is
 * idempotent on the created version, like `script.edit`.
 */
export const agentScriptRestoreInputSchema = z.strictObject({
  scriptVersionId: idSchema,
  baseScriptVersionId: idSchema.optional(),
  requestId: agentRequestIdSchema,
  authorAgentId: z.string().trim().min(1).optional(),
});
export const agentScriptRestoreOutputSchema = z.strictObject({
  scriptVersion: scriptVersionSchema,
  warnings: z.array(warningSchema),
  replay: z.boolean(),
});
export type ScriptRestoreRequest = z.infer<
  typeof agentScriptRestoreInputSchema
>;
export type ScriptRestoreResult = z.infer<
  typeof agentScriptRestoreOutputSchema
>;

export const agentAssetListInputSchema = assetListInputSchema;
export const agentAssetListOutputSchema = assetListPageSchema;

export const agentAssetGetInputSchema = z.strictObject({ assetId: idSchema });
export const agentAssetGetOutputSchema = z.strictObject({ asset: assetSchema });

/**
 * Optional origin metadata for an imported asset. The source path is never
 * part of provenance.
 */
export const agentAssetProvenanceSchema = z.strictObject({
  model: z.string().min(1).optional(),
  prompt: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export type AgentAssetProvenance = z.infer<typeof agentAssetProvenanceSchema>;

export const agentAssetImportInputSchema = z.strictObject({
  path: z.string().min(1),
  originalFilename: z.string().min(1).optional(),
  provenance: agentAssetProvenanceSchema.optional(),
});
export const agentAssetImportOutputSchema = z.strictObject({
  asset: assetSchema,
  jobId: idSchema.nullable(),
  deduplicated: z.boolean(),
});

export const agentAssetTagInputSchema = z.strictObject({
  assetId: idSchema,
  tags: assetTagsSchema,
});
export const agentAssetTagOutputSchema = z.strictObject({ asset: assetSchema });

/**
 * Reversible organization of one asset: the favorite and archive marks that
 * hide it from the default search. Tags stay on `asset.tag`, so only those two
 * fields are picked from the HTTP patch contract. At least one flag is
 * required.
 */
export const agentAssetUpdateInputSchema = assetMetadataPatchSchema
  .pick({ favorited: true, archived: true })
  .extend({ assetId: idSchema })
  .refine(
    (value) =>
      value.favorited !== undefined || value.archived !== undefined,
    { message: "favorited / archived のいずれかを指定してください。" },
  );
export const agentAssetUpdateOutputSchema = z.strictObject({
  asset: assetSchema,
});

/**
 * `render.start` accepts an optional `requestId`. When it is given, the
 * operation is recorded in the idempotency ledger and a retry with the same
 * id returns the same render Job instead of queueing a second one.
 */
export const agentRenderStartInputSchema = z.strictObject({
  scriptVersionId: idSchema,
  requestId: agentRequestIdSchema.optional(),
});
export const agentRenderStartOutputSchema = z.strictObject({ job: jobSchema });

export const agentJobGetInputSchema = z.strictObject({ jobId: idSchema });
export const agentJobGetOutputSchema = z.strictObject({ job: jobSchema });

/**
 * Artifact bytes stay on disk. `filePath` is an absolute path inside the app
 * data root; `artifact.contentUrl` is the browser-facing URL and needs the
 * media session cookie, so agents should use `filePath`.
 */
export const agentArtifactGetInputSchema = z.strictObject({
  artifactId: idSchema,
});
export const agentArtifactGetOutputSchema = z.strictObject({
  artifact: artifactSchema,
  filePath: z.string().min(1),
});

/**
 * Copies an Artifact into a directory chosen by the caller. The canonical
 * Artifact stays in the app data root. An existing file is never replaced, so
 * the operation only adds a new file outside the app.
 */
export const agentArtifactExportInputSchema = z.strictObject({
  artifactId: idSchema,
  outputDir: z.string().trim().min(1),
  // Loose upper bound only; the authoritative limit is the 255-byte rule
  // enforced by the export service.
  filename: z.string().trim().min(1).max(255).optional(),
});
export const agentArtifactExportOutputSchema = z.strictObject({
  artifact: artifactSchema,
  sourcePath: z.string().min(1),
  exportedPath: z.string().min(1),
});

/**
 * `job.list` reads the Jobs of one Work. `asset_ingest` is not Work-scoped, so
 * it is not selectable; the default keeps the historical render-only listing.
 */
export const agentJobListKindSchema = jobKindSchema.extract(["render", "tts"]);

export const agentJobListInputSchema = z.strictObject({
  workId: idSchema,
  kind: agentJobListKindSchema.default("render"),
});
export const agentJobListOutputSchema = z.strictObject({
  jobs: z.array(jobSchema),
});

export const agentJobCancelInputSchema = z.strictObject({ jobId: idSchema });
export const agentJobCancelOutputSchema = z.strictObject({ job: jobSchema });

/**
 * `preview.frame` returns a still PNG of a render artifact at the requested
 * time. The image is full-resolution base64; bindings choose how to surface
 * the bytes (MCP image block, CLI `--out`). Time resolution reuses the
 * `resolveStillFramePtsMs` rule (last frame at or before the requested ms).
 */
export const agentPreviewFrameInputSchema = z.strictObject({
  artifactId: idSchema,
  timeMs: nonNegativeInt,
});
export const agentPreviewFrameOutputSchema = z.strictObject({
  artifactId: idSchema,
  requestedTimeMs: nonNegativeInt,
  resolvedTimeMs: nonNegativeInt,
  width: positiveInt,
  height: positiveInt,
  mimeType: z.literal("image/png"),
  pngBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentPreviewFrameInput = z.input<
  typeof agentPreviewFrameInputSchema
>;
export type AgentPreviewFrameOutput = z.infer<
  typeof agentPreviewFrameOutputSchema
>;

/**
 * Image media types that can cross the Agent Access boundary. Asset previews
 * return the source image bytes (or the normalized PNG rendition) without
 * re-encoding, so the binding needs the real MIME type.
 */
export const agentPreviewImageMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);

/**
 * `preview.scriptFrame` rasterizes a saved ScriptVersion with the same HTML
 * compiler as the Web UI and render worker, seeking to `timeMs` without
 * creating a render Job, ScriptVersion, or Artifact.
 */
export const agentPreviewScriptFrameInputSchema = z.strictObject({
  scriptVersionId: idSchema,
  timeMs: nonNegativeInt,
});
export const agentPreviewScriptFrameOutputSchema = z.strictObject({
  scriptVersionId: idSchema,
  requestedTimeMs: nonNegativeInt,
  durationMs: nonNegativeInt,
  width: positiveInt,
  height: positiveInt,
  mimeType: z.literal("image/png"),
  imageBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentPreviewScriptFrameInput = z.input<
  typeof agentPreviewScriptFrameInputSchema
>;
export type AgentPreviewScriptFrameOutput = z.infer<
  typeof agentPreviewScriptFrameOutputSchema
>;

/**
 * `preview.assetFrame` returns the visual content of one Asset. Images keep
 * their source MIME type; videos return a PNG still at `timeMs` (default 0).
 * Audio Assets have no visual content and are rejected by the operation.
 */
export const agentPreviewAssetFrameInputSchema = z.strictObject({
  assetId: idSchema,
  timeMs: nonNegativeInt.optional(),
});
export const agentPreviewAssetFrameOutputSchema = z.strictObject({
  assetId: idSchema,
  kind: z.enum(["image", "video"]),
  requestedTimeMs: nonNegativeInt.nullable(),
  resolvedTimeMs: nonNegativeInt.nullable(),
  width: positiveInt,
  height: positiveInt,
  mimeType: agentPreviewImageMimeTypeSchema,
  imageBase64: z.string().min(1).max(AGENT_PREVIEW_IMAGE_BASE64_MAX),
});
export type AgentPreviewAssetFrameInput = z.input<
  typeof agentPreviewAssetFrameInputSchema
>;
export type AgentPreviewAssetFrameOutput = z.infer<
  typeof agentPreviewAssetFrameOutputSchema
>;

export const agentCompositionListInputSchema = agentEmptyInputSchema;
export const agentCompositionListOutputSchema = z.strictObject({
  compositions: z.array(compositionSchema),
});

export const agentCompositionGetInputSchema = z.strictObject({
  compositionId: idSchema,
});
export const agentCompositionGetOutputSchema = z.strictObject({
  composition: compositionSchema,
});

export const agentCompositionDraftGetInputSchema = z.strictObject({
  compositionId: idSchema,
});
export const agentCompositionDraftGetOutputSchema = z.strictObject({
  draft: compositionDraftFilesSchema,
});

/** Same request shape as the HTTP composition authoring context. */
export const agentCompositionAuthoringContextInputSchema =
  compositionAuthoringContextRequestSchema;
export const agentCompositionAuthoringContextOutputSchema = z.strictObject({
  context: compositionAuthoringContextSchema,
});

export const agentCompositionCreateInputSchema = createCompositionRequestSchema;
export const agentCompositionCreateOutputSchema = z.strictObject({
  composition: compositionSchema,
});

export const agentCompositionDraftSaveInputSchema = z.strictObject({
  compositionId: idSchema,
  ...updateCompositionDraftRequestSchema.shape,
});
export const agentCompositionDraftSaveOutputSchema = z.strictObject({
  draft: compositionDraftSchema,
});

/**
 * `composition.publish` accepts an optional `requestId`. A real publish is
 * recorded in the idempotency ledger; a dry run has no side effect and is
 * therefore never recorded.
 */
export const agentCompositionPublishInputSchema = z.strictObject({
  compositionId: idSchema,
  dryRun: z.boolean().optional(),
  requestId: agentRequestIdSchema.optional(),
  ...publishCompositionRequestSchema.shape,
});
/**
 * `dryRun` is the discriminant: a dry run returns the validated manifest
 * without creating a version, a real publish returns the new version.
 */
export const agentCompositionPublishOutputSchema = z.discriminatedUnion(
  "dryRun",
  [
    z.strictObject({
      dryRun: z.literal(true),
      manifest: compositionManifestSchema,
      fontDiagnostics: z.array(z.string()),
    }),
    z.strictObject({
      dryRun: z.literal(false),
      version: compositionVersionSchema,
      fontDiagnostics: z.array(z.string()),
    }),
  ],
);

/**
 * TTS operations (A9). They share the HTTP TTS request/result contracts so the
 * socket, MCP and CLI never own a second generation contract. `tts.create`
 * enqueues one Job for a Narration Segment; `tts.createBulk` enqueues Jobs for
 * the unselected lines of a saved Script Version. A completed Job's
 * `ttsResult` is read through `job.get`, and the Take enters the script only
 * through `script.edit` + `line.assignTake`.
 *
 * Both accept an optional `requestId`. When it is given, the operation is
 * recorded in the idempotency ledger and a retry with the same id returns the
 * same Jobs instead of enqueueing new ones.
 */
export const agentTtsCreateInputSchema = createTtsJobRequestSchema.extend({
  scriptVersionId: idSchema,
  narrationSegmentId: idSchema,
  requestId: agentRequestIdSchema.optional(),
});
export type AgentTtsCreateInput = z.input<typeof agentTtsCreateInputSchema>;

export const agentTtsCreateOutputSchema = z.strictObject({ job: jobSchema });
export type AgentTtsCreateOutput = z.infer<typeof agentTtsCreateOutputSchema>;

export const agentTtsCreateBulkInputSchema = z.strictObject({
  scriptVersionId: idSchema,
  requestId: agentRequestIdSchema.optional(),
});
export type AgentTtsCreateBulkInput = z.input<
  typeof agentTtsCreateBulkInputSchema
>;

export const agentTtsCreateBulkOutputSchema = bulkTtsJobsResultSchema;
export type AgentTtsCreateBulkOutput = z.infer<
  typeof agentTtsCreateBulkOutputSchema
>;

/**
 * `tts.attachBulk` attaches the succeeded Jobs of one `tts.createBulk` run in
 * a single Script Version. It is a short mutation: it never enqueues a Job,
 * so it is not a long-running operation and has no `job.wait` support.
 *
 * - `scriptVersionId` is the bulk run's source version. It must still be the
 *   current version, otherwise the call fails with `SCRIPT_BASE_STALE` and
 *   attaches nothing.
 * - `bulkRequestId` is the `requestId` the original `tts.createBulk` call
 *   carried. Only a bulk run that was recorded in the idempotency ledger (one
 *   sent with a `requestId`, by the same agent) can be finalized. Anything
 *   else is `RESOURCE_NOT_FOUND`.
 * - `requestId` is this attach's own required key. The created Script Version
 *   stores it like `script.edit` does, so resending the same attach returns
 *   the existing version instead of creating a second one.
 */
export const agentTtsAttachBulkInputSchema = z.strictObject({
  scriptVersionId: idSchema,
  bulkRequestId: agentRequestIdSchema,
  requestId: agentRequestIdSchema,
});
export type AgentTtsAttachBulkInput = z.input<
  typeof agentTtsAttachBulkInputSchema
>;

export const agentTtsAttachBulkCountsSchema = z.strictObject({
  queued: nonNegativeInt,
  running: nonNegativeInt,
  succeeded: nonNegativeInt,
  failed: nonNegativeInt,
  cancelled: nonNegativeInt,
});
export type AgentTtsAttachBulkCounts = z.infer<
  typeof agentTtsAttachBulkCountsSchema
>;

export const agentTtsAttachBulkFailureSchema = z.strictObject({
  narrationSegmentId: idSchema,
  jobId: idSchema,
  status: z.enum(["failed", "cancelled"]),
  code: z.string().min(1),
  message: z.string().min(1),
});
export type AgentTtsAttachBulkFailure = z.infer<
  typeof agentTtsAttachBulkFailureSchema
>;

/**
 * `status` is `pending` while any Job of the bulk run is still queued or
 * running; the script is left untouched and the agent resends the same attach
 * later. `scriptVersion` is null while pending, and also when the run
 * finalized with nothing to attach: no succeeded Job at all, or none passed
 * verification (missing line, changed speech text, unavailable asset) while
 * no prior attach exists for `requestId`.
 *
 * `counts.succeeded` counts only Jobs that actually became Takes —
 * verification can demote a succeeded Job into `failures`. `queued` and
 * `running` are non-zero only while pending.
 */
export const agentTtsAttachBulkOutputSchema = z.strictObject({
  status: z.enum(["pending", "finalized"]),
  counts: agentTtsAttachBulkCountsSchema,
  excluded: z.array(bulkTtsJobExclusionSchema),
  failures: z.array(agentTtsAttachBulkFailureSchema),
  scriptVersion: scriptVersionSchema.nullable(),
});
export type AgentTtsAttachBulkOutput = z.infer<
  typeof agentTtsAttachBulkOutputSchema
>;

export const agentCharacterListInputSchema = agentEmptyInputSchema;
export const agentCharacterListOutputSchema = z.strictObject({
  characters: z.array(characterLibraryEntrySchema),
});

export const agentCharacterGetInputSchema = z.strictObject({
  characterId: idSchema,
});
export const agentCharacterGetOutputSchema = z.strictObject({
  character: characterLibraryEntrySchema,
});

export const agentCharacterSetVoicesInputSchema = z.strictObject({
  characterId: idSchema,
  voices: characterVoicesSchema,
});
export const agentCharacterSetVoicesOutputSchema = z.strictObject({
  character: characterLibraryEntrySchema,
});

/**
 * A library appearance on the Agent surface. The appearance id is a library
 * internal key that neither scripts nor Face Sets reference, so the server
 * assigns it instead of asking the caller to invent a globally unique id.
 */
export const agentCharacterCreateAppearanceInputSchema = z.strictObject({
  assetId: idSchema,
  expression: z.string(),
  pose: z.string(),
  label: z.string().trim().min(1).optional(),
  faceSetId: idSchema.nullable().default(null),
});

export const agentCharacterUpdateAppearanceInputSchema = z.strictObject({
  /** Omit only for a new appearance; existing IDs keep work links stable. */
  id: idSchema.optional(),
  assetId: idSchema,
  expression: z.string(),
  pose: z.string(),
  label: z.string().trim().min(1).optional(),
  faceSetId: idSchema.nullable().default(null),
});

export const agentCharacterCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1),
  names: characterNamesSchema.default([]),
  voices: characterVoicesSchema.default([]),
  appearances: z.array(agentCharacterCreateAppearanceInputSchema).max(50).default([]),
});
export const agentCharacterCreateOutputSchema = z.strictObject({
  character: characterLibraryEntrySchema,
});

/**
 * A partial update: an omitted member is left unchanged, and a provided list
 * replaces that whole list. Callers read `character.get` first and send only
 * the members they change, so an edit of one field cannot clear another.
 */
export const agentCharacterUpdateInputSchema = z.strictObject({
  characterId: idSchema,
  name: z.string().trim().min(1).optional(),
  names: characterNamesSchema.optional(),
  voices: characterVoicesSchema.optional(),
  appearances: z.array(agentCharacterUpdateAppearanceInputSchema).max(50).optional(),
});
export const agentCharacterUpdateOutputSchema = z.strictObject({
  character: characterLibraryEntrySchema,
});

export type AgentCharacterAppearanceInput = z.infer<
  typeof agentCharacterCreateAppearanceInputSchema
>;
export type AgentCharacterUpdateAppearanceInput = z.infer<
  typeof agentCharacterUpdateAppearanceInputSchema
>;
export type AgentCharacterCreateInput = z.infer<
  typeof agentCharacterCreateInputSchema
>;
export type AgentCharacterUpdateInput = z.infer<
  typeof agentCharacterUpdateInputSchema
>;

export const agentFaceSetListInputSchema = agentEmptyInputSchema;
export const agentFaceSetListOutputSchema = z.strictObject({
  faceSets: z.array(faceSetSchema),
});

export const agentFaceSetGetInputSchema = z.strictObject({
  faceSetId: idSchema,
  /** Omit to read the latest revision. Works pin a specific version. */
  version: positiveInt.optional(),
});
export const agentFaceSetGetOutputSchema = z.strictObject({
  faceSet: faceSetSchema,
});

export const agentVoiceProfileListInputSchema = agentEmptyInputSchema;
export const agentVoiceProfileListOutputSchema = z.strictObject({
  voiceProfiles: z.array(voiceProfileSchema),
});

export const agentVoiceProfileGetInputSchema = z.strictObject({
  voiceProfileId: idSchema,
});
export const agentVoiceProfileGetOutputSchema = z.strictObject({
  voiceProfile: voiceProfileSchema,
});

export const agentVoiceProfileListVoicesInputSchema = z.strictObject({
  adapterId: voiceAdapterIdSchema,
  model: z.string().trim().min(1).max(200).optional(),
});
export const agentVoiceProfileListVoicesOutputSchema = voiceListSchema;

export const agentVoiceProfileListModelsInputSchema = z.strictObject({
  adapterId: voiceAdapterIdSchema,
});
export const agentVoiceProfileListModelsOutputSchema = modelListSchema;

export const agentVoiceProfileCreateInputSchema =
  createVoiceProfileRequestSchema;
export const agentVoiceProfileCreateOutputSchema = z.strictObject({
  voiceProfile: voiceProfileSchema,
});

export const agentVoiceProfileUpdateInputSchema = z.strictObject({
  voiceProfileId: idSchema,
  name: updateVoiceProfileRequestSchema.shape.name,
  voiceId: voiceIdSchema,
  locale: localeSchema,
  settings: voiceProfileExtrasSchema,
});
export const agentVoiceProfileUpdateOutputSchema = z.strictObject({
  voiceProfile: voiceProfileSchema,
});

export * from "./theme-schemas";
