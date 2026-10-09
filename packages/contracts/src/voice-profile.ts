import { z } from "zod";
import { idSchema, timestampSchema } from "./content/primitives";

export const voiceAdapterIdSchema = z.enum(["voicevox", "aivisspeech"]);

export const DEFAULT_VOICE_ADAPTER_ID = "voicevox" as const;

export const MIN_STYLE_ID = -2147483648;
export const MAX_STYLE_ID = 2147483647;

export const styleIdSchema = z.number().int().min(MIN_STYLE_ID).max(MAX_STYLE_ID);

export const voicevoxProfileSettingsSchema = z.strictObject({
  speakerUuid: z.string().min(1),
  defaultStyleId: styleIdSchema,
});

export const aivisspeechProfileSettingsSchema = z.strictObject({
  speakerUuid: z.string().min(1),
  defaultStyleId: styleIdSchema,
});

export const voiceProfileSettingsSchema = z.union([
  voicevoxProfileSettingsSchema,
  aivisspeechProfileSettingsSchema,
]);

export type VoiceAdapterId = z.infer<typeof voiceAdapterIdSchema>;
export type VoiceProfileSettings = z.infer<typeof voiceProfileSettingsSchema>;

export function voiceProfileSettingsSchemaFor(
  adapterId: VoiceAdapterId,
): z.ZodType<VoiceProfileSettings> {
  switch (adapterId) {
    case "voicevox":
      return voicevoxProfileSettingsSchema;
    case "aivisspeech":
      return aivisspeechProfileSettingsSchema;
    default:
      throw new Error(`未対応の音声アダプターです: ${String(adapterId)}`);
  }
}

export const voiceProfileSchema = z.discriminatedUnion("adapterId", [
  z.strictObject({
    id: idSchema,
    name: z.string(),
    adapterId: z.literal("voicevox"),
    settings: voicevoxProfileSettingsSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  }),
  z.strictObject({
    id: idSchema,
    name: z.string(),
    adapterId: z.literal("aivisspeech"),
    settings: aivisspeechProfileSettingsSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  }),
]);

export const createVoiceProfileRequestSchema = z.discriminatedUnion("adapterId", [
  z.strictObject({
    name: z.string().trim().min(1),
    adapterId: z.literal("voicevox"),
    settings: voicevoxProfileSettingsSchema,
  }),
  z.strictObject({
    name: z.string().trim().min(1),
    adapterId: z.literal("aivisspeech"),
    settings: aivisspeechProfileSettingsSchema,
  }),
]);

export const updateVoiceProfileRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  settings: voiceProfileSettingsSchema,
});

export const ttsVoiceStyleSchema = z.object({
  styleId: styleIdSchema,
  name: z.string(),
});

export const ttsVoiceSchema = z.object({
  voiceId: z.string().min(1),
  name: z.string(),
  styles: z.array(ttsVoiceStyleSchema),
});

export const voiceListSchema = z.object({
  adapterId: voiceAdapterIdSchema,
  voices: z.array(ttsVoiceSchema),
});

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type CreateVoiceProfileRequest = z.infer<typeof createVoiceProfileRequestSchema>;
export type UpdateVoiceProfileRequest = z.infer<typeof updateVoiceProfileRequestSchema>;
export type TtsVoiceStyle = z.infer<typeof ttsVoiceStyleSchema>;
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;
export type VoiceList = z.infer<typeof voiceListSchema>;
