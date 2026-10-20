import {
  agentErrorCodeSchema,
  agentErrorIssueSchema,
  type AgentError,
  type AgentErrorCode,
  type AgentErrorIssue,
} from "@kakeai/contracts";
import { ScriptEditError } from "@kakeai/script-edits";
import { ApiError } from "../http/errors.ts";

/** A stable Agent Access error that is not expressed by the HTTP API codes. */
export class AgentOperationError extends Error {
  readonly code: AgentErrorCode;
  readonly issues: AgentErrorIssue[];

  constructor(code: AgentErrorCode, issues: AgentErrorIssue[] = []) {
    super(issues[0]?.message ?? code);
    this.name = "AgentOperationError";
    this.code = code;
    this.issues = issues;
  }
}

export function agentIssue(
  path: (string | number)[],
  code: string,
  message: string,
): AgentErrorIssue {
  return { path, code, message };
}

function asIssues(value: unknown): AgentErrorIssue[] | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const raw = (value as { issues?: unknown }).issues;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const issues: AgentErrorIssue[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const candidate = entry as { path?: unknown; code?: unknown; message?: unknown };
    const path = Array.isArray(candidate.path)
      ? candidate.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        )
      : [];
    const code =
      typeof candidate.code === "string" && candidate.code.length > 0
        ? candidate.code
        : "invalid_value";
    const message = typeof candidate.message === "string" ? candidate.message : "";
    const normalized = { path, code, message };
    if (agentErrorIssueSchema.safeParse(normalized).success) {
      issues.push(normalized);
    }
  }
  return issues.length === 0 ? undefined : issues;
}

function errorCodeOf(value: string): AgentErrorCode {
  return agentErrorCodeSchema.safeParse(value).success
    ? (value as AgentErrorCode)
    : "INTERNAL_ERROR";
}

/**
 * Converts a service/transport error into the wire error shape. Stack traces
 * and free-form messages never cross the socket.
 */
export function toAgentError(error: unknown): AgentError {
  if (error instanceof AgentOperationError) {
    return {
      code: error.code,
      ...(error.issues.length === 0 ? {} : { issues: error.issues }),
    };
  }
  if (error instanceof ScriptEditError) {
    return { code: error.code, ...(error.issues.length === 0 ? {} : { issues: error.issues }) };
  }
  if (error instanceof ApiError) {
    const issues = asIssues(error.details);
    return {
      code: errorCodeOf(error.code),
      ...(issues === undefined ? {} : { issues }),
    };
  }
  return { code: "INTERNAL_ERROR" };
}
