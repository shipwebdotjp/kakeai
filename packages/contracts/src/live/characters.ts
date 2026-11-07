import { z } from "zod";
import { idSchema, positiveInt } from "../content/primitives";
import { standingLayoutSchema } from "../content/standing-layout";
import { expressionPresetSchema, NORMAL_EXPRESSION_ID } from "../face-set";
import { liveSideSchema } from "./common";
import { livePackageRelativePathSchema } from "./paths";
import { liveSpeakerVoiceSchema } from "./show";

export const liveCharacterAppearanceSchema = z.strictObject({
  id: idSchema,
  expression: idSchema,
  image: livePackageRelativePathSchema,
  faceSetId: idSchema.nullable(),
  faceSetVersion: positiveInt.nullable(),
  standing: standingLayoutSchema.optional(),
});
export type LiveCharacterAppearance = z.infer<typeof liveCharacterAppearanceSchema>;

export const liveFaceSetLayerSchema = z.strictObject({
  id: idSchema,
  part: z.enum(["brow", "eye", "mouth", "foreground"]),
  file: livePackageRelativePathSchema,
  blinkFile: livePackageRelativePathSchema.optional(),
  speakingFile: livePackageRelativePathSchema.optional(),
});
export type LiveFaceSetLayer = z.infer<typeof liveFaceSetLayerSchema>;

export const liveFaceSetSchema = z.strictObject({
  id: idSchema,
  version: positiveInt,
  layers: z.array(liveFaceSetLayerSchema),
  expressions: z.array(expressionPresetSchema),
});
export type LiveFaceSet = z.infer<typeof liveFaceSetSchema>;

export const liveCharacterSchema = z.strictObject({
  id: idSchema,
  side: liveSideSchema,
  name: z.string().min(1),
  appearances: z.array(liveCharacterAppearanceSchema).min(1),
  voice: liveSpeakerVoiceSchema,
});
export type LiveCharacter = z.infer<typeof liveCharacterSchema>;

export const liveCharacterSheetSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    characters: z.array(liveCharacterSchema),
    faceSets: z.array(liveFaceSetSchema),
  })
  .superRefine((sheet, ctx) => {
    const characterIds = new Set<string>();
    const sides = new Set<string>();
    for (const character of sheet.characters) {
      if (characterIds.has(character.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["characters"],
          message: `キャラクター ID が重複しています: ${character.id}`,
        });
      }
      characterIds.add(character.id);
      if (sides.has(character.side)) {
        ctx.addIssue({
          code: "custom",
          path: ["characters"],
          message: `同じ side に複数のキャラクターがあります: ${character.side}`,
        });
      }
      sides.add(character.side);
      if (!character.appearances.some((appearance) => appearance.expression === NORMAL_EXPRESSION_ID)) {
        ctx.addIssue({
          code: "custom",
          path: ["characters"],
          message: `${character.id} に expression: normal の外観がありません。`,
        });
      }
    }
    const faceSetByKey = new Map<string, LiveFaceSet>();
    const faceSetKeys = new Set<string>();
    for (const faceSet of sheet.faceSets) {
      const key = `${faceSet.id}@${faceSet.version}`;
      if (faceSetKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["faceSets"],
          message: `表情セットが重複しています: ${key}`,
        });
      }
      faceSetKeys.add(key);
      faceSetByKey.set(key, faceSet);
      if (!faceSet.expressions.some((expression) => expression.id === NORMAL_EXPRESSION_ID)) {
        ctx.addIssue({
          code: "custom",
          path: ["faceSets"],
          message: `${key} に normal Expression がありません。`,
        });
      }
    }
    for (const character of sheet.characters) {
      for (const appearance of character.appearances) {
        if (appearance.faceSetId === null) {
          continue;
        }
        const key = `${appearance.faceSetId}@${appearance.faceSetVersion ?? 1}`;
        const faceSet = faceSetByKey.get(key);
        if (faceSet === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["characters"],
            message: `${character.id} の表情セットが見つかりません: ${key}`,
          });
          continue;
        }
        if (!faceSet.expressions.some((expression) => expression.id === appearance.expression)) {
          ctx.addIssue({
            code: "custom",
            path: ["characters"],
            message: `${character.id} の表情 ${appearance.expression} が ${key} にありません。`,
          });
        }
      }
    }
  });
export type LiveCharacterSheet = z.infer<typeof liveCharacterSheetSchema>;
