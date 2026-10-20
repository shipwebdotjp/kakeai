import {
  SCRIPT_EDIT_ERROR_CODES,
  scriptEditErrorCodes,
  type ScriptEditErrorCode,
} from "@kakeai/contracts";

export { SCRIPT_EDIT_ERROR_CODES, scriptEditErrorCodes, type ScriptEditErrorCode };

export interface ScriptEditIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export class ScriptEditError extends Error {
  readonly code: ScriptEditErrorCode;
  readonly issues: ScriptEditIssue[];

  constructor(code: ScriptEditErrorCode, issues: ScriptEditIssue[]) {
    super(issues[0]?.message ?? code);
    this.name = "ScriptEditError";
    this.code = code;
    this.issues = issues;
  }
}

export function targetNotFound(path: (string | number)[], message: string): ScriptEditError {
  return new ScriptEditError(SCRIPT_EDIT_ERROR_CODES.TARGET_NOT_FOUND, [
    { path, code: "target_not_found", message },
  ]);
}

export function preconditionFailed(
  path: (string | number)[],
  message: string,
): ScriptEditError {
  return new ScriptEditError(SCRIPT_EDIT_ERROR_CODES.PRECONDITION_FAILED, [
    { path, code: "precondition_failed", message },
  ]);
}

export function invalidOperation(
  path: (string | number)[],
  message: string,
): ScriptEditError {
  return new ScriptEditError(SCRIPT_EDIT_ERROR_CODES.INVALID_INPUT, [
    { path, code: "invalid_input", message },
  ]);
}

export function idGenerationFailed(): ScriptEditError {
  return new ScriptEditError(SCRIPT_EDIT_ERROR_CODES.ID_GENERATION_FAILED, [
    { path: [], code: "id_generation_failed", message: "IDを生成できませんでした。" },
  ]);
}
