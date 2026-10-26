import type { AssetKindName } from "../content/asset-reference";

export const MEDIA_KINDS = ["image", "video"] as const satisfies readonly AssetKindName[];

/**
 * Shared line-trigger placeholder for template examples. The ids are
 * placeholders like the other example ids (`<assetId>`); an agent replaces
 * them with real ids before saving.
 */
export const EXAMPLE_LINE_TRIGGER = {
  kind: "lines",
  startLineId: "<startLineId>",
  endLineId: "<endLineId>",
} as const;

export const TONE_OPTIONS = [
  { value: "primary", label: "プライマリ" },
  { value: "secondary", label: "セカンダリ" },
  { value: "tertiary", label: "ターシャリ" },
  { value: "success", label: "成功" },
  { value: "warning", label: "警告" },
  { value: "error", label: "エラー" },
  { value: "info", label: "情報" },
] as const;
