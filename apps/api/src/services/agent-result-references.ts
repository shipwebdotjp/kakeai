import { AgentOperationError } from "../agent/errors.ts";
import { logger } from "../logger.ts";

/** Extra fields attached to the drift log so the ledger row can be traced. */
export interface ResultReferenceLogDetail {
  requestId?: string;
}

export function invalidResultReference(
  operation: string,
  detail: ResultReferenceLogDetail = {},
): AgentOperationError {
  // A stored reference that no longer parses means the reference format and
  // the rows in the ledger drifted apart. It has to be visible in the log,
  // with enough detail to trace the affected ledger row.
  logger.error("agent_result_reference_invalid", { operation, ...detail });
  return new AgentOperationError("INTERNAL_ERROR");
}

export function parseResultReference(
  operation: string,
  resultRef: string,
  detail: ResultReferenceLogDetail = {},
): unknown {
  try {
    return JSON.parse(resultRef) as unknown;
  } catch {
    throw invalidResultReference(operation, detail);
  }
}
