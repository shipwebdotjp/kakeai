import { z } from "zod";
import { agentRequestIdSchema, canonicalAgentRequestJson } from "./agent-request";
import { toAgentJsonSchema, type AgentJsonSchema } from "./agent-json-schema";
import { CONTENT_SCHEMA_VERSION, contentDocumentSchema } from "./content/document";
import { animationPresetSchema } from "./content/animation";
import {
  cueLayerSchema,
  transitionEdgeSchema,
  transitionPresetSchema,
} from "./content/layers";
import { idSchema, localeSchema, nonNegativeInt, positiveInt } from "./content/primitives";
import { richTextMarkSchema } from "./content/rich-text";
import {
  assetKindSchema,
  assetSchema,
  bulkTtsJobExclusionSchema,
  bulkTtsJobsResultSchema,
  jobKindSchema,
  jobSchema,
  previewTimelineSchema,
  scriptVersionSchema,
  workSchema,
  workSummarySchema,
} from "./dto";
import { assetTagsSchema } from "./asset";
import { assetListInputSchema, assetListPageSchema } from "./asset-list";
import { characterLibraryEntrySchema } from "./character-library";
import {
  compositionAuthoringContextSchema,
  compositionDraftFilesSchema,
  compositionDraftSchema,
  compositionManifestSchema,
  compositionSchema,
  compositionVersionSchema,
} from "./composition";
import { errorCodeSchema, warningSchema } from "./error";
import {
  compositionAuthoringContextRequestSchema,
  createCompositionRequestSchema,
  createTtsJobRequestSchema,
  publishCompositionRequestSchema,
  saveScriptVersionRequestSchema,
  updateCompositionDraftRequestSchema,
} from "./requests";
import {
  SCRIPT_EDIT_ERROR_CODES,
  scriptOperationCreatedSchema,
  scriptOperationNames,
  scriptOperationsSchema,
  type ScriptOperationName,
} from "./script-operation";
import {
  visualTemplateDefinitions,
  type TemplateFieldSpec,
  type VisualTemplateDefinition,
} from "./templates";

/** Version of the local socket request/response envelope. */
export const AGENT_PROTOCOL_VERSION = 1 as const;

/**
 * Oldest protocol version this build still accepts. A handshake is accepted
 * when its version is inside `[AGENT_PROTOCOL_MIN_VERSION,
 * AGENT_PROTOCOL_VERSION]`. The range exists so a future breaking change can
 * raise the maximum while old clients are still told which minimum they need;
 * a compatible addition never moves either bound.
 */
export const AGENT_PROTOCOL_MIN_VERSION = 1 as const;

/**
 * True when `version` is a protocol version this build can talk. Used by the
 * local socket handshake and by clients that want to fail early.
 */
export function isAgentProtocolVersionSupported(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= AGENT_PROTOCOL_MIN_VERSION &&
    version <= AGENT_PROTOCOL_VERSION
  );
}

/** Directory (under the app data root) that holds the local control socket. */
export const AGENT_SOCKET_DIRECTORY = "agent" as const;
export const AGENT_SOCKET_FILENAME = "agent.sock" as const;

/** One NDJSON request may not exceed this size, including the trailing newline. */
export const AGENT_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
/** Timeouts shared by the client and the resident server. */
export const AGENT_READ_TIMEOUT_MS = 10_000;
export const AGENT_MUTATION_TIMEOUT_MS = 120_000;
/** A connection that sends nothing for this long is closed by the server. */
export const AGENT_IDLE_TIMEOUT_MS = 300_000;

/**
 * Maximum number of request frames one connection may hold unprocessed. A
 * frame received while the limit is reached is not executed: it is answered
 * with `AGENT_BACKPRESSURE` and skipped, and the connection stays open.
 */
export const AGENT_MAX_PENDING_FRAMES_PER_CONNECTION = 64;

/**
 * Maximum number of concurrent connections the local control socket accepts.
 * A connection above the cap is closed before the handshake.
 */
export const AGENT_MAX_CONNECTIONS = 16;

