import { z } from "zod";
import { idSchema, positiveInt } from "../content/primitives";
import { sceneSchema } from "../content/scene";
import { standingLayoutSchema } from "../content/standing-layout";
import { MAX_TTS_SPEED_SCALE, MIN_TTS_SPEED_SCALE } from "../requests";
import { voiceAdapterIdSchema, voiceIdSchema } from "../voice-profile";
import { liveSideSchema } from "./common";
import {
  liveMaterialDurationMsSchema,
  liveMaterialFormatSchema,
} from "./material";
import { liveAssetSnapshotSchema, liveSha256Schema } from "./snapshot";
import { liveVoiceSettingsSchema } from "./show";

export const LIVE_RESOLUTION_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export const liveResolutionThemeSchema = z.strictObject({
  id: idSchema,
  version: positiveInt,
  sha256: liveSha256Schema,
});
export type LiveResolutionTheme = z.infer<typeof liveResolutionThemeSchema>;

export const liveResolutionFaceSetSchema = z.strictObject({
  id: idSchema,
  version: positiveInt,
  sha256: liveSha256Schema,
  layers: z.array(liveAssetSnapshotSchema),
});
export type LiveResolutionFaceSet = z.infer<typeof liveResolutionFaceSetSchema>;

export const liveResolutionCharacterAppearanceSchema = z.strictObject({
  id: idSchema,
  expression: z.string().min(1),
  pose: z.string().min(1),
  /** Frozen standing layout so a later appearance edit cannot change output. */
  standing: standingLayoutSchema,
  image: liveAssetSnapshotSchema,
  faceSet: liveResolutionFaceSetSchema.nullable(),
});
export type LiveResolutionCharacterAppearance = z.infer<
  typeof liveResolutionCharacterAppearanceSchema
>;

export const liveResolutionCharacterSchema = z.strictObject({
  side: liveSideSchema,
  characterId: idSchema,
  name: z.string().min(1),
  appearances: z.array(liveResolutionCharacterAppearanceSchema).min(1),
});
export type LiveResolutionCharacter = z.infer<typeof liveResolutionCharacterSchema>;

export const liveResolutionVoiceSchema = z.strictObject({
  side: liveSideSchema,
  characterId: idSchema,
  voiceProfileId: idSchema,
  adapterId: voiceAdapterIdSchema,
  voiceId: voiceIdSchema,
  speedScale: z
    .number()
    .finite()
    .min(MIN_TTS_SPEED_SCALE)
    .max(MAX_TTS_SPEED_SCALE),
  settings: liveVoiceSettingsSchema,
  referenceAudio: liveAssetSnapshotSchema.nullable(),
});
export type LiveResolutionVoice = z.infer<typeof liveResolutionVoiceSchema>;

export const liveResolutionAudioAssetSchema = z.strictObject({
  cueId: idSchema,
  asset: liveAssetSnapshotSchema,
});
export type LiveResolutionAudioAsset = z.infer<typeof liveResolutionAudioAssetSchema>;

export const liveResolutionCutInSchema = z.strictObject({
  cutInId: idSchema,
  asset: liveAssetSnapshotSchema,
});
export type LiveResolutionCutIn = z.infer<typeof liveResolutionCutInSchema>;

/**
 * A card image referenced by the version's visuals. The image bytes an export
 * uses are frozen here, so a later Asset replacement cannot change the package.
 */
export const liveResolutionCardAssetSchema = z.strictObject({
  assetId: idSchema,
  asset: liveAssetSnapshotSchema,
});
export type LiveResolutionCardAsset = z.infer<typeof liveResolutionCardAssetSchema>;

export const liveResolutionMaterialSchema = z.strictObject({
  materialId: idSchema,
  name: z.string().min(1),
  format: liveMaterialFormatSchema,
  durationMs: liveMaterialDurationMsSchema,
  scene: sceneSchema,
  assets: z.array(liveAssetSnapshotSchema),
  snapshotSha256: liveSha256Schema,
  provenanceSha256: liveSha256Schema,
});
export type LiveResolutionMaterial = z.infer<typeof liveResolutionMaterialSchema>;

/**
 * Frozen references captured when a Live Program Version is created. An
 * export consumes this snapshot instead of resolving mutable Work, theme or
 * library records again.
 */
