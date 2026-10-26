import { z } from "zod";
import { animationPresetSchema } from "../content/animation";
import {
  cueLayerSchema,
  transitionEdgeSchema,
  transitionPresetSchema,
} from "../content/layers";
import { nonNegativeInt, positiveInt } from "../content/primitives";
import { richTextMarkSchema } from "../content/rich-text";
import { assetKindSchema } from "../dto";

const templateFieldOptionsSchema = z.array(
  z.strictObject({
    value: z.string().min(1),
    label: z.string().min(1),
  }),
);

const fieldKeyShape = {
  key: z.string().min(1),
  label: z.string().min(1),
};

/**
 * Serialisable projection of `TemplateFieldSpec`. It is derived from the
 * template registry at runtime; it is not a second template list.
 */
export const agentTemplateFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("media"),
    ...fieldKeyShape,
    assetKinds: z.array(assetKindSchema).min(1),
    videoPlayback: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("nestedMedia"),
    ...fieldKeyShape,
    assetKinds: z.array(assetKindSchema).min(1),
    optional: z.boolean().optional(),
    allowComposition: z.boolean().optional(),
    videoPlayback: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal("text"), ...fieldKeyShape }),
  z.strictObject({ kind: z.literal("optionalText"), ...fieldKeyShape }),
  z.strictObject({
    kind: z.literal("richText"),
    ...fieldKeyShape,
    marks: z.array(richTextMarkSchema).min(1),
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("select"),
    ...fieldKeyShape,
    options: templateFieldOptionsSchema,
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("color"),
    ...fieldKeyShape,
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("number"),
    ...fieldKeyShape,
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("decimal"),
    ...fieldKeyShape,
    min: z.number().optional(),
    max: z.number().optional(),
    optional: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("mediaCrop"),
    ...fieldKeyShape,
    zoomKey: z.string().min(1).optional(),
  }),
  z.strictObject({ kind: z.literal("boolean"), ...fieldKeyShape }),
  z.strictObject({
    kind: z.literal("grid"),
    ...fieldKeyShape,
    maxColumns: positiveInt,
    maxRows: positiveInt,
    dataKind: z.enum(["table", "chart"]),
  }),
  z.strictObject({
    kind: z.literal("flow"),
    ...fieldKeyShape,
    maxNodes: positiveInt,
    maxEdges: positiveInt,
  }),
  z.strictObject({
    kind: z.literal("effects"),
    ...fieldKeyShape,
    variant: z.enum(["table", "chart", "flow", "stat", "quote", "chat"]),
  }),
  z.strictObject({ kind: z.literal("calloutItems"), ...fieldKeyShape }),
  z.strictObject({
    kind: z.literal("messages"),
    ...fieldKeyShape,
    maxMessages: positiveInt,
  }),
  z.strictObject({ kind: z.literal("animation"), ...fieldKeyShape }),
]);
export type AgentTemplateField = z.infer<typeof agentTemplateFieldSchema>;

export const agentVisualTemplateSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
  display: z.strictObject({
    label: z.string().min(1),
    description: z.string(),
    category: z.string().min(1),
  }),
  layers: z.array(cueLayerSchema),
  editable: z.boolean(),
  inputFields: z.array(agentTemplateFieldSchema),
  transitionPolicy: z.strictObject({
    presets: z.array(transitionPresetSchema),
    defaultEnter: transitionEdgeSchema,
    defaultExit: transitionEdgeSchema,
    maxDurationMs: nonNegativeInt,
  }),
  animationPolicy: z.strictObject({
    presets: z.array(animationPresetSchema),
    defaultDurationMs: nonNegativeInt,
    maxDurationMs: nonNegativeInt,
  }),
});
export type AgentVisualTemplate = z.infer<typeof agentVisualTemplateSchema>;

/**
 * The input contract of one Visual Template. `inputSchema` is derived from the
 * definition's own `inputSchema` (the same Zod schema that validates saves), so
 * the Agent surface never keeps a second copy. `example` is a complete input
 * that passes that schema.
 */
export const agentTemplateInputContractSchema = z.strictObject({
  id: z.string().min(1),
  version: positiveInt,
  inputSchema: z.record(z.string(), z.unknown()),
  example: z.unknown(),
});
export type AgentTemplateInputContract = z.infer<
  typeof agentTemplateInputContractSchema
>;