export function agentSocketPath(dataRoot: string): string {
  const normalized = dataRoot.replace(/[\\/]+$/u, "");
  // Keep the separator style of the caller's platform path without importing
  // `node:path` into a module that is also bundled for the browser.
  const separator = normalized.includes("\\") ? "\\" : "/";
  return `${normalized}${separator}${AGENT_SOCKET_DIRECTORY}${separator}${AGENT_SOCKET_FILENAME}`;
}

/**
 * Error codes that cross the Agent Access binding boundary. Operation-core
 * errors are included here so MCP, CLI and the local socket share one list.
 */
export const AGENT_ERROR_CODES = {
  ...SCRIPT_EDIT_ERROR_CODES,
  APP_UNAVAILABLE: "AGENT_APP_UNAVAILABLE",
  PROTOCOL_MISMATCH: "AGENT_PROTOCOL_MISMATCH",
  OPERATION_UNKNOWN: "AGENT_OPERATION_UNKNOWN",
  PAYLOAD_TOO_LARGE: "AGENT_PAYLOAD_TOO_LARGE",
  REQUEST_TIMEOUT: "AGENT_REQUEST_TIMEOUT",
  /**
   * The connection already holds the maximum number of unprocessed request
   * frames. The frame is skipped instead of executed, and the connection
   * stays open so the client can slow down and retry.
   */
  BACKPRESSURE: "AGENT_BACKPRESSURE",
  SCRIPT_BASE_STALE: "SCRIPT_BASE_STALE",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  IDEMPOTENCY_IN_PROGRESS: "AGENT_IDEMPOTENCY_IN_PROGRESS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  ASSET_UNAVAILABLE: "ASSET_UNAVAILABLE",
  COMPOSITION_UNAVAILABLE: "COMPOSITION_UNAVAILABLE",
  WORK_NOT_FOUND: "WORK_NOT_FOUND",
} as const;

export type AgentSpecificErrorCode =
  (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

export const agentSpecificErrorCodeSchema = z.enum(
  Object.values(AGENT_ERROR_CODES) as [AgentSpecificErrorCode, ...AgentSpecificErrorCode[]],
);

/**
 * Wire errors accept the Agent Access codes plus the stable HTTP API codes, so
 * a service error keeps its meaning instead of collapsing into INTERNAL_ERROR.
 */
export const agentErrorCodeSchema = z.union([agentSpecificErrorCodeSchema, errorCodeSchema]);
export type AgentErrorCode = z.infer<typeof agentErrorCodeSchema>;

export function isAgentErrorCode(value: string): value is AgentErrorCode {
  return agentErrorCodeSchema.safeParse(value).success;
}

export const agentErrorIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string().min(1),
  message: z.string(),
});
export type AgentErrorIssue = z.infer<typeof agentErrorIssueSchema>;

export const agentErrorSchema = z.strictObject({
  code: agentErrorCodeSchema,
  issues: z.array(agentErrorIssueSchema).optional(),
});
export type AgentError = z.infer<typeof agentErrorSchema>;

const templateFieldOptionsSchema = z.array(
  z.strictObject({
    value: z.string().min(1),
    label: z.string().min(1),
  }),
);

const fieldKeyShape = {
  key: z.string().min(1),
  label: z.string().min(1),
};

/**
 * Serialisable projection of `TemplateFieldSpec`. It is derived from the
 * template registry at runtime; it is not a second template list.
 */
