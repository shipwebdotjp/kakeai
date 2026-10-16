import { z } from "zod";
import { idSchema, nonNegativeInt } from "../content/primitives";
import {
  DEFAULT_TRANSITION_POLICY,
  type CueLayer,
  type TransitionPolicy,
} from "../content/layers";
import {
  DEFAULT_ANIMATION_POLICY,
  animationSpecSchema,
  type AnimationPolicy,
} from "../content/animation";
import { fontFaceSpecSchema, textSurfaceSchema, themeAccentTokenSchema } from "../content/theme";
import {
  MAX_NESTED_VISUAL_DEPTH,
  fitSchema,
  focalPointSchema,
  mediaZoomSchema,
  nestedCompositionVisualSchema,
  nestedMediaVisualSchema,
  nestedTemplateVisualSchema,
  nestedVisualSchema,
  type NestedVisual,
} from "../content/nested";
import type { AssetKindName, AssetReference } from "../content/asset-reference";

export const textAnchorSchema = z.enum(["left", "center", "right"]);

export interface TemplateDisplay {
  label: string;
  description: string;
  category: string;
}

export type TemplateFieldSpec =
  | { kind: "media"; key: string; label: string; assetKinds: readonly AssetKindName[] }
  | { kind: "nestedMedia"; key: string; label: string; assetKinds: readonly AssetKindName[]; optional?: boolean; allowComposition?: boolean }
  | { kind: "text"; key: string; label: string }
  | { kind: "optionalText"; key: string; label: string }
  | { kind: "select"; key: string; label: string; options: readonly { value: string; label: string }[]; optional?: boolean }
  | { kind: "color"; key: string; label: string; optional?: boolean }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number; optional?: boolean }
  | { kind: "mediaCrop"; key: string; label: string; zoomKey?: string }
  | { kind: "boolean"; key: string; label: string }
  | { kind: "grid"; key: string; label: string; maxColumns: number; maxRows: number; emphasis?: boolean }
  | { kind: "animation"; key: string; label: string };

export interface VisualTemplateDefinition {
  id: string;
  version: number;
  inputSchema: z.ZodTypeAny;
  layers: readonly CueLayer[];
  transitionPolicy: TransitionPolicy;
  animationPolicy: AnimationPolicy;
  display: TemplateDisplay;
  inputFields?: readonly TemplateFieldSpec[];
  collectAssetRefs: (input: unknown, path: (string | number)[], depth?: number) => AssetReference[];
}

const MEDIA_KINDS = ["image", "video"] as const;

const FIT_OPTIONS = [
  { value: "cover", label: "全体を覆う（切り抜き）" },
  { value: "contain", label: "全体を収める" },
] as const;

const ANCHOR_OPTIONS = [
  { value: "left", label: "左" },
  { value: "center", label: "中央" },
  { value: "right", label: "右" },
] as const;

const DEVICE_FRAME_OPTIONS = [
  { value: "laptop", label: "ラップトップ" },
  { value: "phone", label: "スマートフォン" },
] as const;

export const textRoleSchema = z.enum(["title", "subtitle", "heading", "body", "closing", "label"]);
export type TextRole = z.infer<typeof textRoleSchema>;

export const textVerticalAlignSchema = z.enum(["top", "middle", "bottom"]);
export const textFontSchema = z.enum(["sans", "serif", "mono"]);

export const textBlockInputSchema = z.strictObject({
  text: z.string(),
  role: textRoleSchema,
  anchor: textAnchorSchema.optional(),
  verticalAlign: textVerticalAlignSchema.optional(),
  font: textFontSchema.optional(),
  fontSize: z.number().int().min(8).max(240).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  lineHeight: z.number().min(1).max(3).optional(),
  decoration: z
    .strictObject({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      outline: z.boolean().optional(),
      shadow: z.boolean().optional(),
    })
    .optional(),
  fontFace: fontFaceSpecSchema.optional(),
  surface: textSurfaceSchema.optional(),
});
export type TextBlockInput = z.infer<typeof textBlockInputSchema>;

