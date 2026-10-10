import { z } from "zod";
import { idSchema, nonNegativeInt } from "./primitives";
import { getVisualTemplate } from "../templates";
import { cueLayerSchema, cueTransitionSchema } from "./layers";
import {
  MAX_NESTED_VISUAL_DEPTH,
  MAX_NESTED_VISUAL_NODES,
  nestedVisualSchema,
  templateRefSchema,
} from "./nested";

export const MAX_INPUT_WRITE_DEPTH = 24;

export const visualCueRangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scene") }),
  z.strictObject({
    kind: z.literal("lines"),
    startLineId: idSchema,
    endLineId: idSchema,
  }),
  z.strictObject({
    kind: z.literal("offset"),
    startMs: nonNegativeInt,
    endMs: nonNegativeInt,
  }),
]);

export const visualCueSchema = z
  .strictObject({
    id: idSchema,
    range: visualCueRangeSchema,
    layer: cueLayerSchema,
    order: nonNegativeInt,
    transition: cueTransitionSchema,
    template: templateRefSchema,
    input: z.unknown(),
  })
  .superRefine((cue, ctx) => {
    const definition = getVisualTemplate(cue.template.id, cue.template.version);
    if (!definition) {
      ctx.addIssue({
        code: "custom",
        message: `未対応のVisualTemplateです: ${cue.template.id}@${cue.template.version}`,
        path: ["template"],
      });
      return;
    }
    if (!definition.layers.includes(cue.layer)) {
      ctx.addIssue({
        code: "custom",
        message: `${cue.template.id}@${cue.template.version} は ${cue.layer} レイヤーに置けません`,
        path: ["layer"],
      });
    }
    for (const [edgeName, edge] of [
      ["enter", cue.transition.enter],
      ["exit", cue.transition.exit],
    ] as const) {
      if (!definition.transitionPolicy.presets.includes(edge.preset)) {
        ctx.addIssue({
          code: "custom",
          message: `${edgeName} の preset "${edge.preset}" は許可されていません`,
          path: ["transition", edgeName, "preset"],
        });
      }
      if (edge.durationMs > definition.transitionPolicy.maxDurationMs) {
        ctx.addIssue({
          code: "custom",
          message: `${edgeName} の durationMs が最大 ${definition.transitionPolicy.maxDurationMs}ms を超えています`,
          path: ["transition", edgeName, "durationMs"],
        });
      }
    }
    const result = definition.inputSchema.safeParse(cue.input);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: ["input", ...issue.path],
        });
      }
      return;
    }
    validateNestedVisuals(result.data, ctx, ["input"], 0, { depth: 0, nodes: 0 });
  });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Budget {
  depth: number;
  nodes: number;
}

function validateNestedVisuals(
  value: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[],
  writeDepth: number,
  budget: Budget,
): void {
  if (writeDepth > MAX_INPUT_WRITE_DEPTH) {
    ctx.addIssue({
      code: "custom",
      message: "入力の入れ子が深すぎます",
      path,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateNestedVisuals(entry, ctx, [...path, index], writeDepth + 1, budget),
    );
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  const nested = nestedVisualSchema.safeParse(value);
  if (nested.success) {
    budget.nodes += 1;
    if (budget.nodes > MAX_NESTED_VISUAL_NODES) {
      ctx.addIssue({
        code: "custom",
        message: `NestedVisual は最大 ${MAX_NESTED_VISUAL_NODES} 個までです`,
        path,
      });
      return;
    }
    if (nested.data.kind === "media") {
      return;
    }
    budget.depth += 1;
    if (budget.depth > MAX_NESTED_VISUAL_DEPTH) {
      ctx.addIssue({
        code: "custom",
        message: `NestedVisual の入れ子は最大 ${MAX_NESTED_VISUAL_DEPTH} 階層までです`,
        path,
      });
      budget.depth -= 1;
      return;
    }
    const definition = getVisualTemplate(
      nested.data.template.id,
      nested.data.template.version,
    );
    if (!definition) {
      ctx.addIssue({
        code: "custom",
        message: `未対応のVisualTemplateです: ${nested.data.template.id}@${nested.data.template.version}`,
        path: [...path, "template"],
      });
      budget.depth -= 1;
      return;
    }
    const parsed = definition.inputSchema.safeParse(nested.data.input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: [...path, "input", ...issue.path],
        });
      }
      budget.depth -= 1;
      return;
    }
    validateNestedVisuals(parsed.data, ctx, [...path, "input"], writeDepth + 1, budget);
    budget.depth -= 1;
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    validateNestedVisuals(entry, ctx, [...path, key], writeDepth + 1, budget);
  }
}

export type VisualCue = z.infer<typeof visualCueSchema>;
export type VisualCueRange = z.infer<typeof visualCueRangeSchema>;