export const agentTemplateFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("media"),
    ...fieldKeyShape,
    assetKinds: z.array(assetKindSchema).min(1),
    videoPlayback: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("nestedMedia"),
    ...fieldKeyShape,
    assetKinds: z.array(assetKindSchema).min(1),
    optional: z.boolean().optional(),
    allowComposition: z.boolean().optional(),
    videoPlayback: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal("text"), ...fieldKeyShape }),
  z.strictObject({ kind: z.literal("optionalText"), ...fieldKeyShape }),
  z.strictObject({
    kind: z.literal("richText"),
    ...fieldKeyShape,
    marks: z.array(richTextMarkSchema).min(1),
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("select"),
    ...fieldKeyShape,
    options: templateFieldOptionsSchema,
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("color"),
    ...fieldKeyShape,
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("number"),
    ...fieldKeyShape,
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("decimal"),
    ...fieldKeyShape,
    min: z.number().optional(),
    max: z.number().optional(),
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("mediaCrop"),
    ...fieldKeyShape,
    zoomKey: z.string().min(1).optional(),
  }),
  z.strictObject({ kind: z.literal("boolean"), ...fieldKeyShape }),
  z.strictObject({
    kind: z.literal("grid"),
    ...fieldKeyShape,
    maxColumns: positiveInt,
    maxRows: positiveInt,
    dataKind: z.enum(["table", "chart"]),
  }),
  z.strictObject({
    kind: z.literal("flow"),
    ...fieldKeyShape,
    maxNodes: positiveInt,
    maxEdges: positiveInt,
  }),
  z.strictObject({
    kind: z.literal("effects"),
    ...fieldKeyShape,
    variant: z.enum(["table", "chart", "flow", "stat", "quote", "chat"]),
  }),
  z.strictObject({ kind: z.literal("calloutItems"), ...fieldKeyShape }),
  z.strictObject({
    kind: z.literal("messages"),
    ...fieldKeyShape,
    maxMessages: positiveInt,
  }),
  z.strictObject({ kind: z.literal("animation"), ...fieldKeyShape }),
]);
export type AgentTemplateField = z.infer<typeof agentTemplateFieldSchema>;

export const agentVisualTemplateSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
  display: z.strictObject({
    label: z.string().min(1),
    description: z.string(),
    category: z.string().min(1),
  }),
  layers: z.array(cueLayerSchema),
  editable: z.boolean(),
  inputFields: z.array(agentTemplateFieldSchema),
  transitionPolicy: z.strictObject({
    presets: z.array(transitionPresetSchema),
    defaultEnter: transitionEdgeSchema,
    defaultExit: transitionEdgeSchema,
    maxDurationMs: nonNegativeInt,
  }),
  animationPolicy: z.strictObject({
    presets: z.array(animationPresetSchema),
    defaultDurationMs: nonNegativeInt,
    maxDurationMs: nonNegativeInt,
  }),
});
export type AgentVisualTemplate = z.infer<typeof agentVisualTemplateSchema>;

/**
 * The input contract of one Visual Template. `inputSchema` is derived from the
 * definition's own `inputSchema` (the same Zod schema that validates saves), so
 * the Agent surface never keeps a second copy. `example` is a complete input
 * that passes that schema.
 */
export const agentTemplateInputContractSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
  inputSchema: z.record(z.string(), z.unknown()),
  example: z.unknown(),
});
export type AgentTemplateInputContract = z.infer<
  typeof agentTemplateInputContractSchema
>;

export const scriptOperationCategorySchema = z.enum([
  "scene",
  "line",
  "cue",
  "standing",
  "character",
  "audio",
  "document",
]);
export type ScriptOperationCategory = z.infer<typeof scriptOperationCategorySchema>;

export const agentOperationCatalogEntrySchema = z.strictObject({
  name: z.enum(scriptOperationNames),
  category: scriptOperationCategorySchema,
});
export type AgentOperationCatalogEntry = z.infer<typeof agentOperationCatalogEntrySchema>;

/** Operations exposed by the A3 local control socket and later bindings. */
export const agentOperationNames = [
  "schema.get",
  "template.get",
  "work.list",
  "work.get",
  "work.create",
  "work.update",
  "edition.create",
  "script.get",
  "script.validate",
  "script.save",
  "script.edit",
  "asset.list",
  "asset.get",
  "asset.import",
  "asset.tag",
  "render.start",
  "job.get",
  "job.list",
  "job.cancel",
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
  "preview.frame",
] as const;
export type AgentOperationName = (typeof agentOperationNames)[number];

export const agentReadOperationNames = [
  "schema.get",
  "template.get",
  "work.list",
  "work.get",
  "script.get",
  "script.validate",
  "asset.list",
  "asset.get",
  "job.get",
  "job.list",
  "composition.list",
  "composition.get",
  "composition.draft.get",
  "composition.authoringContext",
  "character.list",
  "character.get",
  "preview.frame",
] as const;