const TEXT_ROLE_OPTIONS = [
  { value: "body", label: "本文" },
  { value: "heading", label: "見出し" },
  { value: "title", label: "タイトル" },
  { value: "subtitle", label: "サブタイトル" },
  { value: "closing", label: "結びの文言" },
  { value: "label", label: "ラベル" },
] as const;

const VERTICAL_ALIGN_OPTIONS = [
  { value: "top", label: "上" },
  { value: "middle", label: "中央" },
  { value: "bottom", label: "下" },
] as const;

const FONT_OPTIONS = [
  { value: "sans", label: "ゴシック" },
  { value: "serif", label: "明朝" },
  { value: "mono", label: "等幅" },
] as const;

const textBlockV1: VisualTemplateDefinition = {
  id: "text.block",
  version: 1,
  inputSchema: textBlockInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "テキスト", description: "見出し・本文・ラベルなどのテキスト", category: "text" },
  inputFields: [
    { kind: "text", key: "text", label: "テキスト" },
    { kind: "select", key: "role", label: "役割", options: TEXT_ROLE_OPTIONS },
    { kind: "select", key: "anchor", label: "左右位置", options: ANCHOR_OPTIONS, optional: true },
    {
      kind: "select",
      key: "verticalAlign",
      label: "上下位置",
      options: VERTICAL_ALIGN_OPTIONS,
      optional: true,
    },
    { kind: "select", key: "font", label: "フォント", options: FONT_OPTIONS, optional: true },
    { kind: "number", key: "fontSize", label: "フォントサイズ(px)", min: 8, max: 240, step: 1, optional: true },
    { kind: "color", key: "color", label: "色", optional: true },
    { kind: "boolean", key: "decoration.bold", label: "太字" },
    { kind: "boolean", key: "decoration.italic", label: "斜体" },
    { kind: "boolean", key: "decoration.outline", label: "縁取り" },
    { kind: "boolean", key: "decoration.shadow", label: "影" },
  ],
  collectAssetRefs: () => [],
};

export const mediaFullBleedInputSchema = z.strictObject({
  assetId: idSchema,
  fit: fitSchema,
  focalPoint: focalPointSchema.optional(),
  zoom: mediaZoomSchema.optional(),
  loop: z.boolean().optional(),
});
export type MediaFullBleedInput = z.infer<typeof mediaFullBleedInputSchema>;

