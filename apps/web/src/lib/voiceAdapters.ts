import { voiceAdapterDescriptors, type TtsVoice, type VoiceAdapterSummary } from "@kakeai/contracts";

export interface AdapterVoicesState {
  voices: TtsVoice[] | undefined;
  loading: boolean;
  failed: boolean;
}

export function adapterLabel(adapterId: string, adapters?: VoiceAdapterSummary[]): string {
  const fromApi = adapters?.find((entry) => entry.id === adapterId)?.label;
  if (fromApi !== undefined) {
    return fromApi;
  }
  return voiceAdapterDescriptors.find((entry) => entry.id === adapterId)?.label ?? adapterId;
}

export function voiceLocale(voice: TtsVoice, adapterId: string): string {
  if (voice.locale !== undefined) {
    return voice.locale;
  }
  return voiceAdapterDescriptors.find((entry) => entry.id === adapterId)?.defaultLocale ?? "";
}
