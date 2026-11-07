import type { LiveExportFailure, LiveExportFailureStage } from "@kakeai/contracts";

export type LiveExportErrorCode =
  | "LIVE_EXPORT_INPUT_INVALID"
  | "LIVE_EXPORT_TTS_FAILED"
  | "LIVE_EXPORT_MATERIAL_FAILED"
  | "LIVE_EXPORT_FAILED"
  | "LIVE_EXPORT_OUTPUT_UNAVAILABLE";

export class LiveExportError extends Error {
  readonly errorCode: LiveExportErrorCode;
  readonly failure: LiveExportFailure;

  constructor(
    errorCode: LiveExportErrorCode,
    stage: LiveExportFailureStage,
    message: string,
    id: string | null = null,
  ) {
    super(message);
    this.name = "LiveExportError";
    this.errorCode = errorCode;
    this.failure = { stage, id, message };
  }
}