const mediaFullBleedV1: VisualTemplateDefinition = {
  id: "media.full-bleed",
  version: 1,
  inputSchema: mediaFullBleedInputSchema,
  layers: ["background"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "背景（全面）", description: "画像・動画を全面に敷く（動画はループ可）", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS },
    { kind: "select", key: "fit", label: "表示方法", options: FIT_OPTIONS },
    { kind: "mediaCrop", key: "focalPoint", label: "焦点位置", zoomKey: "zoom" },
    { kind: "boolean", key: "loop", label: "動画をループ再生" },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = mediaFullBleedInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [{ assetId: parsed.data.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  },
};

export const mediaCardAspectRatioSchema = z.enum(["16:9", "4:3", "1:1", "3:4", "9:16"]);
export type MediaCardAspectRatio = z.infer<typeof mediaCardAspectRatioSchema>;

const MEDIA_CARD_ASPECT_RATIO_OPTIONS = mediaCardAspectRatioSchema.options.map(
  (value) => ({ value, label: value }),
);

export const mediaCardInputSchema = z.strictObject({
  assetId: idSchema,
  aspectRatio: mediaCardAspectRatioSchema.default("16:9"),
  heading: z.string(),
  caption: z.string().optional(),
  focalPoint: focalPointSchema.optional(),
  zoom: mediaZoomSchema.optional(),
  loop: z.boolean().optional(),
});
export type MediaCardInput = z.infer<typeof mediaCardInputSchema>;

const mediaCardV1: VisualTemplateDefinition = {
  id: "media.card",
  version: 1,
  inputSchema: mediaCardInputSchema,
  layers: ["card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "カード", description: "画像・動画を見出し付きカードで表示（動画はループ可）", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS },
    {
      kind: "select",
      key: "aspectRatio",
      label: "アスペクト比",
      options: MEDIA_CARD_ASPECT_RATIO_OPTIONS,
    },
    { kind: "text", key: "heading", label: "見出し" },
    { kind: "optionalText", key: "caption", label: "補足文" },
    { kind: "mediaCrop", key: "focalPoint", label: "焦点位置", zoomKey: "zoom" },
    { kind: "boolean", key: "loop", label: "動画をループ再生" },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = mediaCardInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [{ assetId: parsed.data.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  },
};

export const standingSideSchema = z.enum(["left", "right"]);

export const characterStandingV1InputSchema = z.strictObject({
  characterId: idSchema,
  appearanceId: idSchema,
  side: standingSideSchema,
  scale: z.number().positive(),
});

const characterStandingV1: VisualTemplateDefinition = {
  id: "character.standing",
  version: 1,
  inputSchema: characterStandingV1InputSchema,
  layers: ["standing"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "立ち絵", description: "左右1体ずつ立ち絵を表示し表情を切り替える", category: "character" },
  collectAssetRefs: () => [],
};

export const deviceFrameInputSchema = z.strictObject({
  screen: nestedVisualSchema,
  frame: z.enum(["laptop", "phone"]),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  animation: animationSpecSchema.optional(),
});

const DEVICE_FRAME_FIELDS: readonly TemplateFieldSpec[] = [
  { kind: "nestedMedia", key: "screen", label: "画面", assetKinds: MEDIA_KINDS, allowComposition: true },
  { kind: "select", key: "frame", label: "フレーム", options: DEVICE_FRAME_OPTIONS },
  { kind: "color", key: "backgroundColor", label: "背景色" },
  { kind: "animation", key: "animation", label: "画面の登場アニメーション" },
];

function collectDeviceFrameRefs(
  schema: z.ZodTypeAny,
  input: unknown,
  path: (string | number)[],
  depth: number,
): AssetReference[] {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return [];
  }
  return collectNestedAssetRefs(
    (parsed.data as { screen: NestedVisual }).screen,
    [...path, "screen"],
    depth,
  );
}

const sceneDeviceFrameV1: VisualTemplateDefinition = {
  id: "scene.device-frame",
  version: 1,
  inputSchema: deviceFrameInputSchema,
  layers: ["background", "card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "デバイスフレーム",
    description: "端末枠内に画像・動画を表示するコンポジション",
    category: "composition",
  },
  inputFields: DEVICE_FRAME_FIELDS,
  collectAssetRefs: (input, path, depth = 0) =>
    collectDeviceFrameRefs(deviceFrameInputSchema, input, path, depth),
};

export const siteMockupVariantSchema = z.enum([
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "github",
  "qiita",
  "zenn",
  "note",
  "stackoverflow",
  "hackernews",
  "reddit",
  "pixiv",
  "niconico",
  "browser",
]);
export type SiteMockupVariant = z.infer<typeof siteMockupVariantSchema>;

const SITE_MOCKUP_VARIANT_OPTIONS = [
  { value: "x", label: "X（旧Twitter）" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "github", label: "GitHub" },
  { value: "qiita", label: "Qiita" },
  { value: "zenn", label: "Zenn" },
  { value: "note", label: "note" },
  { value: "stackoverflow", label: "Stack Overflow" },
  { value: "hackernews", label: "Hacker News" },
  { value: "reddit", label: "Reddit" },
  { value: "pixiv", label: "pixiv" },
  { value: "niconico", label: "ニコニコ動画" },
  { value: "browser", label: "ブラウザ" },
] as const;

const THEME_OPTIONS = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
] as const;

export const siteMockupInputSchema = z.strictObject({
  variant: siteMockupVariantSchema,
  screen: nestedMediaVisualSchema,
  theme: z.enum(["light", "dark"]).optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  url: z.string().optional(),
  caption: z.string().optional(),
  logo: nestedMediaVisualSchema.optional(),
  animation: animationSpecSchema.optional(),
});

const sceneSiteMockupV1: VisualTemplateDefinition = {
  id: "scene.site-mockup",
  version: 1,
  inputSchema: siteMockupInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "サイトモックアップ",
    description: "有名サイトやブラウザのガワに画像・動画を収める",
    category: "composition",
  },
  inputFields: [
    { kind: "select", key: "variant", label: "種類", options: SITE_MOCKUP_VARIANT_OPTIONS },
    { kind: "nestedMedia", key: "screen", label: "画面", assetKinds: MEDIA_KINDS },
    { kind: "select", key: "theme", label: "テーマ", options: THEME_OPTIONS, optional: true },
    { kind: "optionalText", key: "name", label: "表示名" },
    { kind: "optionalText", key: "handle", label: "ハンドル" },
    { kind: "optionalText", key: "url", label: "URL" },
    { kind: "optionalText", key: "caption", label: "本文" },
    { kind: "nestedMedia", key: "logo", label: "ロゴ（任意）", assetKinds: MEDIA_KINDS, optional: true },
    { kind: "animation", key: "animation", label: "画面の登場アニメーション" },
  ],
  collectAssetRefs: (input, path, depth = 0) => {
    const parsed = siteMockupInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    const references = collectNestedAssetRefs(parsed.data.screen, [...path, "screen"], depth);
    if (parsed.data.logo !== undefined) {
      references.push(...collectNestedAssetRefs(parsed.data.logo, [...path, "logo"], depth));
    }
    return references;
  },
};

