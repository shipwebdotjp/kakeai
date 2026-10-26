import { z } from "zod";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { animationSpecSchema, DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { nestedVisualSchema } from "../content/nested";
import type { AssetReference } from "../content/asset-reference";
import type { TemplateFieldSpec, VisualTemplateDefinition } from "./shared";
import { MEDIA_KINDS } from "./common";
import { collectNestedAssetRefs } from "./nested-refs";

const DEVICE_FRAME_OPTIONS = [
  { value: "laptop", label: "ラップトップ" },
  { value: "phone", label: "スマートフォン" },
] as const;

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
  { kind: "nestedMedia", key: "screen", label: "画面", assetKinds: MEDIA_KINDS, allowComposition: true, videoPlayback: true },
  { kind: "select", key: "frame", label: "フレーム", options: DEVICE_FRAME_OPTIONS },
  { kind: "color", key: "backgroundColor", label: "背景色" },
  { kind: "animation", key: "animation", label: "画面の登場アニメーション" },
  { kind: "boolean", key: "statusBar", label: "ステータスバーを表示（スマートフォン）" },
  { kind: "boolean", key: "keyboard", label: "キーボードを表示（ノートPC）" },
];

function collectDeviceFrameRefs(
  input: unknown,
  path: (string | number)[],
  depth: number,
): AssetReference[] {
  const parsed = deviceFrameInputSchema.safeParse(input);
  if (!parsed.success) {
    return [];
  }
  return collectNestedAssetRefs(parsed.data.screen, [...path, "screen"], depth);
}

export const sceneDeviceFrameV1: VisualTemplateDefinition = {
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
  exampleInput: {
    screen: { kind: "media", assetId: "<assetId>", fit: "cover" },
    frame: "laptop",
    animation: { preset: "scale-in", durationMs: 600 },
  } satisfies z.input<typeof deviceFrameInputSchema>,
  collectAssetRefs: (input, path, depth = 0) =>
    collectDeviceFrameRefs(input, path, depth),
};
