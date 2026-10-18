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
import { tableToneSchema } from "../content/tone";
import {
  appearEffectSchema,
  cueEffectSchema,
  emphasizeEffectSchema,
  lineTriggerSchema,
  numericEffectSchema,
  valueEffectSchema,
} from "../content/cue-effect";
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
import type { LineReference } from "../content/cue-effect";

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
  | { kind: "decimal"; key: string; label: string; min?: number; max?: number; optional?: boolean }
  | { kind: "mediaCrop"; key: string; label: string; zoomKey?: string }
  | { kind: "boolean"; key: string; label: string }
  | { kind: "grid"; key: string; label: string; maxColumns: number; maxRows: number; dataKind: "table" | "chart" }
  | { kind: "flow"; key: string; label: string; maxNodes: number; maxEdges: number }
  | { kind: "effects"; key: string; label: string; variant: "table" | "chart" | "flow" | "stat" | "quote" | "chat" }
  | { kind: "calloutItems"; key: string; label: string }
  | { kind: "messages"; key: string; label: string; maxMessages: number }
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
  collectLineRefs?: (input: unknown, path: (string | number)[]) => LineReference[];
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

export const mediaFullBleedInputSchema = z
  .strictObject({
    assetId: idSchema,
    fit: fitSchema,
    focalPoint: focalPointSchema.optional(),
    zoom: mediaZoomSchema.optional(),
    loop: z.boolean().optional(),
    trimStartMs: nonNegativeInt.optional(),
    trimEndMs: nonNegativeInt.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.trimStartMs !== undefined &&
      value.trimEndMs !== undefined &&
      value.trimStartMs >= value.trimEndMs
    ) {
      ctx.addIssue({
        code: "custom",
        message: "動画トリムは開始(ms) < 終了(ms) で指定してください",
        path: ["trimEndMs"],
      });
    }
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
    { kind: "number", key: "trimStartMs", label: "トリム開始(ms)", min: 0, step: 1, optional: true },
    { kind: "number", key: "trimEndMs", label: "トリム終了(ms)", min: 0, step: 1, optional: true },
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
  statusBar: z.boolean().default(true),
  keyboard: z.boolean().default(true),
});

const DEVICE_FRAME_FIELDS: readonly TemplateFieldSpec[] = [
  { kind: "nestedMedia", key: "screen", label: "画面", assetKinds: MEDIA_KINDS, allowComposition: true },
  { kind: "select", key: "frame", label: "フレーム", options: DEVICE_FRAME_OPTIONS },
  { kind: "color", key: "backgroundColor", label: "背景色" },
  { kind: "animation", key: "animation", label: "画面の登場アニメーション" },
  { kind: "boolean", key: "statusBar", label: "ステータスバーを表示（スマートフォン）" },
  { kind: "boolean", key: "keyboard", label: "キーボードを表示（ノートPC）" },
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

export const tableColumnTypeSchema = z.enum(["text", "number"]);
export type TableColumnType = z.infer<typeof tableColumnTypeSchema>;

export const tableCellAlignSchema = z.enum(["left", "center", "right"]);
export type TableCellAlign = z.infer<typeof tableCellAlignSchema>;

export const tableNumberFormatSchema = z.enum(["integer", "decimal", "percent", "currency"]);
export type TableNumberFormat = z.infer<typeof tableNumberFormatSchema>;

export const tableStylePresetSchema = z.enum(["clean", "striped", "bordered"]);
export type TableStylePreset = z.infer<typeof tableStylePresetSchema>;

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
  })
  .superRefine((data, ctx) => {
    refineFigureData(data, ctx);
  });
export type TableData = z.infer<typeof tableDataSchema>;

export const tableStyleSchema = z.strictObject({
  preset: tableStylePresetSchema.default("clean"),
  zebra: z.boolean().optional(),
  headerAccent: themeAccentTokenSchema.optional(),
});
export type TableStyle = z.infer<typeof tableStyleSchema>;

export const tableEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("row"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("cell"), row: nonNegativeInt, key: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("rows") }),
  z.strictObject({ kind: z.literal("columns") }),
]);
export type TableEffectTarget = z.infer<typeof tableEffectTargetSchema>;

export const tableEffectSchema = z.strictObject({
  target: tableEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: numericEffectSchema,
});
export type TableEffect = z.infer<typeof tableEffectSchema>;