export const compositionFullBleedInputSchema = z.strictObject({
  compositionVersionId: idSchema,
});

export const compositionFullBleedV1: VisualTemplateDefinition = {
  id: "composition.full-bleed",
  version: 1,
  inputSchema: compositionFullBleedInputSchema,
  layers: ["background"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "コンポジション背景（全面）",
    description: "Composition Libraryの完全画面モーションを配置",
    category: "composition",
  },
  inputFields: [
    { kind: "text", key: "compositionVersionId", label: "Composition バージョン" },
  ],
  collectAssetRefs: () => [],
};

export const TABLE_MAX_COLUMNS = 8;
export const TABLE_MAX_ROWS = 12;
export const TABLE_REVEAL_STAGGER_MAX_MS = 2000;
export const TABLE_REVEAL_DEFAULT_STAGGER_MS = 150;

export const tableColumnTypeSchema = z.enum(["text", "number"]);
export type TableColumnType = z.infer<typeof tableColumnTypeSchema>;

export const tableCellAlignSchema = z.enum(["left", "center", "right"]);
export type TableCellAlign = z.infer<typeof tableCellAlignSchema>;

export const tableNumberFormatSchema = z.enum(["integer", "decimal", "percent", "currency"]);
export type TableNumberFormat = z.infer<typeof tableNumberFormatSchema>;

export const tableToneSchema = z.enum([
  "primary",
  "secondary",
  "tertiary",
  "success",
  "warning",
  "error",
  "info",
]);
export type TableTone = z.infer<typeof tableToneSchema>;

export const tableStylePresetSchema = z.enum(["clean", "striped", "bordered"]);
export type TableStylePreset = z.infer<typeof tableStylePresetSchema>;

export const tableRevealModeSchema = z.enum(["none", "rows", "columns"]);
export type TableRevealMode = z.infer<typeof tableRevealModeSchema>;

export const tableRevealPresetSchema = z.enum(["fade", "slide-up", "scale-in"]);
export type TableRevealPreset = z.infer<typeof tableRevealPresetSchema>;

export const tableColumnSchema = z.strictObject({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  label: z.string(),
  type: tableColumnTypeSchema,
  align: tableCellAlignSchema.optional(),
  format: tableNumberFormatSchema.optional(),
});
export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableRowSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string(), z.number()]),
);
export type TableRow = z.infer<typeof tableRowSchema>;

