import { z } from "zod";
import { idSchema } from "./primitives";

export const characterAppearanceSchema = z.strictObject({
  id: idSchema,
  assetId: idSchema,
  expression: z.string(),
  pose: z.string(),
});

export const characterSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  appearances: z.array(characterAppearanceSchema),
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterAppearance = z.infer<typeof characterAppearanceSchema>;
