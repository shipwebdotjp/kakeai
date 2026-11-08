export type DirectorGenerationFailureReason = "timeout" | "invalid" | "unsafe" | "llm";

/**
 * A director generation that never produced a usable output. Callers treat
 * every reason as "skip this comment and continue the spine"; the reason is
 * for logs and console messages.
 */
export class DirectorGenerationError extends Error {
  constructor(
    readonly reason: DirectorGenerationFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DirectorGenerationError";
  }
}