export const tableEmphasisSchema = z.strictObject({
  row: nonNegativeInt,
  key: z.string().min(1).max(64).optional(),
  tone: tableToneSchema,
});
export type TableEmphasis = z.infer<typeof tableEmphasisSchema>;

interface FigureData {
  columns: TableColumn[];
  rows: TableRow[];
}

function refineFigureData(data: FigureData, ctx: z.RefinementCtx): void {
  const keys = data.columns.map((column) => column.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", message: "列キーは一意にしてください", path: ["columns"] });
  }
  const known = new Set(keys);
  data.rows.forEach((row, rowIndex) => {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `未定義の列キーです: ${key}`,
          path: ["rows", rowIndex, key],
        });
      }
    }
  });
  for (const [columnIndex, column] of data.columns.entries()) {
    if (column.type === "text" && column.format !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `format は number 列だけが持てます: ${column.key}`,
        path: ["columns", columnIndex, "format"],
      });
    }
  }
}

export const tableDataSchema = z
  .strictObject({
    columns: z.array(tableColumnSchema).min(1).max(TABLE_MAX_COLUMNS),
    rows: z.array(tableRowSchema).max(TABLE_MAX_ROWS),
    emphasis: z.array(tableEmphasisSchema).optional(),
  })
  .superRefine((data, ctx) => {
    refineFigureData(data, ctx);
    const known = new Set(data.columns.map((column) => column.key));
    (data.emphasis ?? []).forEach((entry, entryIndex) => {
      if (entry.row >= data.rows.length) {
        ctx.addIssue({
          code: "custom",
          message: `強調の行番号が行数を超えています: ${entry.row}`,
          path: ["emphasis", entryIndex, "row"],
        });
      }
      if (entry.key !== undefined && !known.has(entry.key)) {
        ctx.addIssue({
          code: "custom",
          message: `強調の列キーが未定義です: ${entry.key}`,
          path: ["emphasis", entryIndex, "key"],
        });
      }
    });
  });
export type TableData = z.infer<typeof tableDataSchema>;

export const tableStyleSchema = z.strictObject({
  preset: tableStylePresetSchema.default("clean"),
  zebra: z.boolean().optional(),
  headerAccent: themeAccentTokenSchema.optional(),
});
export type TableStyle = z.infer<typeof tableStyleSchema>;

export const tableRevealSchema = z.strictObject({
  mode: tableRevealModeSchema.default("rows"),
  preset: tableRevealPresetSchema.default("fade"),
  durationMs: nonNegativeInt.max(DEFAULT_ANIMATION_POLICY.maxDurationMs).default(
    DEFAULT_ANIMATION_POLICY.defaultDurationMs,
  ),
  staggerMs: nonNegativeInt.max(TABLE_REVEAL_STAGGER_MAX_MS).default(TABLE_REVEAL_DEFAULT_STAGGER_MS),
});
export type TableReveal = z.infer<typeof tableRevealSchema>;

export const tableSimpleInputSchema = z.strictObject({
  caption: z.string().optional(),
  data: tableDataSchema,
  style: tableStyleSchema.optional(),
  reveal: tableRevealSchema.optional(),
});
export type TableSimpleInput = z.infer<typeof tableSimpleInputSchema>;

const TABLE_STYLE_PRESET_OPTIONS = [
  { value: "clean", label: "シンプル" },
  { value: "striped", label: "ストライプ" },
  { value: "bordered", label: "格子" },
] as const;

const TABLE_HEADER_ACCENT_OPTIONS = [
  { value: "primary", label: "プライマリ" },
  { value: "secondary", label: "セカンダリ" },
  { value: "tertiary", label: "ターシャリ" },
] as const;

const TABLE_REVEAL_MODE_OPTIONS = [
  { value: "rows", label: "行ごと" },
  { value: "columns", label: "列ごと" },
  { value: "none", label: "なし" },
] as const;

