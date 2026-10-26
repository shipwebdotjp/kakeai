import { z } from "zod";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { fontFaceSpecSchema, textSurfaceSchema } from "../content/theme";
import type { VisualTemplateDefinition } from "./shared";

export const textAnchorSchema = z.enum(["left", "center", "right"]);

export const textRoleSchema = z.enum(["title", "subtitle", "heading", "body", "closing", "label"]);
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
  lineHeight: z.number().min(1).max(3).optional(),
  decoration: z
    .strictObject({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      outline: z.boolean().optional(),
      shadow: z.boolean().optional(),
    })
    .optional(),
  fontFace: fontFaceSpecSchema.optional(),
  surface: textSurfaceSchema.optional(),
});
export type TextBlockInput = z.infer<typeof textBlockInputSchema>;

const ANCHOR_OPTIONS = [
  { value: "left", label: "左" },
  { value: "center", label: "中央" },
  { value: "right", label: "右" },
] as const;

const TEXT_ROLE_OPTIONS = [
  { value: "body", label: "本文" },
  { value: "heading", label: "見出し" },
  { value: "title", label: "タイトル" },
  { value: "subtitle", label: "サブタイトル" },
  { value: "closing", label: "結びの文言" },
  { value: "label", label: "ラベル" },
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

export const textBlockV1: VisualTemplateDefinition = {
  id: "text.block",
  version: 1,
  inputSchema: textBlockInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "テキスト", description: "見出し・本文・ラベルなどのテキスト", category: "text" },
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
  exampleInput: {
    text: "売上は前年比120%",
    role: "title",
    anchor: "center",
    fontSize: 96,
    color: "#1F2937",
    decoration: { bold: true, shadow: true },
  } satisfies z.input<typeof textBlockInputSchema>,
  collectAssetRefs: () => [],
};
