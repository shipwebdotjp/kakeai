import type { TtsVoice, VoiceAdapterId } from "./voice-profile";

export interface TtsSynthesisRequest {
  text: string;
  styleId: number;
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
  listVoices(baseUrl: string): Promise<TtsVoiceListing>;
  synthesize(baseUrl: string, request: TtsSynthesisRequest): Promise<TtsSynthesisAudio>;
}
