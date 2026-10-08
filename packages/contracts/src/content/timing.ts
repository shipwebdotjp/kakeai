import { z } from "zod";
import { positiveInt } from "./primitives";

export const sceneTimingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("fixed"), durationMs: positiveInt }),
]);

export type SceneTiming = z.infer<typeof sceneTimingSchema>;
