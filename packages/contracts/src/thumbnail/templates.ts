import { z } from "zod";
import { richTextStringSchema } from "../content/rich-text";
import { idSchema } from "../content/primitives";
import { focalPointSchema, mediaZoomSchema } from "../content/nested";
import type { AssetKindName, AssetReference } from "../content/asset-reference";
import type { TemplateDisplay, TemplateFieldSpec } from "../templates";
import type { ThumbnailDocument } from "./document";

export interface ThumbnailTemplateDefinition {
  id: string;
  version: number;
  inputSchema: z.ZodTypeAny;
  display: TemplateDisplay;
  inputFields?: readonly TemplateFieldSpec[];
  collectAssetRefs: (input: unknown, path: (string | number)[]) => AssetReference[];
}

const THUMBNAIL_MEDIA_KINDS: readonly AssetKindName[] = ["image"];

const HEADLINE_MARKS = ["bold", "italic", "accent", "outline"] as const;
const BADGE_MARKS = ["bold", "italic", "outline"] as const;

function headlineTextSchema() {
  return richTextStringSchema(HEADLINE_MARKS);
}

const LAYOUT_OPTIONS = [
  { value: "photo-left", label: "写真を左" },
  { value: "photo-right", label: "写真を右" },
] as const;

const TONE_OPTIONS = [
  { value: "accent", label: "アクセント色" },
  { value: "canvas", label: "背景色" },
] as const;

export const thumbnailHeadlinePhotoInputSchema = z.strictObject({
  headline: headlineTextSchema(),
  subline: headlineTextSchema().optional(),
  assetId: idSchema,
  focalPoint: focalPointSchema.optional(),
  zoom: mediaZoomSchema.optional(),
  layout: z.enum(["photo-left", "photo-right"]).default("photo-left"),
  tone: z.enum(["accent", "canvas"]).default("accent"),
  badge: richTextStringSchema(BADGE_MARKS).optional(),
});
export type ThumbnailHeadlinePhotoInput = z.infer<typeof thumbnailHeadlinePhotoInputSchema>;

const headlinePhotoV1: ThumbnailTemplateDefinition = {
  id: "thumbnail.headline-photo",
  version: 1,
  inputSchema: thumbnailHeadlinePhotoInputSchema,
  display: {
    label: "見出し＋写真",
    description: "大きな見出しと写真を左右に並べる",
    category: "thumbnail",
  },
  inputFields: [
    { kind: "richText", key: "headline", label: "見出し", marks: HEADLINE_MARKS },
    { kind: "richText", key: "subline", label: "補足文", marks: HEADLINE_MARKS, optional: true },
    { kind: "media", key: "assetId", label: "写真", assetKinds: THUMBNAIL_MEDIA_KINDS },
    { kind: "mediaCrop", key: "focalPoint", label: "切り出し位置", zoomKey: "zoom" },
    { kind: "select", key: "layout", label: "写真の位置", options: LAYOUT_OPTIONS },
    { kind: "select", key: "tone", label: "背景", options: TONE_OPTIONS },
    { kind: "richText", key: "badge", label: "バッジ", marks: BADGE_MARKS, optional: true },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = thumbnailHeadlinePhotoInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [
      { assetId: parsed.data.assetId, allowedKinds: THUMBNAIL_MEDIA_KINDS, path: [...path, "assetId"] },
    ];
  },
};

export const thumbnailPhotoCoverInputSchema = z.strictObject({
  headline: headlineTextSchema(),
  subline: headlineTextSchema().optional(),
  assetId: idSchema,
  focalPoint: focalPointSchema.optional(),
  zoom: mediaZoomSchema.optional(),
});
export type ThumbnailPhotoCoverInput = z.infer<typeof thumbnailPhotoCoverInputSchema>;

const photoCoverV1: ThumbnailTemplateDefinition = {
  id: "thumbnail.photo-cover",
  version: 1,
  inputSchema: thumbnailPhotoCoverInputSchema,
  display: {
    label: "写真全面＋見出し",
    description: "全面の写真に暗幕と見出しを重ねる",
    category: "thumbnail",
  },
  inputFields: [
    { kind: "richText", key: "headline", label: "見出し", marks: HEADLINE_MARKS },
    { kind: "richText", key: "subline", label: "補足文", marks: HEADLINE_MARKS, optional: true },
    { kind: "media", key: "assetId", label: "写真", assetKinds: THUMBNAIL_MEDIA_KINDS },
    { kind: "mediaCrop", key: "focalPoint", label: "切り出し位置", zoomKey: "zoom" },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = thumbnailPhotoCoverInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [
      { assetId: parsed.data.assetId, allowedKinds: THUMBNAIL_MEDIA_KINDS, path: [...path, "assetId"] },
    ];
  },
};

export const THUMBNAIL_LAYERED_STACK_VALUES = [
  "text-character-main",
  "character-text-main",
  "character-main-text",
  "main-character-text",
] as const;

export const thumbnailLayeredStackSchema = z.enum(THUMBNAIL_LAYERED_STACK_VALUES);

export const thumbnailLayeredPositionSchema = z.enum(["left", "center", "right"]);

export const thumbnailLayeredInputSchema = z.strictObject({
  headline: headlineTextSchema(),
  subline: headlineTextSchema().optional(),
  backgroundAssetId: idSchema.optional(),
  backgroundFocalPoint: focalPointSchema.optional(),
  backgroundZoom: mediaZoomSchema.optional(),
  mainAssetId: idSchema.optional(),
  mainFocalPoint: focalPointSchema.optional(),
  mainZoom: mediaZoomSchema.optional(),
  characterAssetId: idSchema.optional(),
  characterPosition: thumbnailLayeredPositionSchema.default("right"),
  characterScale: z.number().min(0.5).max(2).optional(),
  stack: thumbnailLayeredStackSchema.default("text-character-main"),
});
export type ThumbnailLayeredInput = z.infer<typeof thumbnailLayeredInputSchema>;

