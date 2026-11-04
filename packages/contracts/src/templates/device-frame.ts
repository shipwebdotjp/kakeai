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

const DEVICE_PLACEMENT_OPTIONS = [
  { value: "left", label: "左" },
  { value: "center", label: "中央" },
  { value: "right", label: "右" },
] as const;

export const deviceFrameInputSchema = z.strictObject({
  screen: nestedVisualSchema,
  frame: z.enum(["laptop", "phone"]),
  scale: z.number().finite().min(0.6).max(1).optional(),
  placement: z.enum(["left", "center", "right"]).optional(),
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
  {
    kind: "decimal",
    key: "scale",
    label: "倍率（1=100%）",
    min: 0.6,
    max: 1,
    step: 0.05,
    optional: true,
    defaultValue: 1,
  },
  {
    kind: "select",
    key: "placement",
    label: "配置",
    options: DEVICE_PLACEMENT_OPTIONS,
    defaultValue: "center",
  },
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
