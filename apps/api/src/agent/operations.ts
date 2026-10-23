import { z } from "zod";
import {
  AGENT_ERROR_CODES,
  DEFAULT_AGENT_LOCALE,
  agentAssetGetInputSchema,
  agentAssetGetOutputSchema,
  agentAssetImportInputSchema,
  agentAssetImportOutputSchema,
  agentAssetListInputSchema,
  agentAssetListOutputSchema,
  agentAssetTagInputSchema,
  agentAssetTagOutputSchema,
  agentCharacterGetInputSchema,
  agentCharacterGetOutputSchema,
  agentCharacterListInputSchema,
  agentCharacterListOutputSchema,
  agentCompositionAuthoringContextInputSchema,
  agentCompositionAuthoringContextOutputSchema,
  agentCompositionCreateInputSchema,
  agentCompositionCreateOutputSchema,
  agentCompositionDraftGetInputSchema,
  agentCompositionDraftGetOutputSchema,
  agentCompositionDraftSaveInputSchema,
  agentCompositionDraftSaveOutputSchema,
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
  agentPreviewFrameInputSchema,
  agentPreviewFrameOutputSchema,
  agentRenderStartInputSchema,
  agentRenderStartOutputSchema,
  agentSchemaGetInputSchema,
  agentSchemaGetOutputSchema,
  agentScriptEditInputSchema,
  agentScriptEditOutputSchema,
  agentScriptGetInputSchema,
  agentScriptGetOutputSchema,
  agentScriptSaveInputSchema,
  agentScriptSaveOutputSchema,
  agentScriptValidateInputSchema,
  agentScriptValidateOutputSchema,
  agentTtsCreateBulkInputSchema,
  agentTtsCreateBulkOutputSchema,
  agentTtsCreateInputSchema,
  agentTtsCreateOutputSchema,
  agentWorkCreateInputSchema,
  agentWorkCreateOutputSchema,
  agentWorkGetInputSchema,
  agentWorkGetOutputSchema,
  agentWorkListInputSchema,
  agentWorkListOutputSchema,
  agentWorkUpdateInputSchema,
  agentWorkUpdateOutputSchema,
  buildAgentSchemaGetResult,
  bulkTtsJobExclusionSchema,
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
import { getAsset, searchAssets, updateAsset } from "../services/assets.ts";
import {
  editAgentScript,
  getAgentScript,
  saveAgentScript,
  validateAgentScript,
} from "../services/agent-script.ts";
import { importAgentAsset } from "../services/agent-assets.ts";
import type { CompositionAuthoringService } from "../services/authoring-context.ts";
import { getCharacter, listCharacters } from "../services/character-library.ts";
import type { CompositionService } from "../services/compositions.ts";
import {
  diagnoseCompositionFonts,
  publishOrValidateComposition,
} from "../services/composition-publishing.ts";
import type { FontCatalogService } from "../services/font-catalog.ts";
import { cancelJob, getJob, listWorkJobs } from "../services/jobs.ts";
import { getPreviewFrame } from "../services/preview-frames.ts";
import { createRenderJob } from "../services/render-jobs.ts";
import { createBulkTtsJobs, createTtsJob } from "../services/tts-jobs.ts";
import { createWork, createLanguageEdition, getWork, listWorks, updateWork } from "../services/works.ts";
import { AgentOperationError } from "./errors.ts";
import { runWithAgentRequest } from "./idempotency.ts";

export type AgentOperationKind = "read" | "mutation";

export interface AgentOperationContext {
  prisma: PrismaClient;
  config: AppConfig;
  directories: DataDirectories;
  fontCatalogService: FontCatalogService;
  compositions: CompositionService;
  compositionAuthoring: CompositionAuthoringService;
  /** `agentId` from the connection handshake, if the client sent one. */
  agentId?: string;
}

/**
 * The idempotency ledger of one high-cost operation. The ledger stores a
 * result reference (resource ids), never a response snapshot, so a replay
 * rebuilds the answer from the current resource state.
 */
interface AgentOperationIdempotency<Input, Output> {
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

interface AgentOperationDefinition<RawInput, Input, Output> {
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

const definitions: AgentOperationDefinitions = {
  "schema.get": {
    input: agentSchemaGetInputSchema,
    output: agentSchemaGetOutputSchema,
    run: async () => buildAgentSchemaGetResult(),
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
  "script.validate": {
    input: agentScriptValidateInputSchema,
    output: agentScriptValidateOutputSchema,
    invalidInputCode: AGENT_ERROR_CODES.INVALID_INPUT,
    run: async (input, context) => validateAgentScript(context.prisma, input),
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
  "asset.tag": {
    input: agentAssetTagInputSchema,
    output: agentAssetTagOutputSchema,
    run: async (input, context) => ({
      asset: await updateAsset(context.prisma, input.assetId, { tags: input.tags }),
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
      jobs: await listWorkJobs(context.prisma, input.workId),
    }),
  },
  "job.cancel": {
    input: agentJobCancelInputSchema,
    output: agentJobCancelOutputSchema,
    run: async (input, context) => ({
      job: await cancelJob(context.prisma, input.jobId),
    }),
  },
  "preview.frame": {
    input: agentPreviewFrameInputSchema,
    output: agentPreviewFrameOutputSchema,
    run: async (input, context) =>
      getPreviewFrame(context.prisma, context.directories, input),
  },
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
  "composition.draft.save": {
    input: agentCompositionDraftSaveInputSchema,
    output: agentCompositionDraftSaveOutputSchema,
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
  // Character library reads only. Copying into a script goes through
  // `script.edit` + `character.addFromLibrary`; library mutations are not
  // exposed on the Agent surface.
  "character.list": {
    input: agentCharacterListInputSchema,
    output: agentCharacterListOutputSchema,
    run: async (_input, context) => ({
      characters: await listCharacters(context.prisma),
    }),
  },
  "character.get": {
    input: agentCharacterGetInputSchema,
    output: agentCharacterGetOutputSchema,
    run: async (input, context) => ({
      character: await getCharacter(context.prisma, input.characterId),
    }),
  },
};

function unknownOperation(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.OPERATION_UNKNOWN);
}

/** The stored reference of a Job returning operation. */
const jobResultReferenceSchema = z.strictObject({ jobId: z.string().min(1) });

/** The stored reference of the bulk TTS operation. */
const bulkTtsResultReferenceSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      narrationSegmentId: z.string().min(1),
      jobId: z.string().min(1),
    }),
  ),
  excluded: z.array(bulkTtsJobExclusionSchema),
});

