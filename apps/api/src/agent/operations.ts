import { z } from "zod";
import {
  AGENT_ERROR_CODES,
  DEFAULT_AGENT_LOCALE,
  agentArtifactExportInputSchema,
  agentArtifactExportOutputSchema,
  agentArtifactGetInputSchema,
  agentArtifactGetOutputSchema,
  agentAssetGetInputSchema,
  agentAssetGetOutputSchema,
  agentAssetImportInputSchema,
  agentAssetImportOutputSchema,
  agentAssetListInputSchema,
  agentAssetListOutputSchema,
  agentAssetUpdateInputSchema,
  agentAssetUpdateOutputSchema,
  agentCompositionAuthoringContextInputSchema,
  agentCompositionAuthoringContextOutputSchema,
  agentCompositionCreateInputSchema,
  agentCompositionCreateOutputSchema,
  agentCompositionDraftGetInputSchema,
  agentCompositionDraftGetOutputSchema,
  agentCompositionDraftUpdateInputSchema,
  agentCompositionDraftUpdateOutputSchema,
  agentCompositionGetInputSchema,
  agentCompositionGetOutputSchema,
  agentCompositionListInputSchema,
  agentCompositionListOutputSchema,
  agentCompositionPublishInputSchema,
  agentCompositionPublishOutputSchema,
  agentEditionCreateInputSchema,
  agentEditionCreateOutputSchema,
  agentJobCancelInputSchema,
  agentJobCancelOutputSchema,
  agentJobGetInputSchema,
  agentJobGetOutputSchema,
  agentJobListInputSchema,
  agentJobListOutputSchema,
  agentRenderStartInputSchema,
  agentRenderStartOutputSchema,
  agentSchemaGetInputSchema,
  agentSchemaGetOutputSchema,
  agentScriptEditInputSchema,
  agentScriptEditOutputSchema,
  agentScriptGetInputSchema,
  agentScriptGetOutputSchema,
  agentScriptListVersionsInputSchema,
  agentScriptListVersionsOutputSchema,
  agentScriptRestoreInputSchema,
  agentScriptRestoreOutputSchema,
  agentScriptSaveInputSchema,
  agentScriptSaveOutputSchema,
  agentScriptSubtitlesInputSchema,
  agentScriptSubtitlesOutputSchema,
  agentScriptValidateInputSchema,
  agentScriptValidateOutputSchema,
  agentTemplateGetInputSchema,
  agentTemplateGetOutputSchema,
  agentTtsAttachBulkInputSchema,
  agentTtsAttachBulkOutputSchema,
  agentTtsCreateBulkInputSchema,
  agentTtsCreateBulkOutputSchema,
  agentTtsCreateInputSchema,
  agentTtsCreateOutputSchema,
  agentWorkCreateInputSchema,
  agentWorkCreateOutputSchema,
  agentWorkCloneInputSchema,
  agentWorkCloneOutputSchema,
  agentWorkGetInputSchema,
  agentWorkGetOutputSchema,
  agentWorkListInputSchema,
  agentWorkListOutputSchema,
  agentWorkUpdateInputSchema,
  agentWorkUpdateOutputSchema,
  buildAgentSchemaGetResult,
  buildAgentTemplateInputContract,
  isAgentMutationOperation,
  isAgentOperationName,
  type AgentErrorCode,
  type AgentErrorIssue,
  type AgentOperationInputMap,
  type AgentOperationName,
  type AgentOperationOutputMap,
  type AgentOperationParsedInputMap,
  type Job,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { logger } from "../logger.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { exportArtifact } from "../services/artifact-export.ts";
import { getArtifact, resolveArtifactContent } from "../services/artifacts.ts";
import { getAsset, searchAssets, updateAsset } from "../services/assets.ts";
import { getScriptVersionSubtitles } from "../services/script-versions.ts";
import {
  editAgentScript,
  getAgentScript,
  listAgentScriptVersions,
  restoreAgentScript,
  saveAgentScript,
  validateAgentScript,
} from "../services/agent-script.ts";
import { importAgentAsset } from "../services/agent-assets.ts";
import type { CompositionAuthoringService } from "../services/authoring-context.ts";
import type { CompositionService } from "../services/compositions.ts";
import {
  diagnoseCompositionFonts,
  publishOrValidateComposition,
} from "../services/composition-publishing.ts";
import type { FontCatalogService } from "../services/font-catalog.ts";
import { cancelJob, getJob, listWorkJobs } from "../services/jobs.ts";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import type { Rasterizer } from "../media/rasterize.ts";
import { createRenderJob } from "../services/render-jobs.ts";
import type { ThemeService } from "../services/themes.ts";
import { createBulkTtsJobs, createTtsJob } from "../services/tts-jobs.ts";
import { attachBulkTts, bulkTtsResultRefOf } from "../services/tts-attach-bulk.ts";
import {
  invalidResultReference,
  parseResultReference,
} from "../services/agent-result-references.ts";
import { createWork, createLanguageEdition, getWork, listWorks, updateWork, cloneWork } from "../services/works.ts";
import { AgentOperationError, agentIssue, asWorkResource } from "./errors.ts";
import { runWithAgentRequest } from "./idempotency.ts";
import { imageOperationDefinitions } from "./image-operations.ts";
import { libraryOperationDefinitions } from "./library-operations.ts";
import { thumbnailOperationDefinitions } from "./thumbnail-operations.ts";

export type AgentOperationKind = "read" | "mutation";

export interface AgentOperationContext {
  prisma: PrismaClient;
  config: AppConfig;
  directories: DataDirectories;
  fontCatalogService: FontCatalogService;
  compositions: CompositionService;
  compositionAuthoring: CompositionAuthoringService;
  /** Headless rasterizer used by the pre-render preview operations. */
  previewRasterizer: PreviewRasterizer;
  /** Headless screenshot rasterizer used by the thumbnail PNG operations. */
  rasterizer: Rasterizer;
  /** Theme lifecycle (create, draft save, publish) shared with the HTTP API. */
  themes: ThemeService;
  /** `agentId` from the connection handshake, if the client sent one. */
  agentId?: string;
}

/**
 * The idempotency ledger of one high-cost operation. The ledger stores a
 * result reference (resource ids), never a response snapshot, so a replay
 * rebuilds the answer from the current resource state.
 */
export interface AgentOperationIdempotency<Input, Output> {
  /** Whether this input is recorded at all (a dry run has no side effect). */
  applies: (input: Input) => boolean;
  /**
   * The input the request hash is computed over. It defaults to the parsed
   * input; an operation may drop members that do not change what it does, so
   * two equivalent calls hash identically.
   */
  hashInput?: (input: Input) => unknown;
  /** The reference stored when the run succeeded. */
  resultRef: (output: Output) => string;
  /** Rebuilds the response from the stored reference. */
  replay: (resultRef: string, context: AgentOperationContext) => Promise<Output>;
}

export interface AgentOperationDefinition<RawInput, Input, Output> {
  input: z.ZodType<Input, RawInput>;
  output: z.ZodType<Output>;
  invalidInputCode?: AgentErrorCode;
  run: (input: Input, context: AgentOperationContext) => Promise<Output>;
  /** Present for the operations that accept an optional `requestId`. */
  idempotency?: AgentOperationIdempotency<Input, Output>;
}

interface UnknownOperationDefinition {
  input: z.ZodType<unknown>;
  output: z.ZodType<unknown>;
  invalidInputCode?: AgentErrorCode;
  run: (input: unknown, context: AgentOperationContext) => Promise<unknown>;
  idempotency?: AgentOperationIdempotency<unknown, unknown>;
}

type AgentOperationDefinitions = {
  [K in AgentOperationName]: AgentOperationDefinition<
    AgentOperationInputMap[K],
    AgentOperationParsedInputMap[K],
    AgentOperationOutputMap[K]
  >;
};

/**
 * A partial set of definitions that a domain module contributes to the single
 * dispatcher. Keeping the domains in separate files stops the dispatcher from
 * growing every time a domain is added.
 */
export type AgentOperationFragment = Partial<AgentOperationDefinitions>;

const definitions: AgentOperationDefinitions = {
  "schema.get": {
    input: agentSchemaGetInputSchema,
    output: agentSchemaGetOutputSchema,
    run: async () => buildAgentSchemaGetResult(),
  },
  // Template input contracts are read from the immutable registry, so this is
  // a pure lookup. The Zod `inputSchema` stays the only validation source.
  "template.get": {
    input: agentTemplateGetInputSchema,
    output: agentTemplateGetOutputSchema,
    run: async (input) => {
      const template = buildAgentTemplateInputContract(input.id, input.version);
      if (template === undefined) {
        throw new AgentOperationError("RESOURCE_NOT_FOUND", [
          agentIssue(
            ["id", "version"],
            "not_found",
            `未対応のVisualTemplateです: ${input.id}@${input.version}。schema.getのtemplatesからidとversionを選び直してください。`,
          ),
        ]);
      }
      return { template };
    },
  },
  "work.list": {
    input: agentWorkListInputSchema,
    output: agentWorkListOutputSchema,
    run: async (_input, context) => ({ works: await listWorks(context.prisma) }),
  },
  "work.get": {
    input: agentWorkGetInputSchema,
    output: agentWorkGetOutputSchema,
    run: async (input, context) => ({
      work: await asWorkResource(getWork(context.prisma, input.workId)),
    }),
  },
  "work.create": {
    input: agentWorkCreateInputSchema,
    output: agentWorkCreateOutputSchema,
    run: async (input, context) => ({
      work: await createWork(context.prisma, input.title, input.locale ?? DEFAULT_AGENT_LOCALE),
    }),
  },
  "work.update": {
    input: agentWorkUpdateInputSchema,
    output: agentWorkUpdateOutputSchema,
    run: async (input, context) => ({
      work: await updateWork(context.prisma, input.workId, input.title),
    }),
  },
  "work.clone": {
    input: agentWorkCloneInputSchema,
    output: agentWorkCloneOutputSchema,
    // Work creation is not recorded in the idempotency ledger. A timed-out
    // clone is checked through work.list (parentWorkId / createdAt) before it
    // is retried, so the agent never blindly creates a second child.
    run: async (input, context) => ({
      work: await asWorkResource(
        cloneWork(context.prisma, input.workId, input.title, input.sourceEditionId, {
          author: "agent",
          authorAgentId: context.agentId,
        }),
      ),
    }),
  },
  "edition.create": {
    input: agentEditionCreateInputSchema,
    output: agentEditionCreateOutputSchema,
    run: async (input, context) => ({
      work: await asWorkResource(
        createLanguageEdition(context.prisma, input.workId, input.locale, input.sourceEditionId),
      ),
    }),
  },
  "script.get": {
    input: agentScriptGetInputSchema,
    output: agentScriptGetOutputSchema,
    run: async (input, context) => ({
      scriptVersion: await asWorkResource(getAgentScript(context.prisma, input)),
    }),
  },
  "script.listVersions": {
    input: agentScriptListVersionsInputSchema,
    output: agentScriptListVersionsOutputSchema,
    run: async (input, context) =>
      asWorkResource(listAgentScriptVersions(context.prisma, input.languageEditionId)),
  },
  "script.validate": {
    input: agentScriptValidateInputSchema,
    output: agentScriptValidateOutputSchema,
    invalidInputCode: AGENT_ERROR_CODES.INVALID_INPUT,
    run: async (input, context) => validateAgentScript(context.prisma, input),
  },
  // SRT is derived on demand from the saved version; no Artifact or Job.
  "script.subtitles": {
    input: agentScriptSubtitlesInputSchema,
    output: agentScriptSubtitlesOutputSchema,
    run: async (input, context) => {
      const result = await getScriptVersionSubtitles(
        context.prisma,
        input.scriptVersionId,
      );
      return {
        scriptVersionId: input.scriptVersionId,
        filename: result.filename,
        mimeType: "application/x-subrip" as const,
        byteSize: Buffer.byteLength(result.srt, "utf8"),
        srt: result.srt,
      };
    },
  },
  "script.save": {
    input: agentScriptSaveInputSchema,
    output: agentScriptSaveOutputSchema,
    run: async (input, context) =>
      saveAgentScript(context.prisma, input, context.agentId),
  },
  "script.edit": {
    input: agentScriptEditInputSchema,
    output: agentScriptEditOutputSchema,
    invalidInputCode: AGENT_ERROR_CODES.INVALID_INPUT,
    run: async (input, context) =>
      editAgentScript(context.prisma, input, context.agentId),
  },
  "script.restore": {
    input: agentScriptRestoreInputSchema,
    output: agentScriptRestoreOutputSchema,
    // Version-level idempotency on ScriptVersion.agentRequestId, like
    // script.edit; the Job idempotency ledger does not apply.
    run: async (input, context) =>
      restoreAgentScript(context.prisma, input, context.agentId),
  },
  "asset.list": {
    input: agentAssetListInputSchema,
    output: agentAssetListOutputSchema,
    run: async (input, context) => searchAssets(context.prisma, input),
  },
  "asset.get": {
    input: agentAssetGetInputSchema,
    output: agentAssetGetOutputSchema,
    run: async (input, context) => ({
      asset: await getAsset(context.prisma, input.assetId),
    }),
  },
  "asset.import": {
    input: agentAssetImportInputSchema,
    output: agentAssetImportOutputSchema,
    run: async (input, context) =>
      importAgentAsset(context.prisma, context.directories, context.config.limits, input),
  },
  "asset.update": {
    input: agentAssetUpdateInputSchema,
    output: agentAssetUpdateOutputSchema,
    run: async (input, context) => ({
      asset: await updateAsset(context.prisma, input.assetId, {
        tags: input.tags,
        favorited: input.favorited,
        archived: input.archived,
      }),
    }),
  },
  "render.start": {
    input: agentRenderStartInputSchema,
    output: agentRenderStartOutputSchema,
    idempotency: jobResultIdempotency("render.start"),
    run: async (input, context) => ({
      job: await asWorkResource(
        createRenderJob(
          context.prisma,
          input.scriptVersionId,
          context.fontCatalogService,
        ),
      ),
    }),
  },
  "job.get": {
    input: agentJobGetInputSchema,
    output: agentJobGetOutputSchema,
    run: async (input, context) => ({
      job: await getJob(context.prisma, input.jobId),
    }),
  },
  "job.list": {
    input: agentJobListInputSchema,
    output: agentJobListOutputSchema,
    run: async (input, context) => ({
      jobs: await listWorkJobs(context.prisma, input.workId, input.kind),
    }),
  },
  "job.cancel": {
    input: agentJobCancelInputSchema,
    output: agentJobCancelOutputSchema,
    run: async (input, context) => ({
      job: await cancelJob(context.prisma, input.jobId),
    }),
  },
  // The file stays on disk; the absolute path is the agent-facing handle.
  "artifact.get": {
    input: agentArtifactGetInputSchema,
    output: agentArtifactGetOutputSchema,
    run: async (input, context) => {
      const [artifact, location] = await Promise.all([
        getArtifact(context.prisma, input.artifactId),
        resolveArtifactContent(
          context.prisma,
          context.directories,
          input.artifactId,
        ),
      ]);
      return { artifact, filePath: location.path };
    },
  },
  // Export is a separate step so a copy failure never changes a succeeded
  // render Job into a failed one.
  "artifact.export": {
    input: agentArtifactExportInputSchema,
    output: agentArtifactExportOutputSchema,
    run: async (input, context) =>
      exportArtifact(context.prisma, context.directories, input),
  },
  ...imageOperationDefinitions,
  ...thumbnailOperationDefinitions,
  "composition.list": {
    input: agentCompositionListInputSchema,
    output: agentCompositionListOutputSchema,
    run: async (_input, context) => ({
      compositions: await context.compositions.listCompositions(),
    }),
  },
  "composition.get": {
    input: agentCompositionGetInputSchema,
    output: agentCompositionGetOutputSchema,
    run: async (input, context) => ({
      composition: await context.compositions.getCompositionById(input.compositionId),
    }),
  },
  "composition.draft.get": {
    input: agentCompositionDraftGetInputSchema,
    output: agentCompositionDraftGetOutputSchema,
    run: async (input, context) => ({
      draft: await context.compositions.getDraftFiles(input.compositionId),
    }),
  },
  "composition.authoringContext": {
    input: agentCompositionAuthoringContextInputSchema,
    output: agentCompositionAuthoringContextOutputSchema,
    run: async (input, context) => ({
      context: (await context.compositionAuthoring.resolve(input)).context,
    }),
  },
  "composition.create": {
    input: agentCompositionCreateInputSchema,
    output: agentCompositionCreateOutputSchema,
    run: async (input, context) => {
      const { authoringStyle, ...compositionInput } = input;
      const authoringSeed =
        authoringStyle === undefined
          ? undefined
          : await context.compositionAuthoring.resolveSeed({
              visualTheme: authoringStyle.visualTheme,
              canvasProfile: compositionInput.canvasProfile,
            });
      return {
        composition: await context.compositions.createComposition({
          ...compositionInput,
          authoringStyle: authoringSeed,
        }),
      };
    },
  },
  "composition.draft.update": {
    input: agentCompositionDraftUpdateInputSchema,
    output: agentCompositionDraftUpdateOutputSchema,
    run: async (input, context) => {
      const { compositionId, ...draftInput } = input;
      return {
        draft: await context.compositions.updateDraft(compositionId, draftInput),
      };
    },
  },
  "composition.publish": {
    input: agentCompositionPublishInputSchema,
    output: agentCompositionPublishOutputSchema,
    idempotency: {
      // A dry run creates no version and has no side effect, so it is never
      // recorded in the ledger.
      applies: (input) => input.dryRun !== true,
      // A dry run is never recorded, so `dryRun` is not part of the hash.
      // `dryRun: false` and an omitted `dryRun` publish the same version, so
      // both hash identically. The rest of the input is taken as it is, so a
      // new publish field is never silently dropped.
      hashInput: (input) => {
        const { requestId: _requestId, dryRun: _dryRun, ...published } = input;
        return published;
      },
      resultRef: (output) => {
        if (output.dryRun) {
          // Unreachable: `applies` keeps dry runs out of the ledger. The
          // branch only narrows the type of the recorded outcome.
          throw new AgentOperationError("INTERNAL_ERROR");
        }
        return JSON.stringify({ compositionVersionId: output.version.id });
      },
      replay: async (resultRef, context) => {
        const version = await context.compositions.getVersionById(
          compositionVersionIdOf("composition.publish", resultRef),
        );
        return {
          dryRun: false,
          version,
          fontDiagnostics: await diagnoseCompositionFonts(
            context.compositions,
            context.compositionAuthoring,
            version.compositionId,
          ),
        };
      },
    },
    run: async (input, context) => {
      const { requestId: _requestId, compositionId, dryRun, ...publishInput } = input;
      return publishOrValidateComposition(
        context.compositions,
        context.compositionAuthoring,
        compositionId,
        publishInput,
        { dryRun: dryRun ?? false },
      );
    },
  },
  "tts.create": {
    input: agentTtsCreateInputSchema,
    output: agentTtsCreateOutputSchema,
    idempotency: jobResultIdempotency("tts.create"),
    // Adapter resolution, the Job snapshot and the TTS error codes stay in the
    // shared TTS service that the HTTP route also calls.
    run: async (input, context) => ({
      job: await createTtsJob(
        context.prisma,
        context.config,
        input.scriptVersionId,
        input.narrationSegmentId,
        {
          voiceId: input.voiceId,
          speechText: input.speechText,
          speedScale: input.speedScale,
        },
      ),
    }),
  },
  "tts.createBulk": {
    input: agentTtsCreateBulkInputSchema,
    output: agentTtsCreateBulkOutputSchema,
    idempotency: {
      applies: () => true,
      resultRef: (output) =>
        JSON.stringify({
          entries: output.jobs.map((entry) => ({
            narrationSegmentId: entry.narrationSegmentId,
            jobId: entry.job.id,
          })),
          excluded: output.excluded,
        }),
      replay: async (resultRef, context) => {
        const reference = bulkTtsResultRefOf("tts.createBulk", resultRef);
        const jobs = await Promise.all(
          reference.entries.map(async (entry) => ({
            narrationSegmentId: entry.narrationSegmentId,
            job: await getJob(context.prisma, entry.jobId),
          })),
        );
        return { jobs, excluded: reference.excluded };
      },
    },
    run: async (input, context) =>
      createBulkTtsJobs(context.prisma, context.config, input.scriptVersionId),
  },
  "tts.attachBulk": {
    input: agentTtsAttachBulkInputSchema,
    output: agentTtsAttachBulkOutputSchema,
    // Not routed through the Job idempotency ledger: the attach creates a
    // Script Version, so its `requestId` is idempotent on the version itself
    // (like `script.edit`). Resending the same attach returns the existing
    // version instead of creating a second one.
    run: async (input, context) => attachBulkTts(context.prisma, input, context.agentId),
  },
  ...libraryOperationDefinitions,
};

function unknownOperation(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.OPERATION_UNKNOWN);
}

