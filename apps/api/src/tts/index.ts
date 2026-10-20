import { voiceAdapterDescriptorFor, type TtsAdapter, type VoiceAdapterId } from "@kakeai/contracts";
import { createOpenAiCompatibleAdapter } from "./openai-compatible.ts";
import { createVoicevoxCompatibleAdapter } from "./voicevox-compatible.ts";

function buildVoicevoxLike(id: "voicevox" | "aivisspeech"): TtsAdapter {
  const descriptor = voiceAdapterDescriptorFor(id);
  if (descriptor.defaultLocale === null) {
    throw new Error(`音声アダプター ${id} に既定 locale がありません。`);
  }
  return createVoicevoxCompatibleAdapter({ id, defaultLocale: descriptor.defaultLocale });
}

const ADAPTERS: Record<VoiceAdapterId, TtsAdapter> = {
  voicevox: buildVoicevoxLike("voicevox"),
  aivisspeech: buildVoicevoxLike("aivisspeech"),
  "openai-compatible": createOpenAiCompatibleAdapter("openai-compatible"),
};

export function getTtsAdapter(id: VoiceAdapterId): TtsAdapter {
  const adapter = ADAPTERS[id];
  if (adapter === undefined) {
    throw new Error(`未対応の音声アダプターです: ${id}`);
  }
  return adapter;
}

export * from "./errors.ts";
