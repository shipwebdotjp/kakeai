import { z } from "zod";
import { idSchema } from "../content/primitives";
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
import {
  MAX_NESTED_VISUAL_DEPTH,
  fitSchema,
  focalPointSchema,
  nestedMediaVisualSchema,
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
  | { kind: "nestedMedia"; key: string; label: string; assetKinds: readonly AssetKindName[]; optional?: boolean }
  | { kind: "text"; key: string; label: string }
  | { kind: "optionalText"; key: string; label: string }
  | { kind: "select"; key: string; label: string; options: readonly { value: string; label: string }[]; optional?: boolean }
  | { kind: "color"; key: string; label: string; optional?: boolean }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number; optional?: boolean }
  | { kind: "boolean"; key: string; label: string }
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
  { value: "cover", label: "cover" },
  { value: "contain", label: "contain" },
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

export const textRoleSchema = z.enum(["title", "subtitle", "heading", "body", "closing"]);
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
  decoration: z
    .strictObject({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      outline: z.boolean().optional(),
      shadow: z.boolean().optional(),
    })
    .optional(),
});

const TEXT_ROLE_OPTIONS = [
  { value: "body", label: "本文" },
  { value: "heading", label: "見出し" },
  { value: "title", label: "タイトル" },
  { value: "subtitle", label: "サブタイトル" },
  { value: "closing", label: "結びの文言" },
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
  display: { label: "テキスト", description: "見出し・本文などのテキスト", category: "text" },
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
});

const mediaFullBleedV1: VisualTemplateDefinition = {
  id: "media.full-bleed",
  version: 1,
  inputSchema: mediaFullBleedInputSchema,
  layers: ["background"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "背景（全面）", description: "画像・動画を全面に敷く", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS },
    { kind: "select", key: "fit", label: "fit", options: FIT_OPTIONS },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = mediaFullBleedInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [{ assetId: parsed.data.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  },
};

export const mediaCardInputSchema = z.strictObject({
  assetId: idSchema,
  heading: z.string(),
  caption: z.string().optional(),
  focalPoint: focalPointSchema.optional(),
});

const mediaCardV1: VisualTemplateDefinition = {
  id: "media.card",
  version: 1,
  inputSchema: mediaCardInputSchema,
  layers: ["card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "カード", description: "画像・動画を見出し付きカードで表示", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS },
    { kind: "text", key: "heading", label: "見出し" },
    { kind: "optionalText", key: "caption", label: "補足文" },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = mediaCardInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [{ assetId: parsed.data.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  },
};

export const characterStandingV1InputSchema = z.strictObject({
  characterId: idSchema,
  appearanceId: idSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().positive(),
});

const characterStandingV1: VisualTemplateDefinition = {
  id: "character.standing",
  version: 1,
  inputSchema: characterStandingV1InputSchema,
  layers: ["standing"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "立ち絵（旧）", description: "保存済み版の描画用", category: "character" },
  collectAssetRefs: () => [],
};

export const standingSideSchema = z.enum(["left", "right"]);

export const characterStandingV2InputSchema = z.strictObject({
  characterId: idSchema,
  appearanceId: idSchema,
  side: standingSideSchema,
  scale: z.number().positive(),
});

const characterStandingV2: VisualTemplateDefinition = {
  id: "character.standing",
  version: 2,
  inputSchema: characterStandingV2InputSchema,
  layers: ["standing"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "立ち絵", description: "左右1体ずつ立ち絵を表示", category: "character" },
  collectAssetRefs: () => [],
};

export const deviceFrameInputSchema = z.strictObject({
  screen: nestedVisualSchema,
  frame: z.enum(["laptop", "phone"]),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export const deviceFrameV2InputSchema = z.strictObject({
  screen: nestedVisualSchema,
  frame: z.enum(["laptop", "phone"]),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  animation: animationSpecSchema.optional(),
});

const DEVICE_FRAME_DISPLAY: TemplateDisplay = {
  label: "デバイスフレーム",
  description: "端末枠内に画像・動画を表示するコンポジション",
  category: "composition",
};

const DEVICE_FRAME_FIELDS: readonly TemplateFieldSpec[] = [
  { kind: "nestedMedia", key: "screen", label: "画面", assetKinds: MEDIA_KINDS },
  { kind: "select", key: "frame", label: "フレーム", options: DEVICE_FRAME_OPTIONS },
  { kind: "color", key: "backgroundColor", label: "背景色" },
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
  display: { ...DEVICE_FRAME_DISPLAY, label: "デバイスフレーム（旧）" },
  inputFields: DEVICE_FRAME_FIELDS,
  collectAssetRefs: (input, path, depth = 0) =>
    collectDeviceFrameRefs(deviceFrameInputSchema, input, path, depth),
};

const sceneDeviceFrameV2: VisualTemplateDefinition = {
  id: "scene.device-frame",
  version: 2,
  inputSchema: deviceFrameV2InputSchema,
  layers: ["background", "card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: DEVICE_FRAME_DISPLAY,
  inputFields: [
    ...DEVICE_FRAME_FIELDS,
    { kind: "animation", key: "animation", label: "画面の登場アニメーション" },
  ],
  collectAssetRefs: (input, path, depth = 0) =>
    collectDeviceFrameRefs(deviceFrameV2InputSchema, input, path, depth),
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

export const visualTemplateDefinitions: readonly VisualTemplateDefinition[] = [
  textBlockV1,
  mediaFullBleedV1,
  mediaCardV1,
  characterStandingV1,
  characterStandingV2,
  sceneDeviceFrameV1,
  sceneDeviceFrameV2,
  sceneSiteMockupV1,
];

export { textBlockV1, mediaFullBleedV1, mediaCardV1 };
export { characterStandingV1, characterStandingV2, sceneDeviceFrameV1, sceneDeviceFrameV2 };
export { sceneSiteMockupV1 };

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
  const definition = getVisualTemplate(node.template.id, node.template.version);
  if (!definition) {
    return [];
  }
  return definition.collectAssetRefs(node.input, [...path, "input"], depth + 1);
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
