import {
  bindingErrorPayload,
  bindingErrorText,
  zodIssues,
  type BindingErrorPayload,
} from "@kakeai/agent-client";

/**
 * Stable codes produced by the MCP binding itself. Operation failures keep the
 * Agent Access code (`AGENT_*`, `EDIT_*`, `VALIDATION_ERROR`, ...).
 */
export const MCP_ERROR_CODES = {
  TOOL_UNKNOWN: "MCP_TOOL_UNKNOWN",
  INTERNAL_ERROR: "MCP_INTERNAL_ERROR",
} as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES];

/** Same `{ code, issues? }` payload the CLI emits on stderr. */
export type ToolErrorPayload = BindingErrorPayload;

export { zodIssues };

export function toolErrorPayload(
  code: string,
  issues: Parameters<typeof bindingErrorPayload>[1] = [],
): ToolErrorPayload {
  return bindingErrorPayload(code, issues);
}

export function toolErrorText(payload: ToolErrorPayload): string {
  return bindingErrorText(payload);
}