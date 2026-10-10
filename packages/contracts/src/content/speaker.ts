import { z } from "zod";
import { idSchema } from "./primitives";

export const speakerSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  characterId: idSchema.nullable(),
  voiceProfileId: idSchema.nullable(),
});

export type Speaker = z.infer<typeof speakerSchema>;
