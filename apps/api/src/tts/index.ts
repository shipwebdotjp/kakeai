import { voiceAdapterDescriptorFor, type TtsAdapter, type VoiceAdapterId } from "@kakeai/contracts";
import { createVoicevoxCompatibleAdapter } from "./voicevox-compatible.ts";

function buildAdapter(id: VoiceAdapterId): TtsAdapter {
  const descriptor = voiceAdapterDescriptorFor(id);
  return createVoicevoxCompatibleAdapter({
    id,
    defaultLocale: descriptor.defaultLocale,
  });
}

const ADAPTERS: Record<VoiceAdapterId, TtsAdapter> = {
  voicevox: buildAdapter("voicevox"),
  aivisspeech: buildAdapter("aivisspeech"),
};

export function getTtsAdapter(id: VoiceAdapterId): TtsAdapter {
  const adapter = ADAPTERS[id];
  if (adapter === undefined) {
    throw new Error(`未対応の音声アダプターです: ${id}`);
  }
  return adapter;
}

export * from "./errors.ts";
