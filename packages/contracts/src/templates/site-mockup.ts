import { z } from "zod";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { animationSpecSchema, DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { nestedMediaVisualSchema } from "../content/nested";
import type { VisualTemplateDefinition } from "./shared";
import { MEDIA_KINDS } from "./common";
import { collectNestedAssetRefs } from "./nested-refs";

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

const SITE_MOCKUP_VARIANT_LABELS: Record<SiteMockupVariant, string> = {
  x: "X（旧Twitter）",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  github: "GitHub",
  qiita: "Qiita",
  zenn: "Zenn",
  note: "note",
  stackoverflow: "Stack Overflow",
  hackernews: "Hacker News",
  reddit: "Reddit",
  pixiv: "pixiv",
  niconico: "ニコニコ動画",
  browser: "ブラウザ",
};

const SITE_MOCKUP_VARIANT_OPTIONS = siteMockupVariantSchema.options.map((value) => ({
  value,
  label: SITE_MOCKUP_VARIANT_LABELS[value],
}));

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

export const sceneSiteMockupV1: VisualTemplateDefinition = {
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
    { kind: "nestedMedia", key: "screen", label: "画面", assetKinds: MEDIA_KINDS, videoPlayback: true },
    { kind: "select", key: "theme", label: "テーマ", options: THEME_OPTIONS, optional: true },
    { kind: "optionalText", key: "name", label: "表示名" },
    { kind: "optionalText", key: "handle", label: "ハンドル" },
    { kind: "optionalText", key: "url", label: "URL" },
    { kind: "optionalText", key: "caption", label: "本文" },
    { kind: "nestedMedia", key: "logo", label: "ロゴ（任意）", assetKinds: MEDIA_KINDS, optional: true, videoPlayback: true },
    { kind: "animation", key: "animation", label: "画面の登場アニメーション" },
  ],
  exampleInput: {
    variant: "x",
    screen: { kind: "media", assetId: "<assetId>", fit: "cover" },
    theme: "light",
    name: "Kakeai",
    handle: "@kakeai",
    caption: "台本からMP4まで、ひとつのアプリで",
    animation: { preset: "fade", durationMs: 400 },
  } satisfies z.input<typeof siteMockupInputSchema>,
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
