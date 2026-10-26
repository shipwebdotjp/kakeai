import { z } from "zod";
import { nonNegativeInt } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import { cueEffectSchema, lineTriggerSchema } from "../content/cue-effect";
import type { VisualTemplateDefinition } from "./shared";
import { EXAMPLE_LINE_TRIGGER } from "./common";
import { createEffectsLineRefCollector } from "./line-refs";

export const FLOW_MAX_NODES = 8;
export const FLOW_MAX_EDGES = 16;

export const flowOrientationSchema = z.enum(["vertical", "horizontal"]);
export type FlowOrientation = z.infer<typeof flowOrientationSchema>;

export const flowStylePresetSchema = z.enum(["clean", "boxed"]);
export type FlowStylePreset = z.infer<typeof flowStylePresetSchema>;

export const flowNodeSchema = z.strictObject({
  label: z.string().min(1).max(64),
  caption: z.string().max(64).optional(),
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.strictObject({
  from: nonNegativeInt,
  to: nonNegativeInt,
  label: z.string().max(32).optional(),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowDiagramSchema = z
  .strictObject({
    nodes: z.array(flowNodeSchema).min(1).max(FLOW_MAX_NODES),
    edges: z.array(flowEdgeSchema).max(FLOW_MAX_EDGES),
  })
  .superRefine((diagram, ctx) => {
    diagram.edges.forEach((edge, index) => {
      if (edge.from >= diagram.nodes.length) {
        ctx.addIssue({
          code: "custom",
          message: `辺の from がノード数を超えています: ${edge.from}`,
          path: ["edges", index, "from"],
        });
      }
      if (edge.to >= diagram.nodes.length) {
        ctx.addIssue({
          code: "custom",
          message: `辺の to がノード数を超えています: ${edge.to}`,
          path: ["edges", index, "to"],
        });
      }
      if (edge.from === edge.to) {
        ctx.addIssue({
          code: "custom",
          message: "自己ループの辺は指定できません",
          path: ["edges", index, "to"],
        });
      }
    });
  });
export type FlowDiagram = z.infer<typeof flowDiagramSchema>;

export const flowStyleSchema = z.strictObject({
  orientation: flowOrientationSchema.default("horizontal"),
  preset: flowStylePresetSchema.default("clean"),
});
export type FlowStyle = z.infer<typeof flowStyleSchema>;

export const flowEffectTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("node"), index: nonNegativeInt }),
  z.strictObject({ kind: z.literal("nodes") }),
]);
export type FlowEffectTarget = z.infer<typeof flowEffectTargetSchema>;

export const flowEffectSchema = z.strictObject({
  target: flowEffectTargetSchema,
  trigger: lineTriggerSchema,
  effect: cueEffectSchema,
});
export type FlowEffect = z.infer<typeof flowEffectSchema>;

export const flowEffectsSchema = z.array(flowEffectSchema).max(32);

export const flowDiagramInputSchema = z
  .strictObject({
    title: z.string().optional(),
    diagram: flowDiagramSchema,
    style: flowStyleSchema.optional(),
    effects: flowEffectsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    (input.effects ?? []).forEach((entry, index) => {
      if (
        entry.target.kind === "node" &&
        entry.target.index >= input.diagram.nodes.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: `効果のノード番号がノード数を超えています: ${entry.target.index}`,
          path: ["effects", index, "target", "index"],
        });
      }
    });
  });
export type FlowDiagramInput = z.infer<typeof flowDiagramInputSchema>;

const FLOW_ORIENTATION_OPTIONS = [
  { value: "horizontal", label: "横" },
  { value: "vertical", label: "縦" },
] as const;

const FLOW_STYLE_PRESET_OPTIONS = [
  { value: "clean", label: "シンプル" },
  { value: "boxed", label: "枠付き" },
] as const;

export const flowDiagramV1: VisualTemplateDefinition = {
  id: "flow.diagram",
  version: 1,
  inputSchema: flowDiagramInputSchema,
  layers: ["card", "overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "フロー図", description: "ノードと辺で工程・流れを表す図", category: "data" },
  inputFields: [
    { kind: "optionalText", key: "title", label: "タイトル" },
    {
      kind: "flow",
      key: "diagram",
      label: "ノードと辺",
      maxNodes: FLOW_MAX_NODES,
      maxEdges: FLOW_MAX_EDGES,
    },
    { kind: "select", key: "style.orientation", label: "向き", options: FLOW_ORIENTATION_OPTIONS },
    { kind: "select", key: "style.preset", label: "スタイル", options: FLOW_STYLE_PRESET_OPTIONS },
    { kind: "effects", key: "effects", label: "セリフ同期の効果", variant: "flow" },
  ],
  exampleInput: {
    title: "制作の流れ",
    diagram: {
      nodes: [
        { label: "台本", caption: "正本JSON" },
        { label: "TTS" },
        { label: "レンダー" },
      ],
      edges: [
        { from: 0, to: 1, label: "音声生成" },
        { from: 1, to: 2 },
      ],
    },
    style: { orientation: "horizontal", preset: "boxed" },
    effects: [
      {
        target: { kind: "node", index: 0 },
        trigger: EXAMPLE_LINE_TRIGGER,
        effect: { kind: "appear", preset: "fade", durationMs: 300 },
      },
    ],
  } satisfies z.input<typeof flowDiagramInputSchema>,
  collectAssetRefs: () => [],
  collectLineRefs: createEffectsLineRefCollector(),
};