export const tableEffectsSchema = z.array(tableEffectSchema).max(32);

export const tableSimpleInputSchema = z
  .strictObject({
    caption: z.string().optional(),
    data: tableDataSchema,
    style: tableStyleSchema.optional(),
    effects: tableEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const known = new Set(input.data.columns.map((column) => column.key));
    (input.effects ?? []).forEach((entry, index) => {
      if (
        entry.target.kind === "row" &&
        entry.target.index >= input.data.rows.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果の行番号が行数を超えています: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
      if (entry.target.kind === "cell") {
        if (entry.target.row >= input.data.rows.length) {
          ctx.addIssue({
            code: "custom",
            message: `効果の行番号が行数を超えています: ${entry.target.row}`,
            path: ["effects", index, "target", "row"],
          });
        }
        if (!known.has(entry.target.key)) {
          ctx.addIssue({
            code: "custom",
            message: `効果の列キーが未定義です: ${entry.target.key}`,
            path: ["effects", index, "target", "key"],
          });
        }
      }
      if (entry.effect.kind === "value") {
        const target = entry.target;
        if (target.kind !== "cell") {
          ctx.addIssue({
            code: "custom",
            message: "数値のカウントはセルを対象にしてください",
            path: ["effects", index, "target"],
          });
        } else {
          const column = input.data.columns.find((item) => item.key === target.key);
          if (column !== undefined && column.type !== "number") {
            ctx.addIssue({
              code: "custom",
              message: `数値のカウントは数値列にだけ指定できます: ${column.key}`,
              path: ["effects", index, "target", "key"],
            });
          }
        }
      }
    });
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

const tableSimpleV1: VisualTemplateDefinition = {
  id: "table.simple",
  version: 1,
  inputSchema: tableSimpleInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "表", description: "列定義・行・セルを持つ表", category: "data" },
  inputFields: [
    { kind: "optionalText", key: "caption", label: "見出し" },
    {
      kind: "grid",
      key: "data",
      label: "表データ",
      maxColumns: TABLE_MAX_COLUMNS,
      maxRows: TABLE_MAX_ROWS,
      dataKind: "table",
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
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "table" },
  ],
  collectAssetRefs: () => [],
  collectLineRefs: (input, path) => {
    const parsed = tableEffectsSchema.safeParse(readTriggerField(input, "effects") ?? []);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.flatMap((entry, index) =>
      collectTriggerLineRefs(entry.trigger, [...path, "effects", index, "trigger"]),
    );
  },
};

export const CHART_MAX_CATEGORIES = 8;
export const CHART_MAX_SERIES = 4;
export const CHART_MAX_COLUMNS = CHART_MAX_SERIES + 1;

export const chartOrientationSchema = z.enum(["vertical", "horizontal"]);
export type ChartOrientation = z.infer<typeof chartOrientationSchema>;

export const chartColorBySchema = z.enum(["series", "category"]);
export type ChartColorBy = z.infer<typeof chartColorBySchema>;

export const chartStylePresetSchema = z.enum(["clean", "grid"]);
export type ChartStylePreset = z.infer<typeof chartStylePresetSchema>;

export const chartAppearPresetSchema = z.enum(["grow", "bounce", "fade"]);
export type ChartAppearPreset = z.infer<typeof chartAppearPresetSchema>;
export const CHART_APPEAR_PRESETS = chartAppearPresetSchema.options;

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

export const chartEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("category"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("series"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("bars") }),
]);
export type ChartEffectTarget = z.infer<typeof chartEffectTargetSchema>;

export const chartAppearEffectSchema = z.strictObject({
  kind: z.literal("appear"),
  preset: chartAppearPresetSchema,
  durationMs: nonNegativeInt,
  staggerMs: nonNegativeInt.optional(),
});
export type ChartAppearEffect = z.infer<typeof chartAppearEffectSchema>;

export const chartCueEffectSchema = z.discriminatedUnion("kind", [
  chartAppearEffectSchema,
  emphasizeEffectSchema,
  valueEffectSchema,
]);
export type ChartCueEffect = z.infer<typeof chartCueEffectSchema>;

export const chartEffectSchema = z.strictObject({
  target: chartEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: chartCueEffectSchema,
});
export type ChartEffect = z.infer<typeof chartEffectSchema>;

export const chartEffectsSchema = z.array(chartEffectSchema).max(32);

