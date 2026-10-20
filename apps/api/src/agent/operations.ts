import type { z } from "zod";
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
  agentScriptSaveInputSchema,
  agentScriptSaveOutputSchema,
  agentScriptValidateInputSchema,
  agentScriptValidateOutputSchema,
  agentWorkCreateInputSchema,
  agentWorkCreateOutputSchema,
  agentWorkGetInputSchema,
  agentWorkGetOutputSchema,
  agentWorkListInputSchema,
  agentWorkListOutputSchema,
  buildAgentSchemaGetResult,
  isAgentMutationOperation,
  isAgentOperationName,
  type AgentErrorCode,
  type AgentErrorIssue,
  type AgentOperationInputMap,
  type AgentOperationName,
  type AgentOperationOutputMap,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { logger } from "../logger.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { getAsset, listAssets, updateAsset } from "../services/assets.ts";
import {
  editAgentScript,
  getAgentScript,
  saveAgentScript,
  validateAgentScript,
} from "../services/agent-script.ts";
import { importAgentAsset } from "../services/agent-assets.ts";
import type { CompositionAuthoringService } from "../services/authoring-context.ts";
import type { CompositionService } from "../services/compositions.ts";
import { publishOrValidateComposition } from "../services/composition-publishing.ts";
import type { FontCatalogService } from "../services/font-catalog.ts";
import { cancelJob, getJob, listWorkJobs } from "../services/jobs.ts";
import { createRenderJob } from "../services/render-jobs.ts";
import { createWork, getWork, listWorks } from "../services/works.ts";
import { AgentOperationError } from "./errors.ts";

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

interface AgentOperationDefinition<Input, Output> {
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  invalidInputCode?: AgentErrorCode;
  run: (input: Input, context: AgentOperationContext) => Promise<Output>;
}

interface UnknownOperationDefinition {
  input: z.ZodType<unknown>;
  output: z.ZodType<unknown>;
  invalidInputCode?: AgentErrorCode;
  run: (input: unknown, context: AgentOperationContext) => Promise<unknown>;
}

type AgentOperationDefinitions = {
  [K in AgentOperationName]: AgentOperationDefinition<
    AgentOperationInputMap[K],
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
    run: async (input, context) => ({
      assets: await listAssets(context.prisma, input.kind),
    }),
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
    run: async (input, context) => {
      const { compositionId, dryRun, ...publishInput } = input;
      return publishOrValidateComposition(
        context.compositions,
        context.compositionAuthoring,
        compositionId,
        publishInput,
        { dryRun: dryRun ?? false },
      );
    },
  },
};

function unknownOperation(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.OPERATION_UNKNOWN);
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
  const result = await definition.run(parsedInput.data, context);
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
