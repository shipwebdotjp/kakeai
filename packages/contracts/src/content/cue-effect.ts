import { z } from "zod";
import { idSchema, nonNegativeInt } from "./primitives";
import { tableToneSchema } from "./tone";

export const lineTriggerKindSchema = z.enum(["lines", "cue"]);
export type LineTriggerKind = z.infer<typeof lineTriggerKindSchema>;

export const linesTriggerSchema = z.strictObject({
  kind: z.literal("lines"),
  startLineId: idSchema,
  endLineId: idSchema,
});

export const cueTriggerSchema = z.strictObject({
  kind: z.literal("cue"),
});

export const lineTriggerSchema = z.discriminatedUnion("kind", [
  linesTriggerSchema,
  cueTriggerSchema,
]);
export type LineTrigger = z.infer<typeof lineTriggerSchema>;

export const appearPresetSchema = z.enum([
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scale-in",
]);
export type AppearPreset = z.infer<typeof appearPresetSchema>;
export const APPEAR_PRESETS = appearPresetSchema.options;

export const emphasizeStyleSchema = z.enum(["background", "frame"]);
export type EmphasizeStyle = z.infer<typeof emphasizeStyleSchema>;
export const EMPHASIZE_STYLES = emphasizeStyleSchema.options;

export const appearEffectSchema = z.strictObject({
  kind: z.literal("appear"),
  preset: appearPresetSchema,
  durationMs: nonNegativeInt,
  staggerMs: nonNegativeInt.optional(),
});
export type AppearEffect = z.infer<typeof appearEffectSchema>;

export const emphasizeEffectSchema = z.strictObject({
  kind: z.literal("emphasize"),
  style: emphasizeStyleSchema,
  tone: tableToneSchema,
});
export type EmphasizeEffect = z.infer<typeof emphasizeEffectSchema>;

export const cueEffectSchema = z.discriminatedUnion("kind", [
  appearEffectSchema,
  emphasizeEffectSchema,
]);
export type CueEffect = z.infer<typeof cueEffectSchema>;

export const timedEffectSchema = z.strictObject({
  trigger: lineTriggerSchema,
  effect: cueEffectSchema,
});
export type TimedEffect = z.infer<typeof timedEffectSchema>;

export interface LineReference {
  lineId: string;
  path: (string | number)[];
}
