import { z } from "zod";
import { idSchema, localeSchema, timestampSchema } from "./content/primitives";

export type VoiceSelection = "list" | "list-or-manual";

export interface VoiceAdapterDescriptor {
  readonly id: string;
  readonly label: string;
  readonly envName: string;
  readonly defaultBaseUrl: string;
  readonly defaultLocale: string | null;
  readonly voiceSelection: VoiceSelection;
  readonly modelSelection: boolean;
}

export const voiceAdapterDescriptors = [
  {
    id: "voicevox",
    label: "VOICEVOX",
    envName: "KAKEAI_VOICEVOX_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:50021",
    defaultLocale: "ja-JP",
    voiceSelection: "list",
    modelSelection: false,
  },
  {
    id: "aivisspeech",
    label: "AivisSpeech",
    envName: "KAKEAI_AIVISSPEECH_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:10101",
    defaultLocale: "ja-JP",
    voiceSelection: "list",
    modelSelection: false,
  },
  {
    id: "openai-compatible",
    label: "OpenAI互換",
    envName: "KAKEAI_OPENAI_TTS_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:8899",
    defaultLocale: null,
    voiceSelection: "list-or-manual",
    modelSelection: true,
  },
] as const satisfies readonly VoiceAdapterDescriptor[];

export type VoiceAdapterId = (typeof voiceAdapterDescriptors)[number]["id"];

const voiceAdapterIds = voiceAdapterDescriptors.map(
  (descriptor) => descriptor.id,
) as [VoiceAdapterId, ...VoiceAdapterId[]];

export const voiceAdapterIdSchema = z.enum(voiceAdapterIds);

export const DEFAULT_VOICE_ADAPTER_ID = "voicevox" as const satisfies VoiceAdapterId;

export function voiceAdapterDescriptorFor(adapterId: string): VoiceAdapterDescriptor {
  const descriptor = voiceAdapterDescriptors.find((entry) => entry.id === adapterId);
  if (descriptor === undefined) {
    throw new Error(`未対応の音声アダプターです: ${adapterId}`);
  }
  return descriptor;
}

export const voiceIdSchema = z.string().min(1).max(200);

export const voicevoxAdapterExtrasSchema = z.strictObject({});

export const aivisspeechAdapterExtrasSchema = z.strictObject({});

export const openAiAdapterExtrasSchema = z.strictObject({
  model: z.string().trim().min(1).max(200),
});

export const voiceProfileExtrasSchema = z.union([
  voicevoxAdapterExtrasSchema,
  aivisspeechAdapterExtrasSchema,
  openAiAdapterExtrasSchema,
]);

export type VoiceProfileExtras = z.infer<typeof voiceProfileExtrasSchema>;

export function voiceProfileExtrasSchemaFor(adapterId: VoiceAdapterId): z.ZodType<VoiceProfileExtras> {
  switch (adapterId) {
    case "voicevox":
      return voicevoxAdapterExtrasSchema;
    case "aivisspeech":
      return aivisspeechAdapterExtrasSchema;
    case "openai-compatible":
      return openAiAdapterExtrasSchema;
    default:
      throw new Error(`未対応の音声アダプターです: ${String(adapterId)}`);
  }
}

export const voiceProfileSchema = z.object({
  id: idSchema,
  name: z.string(),
  adapterId: voiceAdapterIdSchema,
  voiceId: voiceIdSchema,
  locale: localeSchema,
  settings: voiceProfileExtrasSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createVoiceProfileRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  adapterId: voiceAdapterIdSchema,
  voiceId: voiceIdSchema,
  locale: localeSchema,
  settings: voiceProfileExtrasSchema,
});

export const updateVoiceProfileRequestSchema = z.strictObject({
  name: z.string().trim().min(1),
  voiceId: voiceIdSchema,
  locale: localeSchema,
  settings: voiceProfileExtrasSchema,
});

export const voiceAdapterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  defaultLocale: z.string().min(1).max(35).nullable(),
  voiceSelection: z.enum(["list", "list-or-manual"]),
  modelSelection: z.boolean(),
});

export const voiceAdapterListSchema = z.object({
  adapters: z.array(voiceAdapterSchema),
});

export const ttsVoiceSchema = z.object({
  voiceId: voiceIdSchema,
  name: z.string().min(1).max(200),
  locale: z.string().min(1).max(35).optional(),
});

export const voiceListSchema = z.object({
  adapterId: voiceAdapterIdSchema,
  voices: z.array(ttsVoiceSchema),
});

export const modelListSchema = z.object({
  adapterId: voiceAdapterIdSchema,
  models: z.array(z.string().min(1).max(200)),
});

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type CreateVoiceProfileRequest = z.infer<typeof createVoiceProfileRequestSchema>;
export type UpdateVoiceProfileRequest = z.infer<typeof updateVoiceProfileRequestSchema>;
export type VoiceAdapterSummary = z.infer<typeof voiceAdapterSchema>;
export type VoiceAdapterList = z.infer<typeof voiceAdapterListSchema>;
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;
export type VoiceList = z.infer<typeof voiceListSchema>;
export type ModelList = z.infer<typeof modelListSchema>;