export const agentMutationOperationNames = [
  "work.create",
  "work.update",
  "edition.create",
  "script.save",
  "script.edit",
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

export function isAgentOperationName(value: string): value is AgentOperationName {
  return (agentOperationNames as readonly string[]).includes(value);
}

export function isAgentMutationOperation(operation: string): boolean {
  return (agentMutationOperationNames as readonly string[]).includes(operation);
}

export function isAgentLongRunningOperation(operation: string): boolean {
  return (agentLongRunningOperationNames as readonly string[]).includes(operation);
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
export type AgentOperationDescriptor = z.infer<typeof agentOperationDescriptorSchema>;

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

export const AGENT_SCHEMA_DIGEST_ALGORITHM = "fnv1a64" as const;
export const agentSchemaDigestSchema = z
  .string()
  .regex(new RegExp(`^${AGENT_SCHEMA_DIGEST_ALGORITHM}:[0-9a-f]{16}$`));

export const agentSchemaGetResultSchema = z.strictObject({
  protocolVersion: z.literal(AGENT_PROTOCOL_VERSION),
  /**
   * The oldest protocol version this build accepts. A server that predates
   * the version range does not report it, so the field is optional on the
   * wire; the current server always sends it.
   */
  minProtocolVersion: z.literal(AGENT_PROTOCOL_MIN_VERSION).optional(),
  contentSchemaVersion: positiveInt,
  templates: z.array(agentVisualTemplateSchema),
  operations: z.array(agentOperationCatalogEntrySchema),
  agentOperations: z.array(agentOperationDescriptorSchema),
  warningCodes: z.array(agentWarningCodeSchema),
  assetKinds: z.array(assetKindSchema),
  /**
   * Digest of the operation contracts. A server that predates the digest
   * does not report it, so the field is optional on the wire; the current
   * server always sends it.
   */
  operationDigest: agentSchemaDigestSchema.optional(),
  schemaDigest: agentSchemaDigestSchema,
});
export type AgentSchemaGetResult = z.infer<typeof agentSchemaGetResultSchema>;

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
}

function toTemplateField(field: TemplateFieldSpec): AgentTemplateField {
  switch (field.kind) {
    case "media":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        assetKinds: [...field.assetKinds],
        ...optional("videoPlayback", field.videoPlayback),
      };
    case "nestedMedia":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        assetKinds: [...field.assetKinds],
        ...optional("optional", field.optional),
        ...optional("allowComposition", field.allowComposition),
        ...optional("videoPlayback", field.videoPlayback),
      };
    case "text":
    case "optionalText":
    case "boolean":
    case "calloutItems":
    case "animation":
      return { kind: field.kind, key: field.key, label: field.label };
    case "richText":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        marks: [...field.marks],
        ...optional("optional", field.optional),
      };
    case "select":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        options: field.options.map((option) => ({ value: option.value, label: option.label })),
        ...optional("optional", field.optional),
      };
    case "color":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        ...optional("optional", field.optional),
      };
    case "number":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        ...optional("min", field.min),
        ...optional("max", field.max),
        ...optional("step", field.step),
        ...optional("optional", field.optional),
      };
    case "decimal":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        ...optional("min", field.min),
        ...optional("max", field.max),
        ...optional("optional", field.optional),
      };
    case "mediaCrop":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        ...optional("zoomKey", field.zoomKey),
      };
    case "grid":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        maxColumns: field.maxColumns,
        maxRows: field.maxRows,
        dataKind: field.dataKind,
      };
    case "flow":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        maxNodes: field.maxNodes,
        maxEdges: field.maxEdges,
      };
    case "effects":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        variant: field.variant,
      };
    case "messages":
      return {
        kind: field.kind,
        key: field.key,
        label: field.label,
        maxMessages: field.maxMessages,
      };
  }
}

