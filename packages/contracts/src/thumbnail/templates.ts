import { z } from "zod";
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

const LAYOUT_OPTIONS = [
  { value: "photo-left", label: "写真を左" },
  { value: "photo-right", label: "写真を右" },
] as const;

const TONE_OPTIONS = [
  { value: "accent", label: "アクセント色" },
  { value: "canvas", label: "背景色" },
] as const;

export const thumbnailHeadlinePhotoInputSchema = z.strictObject({
  headline: z.string(),
  subline: z.string().optional(),
  assetId: idSchema,
  focalPoint: focalPointSchema.optional(),
  zoom: mediaZoomSchema.optional(),
  layout: z.enum(["photo-left", "photo-right"]).default("photo-left"),
  tone: z.enum(["accent", "canvas"]).default("accent"),
  badge: z.string().optional(),
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
    { kind: "text", key: "headline", label: "見出し" },
    { kind: "optionalText", key: "subline", label: "補足文" },
    { kind: "media", key: "assetId", label: "写真", assetKinds: THUMBNAIL_MEDIA_KINDS },
    { kind: "mediaCrop", key: "focalPoint", label: "切り出し位置", zoomKey: "zoom" },
    { kind: "select", key: "layout", label: "写真の位置", options: LAYOUT_OPTIONS },
    { kind: "select", key: "tone", label: "背景", options: TONE_OPTIONS },
    { kind: "optionalText", key: "badge", label: "バッジ" },
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
  headline: z.string(),
  subline: z.string().optional(),
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
    { kind: "text", key: "headline", label: "見出し" },
    { kind: "optionalText", key: "subline", label: "補足文" },
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

export const thumbnailTextInputSchema = z.strictObject({
  headline: z.string(),
  subline: z.string().optional(),
  tone: z.enum(["accent", "canvas"]).default("accent"),
  badge: z.string().optional(),
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
    { kind: "text", key: "headline", label: "見出し" },
    { kind: "optionalText", key: "subline", label: "補足文" },
    { kind: "select", key: "tone", label: "背景", options: TONE_OPTIONS },
    { kind: "optionalText", key: "badge", label: "バッジ" },
  ],
  collectAssetRefs: () => [],
};

export const thumbnailTemplateDefinitions: readonly ThumbnailTemplateDefinition[] = [
  headlinePhotoV1,
  photoCoverV1,
  textV1,
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
