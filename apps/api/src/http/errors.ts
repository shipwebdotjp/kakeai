import type { ErrorEnvelope } from "@kakeai/contracts";

export type ErrorCode = ErrorEnvelope["error"]["code"];

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  MALFORMED_JSON: "リクエストのJSONを解釈できませんでした。",
  LOCAL_ACCESS_DENIED: "このアクセスは許可されていません。",
  RESOURCE_NOT_FOUND: "指定されたリソースが見つかりません。",
  ASSET_PROCESSING: "素材を取り込み中です。完了後に再試行してください。",
  ASSET_IN_USE: "この素材は使用中のため削除できません。",
  WORK_HAS_CHILDREN: "子作品があるため削除できません。",
  LANGUAGE_EDITION_EXISTS: "この言語版は既に存在します。",
  LAST_LANGUAGE_EDITION: "作品には少なくとも1つの言語版が必要です。",
  LANGUAGE_EDITION_JOB_RUNNING: "実行中のジョブがあるため言語版を削除できません。",
  CURRENT_SCRIPT_VERSION_DELETE: "現在版は削除できません。",
  SCRIPT_VERSION_JOB_RUNNING: "実行中のジョブがあるため版を削除できません。",
  JOB_NOT_CANCELLABLE: "このジョブはキャンセルできません。",
  FILE_TOO_LARGE: "ファイルサイズが上限を超えています。",
  UNSUPPORTED_MEDIA_TYPE: "対応していないファイル形式です。",
  VALIDATION_ERROR: "入力内容を確認してください。",
  ASSET_NOT_FOUND: "指定された素材が見つかりません。",
  ASSET_UNAVAILABLE: "素材ファイルを利用できません。",
  COMPOSITION_UNAVAILABLE: "参照先のCompositionVersionを利用できません。",
  MEDIA_INSPECTION_FAILED: "素材の情報を取得できませんでした。",
  MEDIA_LIMIT_EXCEEDED: "素材の長さまたは寸法が上限を超えています。",
  PREVIEW_INPUT_INVALID: "プレビューを生成できません。",
  RENDER_INPUT_INVALID: "レンダー入力を確認してください。",
  THUMBNAIL_INPUT_INVALID: "サムネイルを生成できません。",
  VOICE_PROFILE_IN_USE: "この声プロファイルは使用中のため削除できません。",
  FACE_SET_IN_USE: "この表情セットは使用中のため削除できません。",
  FACE_SET_VERSION_CONFLICT: "他の更新と改訂版番号が競合しました。再試行してください。",
  TTS_INPUT_INVALID: "音声生成の入力を確認してください。",
  TTS_ENGINE_UNAVAILABLE: "音声エンジンに接続できません。起動を確認してください。",
  INVALID_STATE: "現在の状態では操作を実行できません。",
  THEME_DEFINITION_INVALID: "テーマ定義が無効です。",
  STYLE_KIT_MODIFIED: "Style Kitが変更されています。",
  INVALID_OPERATION: "この操作は許可されていません。",
  EXPORT_TARGET_EXISTS: "同名のファイルまたはディレクトリが既に存在します。別のファイル名を指定してください。",
  EXPORT_FAILED: "ファイルを書き出せませんでした。再試行してください。",
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