function toAgentTemplate(definition: VisualTemplateDefinition): AgentVisualTemplate {
  const inputFields = definition.inputFields ?? [];
  return {
    id: definition.id,
    version: definition.version,
    display: { ...definition.display },
    layers: [...definition.layers],
    editable: inputFields.length > 0,
    inputFields: inputFields.map(toTemplateField),
    transitionPolicy: {
      presets: [...definition.transitionPolicy.presets],
      defaultEnter: { ...definition.transitionPolicy.defaultEnter },
      defaultExit: { ...definition.transitionPolicy.defaultExit },
      maxDurationMs: definition.transitionPolicy.maxDurationMs,
    },
    animationPolicy: {
      presets: [...definition.animationPolicy.presets],
      defaultDurationMs: definition.animationPolicy.defaultDurationMs,
      maxDurationMs: definition.animationPolicy.maxDurationMs,
    },
  };
}

function scriptOperationCategoryOf(name: ScriptOperationName): ScriptOperationCategory {
  return scriptOperationCategorySchema.parse(name.slice(0, name.indexOf(".")));
}

/**
 * Stable JSON with lexicographically sorted object keys. Used only for the
 * schema fingerprint, not for storage normalisation. The request hash uses the
 * same canonical form, so there is exactly one canonicaliser in this package.
 */
function stableStringify(value: unknown): string {
  return canonicalAgentRequestJson(value);
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

function fnv1a64Hex(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of utf8Bytes(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Non-cryptographic fingerprint of the schema-relevant data. The prefix names
 * the algorithm so the format remains self-describing if it ever changes.
 */
export function computeAgentSchemaDigest(value: unknown): string {
  return `${AGENT_SCHEMA_DIGEST_ALGORITHM}:${fnv1a64Hex(stableStringify(value))}`;
}

export type AgentSchemaDigestTemplate = Omit<AgentVisualTemplate, "display" | "editable">;

/**
 * The payload parts and the operation contracts that belong together. The
 * digest is computed from this source, so a caller always states which
 * contracts belong to the payload it digests.
 */
export interface AgentSchemaDigestSource {
  contentSchemaVersion: number;
  templates: AgentVisualTemplate[];
  operations: AgentOperationCatalogEntry[];
  agentOperations: AgentOperationDescriptor[];
  warningCodes: AgentWarningCode[];
  assetKinds: Array<z.infer<typeof assetKindSchema>>;
  /**
   * The published input contract (JSON Schema and example) of every template.
   * Folding it into the schema digest is what makes a template input change
   * visible to an agent that cached a previous `template.get` result.
   */
  templateInputContracts: readonly AgentTemplateInputContract[];
  /**
   * The normalised input/output schema of every agent operation. Folding it
   * into the schema digest is what makes an operation contract change visible
   * to an agent that cached the previous digest.
   */
  operationContracts: readonly AgentOperationContract[];
}

export interface AgentSchemaDigestInput {
  contentSchemaVersion: number;
  templates: AgentSchemaDigestTemplate[];
  operations: AgentOperationCatalogEntry[];
  agentOperations: AgentOperationDescriptor[];
  warningCodes: AgentWarningCode[];
  assetKinds: Array<z.infer<typeof assetKindSchema>>;
  templateInputContracts: readonly AgentTemplateInputContract[];
  operationContracts: readonly AgentOperationContract[];
}

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

const agentEmptyInputSchema = z.strictObject({});

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
  works: z.array(workSummarySchema),
});

export const agentWorkGetInputSchema = z.strictObject({ workId: idSchema });
export const agentWorkGetOutputSchema = z.strictObject({ work: workSchema });

export const DEFAULT_AGENT_LOCALE = "ja-JP" as const;
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

export const agentEditionCreateInputSchema = z.strictObject({
  workId: idSchema,
  locale: localeSchema,
  sourceEditionId: idSchema,
});
export const agentEditionCreateOutputSchema = z.strictObject({ work: workSchema });

export const agentScriptGetInputSchema = z
  .strictObject({
    scriptVersionId: idSchema.optional(),
    languageEditionId: idSchema.optional(),
  })
  .refine(
    (value) =>
      (value.scriptVersionId === undefined) !== (value.languageEditionId === undefined),
    {
      message: "scriptVersionId または languageEditionId のどちらか一方を指定してください。",
      path: ["scriptVersionId"],
    },
  );
export const agentScriptGetOutputSchema = z.strictObject({
  scriptVersion: scriptVersionSchema,
});

export const agentScriptValidateInputSchema = scriptValidateRequestSchema;
export const agentScriptValidateOutputSchema = scriptValidateResultSchema;

export const agentScriptSaveInputSchema = scriptSaveRequestSchema;
export const agentScriptSaveOutputSchema = scriptSaveResultSchema;

export const agentScriptEditInputSchema = scriptEditRequestSchema;
export const agentScriptEditOutputSchema = scriptEditResultSchema;

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
 * `job.list` reads the Jobs of one Work. `asset_ingest` is not Work-scoped, so
 * it is not selectable; the default keeps the historical render-only listing.
 */
export const agentJobListKindSchema = jobKindSchema.extract(["render", "tts"]);

export const agentJobListInputSchema = z.strictObject({
  workId: idSchema,
  kind: agentJobListKindSchema.default("render"),
});
export const agentJobListOutputSchema = z.strictObject({ jobs: z.array(jobSchema) });

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
  pngBase64: z.string().min(1),
});
export type AgentPreviewFrameInput = z.input<typeof agentPreviewFrameInputSchema>;
export type AgentPreviewFrameOutput = z.infer<typeof agentPreviewFrameOutputSchema>;

