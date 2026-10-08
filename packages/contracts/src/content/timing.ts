import { z } from "zod";
import { positiveInt } from "./primitives";

export const sceneTimingSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("auto") }),
  z.strictObject({ mode: z.literal("fixed"), durationMs: positiveInt }),
]);

export type SceneTiming = z.infer<typeof sceneTimingSchema>;