export const chartBarInputSchema = z
  .strictObject({
    title: z.string().optional(),
    data: chartDataSchema,
    style: chartStyleSchema.optional(),
    effects: chartEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const seriesCount = Math.max(0, input.data.columns.length - 1);
    (input.effects ?? []).forEach((entry, index) => {
      if (
        entry.target.kind === "category" &&
        entry.target.index >= input.data.rows.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果のカテゴリ番号が範囲外です: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
      if (entry.target.kind === "series" && entry.target.index >= seriesCount) {
        ctx.addIssue({
          code: "custom",
          message: `効果の系列番号が範囲外です: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
      if (entry.effect.kind === "emphasize" && entry.effect.style === "background") {
        ctx.addIssue({
          code: "custom",
          message: "棒グラフの強調は frame か spotlight を指定してください",
          path: ["effects", index, "effect", "style"],
        });
      }
      if (entry.effect.kind === "value" && (input.style?.valueLabels ?? true) === false) {
        ctx.addIssue({
          code: "custom",
          message: "数値のカウントには値ラベルを有効にしてください",
          path: ["effects", index, "effect"],
        });
      }
    });
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
      dataKind: "chart",
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
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "chart" },
  ],
  collectAssetRefs: () => [],
  collectLineRefs: (input, path) => {
    const parsed = chartEffectsSchema.safeParse(readTriggerField(input, "effects") ?? []);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.flatMap((entry, index) =>
      collectTriggerLineRefs(entry.trigger, [...path, "effects", index, "trigger"]),
    );
  },
};

export const LIST_CALLOUT_MAX_ITEMS = 8;

export const listCalloutItemSchema = z
  .strictObject({
    text: z.string(),
    trigger: lineTriggerSchema.optional(),
    effect: cueEffectSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if ((item.trigger === undefined) !== (item.effect === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "trigger と effect は同時に指定してください",
        path: ["trigger"],
      });
    }
  });
export type ListCalloutItem = z.infer<typeof listCalloutItemSchema>;

export const listCalloutItemsSchema = z
  .array(listCalloutItemSchema)
  .min(1)
  .max(LIST_CALLOUT_MAX_ITEMS);

export const listCalloutAppearSchema = z.strictObject({
  trigger: lineTriggerSchema,
  effect: appearEffectSchema,
});
export type ListCalloutAppear = z.infer<typeof listCalloutAppearSchema>;

export const listCalloutInputSchema = z.strictObject({
  title: z.string().optional(),
  items: listCalloutItemsSchema,
  appear: listCalloutAppearSchema.optional(),
});
export type ListCalloutInput = z.infer<typeof listCalloutInputSchema>;

function collectTriggerLineRefs(
  trigger: unknown,
  path: (string | number)[],
): LineReference[] {
  const parsed = lineTriggerSchema.safeParse(trigger);
  if (!parsed.success || parsed.data.kind !== "lines") {
    return [];
  }
  return [
    { lineId: parsed.data.startLineId, path: [...path, "startLineId"] },
    { lineId: parsed.data.endLineId, path: [...path, "endLineId"] },
  ];
}

function readTriggerField(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  return (input as Record<string, unknown>)[key];
}

const listCalloutV1: VisualTemplateDefinition = {
  id: "list.callout",
  version: 1,
  inputSchema: listCalloutInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "ポイント",
    description: "セリフに同期して強調する箇条書き",
    category: "text",
  },
  inputFields: [
    { kind: "optionalText", key: "title", label: "見出し" },
    { kind: "calloutItems", key: "items", label: "ポイント" },
  ],
  collectAssetRefs: () => [],
  collectLineRefs: (input, path) => {
    const items = listCalloutItemsSchema.safeParse(readTriggerField(input, "items") ?? []);
    const refs = items.success
      ? items.data.flatMap((item, index) =>
          collectTriggerLineRefs(item.trigger, [...path, "items", index, "trigger"]),
        )
      : [];
    const appear = listCalloutAppearSchema.safeParse(readTriggerField(input, "appear"));
    if (appear.success) {
      refs.push(...collectTriggerLineRefs(appear.data.trigger, [...path, "appear", "trigger"]));
    }
    return refs;
  },
};

export const FLOW_MAX_NODES = 8;
export const FLOW_MAX_EDGES = 16;

export const flowOrientationSchema = z.enum(["vertical", "horizontal"]);
export type FlowOrientation = z.infer<typeof flowOrientationSchema>;

export const flowStylePresetSchema = z.enum(["clean", "boxed"]);
export type FlowStylePreset = z.infer<typeof flowStylePresetSchema>;

export const flowNodeSchema = z.strictObject({
  label: z.string().min(1).max(64),
  caption: z.string().max(64).optional(),
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.strictObject({
  from: nonNegativeInt,
  to: nonNegativeInt,
  label: z.string().max(32).optional(),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowDiagramSchema = z
  .strictObject({
    nodes: z.array(flowNodeSchema).min(1).max(FLOW_MAX_NODES),
    edges: z.array(flowEdgeSchema).max(FLOW_MAX_EDGES),
  })
  .superRefine((diagram, ctx) => {
    diagram.edges.forEach((edge, index) => {
      if (edge.from >= diagram.nodes.length) {
        ctx.addIssue({
          code: "custom",
          message: `辺の from がノード数を超えています: ${edge.from}`,
          path: ["edges", index, "from"],
        });
      }
      if (edge.to >= diagram.nodes.length) {
        ctx.addIssue({
          code: "custom",
          message: `辺の to がノード数を超えています: ${edge.to}`,
          path: ["edges", index, "to"],
        });
      }
      if (edge.from === edge.to) {
        ctx.addIssue({
          code: "custom",
          message: "自己ループの辺は指定できません",
          path: ["edges", index, "to"],
        });
      }
    });
  });
export type FlowDiagram = z.infer<typeof flowDiagramSchema>;

export const flowStyleSchema = z.strictObject({
  orientation: flowOrientationSchema.default("horizontal"),
  preset: flowStylePresetSchema.default("clean"),
});
export type FlowStyle = z.infer<typeof flowStyleSchema>;

export const flowEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("node"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("nodes") }),
]);
export type FlowEffectTarget = z.infer<typeof flowEffectTargetSchema>;

export const flowEffectSchema = z.strictObject({
  target: flowEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: cueEffectSchema,
});
export type FlowEffect = z.infer<typeof flowEffectSchema>;

export const flowEffectsSchema = z.array(flowEffectSchema).max(32);

export const flowDiagramInputSchema = z
  .strictObject({
    title: z.string().optional(),
    diagram: flowDiagramSchema,
    style: flowStyleSchema.optional(),
    effects: flowEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    (input.effects ?? []).forEach((entry, index) => {
      if (
        entry.target.kind === "node" &&
        entry.target.index >= input.diagram.nodes.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果のノード番号がノード数を超えています: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
    });
  });
export type FlowDiagramInput = z.infer<typeof flowDiagramInputSchema>;

const FLOW_ORIENTATION_OPTIONS = [
  { value: "horizontal", label: "横" },
  { value: "vertical", label: "縦" },
] as const;

const FLOW_STYLE_PRESET_OPTIONS = [
  { value: "clean", label: "シンプル" },
  { value: "boxed", label: "枠付き" },
] as const;

const flowDiagramV1: VisualTemplateDefinition = {
  id: "flow.diagram",
  version: 1,
  inputSchema: flowDiagramInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "フロー図", description: "ノードと辺で工程・流れを表す図", category: "data" },
  inputFields: [
    { kind: "optionalText", key: "title", label: "タイトル" },
    {
      kind: "flow",
      key: "diagram",
      label: "ノードと辺",
      maxNodes: FLOW_MAX_NODES,
      maxEdges: FLOW_MAX_EDGES,
    },
    { kind: "select", key: "style.orientation", label: "向き", options: FLOW_ORIENTATION_OPTIONS },
    { kind: "select", key: "style.preset", label: "スタイル", options: FLOW_STYLE_PRESET_OPTIONS },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "flow" },
  ],
  collectAssetRefs: () => [],
  collectLineRefs: (input, path) => {
    const parsed = flowEffectsSchema.safeParse(readTriggerField(input, "effects") ?? []);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.flatMap((entry, index) =>
      collectTriggerLineRefs(entry.trigger, [...path, "effects", index, "trigger"]),
    );
  },
};

export const STAT_FORMATS = ["integer", "decimal", "percent", "currency"] as const;
export const statFormatSchema = z.enum(STAT_FORMATS);
export type StatFormat = z.infer<typeof statFormatSchema>;

export const statStylePresetSchema = z.enum(["plain", "card"]);
export type StatStylePreset = z.infer<typeof statStylePresetSchema>;

export const statStyleSchema = z.strictObject({
  tone: tableToneSchema.default("primary"),
  preset: statStylePresetSchema.default("plain"),
});
export type StatStyle = z.infer<typeof statStyleSchema>;

export const statEffectSchema = z.strictObject({
  trigger: lineTriggerSchema,
  effect: numericEffectSchema,
});
export type StatEffect = z.infer<typeof statEffectSchema>;

export const statEffectsSchema = z.array(statEffectSchema).max(16);

export const statInputSchema = z.strictObject({
  value: z.number().finite(),
  label: z.string().optional(),
  caption: z.string().optional(),
  format: statFormatSchema.default("integer"),
  style: statStyleSchema.optional(),
  effects: statEffectsSchema.optional(),
});
export type StatInput = z.infer<typeof statInputSchema>;

const STAT_FORMAT_OPTIONS = [
  { value: "integer", label: "整数" },
  { value: "decimal", label: "小数" },
  { value: "percent", label: "パーセント" },
  { value: "currency", label: "金額" },
] as const;

const STAT_TONE_OPTIONS = [
  { value: "primary", label: "プライマリ" },
  { value: "secondary", label: "セカンダリ" },
  { value: "tertiary", label: "ターシャリ" },
  { value: "success", label: "成功" },
  { value: "warning", label: "警告" },
  { value: "error", label: "エラー" },
  { value: "info", label: "情報" },
] as const;

const STAT_STYLE_PRESET_OPTIONS = [
  { value: "plain", label: "シンプル" },
  { value: "card", label: "カード" },
] as const;

const statV1: VisualTemplateDefinition = {
  id: "stat",
  version: 1,
  inputSchema: statInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "数値", description: "大きな数値とラベルの1点強調", category: "data" },
  inputFields: [
    { kind: "decimal", key: "value", label: "数値" },
    { kind: "optionalText", key: "label", label: "ラベル" },
    { kind: "optionalText", key: "caption", label: "補足" },
    { kind: "select", key: "format", label: "書式", options: STAT_FORMAT_OPTIONS },
    { kind: "select", key: "style.tone", label: "色", options: STAT_TONE_OPTIONS },
    { kind: "select", key: "style.preset", label: "スタイル", options: STAT_STYLE_PRESET_OPTIONS },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "stat" },
  ],
  collectAssetRefs: () => [],
  collectLineRefs: (input, path) => {
    const parsed = statEffectsSchema.safeParse(readTriggerField(input, "effects") ?? []);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.flatMap((entry, index) =>
      collectTriggerLineRefs(entry.trigger, [...path, "effects", index, "trigger"]),
    );
  },
};

export const QUOTE_STYLE_PRESETS = ["plain", "card"] as const;
export const quoteStylePresetSchema = z.enum(QUOTE_STYLE_PRESETS);
export type QuoteStylePreset = z.infer<typeof quoteStylePresetSchema>;

export const quoteStyleSchema = z.strictObject({
  tone: tableToneSchema.default("primary"),
  preset: quoteStylePresetSchema.default("plain"),
});
export type QuoteStyle = z.infer<typeof quoteStyleSchema>;

export const quoteEffectSchema = z.strictObject({
  trigger: lineTriggerSchema,
  effect: cueEffectSchema,
});
export type QuoteEffect = z.infer<typeof quoteEffectSchema>;

export const quoteEffectsSchema = z.array(quoteEffectSchema).max(16);

export const quoteInputSchema = z.strictObject({
  quote: z.string(),
  author: z.string().optional(),
  source: z.string().optional(),
  style: quoteStyleSchema.optional(),
  effects: quoteEffectsSchema.optional(),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

const QUOTE_STYLE_PRESET_OPTIONS = [
  { value: "plain", label: "シンプル" },
  { value: "card", label: "カード" },
] as const;

const quoteV1: VisualTemplateDefinition = {
  id: "quote",
  version: 1,
  inputSchema: quoteInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "引用", description: "著者・出典付きの引用カード", category: "text" },
  inputFields: [
    { kind: "text", key: "quote", label: "引用" },
    { kind: "optionalText", key: "author", label: "著者" },
    { kind: "optionalText", key: "source", label: "出典" },
    { kind: "select", key: "style.tone", label: "色", options: STAT_TONE_OPTIONS },
    { kind: "select", key: "style.preset", label: "スタイル", options: QUOTE_STYLE_PRESET_OPTIONS },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "quote" },
  ],
  collectAssetRefs: () => [],
  collectLineRefs: (input, path) => {
    const parsed = quoteEffectsSchema.safeParse(readTriggerField(input, "effects") ?? []);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.flatMap((entry, index) =>
      collectTriggerLineRefs(entry.trigger, [...path, "effects", index, "trigger"]),
    );
  },
};

export const CHAT_MAX_MESSAGES = 6;

export const chatSideSchema = z.enum(["left", "right"]);
export type ChatSide = z.infer<typeof chatSideSchema>;

export const chatFrameSchema = z.enum(["none", "phone", "laptop", "desktop"]);
export type ChatFrame = z.infer<typeof chatFrameSchema>;

export const chatMessageSchema = z.strictObject({
  name: z.string().optional(),
  icon: nestedMediaVisualSchema.optional(),
  side: chatSideSchema.optional(),
  body: z.string(),
  time: z.string().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatMessagesSchema = z
  .array(chatMessageSchema)
  .min(1)
  .max(CHAT_MAX_MESSAGES);

export const chatEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("message"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("messages") }),
]);
export type ChatEffectTarget = z.infer<typeof chatEffectTargetSchema>;

export const chatEffectSchema = z.strictObject({
  target: chatEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: cueEffectSchema,
});
export type ChatEffect = z.infer<typeof chatEffectSchema>;

export const chatEffectsSchema = z.array(chatEffectSchema).max(32);

export const chatThreadInputSchema = z
  .strictObject({
    title: z.string().optional(),
    frame: chatFrameSchema.default("phone"),
    statusBar: z.boolean().default(true),
    statusTime: z.string().optional(),
    keyboard: z.boolean().default(true),
    messages: chatMessagesSchema,
    effects: chatEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    (input.effects ?? []).forEach((entry, index) => {
      if (entry.target.kind === "message" && entry.target.index >= input.messages.length) {
        ctx.addIssue({
          code: "custom",
          message: `効果のメッセージ番号が件数を超えています: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
    });
  });
export type ChatThreadInput = z.infer<typeof chatThreadInputSchema>;

const CHAT_FRAME_OPTIONS = [
  { value: "phone", label: "スマートフォン" },
  { value: "laptop", label: "ノートPC" },
  { value: "desktop", label: "デスクトップ" },
  { value: "none", label: "枠なし（全面）" },
] as const;

const chatThreadV1: VisualTemplateDefinition = {
  id: "chat.thread",
  version: 1,
  inputSchema: chatThreadInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "チャット",
    description: "会話を吹き出しで並べるチャット画面",
    category: "text",
  },
  inputFields: [
    { kind: "optionalText", key: "title", label: "チャットのタイトル" },
    { kind: "select", key: "frame", label: "端末の枠", options: CHAT_FRAME_OPTIONS },
    { kind: "optionalText", key: "statusTime", label: "ステータスバーの時刻" },
    { kind: "boolean", key: "statusBar", label: "ステータスバーを表示" },
    { kind: "boolean", key: "keyboard", label: "キーボードを表示（ノートPC）" },
    { kind: "messages", key: "messages", label: "メッセージ", maxMessages: CHAT_MAX_MESSAGES },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "chat" },
  ],
  collectAssetRefs: (input, path, depth = 0) => {
    const parsed = chatThreadInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.messages.flatMap((message, index) =>
      message.icon === undefined
        ? []
        : collectNestedAssetRefs(message.icon, [...path, "messages", index, "icon"], depth),
    );
  },
  collectLineRefs: (input, path) => {
    const parsed = chatEffectsSchema.safeParse(readTriggerField(input, "effects") ?? []);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.flatMap((entry, index) =>
      collectTriggerLineRefs(entry.trigger, [...path, "effects", index, "trigger"]),
    );
  },
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
  listCalloutV1,
  flowDiagramV1,
  statV1,
  quoteV1,
  chatThreadV1,
];

export { textBlockV1, mediaFullBleedV1, mediaCardV1 };
export { characterStandingV1, sceneDeviceFrameV1 };
export { sceneSiteMockupV1 };
export { tableSimpleV1 };
export { chartBarV1 };
export { listCalloutV1 };
export { flowDiagramV1 };
export { statV1 };
export { quoteV1 };
export { chatThreadV1 };

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
