import { AGENT_PROTOCOL_MIN_VERSION, AGENT_PROTOCOL_VERSION } from "./protocol";
import {
  agentOperationCatalogEntrySchema,
  agentOperationDescriptorSchema,
  agentWarningCodeSchema,
  scriptOperationCategorySchema,
  type AgentOperationCatalogEntry,
  type AgentOperationName,
  type AgentOperationDescriptor,
  type AgentWarningCode,
  type ScriptOperationCategory,
} from "./catalog";
import {
  agentVisualTemplateSchema,
  type AgentTemplateField,
  type AgentTemplateInputContract,
  type AgentVisualTemplate,
} from "./template";
import { z } from "zod";
import { canonicalAgentRequestJson } from "../agent-request";
import { type AgentJsonSchema } from "../agent-json-schema";
import { positiveInt } from "../content/primitives";
import { assetKindSchema } from "../dto";
import { type ScriptOperationName } from "../script-operation";
import {
  type TemplateFieldSpec,
  type VisualTemplateDefinition,
} from "../templates";

export const AGENT_SCHEMA_DIGEST_ALGORITHM = "fnv1a64" as const;
export const agentSchemaDigestSchema = z
  .string()
  .regex(new RegExp(`^${AGENT_SCHEMA_DIGEST_ALGORITHM}:[0-9a-f]{16}$`));

export interface AgentOperationContract {
  name: AgentOperationName;
  input: AgentJsonSchema;
  output: AgentJsonSchema;
}

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
        options: field.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
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

export function toAgentTemplate(
  definition: VisualTemplateDefinition,
): AgentVisualTemplate {
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

export function scriptOperationCategoryOf(
  name: ScriptOperationName,
): ScriptOperationCategory {
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
    if (
      codePoint >= 0xd800 &&
      codePoint <= 0xdbff &&
      index + 1 < value.length
    ) {
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

export type AgentSchemaDigestTemplate = Omit<
  AgentVisualTemplate,
  "display" | "editable"
>;

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
