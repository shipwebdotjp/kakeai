import type { TtsVoice, VoiceAdapterId } from "./voice-profile";

export interface TtsAdapterContext {
  readonly baseUrl: string;
}

export interface TtsSynthesisRequest {
  text: string;
  voiceId: string;
  speedScale: number;
}

export interface TtsSynthesisAudio {
  data: Uint8Array;
  mediaType: string;
}

export interface TtsVoiceListing {
  voices: TtsVoice[];
  engineVersion: string | null;
}

export interface TtsAdapter {
  readonly id: VoiceAdapterId;
  listVoices(context: TtsAdapterContext): Promise<TtsVoiceListing>;
  synthesize(context: TtsAdapterContext, request: TtsSynthesisRequest): Promise<TtsSynthesisAudio>;
}