export const liveResolutionSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(LIVE_RESOLUTION_SNAPSHOT_SCHEMA_VERSION),
    theme: liveResolutionThemeSchema,
    characters: z.array(liveResolutionCharacterSchema),
    voices: z.array(liveResolutionVoiceSchema),
    audioAssets: z.array(liveResolutionAudioAssetSchema),
    cutIns: z.array(liveResolutionCutInSchema),
    cardAssets: z.array(liveResolutionCardAssetSchema),
    materials: z.array(liveResolutionMaterialSchema),
  })
  .superRefine((snapshot, ctx) => {
    const characterSides = new Set<string>();
    const characterBySide = new Map<string, LiveResolutionCharacter>();
    for (const [index, character] of snapshot.characters.entries()) {
      if (characterSides.has(character.side)) {
        ctx.addIssue({
          code: "custom",
          path: ["characters", index, "side"],
          message: `同じ side のキャラクターが重複しています: ${character.side}`,
        });
      }
      characterSides.add(character.side);
      characterBySide.set(character.side, character);
    }
    const voiceSides = new Set<string>();
    const voiceBySide = new Map<string, LiveResolutionVoice>();
    for (const [index, voice] of snapshot.voices.entries()) {
      if (voiceSides.has(voice.side)) {
        ctx.addIssue({
          code: "custom",
          path: ["voices", index, "side"],
          message: `同じ side の声が重複しています: ${voice.side}`,
        });
      }
      voiceSides.add(voice.side);
      voiceBySide.set(voice.side, voice);
    }
    // A side's voice and character are one cast entry. A mismatched or missing
    // counterpart means the frozen snapshot cannot be exported consistently.
    for (const [index, voice] of snapshot.voices.entries()) {
      const character = characterBySide.get(voice.side);
      if (character === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["voices", index, "side"],
          message: `side ${voice.side} に対応するキャラクターがありません。`,
        });
      } else if (character.characterId !== voice.characterId) {
        ctx.addIssue({
          code: "custom",
          path: ["voices", index, "characterId"],
          message: `side ${voice.side} のキャラクター ID が声と一致しません: ${voice.characterId}`,
        });
      }
    }
    for (const [index, character] of snapshot.characters.entries()) {
      const voice = voiceBySide.get(character.side);
      if (voice === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["characters", index, "side"],
          message: `side ${character.side} に対応する声がありません。`,
        });
      } else if (voice.characterId !== character.characterId) {
        ctx.addIssue({
          code: "custom",
          path: ["characters", index, "characterId"],
          message: `side ${character.side} の声のキャラクター ID が一致しません: ${character.characterId}`,
        });
      }
    }
    const cueIds = new Set<string>();
    for (const [index, audio] of snapshot.audioAssets.entries()) {
      if (cueIds.has(audio.cueId)) {
        ctx.addIssue({
          code: "custom",
          path: ["audioAssets", index, "cueId"],
          message: `音声 Asset のキューが重複しています: ${audio.cueId}`,
        });
      }
      cueIds.add(audio.cueId);
    }
    const cutInIds = new Set<string>();
    for (const [index, cutIn] of snapshot.cutIns.entries()) {
      if (cutInIds.has(cutIn.cutInId)) {
        ctx.addIssue({
          code: "custom",
          path: ["cutIns", index, "cutInId"],
          message: `CutIn が重複しています: ${cutIn.cutInId}`,
        });
      }
      cutInIds.add(cutIn.cutInId);
    }
    const cardAssetIds = new Set<string>();
    for (const [index, cardAsset] of snapshot.cardAssets.entries()) {
      if (cardAssetIds.has(cardAsset.assetId)) {
        ctx.addIssue({
          code: "custom",
          path: ["cardAssets", index, "assetId"],
          message: `カード画像 Asset が重複しています: ${cardAsset.assetId}`,
        });
      }
      if (cardAsset.asset.assetId !== cardAsset.assetId) {
        ctx.addIssue({
          code: "custom",
          path: ["cardAssets", index, "asset", "assetId"],
          message: `カード画像 Asset の ID がスナップショットと一致しません: ${cardAsset.assetId}`,
        });
      }
      cardAssetIds.add(cardAsset.assetId);
    }
    const materialIds = new Set<string>();
    for (const [index, material] of snapshot.materials.entries()) {
      if (materialIds.has(material.materialId)) {
        ctx.addIssue({
          code: "custom",
          path: ["materials", index, "materialId"],
          message: `Live Material が重複しています: ${material.materialId}`,
        });
      }
      materialIds.add(material.materialId);
    }
  });
export type LiveResolutionSnapshot = z.infer<typeof liveResolutionSnapshotSchema>;
