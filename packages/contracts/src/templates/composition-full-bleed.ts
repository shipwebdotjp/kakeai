import { z } from "zod";
import { idSchema } from "../content/primitives";
import { DEFAULT_TRANSITION_POLICY } from "../content/layers";
import { DEFAULT_ANIMATION_POLICY } from "../content/animation";
import type { VisualTemplateDefinition } from "./shared";

export const compositionFullBleedInputSchema = z.strictObject({
  compositionVersionId: idSchema,
});

export const compositionFullBleedV1: VisualTemplateDefinition = {
  id: "composition.full-bleed",
  version: 1,
  inputSchema: compositionFullBleedInputSchema,
  layers: ["background"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: {
    label: "コンポジション背景（全面）",
    description: "Composition Libraryの完全画面モーションを配置",
    category: "composition",
  },
  inputFields: [
    { kind: "text", key: "compositionVersionId", label: "Composition バージョン" },
  ],
  exampleInput: { compositionVersionId: "<compositionVersionId>" } satisfies z.input<
    typeof compositionFullBleedInputSchema
  >,
  collectAssetRefs: () => [],
};
