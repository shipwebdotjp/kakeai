import { z } from "zod";
import { idSchema, timestampSchema } from "./content/primitives";
import { characterAppearanceSchema } from "./content/character";

export const characterLibraryEntrySchema = z.object({
  id: idSchema,
  name: z.string(),
  voiceProfileId: idSchema.nullable(),
  appearances: z.array(characterAppearanceSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createCharacterRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  voiceProfileId: idSchema.nullable().default(null),
  appearances: z.array(characterAppearanceSchema).max(50),
});

export const updateCharacterRequestSchema = createCharacterRequestSchema;

export type CharacterLibraryEntry = z.infer<typeof characterLibraryEntrySchema>;
export type CreateCharacterRequest = z.infer<typeof createCharacterRequestSchema>;
export type UpdateCharacterRequest = z.infer<typeof updateCharacterRequestSchema>;
