import { z } from "zod";
import { idSchema } from "./primitives";

export const speakerSchema = z.object({
  id: idSchema,
  name: z.string(),
  characterId: idSchema.nullable(),
});

export type Speaker = z.infer<typeof speakerSchema>;