const STACK_OPTIONS = [
  { value: "text-character-main", label: "テキスト ＞ キャラ ＞ メイン" },
  { value: "character-text-main", label: "キャラ ＞ テキスト ＞ メイン" },
  { value: "character-main-text", label: "キャラ ＞ メイン ＞ テキスト" },
  { value: "main-character-text", label: "メイン ＞ キャラ ＞ テキスト" },
] as const;

const CHARACTER_POSITION_OPTIONS = [
  { value: "left", label: "左" },
  { value: "center", label: "中央" },
  { value: "right", label: "右" },
] as const;

const layeredV1: ThumbnailTemplateDefinition = {
  id: "thumbnail.layered",
  version: 1,
  inputSchema: thumbnailLayeredInputSchema,
  display: {
    label: "重ね合わせ（背景＋メイン＋キャラ）",
    description: "背景・メインビジュアル・キャラクターを重ね、見出しを上・補足文を下に置く",
    category: "thumbnail",
  },
  inputFields: [
    { kind: "richText", key: "headline", label: "見出し", marks: HEADLINE_MARKS },
    { kind: "richText", key: "subline", label: "補足文", marks: HEADLINE_MARKS, optional: true },
    { kind: "media", key: "backgroundAssetId", label: "背景画像", assetKinds: THUMBNAIL_MEDIA_KINDS },
    {
      kind: "mediaCrop",
      key: "backgroundFocalPoint",
      label: "背景の切り出し位置",
      zoomKey: "backgroundZoom",
    },
    { kind: "media", key: "mainAssetId", label: "メインビジュアル", assetKinds: THUMBNAIL_MEDIA_KINDS },
    {
      kind: "mediaCrop",
      key: "mainFocalPoint",
      label: "メインビジュアルの切り出し位置",
      zoomKey: "mainZoom",
    },
    { kind: "media", key: "characterAssetId", label: "キャラクター画像", assetKinds: THUMBNAIL_MEDIA_KINDS },
    { kind: "select", key: "characterPosition", label: "キャラクターの位置", options: CHARACTER_POSITION_OPTIONS },
    {
      kind: "number",
      key: "characterScale",
      label: "キャラクターの拡大",
      min: 0.5,
      max: 2,
      step: 0.05,
      optional: true,
    },
    { kind: "select", key: "stack", label: "重なり順", options: STACK_OPTIONS },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = thumbnailLayeredInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    const references: AssetReference[] = [];
    const push = (assetId: string | undefined, key: string): void => {
      if (assetId !== undefined) {
        references.push({ assetId, allowedKinds: THUMBNAIL_MEDIA_KINDS, path: [...path, key] });
      }
    };
    push(parsed.data.backgroundAssetId, "backgroundAssetId");
    push(parsed.data.mainAssetId, "mainAssetId");
    push(parsed.data.characterAssetId, "characterAssetId");
    return references;
  },
};

export const thumbnailTextInputSchema = z.strictObject({
  headline: headlineTextSchema(),
  subline: headlineTextSchema().optional(),
  tone: z.enum(["accent", "canvas"]).default("accent"),
  badge: richTextStringSchema(BADGE_MARKS).optional(),
});
export type ThumbnailTextInput = z.infer<typeof thumbnailTextInputSchema>;

const textV1: ThumbnailTemplateDefinition = {
  id: "thumbnail.text",
  version: 1,
  inputSchema: thumbnailTextInputSchema,
  display: {
    label: "文字のみ",
    description: "背景色に大きな文字だけを置く",
    category: "thumbnail",
  },
  inputFields: [
    { kind: "richText", key: "headline", label: "見出し", marks: HEADLINE_MARKS },
    { kind: "richText", key: "subline", label: "補足文", marks: HEADLINE_MARKS, optional: true },
    { kind: "select", key: "tone", label: "背景", options: TONE_OPTIONS },
    { kind: "richText", key: "badge", label: "バッジ", marks: BADGE_MARKS, optional: true },
  ],
  collectAssetRefs: () => [],
};

export const thumbnailTemplateDefinitions: readonly ThumbnailTemplateDefinition[] = [
  headlinePhotoV1,
  photoCoverV1,
  textV1,
  layeredV1,
];

export const thumbnailTemplateRegistry: ReadonlyMap<string, ThumbnailTemplateDefinition> = new Map(
  thumbnailTemplateDefinitions.map((definition) => [
    `${definition.id}@${definition.version}`,
    definition,
  ]),
);

export function getThumbnailTemplate(
  id: string,
  version: number,
): ThumbnailTemplateDefinition | undefined {
  return thumbnailTemplateRegistry.get(`${id}@${version}`);
}

export interface ThumbnailTemplateCatalogEntry extends TemplateDisplay {
  id: string;
  version: number;
}

export function listThumbnailTemplateCatalog(): ThumbnailTemplateCatalogEntry[] {
  return thumbnailTemplateDefinitions.map((definition) => ({
    id: definition.id,
    version: definition.version,
    ...definition.display,
  }));
}

export function collectThumbnailAssetRefs(document: ThumbnailDocument): AssetReference[] {
  const definition = getThumbnailTemplate(document.template.id, document.template.version);
  if (definition === undefined) {
    return [];
  }
  return definition.collectAssetRefs(document.input, ["input"]);
}
