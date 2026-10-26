import { z } from "zod";
import { nonNegativeInt } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { nestedMediaVisualSchema } from "../content/nested";
import { cueEffectSchema, lineTriggerSchema } from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";
import { EXAMPLE_LINE_TRIGGER } from "./common";
import { collectNestedAssetRefs } from "./nested-refs";
import { createEffectsLineRefCollector, readInputField } from "./line-refs";

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

export const chatThreadV1: VisualTemplateDefinition = {
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
  exampleInput: {
    title: "チームの相談",
    frame: "phone",
    statusTime: "9:41",
    messages: [
      { name: "佐藤", side: "left", body: "今日の打ち合わせは10時です", time: "9:40" },
      { name: "鈴木", side: "right", body: "了解しました", time: "9:41" },
    ],
    effects: [
      {
        target: { kind: "message", index: 1 },
        trigger: EXAMPLE_LINE_TRIGGER,
        effect: { kind: "appear", preset: "slide-up", durationMs: 300 },
      },
    ],
  } satisfies z.input<typeof chatThreadInputSchema>,
  collectAssetRefs: (input, path, depth = 0) => {
    const messages = readInputField(input, "messages");
    if (!Array.isArray(messages)) {
      return [];
    }
    return messages.flatMap((raw, index) => {
      const parsed = chatMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.icon === undefined) {
        return [];
      }
      return collectNestedAssetRefs(parsed.data.icon, [...path, "messages", index, "icon"], depth);
    });
  },
  collectLineRefs: createEffectsLineRefCollector(),
};
