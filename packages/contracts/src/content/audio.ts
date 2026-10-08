import { z } from "zod";
import { idSchema } from "./primitives";

export const audioCueRoleSchema = z.enum(["bgm", "sfx"]);

export const audioCueRangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("work") }),
  z.strictObject({ kind: z.literal("scene"), sceneId: idSchema }),
]);

export const audioCueSchema = z.strictObject({
  id: idSchema,
  role: audioCueRoleSchema,
  assetId: idSchema,
  range: audioCueRangeSchema,
  gainDb: z.number().finite().optional(),
  loop: z.boolean().optional(),
});

export type AudioCue = z.infer<typeof audioCueSchema>;
