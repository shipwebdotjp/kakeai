import { createHash } from "node:crypto";
import { agentRequestHashPayload, canonicalAgentRequestJson } from "@kakeai/contracts";

/**
 * SHA-256 of a canonical JSON payload, in the `sha256:<hex>` form. The
 * canonical form sorts object keys and drops `undefined` members, so the same
 * logical request always produces the same text.
 */
export function sha256RequestHash(payload: unknown): string {
  const canonical = canonicalAgentRequestJson(payload);
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Hash of one agent request, used by the idempotency ledger to tell a retry
 * of the same request from a different request that reuses the id.
 *
 * The `requestId` is excluded from the payload: the same logical request
 * hashes identically no matter which key carried it. The operation name is
 * part of the payload, so one id used for two different operations cannot
 * look like the same request.
 */
export function computeAgentRequestHash(operation: string, input: unknown): string {
  return sha256RequestHash(agentRequestHashPayload(operation, input));
}
