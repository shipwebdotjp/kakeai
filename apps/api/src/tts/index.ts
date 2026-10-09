import type { TtsAdapter, VoiceAdapterId } from "@kakeai/contracts";
import { voicevoxAdapter } from "./voicevox.ts";

const ADAPTERS: Record<VoiceAdapterId, TtsAdapter> = {
  voicevox: voicevoxAdapter,
};

export function getTtsAdapter(id: VoiceAdapterId): TtsAdapter {
  const adapter = ADAPTERS[id];
  if (adapter === undefined) {
    throw new Error(`未対応の音声アダプターです: ${id}`);
  }
  return adapter;
}

export * from "./errors.ts";