export const agentCompositionListInputSchema = agentEmptyInputSchema;
export const agentCompositionListOutputSchema = z.strictObject({
  compositions: z.array(compositionSchema),
});

export const agentCompositionGetInputSchema = z.strictObject({ compositionId: idSchema });
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
export const agentCompositionPublishOutputSchema = z.discriminatedUnion("dryRun", [
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
]);

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
export type AgentTtsCreateBulkInput = z.input<typeof agentTtsCreateBulkInputSchema>;

export const agentTtsCreateBulkOutputSchema = bulkTtsJobsResultSchema;
export type AgentTtsCreateBulkOutput = z.infer<typeof agentTtsCreateBulkOutputSchema>;

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
export type AgentTtsAttachBulkInput = z.input<typeof agentTtsAttachBulkInputSchema>;

export const agentTtsAttachBulkCountsSchema = z.strictObject({
  queued: nonNegativeInt,
  running: nonNegativeInt,
  succeeded: nonNegativeInt,
  failed: nonNegativeInt,
  cancelled: nonNegativeInt,
});
export type AgentTtsAttachBulkCounts = z.infer<typeof agentTtsAttachBulkCountsSchema>;

export const agentTtsAttachBulkFailureSchema = z.strictObject({
  narrationSegmentId: idSchema,
  jobId: idSchema,
  status: z.enum(["failed", "cancelled"]),
  code: z.string().min(1),
  message: z.string().min(1),
});
export type AgentTtsAttachBulkFailure = z.infer<typeof agentTtsAttachBulkFailureSchema>;

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
export type AgentTtsAttachBulkOutput = z.infer<typeof agentTtsAttachBulkOutputSchema>;

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