/** The stored reference of a Job returning operation. */
const jobResultReferenceSchema = z.strictObject({ jobId: z.string().min(1) });

/** The stored reference of a composition publish. */
const compositionVersionResultReferenceSchema = z.strictObject({
  compositionVersionId: z.string().min(1),
});

function jobIdOf(operation: string, resultRef: string): string {
  const parsed = jobResultReferenceSchema.safeParse(
    parseResultReference(operation, resultRef),
  );
  if (!parsed.success) {
    throw invalidResultReference(operation);
  }
  return parsed.data.jobId;
}

function compositionVersionIdOf(operation: string, resultRef: string): string {
  const parsed = compositionVersionResultReferenceSchema.safeParse(
    parseResultReference(operation, resultRef),
  );
  if (!parsed.success) {
    throw invalidResultReference(operation);
  }
  return parsed.data.compositionVersionId;
}

/**
 * The ledger rule of a Job returning operation: the stored reference is the
 * Job id, and a replay rebuilds the Job from its current state.
 */
function jobResultIdempotency(
  operation: string,
): AgentOperationIdempotency<unknown, { job: Job }> {
  return {
    applies: () => true,
    resultRef: (output) => JSON.stringify({ jobId: output.job.id }),
    replay: async (resultRef, context) => ({
      job: await getJob(context.prisma, jobIdOf(operation, resultRef)),
    }),
  };
}