const TABLE_REVEAL_PRESET_OPTIONS = [
  { value: "fade", label: "フェード" },
  { value: "slide-up", label: "下から" },
  { value: "scale-in", label: "拡大" },
] as const;

const tableSimpleV1: VisualTemplateDefinition = {
  id: "table.simple",
  version: 1,
  inputSchema: tableSimpleInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "表", description: "列定義・行・強調セルを持つ表", category: "data" },
  inputFields: [
    { kind: "optionalText", key: "caption", label: "見出し" },
    {
      kind: "grid",
      key: "data",
      label: "表データ",
      maxColumns: TABLE_MAX_COLUMNS,
      maxRows: TABLE_MAX_ROWS,
      emphasis: true,
    },
    { kind: "select", key: "style.preset", label: "スタイル", options: TABLE_STYLE_PRESET_OPTIONS },
    {
      kind: "select",
      key: "style.headerAccent",
      label: "見出しの色",
      options: TABLE_HEADER_ACCENT_OPTIONS,
      optional: true,
    },
    { kind: "boolean", key: "style.zebra", label: "ゼブラ" },
    { kind: "select", key: "reveal.mode", label: "登場の仕方", options: TABLE_REVEAL_MODE_OPTIONS },
    { kind: "select", key: "reveal.preset", label: "登場のアニメーション", options: TABLE_REVEAL_PRESET_OPTIONS },
    {
      kind: "number",
      key: "reveal.durationMs",
      label: "登場の尺(ms)",
      min: 0,
      max: DEFAULT_ANIMATION_POLICY.maxDurationMs,
      step: 50,
    },
    {
      kind: "number",
      key: "reveal.staggerMs",
      label: "登場のずれ(ms)",
      min: 0,
      max: TABLE_REVEAL_STAGGER_MAX_MS,
      step: 10,
    },
  ],
  collectAssetRefs: () => [],
};

export const CHART_MAX_CATEGORIES = 8;
export const CHART_MAX_SERIES = 4;
export const CHART_MAX_COLUMNS = CHART_MAX_SERIES + 1;
export const CHART_REVEAL_STAGGER_MAX_MS = 2000;
export const CHART_REVEAL_DEFAULT_STAGGER_MS = 120;
export const CHART_REVEAL_DEFAULT_DURATION_MS = 600;

export const chartOrientationSchema = z.enum(["vertical", "horizontal"]);
export type ChartOrientation = z.infer<typeof chartOrientationSchema>;

export const chartColorBySchema = z.enum(["series", "category"]);
export type ChartColorBy = z.infer<typeof chartColorBySchema>;

export const chartStylePresetSchema = z.enum(["clean", "grid"]);
export type ChartStylePreset = z.infer<typeof chartStylePresetSchema>;

export const chartRevealModeSchema = z.enum(["bars", "none"]);
export type ChartRevealMode = z.infer<typeof chartRevealModeSchema>;

export const chartRevealPresetSchema = z.enum(["grow", "bounce", "fade"]);
export type ChartRevealPreset = z.infer<typeof chartRevealPresetSchema>;

export const chartDataSchema = z
  .strictObject({
    columns: z.array(tableColumnSchema).min(2).max(CHART_MAX_COLUMNS),
    rows: z.array(tableRowSchema).min(1).max(CHART_MAX_CATEGORIES),
  })
  .superRefine((data, ctx) => {
    refineFigureData(data, ctx);
    if (data.columns[0]?.type !== "text") {
      ctx.addIssue({
        code: "custom",
        message: "先頭の列はカテゴリ（文字列）にしてください",
        path: ["columns", 0, "type"],
      });
    }
    data.columns.slice(1).forEach((column, index) => {
      if (column.type !== "number") {
        ctx.addIssue({
          code: "custom",
          message: "2列目以降は系列（数値）にしてください",
          path: ["columns", index + 1, "type"],
        });
        return;
      }
      data.rows.forEach((row, rowIndex) => {
        const value = row[column.key];
        if (value === undefined) {
          return;
        }
        const numeric = typeof value === "number" ? value : Number(value);
        if (typeof value === "string" && value.trim() !== "" && !Number.isFinite(numeric)) {
          ctx.addIssue({
            code: "custom",
            message: `系列「${column.label}」の値は数値にしてください`,
            path: ["rows", rowIndex, column.key],
          });
        }
      });
    });
  });
