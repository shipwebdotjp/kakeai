import { z } from "zod";

/**
 * A caller supplied idempotency key. It is optional on the high-cost agent
 * operations and unique per (operation, agentId) once it is used.
 */
export const agentRequestIdSchema = z.string().trim().min(1);
export type AgentRequestId = z.infer<typeof agentRequestIdSchema>;

/**
 * Stable JSON with lexicographically sorted object keys. `undefined` members
 * are dropped, so an absent optional field and an explicit `undefined` produce
 * the same text. Used to hash a request, never to store data.
 *
 * Only plain JSON values are supported: a `Date`, `Map` or `Set` has no own
 * enumerable keys and would collapse to `{}`, and a `BigInt` cannot be
 * serialised at all.
 */
export function canonicalAgentRequestJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalAgentRequestJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalAgentRequestJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

/** The payload a request hash is computed over. */
export interface AgentRequestHashPayload {
  operation: string;
  input: unknown;
}

/**
 * Builds the payload a request hash is computed over. `requestId` is left
 * out, so the same logical request hashes identically no matter which
 * idempotency key carried it. The operation name is part of the payload, so
 * one `requestId` used for two different operations cannot look like the same
 * request.
 */
export function agentRequestHashPayload(
  operation: string,
  input: unknown,
): AgentRequestHashPayload {
  return { operation, input: withoutRequestId(input) };
}

function withoutRequestId(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  // `Object.fromEntries` defines own properties, so a `__proto__` member
  // cannot disappear through the prototype setter.
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([key]) => key !== "requestId",
    ),
  );
}
