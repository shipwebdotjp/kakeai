import type { TtsVoice, VoiceAdapterId } from "@kakeai/contracts";

export const VOICE_ADAPTER_LABELS: Record<VoiceAdapterId, string> = {
  voicevox: "VOICEVOX",
  aivisspeech: "AivisSpeech",
};

export interface AdapterVoicesState {
  voices: TtsVoice[] | undefined;
  loading: boolean;
  failed: boolean;
}

export function adapterLabel(adapterId: string): string {
  return VOICE_ADAPTER_LABELS[adapterId as VoiceAdapterId] ?? adapterId;
}