export type ChartData = z.infer<typeof chartDataSchema>;

export const chartStyleSchema = z.strictObject({
  preset: chartStylePresetSchema.default("clean"),
  orientation: chartOrientationSchema.default("vertical"),
  valueLabels: z.boolean().default(true),
  colorBy: chartColorBySchema.optional(),
  axisUnit: z.string().max(8).optional(),
});
export type ChartStyle = z.infer<typeof chartStyleSchema>;

export const chartRevealSchema = z.strictObject({
  mode: chartRevealModeSchema.default("bars"),
  preset: chartRevealPresetSchema.default("grow"),
  durationMs: nonNegativeInt.max(DEFAULT_ANIMATION_POLICY.maxDurationMs).default(
    CHART_REVEAL_DEFAULT_DURATION_MS,
  ),
  staggerMs: nonNegativeInt.max(CHART_REVEAL_STAGGER_MAX_MS).default(
    CHART_REVEAL_DEFAULT_STAGGER_MS,
  ),
});
export type ChartReveal = z.infer<typeof chartRevealSchema>;

export const chartBarInputSchema = z.strictObject({
  title: z.string().optional(),
  data: chartDataSchema,
  style: chartStyleSchema.optional(),
  reveal: chartRevealSchema.optional(),
});
export type ChartBarInput = z.infer<typeof chartBarInputSchema>;

const CHART_STYLE_PRESET_OPTIONS = [
  { value: "clean", label: "シンプル" },
  { value: "grid", label: "目盛り線" },
] as const;

const CHART_ORIENTATION_OPTIONS = [
  { value: "vertical", label: "縦棒" },
  { value: "horizontal", label: "横棒" },
] as const;

const CHART_COLOR_BY_OPTIONS = [
  { value: "series", label: "系列ごと" },
  { value: "category", label: "カテゴリごと" },
] as const;

const CHART_REVEAL_MODE_OPTIONS = [
  { value: "bars", label: "棒ごと" },
  { value: "none", label: "なし" },
] as const;

const CHART_REVEAL_PRESET_OPTIONS = [
  { value: "grow", label: "伸ばす" },
  { value: "bounce", label: "弾ませる" },
  { value: "fade", label: "フェード" },
] as const;

const chartBarV1: VisualTemplateDefinition = {
  id: "chart.bar",
  version: 1,
  inputSchema: chartBarInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "棒グラフ", description: "カテゴリと系列を持つ棒グラフ", category: "data" },
  inputFields: [
    { kind: "optionalText", key: "title", label: "タイトル" },
    {
      kind: "grid",
      key: "data",
      label: "グラフデータ",
      maxColumns: CHART_MAX_COLUMNS,
      maxRows: CHART_MAX_CATEGORIES,
      emphasis: false,
    },
    { kind: "select", key: "style.preset", label: "目盛り線", options: CHART_STYLE_PRESET_OPTIONS },
    { kind: "select", key: "style.orientation", label: "向き", options: CHART_ORIENTATION_OPTIONS },
    {
      kind: "select",
      key: "style.colorBy",
      label: "色分け",
      options: CHART_COLOR_BY_OPTIONS,
      optional: true,
    },
    { kind: "optionalText", key: "style.axisUnit", label: "軸の単位" },
    { kind: "boolean", key: "style.valueLabels", label: "値ラベル" },
    { kind: "select", key: "reveal.mode", label: "登場の仕方", options: CHART_REVEAL_MODE_OPTIONS },
    { kind: "select", key: "reveal.preset", label: "登場のアニメーション", options: CHART_REVEAL_PRESET_OPTIONS },
    {
      kind: "number",
      key: "reveal.durationMs",
      label: "登場の尺(ms)",
      min: 0,
      max: DEFAULT_ANIMATION_POLICY.maxDurationMs,
      step: 50,
    },
    {
      kind: "number",
      key: "reveal.staggerMs",
      label: "登場のずれ(ms)",
      min: 0,
      max: CHART_REVEAL_STAGGER_MAX_MS,
      step: 10,
    },
  ],
  collectAssetRefs: () => [],
};

