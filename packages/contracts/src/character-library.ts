import { z } from "zod";
import { idSchema, timestampSchema } from "./content/primitives";
import {
  characterAppearanceCoreSchema,
  characterNamesSchema,
  characterVoicesSchema,
} from "./content/character";

export const characterLibraryEntrySchema = z.object({
  id: idSchema,
  name: z.string(),
  names: characterNamesSchema.default([]),
  voices: characterVoicesSchema,
  appearances: z.array(characterAppearanceCoreSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createCharacterRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  names: characterNamesSchema.default([]),
  voices: characterVoicesSchema.default([]),
  appearances: z.array(characterAppearanceCoreSchema).max(50),
});

export const updateCharacterRequestSchema = createCharacterRequestSchema;

export type CharacterLibraryEntry = z.infer<typeof characterLibraryEntrySchema>;
export type CreateCharacterRequest = z.infer<typeof createCharacterRequestSchema>;
export type UpdateCharacterRequest = z.infer<typeof updateCharacterRequestSchema>;
