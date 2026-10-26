import { CompositionCompileError } from "@kakeai/video";
import { validationError } from "../../http/validation.ts";

export function throwIfFatalTimelineError(error: unknown): void {
  if (!(error instanceof CompositionCompileError)) {
    throw error;
  }
  const fatal = error.issues.filter(
    (issue) => issue.code !== "fixed_duration_overflow",
  );
  if (fatal.length > 0) {
    throw validationError(
      fatal.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
  }
}