export const agentOperationInputSchemas = {
  "schema.get": agentSchemaGetInputSchema,
  "template.get": agentTemplateGetInputSchema,
  "work.list": agentWorkListInputSchema,
  "work.get": agentWorkGetInputSchema,
  "work.create": agentWorkCreateInputSchema,
  "work.update": agentWorkUpdateInputSchema,
  "edition.create": agentEditionCreateInputSchema,
  "script.get": agentScriptGetInputSchema,
  "script.validate": agentScriptValidateInputSchema,
  "script.save": agentScriptSaveInputSchema,
  "script.edit": agentScriptEditInputSchema,
  "asset.list": agentAssetListInputSchema,
  "asset.get": agentAssetGetInputSchema,
  "asset.import": agentAssetImportInputSchema,
  "asset.tag": agentAssetTagInputSchema,
  "render.start": agentRenderStartInputSchema,
  "job.get": agentJobGetInputSchema,
  "job.list": agentJobListInputSchema,
  "job.cancel": agentJobCancelInputSchema,
  "preview.frame": agentPreviewFrameInputSchema,
  "composition.list": agentCompositionListInputSchema,
  "composition.get": agentCompositionGetInputSchema,
  "composition.draft.get": agentCompositionDraftGetInputSchema,
  "composition.authoringContext": agentCompositionAuthoringContextInputSchema,
  "composition.create": agentCompositionCreateInputSchema,
  "composition.draft.save": agentCompositionDraftSaveInputSchema,
  "composition.publish": agentCompositionPublishInputSchema,
  "tts.create": agentTtsCreateInputSchema,
  "tts.createBulk": agentTtsCreateBulkInputSchema,
  "tts.attachBulk": agentTtsAttachBulkInputSchema,
  "character.list": agentCharacterListInputSchema,
  "character.get": agentCharacterGetInputSchema,
} as const satisfies Record<AgentOperationName, z.ZodType>;

export const agentOperationOutputSchemas = {
  "schema.get": agentSchemaGetOutputSchema,
  "template.get": agentTemplateGetOutputSchema,
  "work.list": agentWorkListOutputSchema,
  "work.get": agentWorkGetOutputSchema,
  "work.create": agentWorkCreateOutputSchema,
  "work.update": agentWorkUpdateOutputSchema,
  "edition.create": agentEditionCreateOutputSchema,
  "script.get": agentScriptGetOutputSchema,
  "script.validate": agentScriptValidateOutputSchema,
  "script.save": agentScriptSaveOutputSchema,
  "script.edit": agentScriptEditOutputSchema,
  "asset.list": agentAssetListOutputSchema,
  "asset.get": agentAssetGetOutputSchema,
  "asset.import": agentAssetImportOutputSchema,
  "asset.tag": agentAssetTagOutputSchema,
  "render.start": agentRenderStartOutputSchema,
  "job.get": agentJobGetOutputSchema,
  "job.list": agentJobListOutputSchema,
  "job.cancel": agentJobCancelOutputSchema,
  "preview.frame": agentPreviewFrameOutputSchema,
  "composition.list": agentCompositionListOutputSchema,
  "composition.get": agentCompositionGetOutputSchema,
  "composition.draft.get": agentCompositionDraftGetOutputSchema,
  "composition.authoringContext": agentCompositionAuthoringContextOutputSchema,
  "composition.create": agentCompositionCreateOutputSchema,
  "composition.draft.save": agentCompositionDraftSaveOutputSchema,
  "composition.publish": agentCompositionPublishOutputSchema,
  "tts.create": agentTtsCreateOutputSchema,
  "tts.createBulk": agentTtsCreateBulkOutputSchema,
  "tts.attachBulk": agentTtsAttachBulkOutputSchema,
  "character.list": agentCharacterListOutputSchema,
  "character.get": agentCharacterGetOutputSchema,
} as const satisfies Record<AgentOperationName, z.ZodType>;

export type AgentOperationInputMap = {
  [K in AgentOperationName]: z.input<(typeof agentOperationInputSchemas)[K]>;
};
/** Inputs after the binding has applied schema defaults and transforms. */
export type AgentOperationParsedInputMap = {
  [K in AgentOperationName]: z.output<(typeof agentOperationInputSchemas)[K]>;
};
export type AgentOperationOutputMap = {
  [K in AgentOperationName]: z.infer<(typeof agentOperationOutputSchemas)[K]>;
};

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
export interface AgentOperationContract {
  name: AgentOperationName;
  input: AgentJsonSchema;
  output: AgentJsonSchema;
}

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

const operationContractsCache: { value?: readonly AgentOperationContract[] } = {};

/**
 * The operation contracts of this build. They are built once and reused, so
 * every digest of the same build is computed from the same contracts.
 */
export function agentOperationContracts(): readonly AgentOperationContract[] {
  if (operationContractsCache.value === undefined) {
    operationContractsCache.value = Object.freeze(buildAgentOperationContracts());
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