/** The stored reference of a composition publish. */
const compositionVersionResultReferenceSchema = z.strictObject({
  compositionVersionId: z.string().min(1),
});

function invalidResultReference(operation: string): AgentOperationError {
  // A stored reference that no longer parses means the reference format and
  // the rows in the ledger drifted apart. It has to be visible in the log.
  logger.error("agent_result_reference_invalid", { operation });
  return new AgentOperationError("INTERNAL_ERROR");
}

function parseResultReference(operation: string, resultRef: string): unknown {
  try {
    return JSON.parse(resultRef) as unknown;
  } catch {
    throw invalidResultReference(operation);
  }
}

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

function bulkTtsResultRefOf(
  operation: string,
  resultRef: string,
): z.infer<typeof bulkTtsResultReferenceSchema> {
  const parsed = bulkTtsResultReferenceSchema.safeParse(
    parseResultReference(operation, resultRef),
  );
  if (!parsed.success) {
    throw invalidResultReference(operation);
  }
  return parsed.data;
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

/** Work/edition/version lookups use the Agent Access code, not generic 404. */
async function asWorkResource<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof ApiError && error.code === "RESOURCE_NOT_FOUND") {
      throw new AgentOperationError(AGENT_ERROR_CODES.WORK_NOT_FOUND);
    }
    throw error;
  }
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
