import type { ErrorEnvelope } from "@kakeai/contracts";

export type ErrorCode = ErrorEnvelope["error"]["code"];

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  MALFORMED_JSON: "リクエストのJSONを解釈できませんでした。",
  LOCAL_ACCESS_DENIED: "このアクセスは許可されていません。",
  RESOURCE_NOT_FOUND: "指定されたリソースが見つかりません。",
  ASSET_PROCESSING: "素材を取り込み中です。完了後に再試行してください。",
  ASSET_IN_USE: "この素材は使用中のため削除できません。",
  WORK_HAS_CHILDREN: "子作品があるため削除できません。",
  JOB_NOT_CANCELLABLE: "このジョブはキャンセルできません。",
  FILE_TOO_LARGE: "ファイルサイズが上限を超えています。",
  UNSUPPORTED_MEDIA_TYPE: "対応していないファイル形式です。",
  VALIDATION_ERROR: "入力内容を確認してください。",
  ASSET_NOT_FOUND: "指定された素材が見つかりません。",
  ASSET_UNAVAILABLE: "素材ファイルを利用できません。",
  MEDIA_INSPECTION_FAILED: "素材の情報を取得できませんでした。",
  MEDIA_LIMIT_EXCEEDED: "素材の長さまたは寸法が上限を超えています。",
  PREVIEW_INPUT_INVALID: "プレビューを生成できません。",
  RENDER_INPUT_INVALID: "レンダー入力を確認してください。",
  INTERNAL_ERROR: "予期しないエラーが発生しました。",
  DATABASE_BUSY: "データベースが混雑しています。少し待って再試行してください。",
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
