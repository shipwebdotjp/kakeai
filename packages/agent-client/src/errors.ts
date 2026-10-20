import { z } from "zod";
import { AGENT_ERROR_CODES, type AgentErrorIssue } from "@kakeai/contracts";

/**
 * Stable failure payload shared by every Agent Access binding. Operation
 * failures keep their Agent Access / operation-core code; only the binding's
 * own failures add a binding-specific code.
 */
export interface BindingErrorPayload {
  code: string;
  issues?: AgentErrorIssue[];
}

/** Input validation uses the same code as the resident server. */
export const BINDING_VALIDATION_ERROR_CODE = AGENT_ERROR_CODES.VALIDATION_ERROR;

/** Projects Zod issues onto the wire `{ path, code, message }` shape. */
export function zodIssues(error: z.ZodError): AgentErrorIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    ),
    code: issue.code,
    message: issue.message,
  }));
}

export function bindingErrorPayload(
  code: string,
  issues: AgentErrorIssue[] = [],
): BindingErrorPayload {
  return issues.length === 0 ? { code } : { code, issues };
}

/** Serialised error text. Never includes a stack trace or a free-form message. */
export function bindingErrorText(payload: BindingErrorPayload): string {
  return JSON.stringify(payload);
}
