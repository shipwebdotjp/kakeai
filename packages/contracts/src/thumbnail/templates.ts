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
  /** UI defaults for optional inputs, merged into new and existing candidates. */
  uiDefaults?: Readonly<Record<string, unknown>>;
  collectAssetRefs: (input: unknown, path: (string | number)[]) => AssetReference[];
}

const THUMBNAIL_MEDIA_KINDS: readonly AssetKindName[] = ["image"];

const HEADLINE_MARKS = ["bold", "italic", "accent", "outline"] as const;

function headlineTextSchema() {
  return richTextStringSchema(HEADLINE_MARKS);
}

const SUBJECT_SIDE_OPTIONS = [
  { value: "right", label: "右" },
  { value: "left", label: "左" },
] as const;

export const THUMBNAIL_SUBJECT_ANCHOR_VALUES = [
  "bottom-center",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

export const thumbnailSubjectAnchorSchema = z.enum(THUMBNAIL_SUBJECT_ANCHOR_VALUES);
export type ThumbnailSubjectAnchor = z.infer<typeof thumbnailSubjectAnchorSchema>;

const SUBJECT_ANCHOR_OPTIONS = [
  { value: "bottom-center", label: "下端中央（既定）" },
  { value: "center", label: "中央" },
  { value: "top-left", label: "左上" },
  { value: "top-right", label: "右上" },
  { value: "bottom-left", label: "左下" },
  { value: "bottom-right", label: "右下" },
] as const;

/** Single source for both the schema defaults and the editor's UI defaults. */
export const THUMBNAIL_CUTOUT_HERO_DEFAULTS = {
  subjectSide: "right",
  flipForeground: false,
  subjectAnchor: "bottom-center",
  subjectScale: 1,
  textWidth: 50,
  wrapText: true,
} as const;

export const thumbnailCutoutHeroInputSchema = z.strictObject({
  headline: headlineTextSchema(),
  subline: headlineTextSchema().optional(),
  backgroundAssetId: idSchema,
  backgroundFocalPoint: focalPointSchema.optional(),
  backgroundZoom: mediaZoomSchema.optional(),
  foregroundAssetId: idSchema,
  subjectSide: z.enum(["left", "right"]).default(THUMBNAIL_CUTOUT_HERO_DEFAULTS.subjectSide),
  flipForeground: z.boolean().default(THUMBNAIL_CUTOUT_HERO_DEFAULTS.flipForeground),
  subjectAnchor: thumbnailSubjectAnchorSchema.default(
    THUMBNAIL_CUTOUT_HERO_DEFAULTS.subjectAnchor,
  ),
  subjectScale: z
    .number()
    .min(0.5)
    .max(1.8)
    .default(THUMBNAIL_CUTOUT_HERO_DEFAULTS.subjectScale),
  textWidth: z
    .number()
    .min(30)
    .max(100)
    .default(THUMBNAIL_CUTOUT_HERO_DEFAULTS.textWidth),
  wrapText: z.boolean().default(THUMBNAIL_CUTOUT_HERO_DEFAULTS.wrapText),
});
export type ThumbnailCutoutHeroInput = z.infer<typeof thumbnailCutoutHeroInputSchema>;

const cutoutHeroV1: ThumbnailTemplateDefinition = {
  id: "thumbnail.cutout-hero",
  version: 1,
  inputSchema: thumbnailCutoutHeroInputSchema,
  display: {
    label: "切り抜きヒーロー",
    description: "背景写真に透過の被写体を重ね、反対側の下部に大きな見出しを置く",
    category: "thumbnail",
  },
  uiDefaults: THUMBNAIL_CUTOUT_HERO_DEFAULTS,
  inputFields: [
    { kind: "richText", key: "headline", label: "見出し", marks: HEADLINE_MARKS },
    { kind: "richText", key: "subline", label: "補足文", marks: HEADLINE_MARKS, optional: true },
    { kind: "media", key: "backgroundAssetId", label: "背景写真", assetKinds: THUMBNAIL_MEDIA_KINDS },
    {
      kind: "mediaCrop",
      key: "backgroundFocalPoint",
      label: "背景の切り出し位置",
      zoomKey: "backgroundZoom",
    },
    {
      kind: "media",
      key: "foregroundAssetId",
      label: "前景の切り抜き画像（透過PNG・WebP）",
      assetKinds: THUMBNAIL_MEDIA_KINDS,
    },
    { kind: "select", key: "subjectSide", label: "被写体の位置", options: SUBJECT_SIDE_OPTIONS },
    { kind: "boolean", key: "flipForeground", label: "被写体を左右反転" },
    {
      kind: "select",
      key: "subjectAnchor",
      label: "拡大の基準点",
      options: SUBJECT_ANCHOR_OPTIONS,
    },
    {
      kind: "number",
      key: "subjectScale",
      label: "被写体の大きさ",
      min: 0.5,
      max: 1.8,
      step: 0.05,
      optional: true,
    },
    {
      kind: "number",
      key: "textWidth",
      label: "文字ブロックの幅（%）",
      min: 30,
      max: 100,
      step: 1,
      optional: true,
    },
    { kind: "boolean", key: "wrapText", label: "文字を折り返す" },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = thumbnailCutoutHeroInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [
      {
        assetId: parsed.data.backgroundAssetId,
        allowedKinds: THUMBNAIL_MEDIA_KINDS,
        path: [...path, "backgroundAssetId"],
      },
      {
        assetId: parsed.data.foregroundAssetId,
        allowedKinds: THUMBNAIL_MEDIA_KINDS,
        path: [...path, "foregroundAssetId"],
      },
    ];
  },
};

export const thumbnailTemplateDefinitions: readonly ThumbnailTemplateDefinition[] = [
  cutoutHeroV1,
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
