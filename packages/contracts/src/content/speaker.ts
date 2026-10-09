import { z } from "zod";
import { idSchema } from "./primitives";

export const speakerV1Schema = z.strictObject({
  id: idSchema,
  name: z.string(),
  characterId: idSchema.nullable(),
});

export const speakerSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  characterId: idSchema.nullable(),
  voiceProfileId: idSchema.nullable(),
});

export type Speaker = z.infer<typeof speakerSchema>;
export type SpeakerV1 = z.infer<typeof speakerV1Schema>;