export const visualTemplateDefinitions: readonly VisualTemplateDefinition[] = [
  textBlockV1,
  mediaFullBleedV1,
  mediaCardV1,
  characterStandingV1,
  sceneDeviceFrameV1,
  sceneSiteMockupV1,
  compositionFullBleedV1,
  tableSimpleV1,
  chartBarV1,
];

export { textBlockV1, mediaFullBleedV1, mediaCardV1 };
export { characterStandingV1, sceneDeviceFrameV1 };
export { sceneSiteMockupV1 };
export { tableSimpleV1 };
export { chartBarV1 };

export const visualTemplateRegistry: ReadonlyMap<string, VisualTemplateDefinition> = new Map(
  visualTemplateDefinitions.map((definition) => [
    `${definition.id}@${definition.version}`,
    definition,
  ]),
);

export function getVisualTemplate(
  id: string,
  version: number,
): VisualTemplateDefinition | undefined {
  return visualTemplateRegistry.get(`${id}@${version}`);
}

export function getTemplateInputFields(
  id: string,
  version: number,
): readonly TemplateFieldSpec[] | undefined {
  return getVisualTemplate(id, version)?.inputFields;
}

export function isEditableTemplate(id: string, version: number): boolean {
  const fields = getTemplateInputFields(id, version);
  return fields !== undefined && fields.length > 0;
}

export function collectNestedAssetRefs(
  node: NestedVisual,
  path: (string | number)[],
  depth = 0,
): AssetReference[] {
  if (depth >= MAX_NESTED_VISUAL_DEPTH) {
    return [];
  }
  if (node.kind === "media") {
    return [{ assetId: node.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  }
  if (node.kind === "composition") {
    return [];
  }
  const definition = getVisualTemplate(node.template.id, node.template.version);
  if (!definition) {
    return [];
  }
  return definition.collectAssetRefs(node.input, [...path, "input"], depth + 1);
}

const MAX_COMPOSITION_REF_WALK_DEPTH = 64;

export function collectNestedCompositionVersionIds(
  value: unknown,
  depth = 0,
): string[] {
  if (depth > MAX_COMPOSITION_REF_WALK_DEPTH) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectNestedCompositionVersionIds(entry, depth + 1));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const composition = nestedCompositionVisualSchema.safeParse(value);
  if (composition.success) {
    return [composition.data.compositionVersionId];
  }
  const template = nestedTemplateVisualSchema.safeParse(value);
  if (template.success) {
    const definition = getVisualTemplate(template.data.template.id, template.data.template.version);
    if (definition === undefined) {
      return [];
    }
    const parsed = definition.inputSchema.safeParse(template.data.input);
    if (!parsed.success) {
      return [];
    }
    return collectNestedCompositionVersionIds(parsed.data, depth + 1);
  }
  return Object.values(value).flatMap((entry) =>
    collectNestedCompositionVersionIds(entry, depth + 1),
  );
}

export interface VisualTemplateCatalogEntry extends TemplateDisplay {
  id: string;
  version: number;
  layers: readonly CueLayer[];
  editable: boolean;
}

export function listVisualTemplateCatalog(): VisualTemplateCatalogEntry[] {
  return visualTemplateDefinitions.map((definition) => ({
    id: definition.id,
    version: definition.version,
    layers: definition.layers,
    editable: isEditableTemplate(definition.id, definition.version),
    ...definition.display,
  }));
}
