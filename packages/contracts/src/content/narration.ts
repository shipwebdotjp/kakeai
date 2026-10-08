import { z } from "zod";
import { idSchema, positiveInt } from "./primitives";

export const narrationSegmentSchema = z.strictObject({
  id: idSchema,
  speakerId: idSchema.nullable(),
  captionText: z.string(),
  speechText: z.string(),
  selectedAudioTakeId: idSchema.nullable(),
});

export const audioTakeSourceSchema = z.enum(["manual", "tts"]);

export const audioTakeSchema = z.strictObject({
  id: idSchema,
  narrationSegmentId: idSchema,
  source: audioTakeSourceSchema,
  assetId: idSchema,
  durationMs: positiveInt,
});

export type NarrationSegment = z.infer<typeof narrationSegmentSchema>;
export type AudioTake = z.infer<typeof audioTakeSchema>;
