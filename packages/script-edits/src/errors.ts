export const scriptEditErrorCodes = [
  "EDIT_TARGET_NOT_FOUND",
  "EDIT_PRECONDITION_FAILED",
  "EDIT_INVALID_INPUT",
  "EDIT_UNSUPPORTED_TEMPLATE",
  "EDIT_ID_GENERATION_FAILED",
] as const;

export type ScriptEditErrorCode = (typeof scriptEditErrorCodes)[number];

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
  return new ScriptEditError("EDIT_TARGET_NOT_FOUND", [
    { path, code: "target_not_found", message },
  ]);
}

export function preconditionFailed(
  path: (string | number)[],
  message: string,
): ScriptEditError {
  return new ScriptEditError("EDIT_PRECONDITION_FAILED", [
    { path, code: "precondition_failed", message },
  ]);
}

export function invalidOperation(
  path: (string | number)[],
  message: string,
): ScriptEditError {
  return new ScriptEditError("EDIT_INVALID_INPUT", [
    { path, code: "invalid_input", message },
  ]);
}

export function idGenerationFailed(): ScriptEditError {
  return new ScriptEditError("EDIT_ID_GENERATION_FAILED", [
    { path: [], code: "id_generation_failed", message: "IDを生成できませんでした。" },
  ]);
}
