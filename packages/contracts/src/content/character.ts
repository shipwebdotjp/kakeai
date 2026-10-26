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

function rejectDuplicateLocales(
  entries: readonly { locale: string }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.locale)) {
      ctx.addIssue({
        code: "custom",
        message: `locale が重複しています: ${entry.locale}`,
        path: [index, "locale"],
      });
    } else {
      seen.add(entry.locale);
    }
  }
}

export const characterVoicesSchema = z
  .array(characterVoiceSchema)
  .max(SUPPORTED_LOCALES.length)
  .superRefine(rejectDuplicateLocales);

export const characterNameSchema = z.strictObject({
  locale: localeSchema,
  name: z.string().trim().min(1),
});

export const characterNamesSchema = z
  .array(characterNameSchema)
  .max(SUPPORTED_LOCALES.length)
  .superRefine(rejectDuplicateLocales);

export const characterSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  names: characterNamesSchema.default([]),
  voices: characterVoicesSchema,
  appearances: z.array(characterAppearanceSchema),
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterAppearance = z.infer<typeof characterAppearanceSchema>;
export type CharacterVoice = z.infer<typeof characterVoiceSchema>;
export type CharacterName = z.infer<typeof characterNameSchema>;

export function resolveCharacterName(
  character: Pick<Character, "name" | "names">,
  locale: (typeof SUPPORTED_LOCALES)[number],
): string {
  return character.names.find((entry) => entry.locale === locale)?.name ?? character.name;
}
