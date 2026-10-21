import { z } from "zod";

/**
 * A JSON Schema object (draft 2020-12) produced from a contract schema.
 * The concrete shape is open because a JSON Schema is data, not a contract
 * type: the digest only needs a stable, serialisable representation.
 */
export type AgentJsonSchema = Record<string, unknown>;

/** Which side of the operation the schema describes. */
export type AgentJsonSchemaIo = "input" | "output";

const DEFS_POINTER_PREFIX = "#/$defs/";

/**
 * Resolves a local `$ref` into the schema it points at. Only the root
 * `$defs` of the same schema object are resolvable, which is all Zod emits.
 */
function resolveRef(ref: unknown, root: AgentJsonSchema): unknown {
  if (typeof ref !== "string" || !ref.startsWith(DEFS_POINTER_PREFIX)) {
    return undefined;
  }
  const defs = root.$defs;
  if (typeof defs !== "object" || defs === null) {
    return undefined;
  }
  return (defs as Record<string, unknown>)[ref.slice(DEFS_POINTER_PREFIX.length)];
}

/**
 * True when a JSON Schema node describes an object. A node is an object when
 * it says so, when it is an `allOf` composition of objects, or when it
 * references an object definition.
 */
function isObjectSchema(
  node: unknown,
  root: AgentJsonSchema,
  visiting: Set<unknown>,
): boolean {
  if (typeof node !== "object" || node === null) {
    return false;
  }
  if (visiting.has(node)) {
    // A recursive definition: the branch was already being checked.
    return true;
  }
  visiting.add(node);
  try {
    const record = node as { type?: unknown; allOf?: unknown; $ref?: unknown };
    if (record.type === "object") {
      return true;
    }
    if (record.$ref !== undefined) {
      const target = resolveRef(record.$ref, root);
      if (target === undefined) {
        return false;
      }
      return isObjectSchema(target, root, visiting);
    }
    if (Array.isArray(record.allOf) && record.allOf.length > 0) {
      return record.allOf.every((branch) => isObjectSchema(branch, root, visiting));
    }
    return false;
  } finally {
    visiting.delete(node);
  }
}

/**
 * True when a composed schema has at least one branch and every branch is an
 * object schema. Only such a schema may carry the top-level `type: "object"`.
 */
function hasObjectShape(json: AgentJsonSchema): boolean {
  const branches = json.anyOf ?? json.oneOf ?? json.allOf;
  if (!Array.isArray(branches) || branches.length === 0) {
    return false;
  }
  return branches.every((branch) => isObjectSchema(branch, json, new Set()));
}

/**
 * Converts a contract Zod schema into the JSON Schema object that the Agent
 * Access surface exposes. The MCP tool schemas and the operation digest share
 * this single conversion, so an agent sees exactly the schema that was hashed.
 *
 * `$schema` is stripped because the dialect is fixed by the contract and the
 * digest must not move when the Zod release changes. A top-level
 * `type: "object"` is added when the schema is a composition of object schemas
 * and has no top-level type (a union such as `script.validate`), because every
 * agent operation takes and returns an object. A composition that has a
 * non-object branch is left untouched: adding `type: "object"` to it would
 * publish a schema that rejects every value.
 */
export function toAgentJsonSchema(
  schema: z.ZodType,
  io: AgentJsonSchemaIo,
): AgentJsonSchema {
  const { $schema: _schema, ...json } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  }) as AgentJsonSchema;
  if (json.type !== undefined) {
    return json;
  }
  return hasObjectShape(json) ? { type: "object", ...json } : json;
}
