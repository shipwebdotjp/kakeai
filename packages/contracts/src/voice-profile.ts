import { z } from "zod";
import { idSchema, timestampSchema } from "./content/primitives";

export const voiceAdapterIdSchema = z.enum(["voicevox"]);

export const DEFAULT_VOICE_ADAPTER_ID = "voicevox" as const;

export const voicevoxProfileSettingsSchema = z.strictObject({
  speakerUuid: z.string().min(1),
  defaultStyleId: z.number().int().nonnegative(),
});

export const voiceProfileSettingsSchema = voicevoxProfileSettingsSchema;

export const voiceProfileSchema = z.object({
  id: idSchema,
  name: z.string(),
  adapterId: voiceAdapterIdSchema,
  settings: voiceProfileSettingsSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createVoiceProfileRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  adapterId: voiceAdapterIdSchema,
  settings: voiceProfileSettingsSchema,
});

export const updateVoiceProfileRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  settings: voiceProfileSettingsSchema,
});

export const ttsVoiceStyleSchema = z.object({
  styleId: z.number().int().nonnegative(),
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

export type VoiceAdapterId = z.infer<typeof voiceAdapterIdSchema>;
export type VoicevoxProfileSettings = z.infer<typeof voicevoxProfileSettingsSchema>;
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type CreateVoiceProfileRequest = z.infer<typeof createVoiceProfileRequestSchema>;
export type UpdateVoiceProfileRequest = z.infer<typeof updateVoiceProfileRequestSchema>;
export type TtsVoiceStyle = z.infer<typeof ttsVoiceStyleSchema>;
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;
export type VoiceList = z.infer<typeof voiceListSchema>;
