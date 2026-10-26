import { z } from "zod";
import { idSchema, nonNegativeInt } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { fitSchema, focalPointSchema, mediaZoomSchema } from "../content/nested";
import { videoPlaybackSchema } from "../content/video-playback";
import type { VisualTemplateDefinition } from "./shared";
import { MEDIA_KINDS } from "./common";

const FIT_OPTIONS = [
  { value: "cover", label: "全体を覆う（切り抜き）" },
  { value: "contain", label: "全体を収める" },
] as const;

export const mediaFullBleedInputSchema = z
  .strictObject({
    assetId: idSchema,
    fit: fitSchema,
    focalPoint: focalPointSchema.optional(),
    zoom: mediaZoomSchema.optional(),
    loop: z.boolean().optional(),
    trimStartMs: nonNegativeInt.optional(),
    trimEndMs: nonNegativeInt.optional(),
    videoPlayback: videoPlaybackSchema.optional(),
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
    if (
      value.videoPlayback !== undefined &&
      (value.loop === true || value.trimStartMs !== undefined || value.trimEndMs !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "セリフゲート再生はループ再生・トリムと併用できません",
        path: ["videoPlayback"],
      });
    }
  });
export type MediaFullBleedInput = z.infer<typeof mediaFullBleedInputSchema>;

export const mediaFullBleedV1: VisualTemplateDefinition = {
  id: "media.full-bleed",
  version: 1,
  inputSchema: mediaFullBleedInputSchema,
  layers: ["background"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "背景（全面）", description: "画像・動画を全面に敷く（動画はループ可）", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS, videoPlayback: true },
    { kind: "select", key: "fit", label: "表示方法", options: FIT_OPTIONS },
    { kind: "mediaCrop", key: "focalPoint", label: "焦点位置", zoomKey: "zoom" },
    { kind: "number", key: "trimStartMs", label: "トリム開始(ms)", min: 0, step: 1, optional: true },
    { kind: "number", key: "trimEndMs", label: "トリム終了(ms)", min: 0, step: 1, optional: true },
    { kind: "boolean", key: "loop", label: "動画をループ再生" },
  ],
  exampleInput: {
    assetId: "<assetId>",
    fit: "cover",
    focalPoint: { x: 0.5, y: 0.4 },
    zoom: 1.2,
  } satisfies z.input<typeof mediaFullBleedInputSchema>,
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

export const mediaCardInputSchema = z
  .strictObject({
    assetId: idSchema,
    aspectRatio: mediaCardAspectRatioSchema.default("16:9"),
    heading: z.string(),
    caption: z.string().optional(),
    focalPoint: focalPointSchema.optional(),
    zoom: mediaZoomSchema.optional(),
    loop: z.boolean().optional(),
    videoPlayback: videoPlaybackSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.videoPlayback !== undefined && value.loop === true) {
      ctx.addIssue({
        code: "custom",
        message: "セリフゲート再生はループ再生と併用できません",
        path: ["videoPlayback"],
      });
    }
  });
export type MediaCardInput = z.infer<typeof mediaCardInputSchema>;

export const mediaCardV1: VisualTemplateDefinition = {
  id: "media.card",
  version: 1,
  inputSchema: mediaCardInputSchema,
  layers: ["card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "カード", description: "画像・動画を見出し付きカードで表示（動画はループ可）", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS, videoPlayback: true },
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
  exampleInput: {
    assetId: "<assetId>",
    aspectRatio: "16:9",
    heading: "管理画面のダッシュボード",
    caption: "毎日の確認はここから",
    zoom: 1.1,
  } satisfies z.input<typeof mediaCardInputSchema>,
  collectAssetRefs: (input, path) => {
    const parsed = mediaCardInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [{ assetId: parsed.data.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  },
};
