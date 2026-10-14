import type { TtsVoice, VoiceAdapterId, VoiceProfileExtras } from "./voice-profile";

export interface TtsAdapterContext {
  readonly baseUrl: string;
}

export interface TtsSynthesisRequest {
  text: string;
  voiceId: string;
  speedScale: number;
  settings: VoiceProfileExtras;
}

export interface TtsVoiceQuery {
  readonly settings: VoiceProfileExtras | null;
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
  listVoices(context: TtsAdapterContext, query: TtsVoiceQuery): Promise<TtsVoiceListing>;
  listModels?(context: TtsAdapterContext): Promise<string[]>;
  synthesize(context: TtsAdapterContext, request: TtsSynthesisRequest): Promise<TtsSynthesisAudio>;
}
