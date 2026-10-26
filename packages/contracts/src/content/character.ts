import { z } from "zod";
import { SUPPORTED_LOCALES, idSchema, localeSchema, positiveInt } from "./primitives";

/**
 * The fields shared by a library Character Appearance and a work-local copy.
 * Library appearances never pin a Face Set revision: the library always renders
 * the latest revision.
 */
export const characterAppearanceCoreSchema = z.strictObject({
  id: idSchema,
  assetId: idSchema,
  expression: z.string(),
  pose: z.string(),
  label: z.string().trim().min(1).optional(),
  faceSetId: idSchema.nullable().default(null),
});

/**
 * A work-local Appearance. `faceSetVersion` pins the Face Set revision used by
 * this Script Version; `null` means the legacy v1 for a non-null `faceSetId`.
 * `libraryAppearanceId` links the copy back to its library source so an explicit
 * "update from library" can preserve the local Appearance ID.
 */
export const characterAppearanceSchema = z.strictObject({
  id: idSchema,
  assetId: idSchema,
  expression: z.string(),
  pose: z.string(),
  label: z.string().trim().min(1).optional(),
  faceSetId: idSchema.nullable().default(null),
  faceSetVersion: positiveInt.nullable().default(null),
  libraryAppearanceId: idSchema.nullable().default(null),
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
  /** Provenance of a copy made from the character library; never a render input. */
  libraryCharacterId: idSchema.nullable().default(null),
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterAppearance = z.infer<typeof characterAppearanceSchema>;
export type CharacterAppearanceCore = z.infer<typeof characterAppearanceCoreSchema>;
export type CharacterVoice = z.infer<typeof characterVoiceSchema>;
export type CharacterName = z.infer<typeof characterNameSchema>;

export function resolveCharacterName(
  character: Pick<Character, "name" | "names">,
  locale: (typeof SUPPORTED_LOCALES)[number],
): string {
  return character.names.find((entry) => entry.locale === locale)?.name ?? character.name;
}
