import { z } from "zod";
import { SUPPORTED_LOCALES, idSchema, localeSchema } from "./primitives";

export const characterAppearanceSchema = z.strictObject({
  id: idSchema,
  assetId: idSchema,
  expression: z.string(),
  pose: z.string(),
  label: z.string().trim().min(1).optional(),
  faceSetId: idSchema.nullable().default(null),
});

export const characterVoiceSchema = z.strictObject({
  locale: localeSchema,
  voiceProfileId: idSchema,
});

export const characterVoicesSchema = z
  .array(characterVoiceSchema)
  .max(SUPPORTED_LOCALES.length)
  .superRefine((voices, ctx) => {
    const seen = new Set<string>();
    for (const [index, voice] of voices.entries()) {
      if (seen.has(voice.locale)) {
        ctx.addIssue({
          code: "custom",
          message: `locale が重複しています: ${voice.locale}`,
          path: [index, "locale"],
        });
      } else {
        seen.add(voice.locale);
      }
    }
  });

export const characterSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  voices: characterVoicesSchema,
  appearances: z.array(characterAppearanceSchema),
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterAppearance = z.infer<typeof characterAppearanceSchema>;
export type CharacterVoice = z.infer<typeof characterVoiceSchema>;
