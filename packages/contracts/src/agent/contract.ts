import {
  AGENT_PROTOCOL_MIN_VERSION,
  AGENT_PROTOCOL_VERSION,
  agentErrorSchema,
} from "./protocol";
import {
  agentOperationCatalog,
  agentOperationNames,
  agentWarningCodes,
} from "./catalog";
import type { AgentTemplateInputContract } from "./template";
import {
  agentOperationInputSchemas,
  agentOperationOutputSchemas,
} from "./maps";
import {
  computeAgentSchemaDigest,
  scriptOperationCategoryOf,
  toAgentTemplate,
  type AgentOperationContract,
  type AgentSchemaDigestInput,
  type AgentSchemaDigestSource,
  type AgentSchemaGetResult,
} from "./schema";
import { z } from "zod";
import { toAgentJsonSchema } from "../agent-json-schema";
import { CONTENT_SCHEMA_VERSION } from "../content/document";
import { assetKindSchema } from "../dto";
import { scriptOperationNames } from "../script-operation";
import {
  visualTemplateDefinitions,
  type VisualTemplateDefinition,
} from "../templates";

export const agentHandshakeSchema = z.strictObject({
  protocolVersion: z.number().int(),
  agentId: z.string().trim().min(1).optional(),
});
export type AgentHandshake = z.infer<typeof agentHandshakeSchema>;

export const agentRequestEnvelopeSchema = z.strictObject({
  requestId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  input: z.unknown(),
});
export type AgentRequestEnvelope = z.infer<typeof agentRequestEnvelopeSchema>;

export const agentSuccessResponseSchema = z.strictObject({
  requestId: z.string(),
  ok: z.literal(true),
  data: z.unknown(),
});
export type AgentSuccessResponse = z.infer<typeof agentSuccessResponseSchema>;

export const agentErrorResponseSchema = z.strictObject({
  requestId: z.string(),
  ok: z.literal(false),
  error: agentErrorSchema,
});
export type AgentErrorResponse = z.infer<typeof agentErrorResponseSchema>;

export const agentResponseSchema = z.discriminatedUnion("ok", [
  agentSuccessResponseSchema,
  agentErrorResponseSchema,
]);
export type AgentResponse = z.infer<typeof agentResponseSchema>;

/**
 * The normalised contract of one agent operation: the JSON Schema of its
 * input and of its output. The JSON Schema conversion is the one shared with
 * the MCP tool schemas, so an agent sees exactly the schema that was hashed.
 */
export const agentOperationContractSchema = z.strictObject({
  name: z.enum(agentOperationNames),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
});

/**
 * Freezes a plain data structure. The operation contracts are digest inputs,
 * so they must not change while the build is running.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}

/**
 * The input contract of one definition. The JSON Schema is converted from the
 * same Zod schema that validates saves; the example is data that a test keeps
 * valid. Nothing here re-implements validation.
 */
function toAgentTemplateInputContract(
  definition: VisualTemplateDefinition,
): AgentTemplateInputContract {
  return deepFreeze({
    id: definition.id,
    version: definition.version,
    inputSchema: toAgentJsonSchema(definition.inputSchema, "input"),
    example: definition.exampleInput,
  });
}

const templateInputContractsCache: {
  value?: readonly AgentTemplateInputContract[];
} = {};

/**
 * The input contracts of this build, built once from the template registry.
 * They are a digest input, so they must not change while the build is running.
 */
export function agentTemplateInputContracts(): readonly AgentTemplateInputContract[] {
  if (templateInputContractsCache.value === undefined) {
    templateInputContractsCache.value = Object.freeze(
      visualTemplateDefinitions.map(toAgentTemplateInputContract),
    );
  }
  return templateInputContractsCache.value;
}

/** One template's input contract, or undefined when id/version is unknown. */
export function buildAgentTemplateInputContract(
  id: string,
  version: number,
): AgentTemplateInputContract | undefined {
  return agentTemplateInputContracts().find(
    (contract) => contract.id === id && contract.version === version,
  );
}

/**
 * Builds the contract of every agent operation, in the fixed operation order.
 * The order is part of the digest input, so it must not change.
 */
export function buildAgentOperationContracts(): AgentOperationContract[] {
  return agentOperationNames.map((name) =>
    deepFreeze(
      agentOperationContractSchema.parse({
        name,
        input: toAgentJsonSchema(agentOperationInputSchemas[name], "input"),
        output: toAgentJsonSchema(agentOperationOutputSchemas[name], "output"),
      }),
    ),
  );
}

const operationContractsCache: { value?: readonly AgentOperationContract[] } =
  {};

/**
 * The operation contracts of this build. They are built once and reused, so
 * every digest of the same build is computed from the same contracts.
 */
export function agentOperationContracts(): readonly AgentOperationContract[] {
  if (operationContractsCache.value === undefined) {
    operationContractsCache.value = Object.freeze(
      buildAgentOperationContracts(),
    );
  }
  return operationContractsCache.value;
}

/**
 * Digest of the operation contracts alone. It changes whenever an
 * operation's input or output schema changes, and it does not depend on the
 * key order of the JSON Schema objects.
 */
export function computeAgentOperationDigest(
  contracts: readonly AgentOperationContract[],
): string {
  return computeAgentSchemaDigest(contracts);
}

export function agentSchemaDigestInputOf(
  source: AgentSchemaDigestSource,
): AgentSchemaDigestInput {
  return {
    contentSchemaVersion: source.contentSchemaVersion,
    templates: source.templates.map((template) => ({
      id: template.id,
      version: template.version,
      layers: template.layers,
      inputFields: template.inputFields,
      transitionPolicy: template.transitionPolicy,
      animationPolicy: template.animationPolicy,
    })),
    operations: source.operations,
    agentOperations: source.agentOperations,
    warningCodes: source.warningCodes,
    assetKinds: source.assetKinds,
    templateInputContracts: source.templateInputContracts,
    operationContracts: source.operationContracts,
  };
}

export function buildAgentSchemaGetResult(): AgentSchemaGetResult {
  const contentSchemaVersion = CONTENT_SCHEMA_VERSION;
  const templates = visualTemplateDefinitions.map(toAgentTemplate);
  const operations = scriptOperationNames.map((name) => ({
    name,
    category: scriptOperationCategoryOf(name),
  }));
  const agentOperations = agentOperationCatalog.map((entry) => ({ ...entry }));
  const warningCodes = [...agentWarningCodes];
  const assetKinds = [...assetKindSchema.options];
  const operationContracts = agentOperationContracts();
  const templateInputContracts = agentTemplateInputContracts();
  const schema = {
    contentSchemaVersion,
    templates,
    operations,
    agentOperations,
    warningCodes,
    assetKinds,
  };
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    minProtocolVersion: AGENT_PROTOCOL_MIN_VERSION,
    ...schema,
    operationDigest: computeAgentOperationDigest(operationContracts),
    schemaDigest: computeAgentSchemaDigest(
      agentSchemaDigestInputOf({
        ...schema,
        templateInputContracts,
        operationContracts,
      }),
    ),
  };
}
