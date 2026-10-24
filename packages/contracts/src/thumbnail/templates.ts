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

function headlineTextSchema() {
  return richTextStringSchema(HEADLINE_MARKS);
}

const SUBJECT_SIDE_OPTIONS = [
  { value: "right", label: "右" },
  { value: "left", label: "左" },
] as const;

export const thumbnailCutoutHeroInputSchema = z.strictObject({
  headline: headlineTextSchema(),
  subline: headlineTextSchema().optional(),
  backgroundAssetId: idSchema,
  backgroundFocalPoint: focalPointSchema.optional(),
  backgroundZoom: mediaZoomSchema.optional(),
  foregroundAssetId: idSchema,
  subjectSide: z.enum(["left", "right"]).default("right"),
  flipForeground: z.boolean().default(false),
  subjectScale: z.number().min(0.6).max(1.5).default(1),
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
      kind: "number",
      key: "subjectScale",
      label: "被写体の大きさ（未指定は1）",
      min: 0.6,
      max: 1.5,
      step: 0.05,
      optional: true,
    },
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