/** The optional `requestId` of an operation input, if the caller sent one. */
function requestIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const value = (input as { requestId?: unknown }).requestId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toAgentIssues(error: z.ZodError): AgentErrorIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    ),
    code: issue.code,
    message: issue.message,
  }));
}

export function agentOperationKind(operation: string): AgentOperationKind | undefined {
  if (!isAgentOperationName(operation)) {
    return undefined;
  }
  // The contracts catalog is the single classification used by clients too.
  return isAgentMutationOperation(operation) ? "mutation" : "read";
}

/**
 * Runs one operation. The high-cost operations take an optional `requestId`;
 * when it is given, the run goes through the idempotency ledger, so a retry
 * replays the stored reference instead of creating a second Job or Version.
 */
async function runOperation(
  operation: AgentOperationName,
  definition: UnknownOperationDefinition,
  input: unknown,
  context: AgentOperationContext,
): Promise<unknown> {
  const spec = definition.idempotency;
  if (spec === undefined) {
    return definition.run(input, context);
  }
  const requestId = requestIdOf(input);
  if (requestId === undefined || !spec.applies(input)) {
    return definition.run(input, context);
  }
  return runWithAgentRequest({
    prisma: context.prisma,
    operation,
    agentId: context.agentId,
    requestId,
    input: spec.hashInput === undefined ? input : spec.hashInput(input),
    idempotent: {
      run: () => definition.run(input, context),
      resultRef: (output: unknown) => spec.resultRef(output),
      replay: (resultRef: string) => spec.replay(resultRef, context),
    },
  });
}

/**
 * Single dispatch point for every binding. Inputs and outputs are validated
 * here; the operation bodies only call existing services.
 */
export async function dispatchAgentOperation(
  operation: string,
  input: unknown,
  context: AgentOperationContext,
): Promise<unknown> {
  if (!isAgentOperationName(operation)) {
    throw unknownOperation();
  }
  const definition = definitions[operation] as unknown as UnknownOperationDefinition;
  const parsedInput = definition.input.safeParse(input);
  if (!parsedInput.success) {
    throw new AgentOperationError(
      definition.invalidInputCode ?? AGENT_ERROR_CODES.VALIDATION_ERROR,
      toAgentIssues(parsedInput.error),
    );
  }
  const result = await runOperation(operation, definition, parsedInput.data, context);
  const parsedOutput = definition.output.safeParse(result);
  if (!parsedOutput.success) {
    logger.error("agent_output_invalid", {
      operation,
      issues: toAgentIssues(parsedOutput.error),
    });
    throw new AgentOperationError("INTERNAL_ERROR");
  }
  return parsedOutput.data;
}
