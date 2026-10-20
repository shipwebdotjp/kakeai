import { BINDING_VALIDATION_ERROR_CODE } from "@kakeai/agent-client";
import type { AgentErrorIssue } from "@kakeai/contracts";

/**
 * Codes produced by the CLI binding itself. Operation failures keep their
 * Agent Access / operation-core code, exactly like the MCP binding.
 */
export const CLI_ERROR_CODES = {
  USAGE_ERROR: "CLI_USAGE_ERROR",
  INPUT_ERROR: "CLI_INPUT_ERROR",
  INTERNAL_ERROR: "CLI_INTERNAL_ERROR",
} as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[keyof typeof CLI_ERROR_CODES];

/**
 * Exit codes are part of the CLI contract:
 * - `0` success (including help, version and `operations`)
 * - `1` the request was sent (or rejected by contract validation)
 * - `2` the invocation never formed a request (usage / unreadable input)
 */
export class CliError extends Error {
  readonly code: CliErrorCode | string;
  readonly exitCode: number;
  readonly issues: AgentErrorIssue[];

  constructor(
    code: CliErrorCode | string,
    exitCode: number,
    issues: AgentErrorIssue[] = [],
  ) {
    super(code);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.issues = issues;
  }
}

export function usageError(message: string): CliError {
  return new CliError(CLI_ERROR_CODES.USAGE_ERROR, 2, [
    { path: [], code: "usage", message },
  ]);
}

export function inputError(code: string, message: string): CliError {
  return new CliError(CLI_ERROR_CODES.INPUT_ERROR, 2, [{ path: [], code, message }]);
}

export function validationError(issues: AgentErrorIssue[]): CliError {
  return new CliError(BINDING_VALIDATION_ERROR_CODE, 1, issues);
}

export function internalError(): CliError {
  return new CliError(CLI_ERROR_CODES.INTERNAL_ERROR, 1);
}
