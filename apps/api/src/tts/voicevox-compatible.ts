import type {
  TtsAdapter,
  TtsAdapterContext,
  TtsSynthesisAudio,
  TtsSynthesisRequest,
  TtsVoice,
  TtsVoiceListing,
  TtsVoiceQuery,
  VoiceAdapterId,
} from "@kakeai/contracts";
import { TtsEngineUnavailableError, TtsInputRejectedError } from "./errors.ts";

const REQUEST_TIMEOUT_MS = 5000;
const MAX_TTS_AUDIO_BYTES = 50 * 1024 * 1024;

interface VoicevoxSpeaker {
  name?: unknown;
  speaker_uuid?: unknown;
  styles?: unknown;
}

interface VoicevoxStyle {
  name?: unknown;
  id?: unknown;
}

export function encodeVoicevoxVoiceId(speakerUuid: string, styleId: number): string {
  return `${speakerUuid}:${String(styleId)}`;
}

export function decodeVoicevoxVoiceId(voiceId: string): { speakerUuid: string; styleId: number } {
  const separator = voiceId.lastIndexOf(":");
  const speakerUuid = separator === -1 ? "" : voiceId.slice(0, separator);
  const styleText = separator === -1 ? "" : voiceId.slice(separator + 1);
  if (speakerUuid.length === 0 || !/^-?\d+$/.test(styleText)) {
    throw new TtsInputRejectedError();
  }
  const styleId = Number(styleText);
  if (!Number.isSafeInteger(styleId)) {
    throw new TtsInputRejectedError();
  }
  return { speakerUuid, styleId };
}

function toVoices(speaker: VoicevoxSpeaker, defaultLocale: string): TtsVoice[] {
  if (typeof speaker !== "object" || speaker === null) {
    return [];
  }
  if (typeof speaker.speaker_uuid !== "string" || typeof speaker.name !== "string") {
    return [];
  }
  if (!Array.isArray(speaker.styles)) {
    return [];
  }
  const voices: TtsVoice[] = [];
  for (const style of speaker.styles) {
    if (typeof style !== "object" || style === null) {
      continue;
    }
    const candidate = style as VoicevoxStyle;
    if (typeof candidate.id !== "number" || !Number.isSafeInteger(candidate.id)) {
      continue;
    }
    if (typeof candidate.name !== "string") {
      continue;
    }
    voices.push({
      voiceId: encodeVoicevoxVoiceId(speaker.speaker_uuid, candidate.id),
      name: `${speaker.name}（${candidate.name}）`,
      locale: defaultLocale,
    });
  }
  return voices;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TtsEngineUnavailableError();
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TtsEngineUnavailableError("音声エンジンの応答を解釈できません。");
  }
}

async function fetchEngineVersion(baseUrl: string): Promise<string | null> {
  const response = await request(`${baseUrl}/version`, { method: "GET" });
  if (!response.ok) {
    return null;
  }
  try {
    const value = await response.json();
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function createVoicevoxCompatibleAdapter(options: {
  id: VoiceAdapterId;
  defaultLocale: string;
}): TtsAdapter {
  return {
    id: options.id,

    async listVoices(context: TtsAdapterContext, _query: TtsVoiceQuery): Promise<TtsVoiceListing> {
      const response = await request(`${context.baseUrl}/speakers`, { method: "GET" });
      if (!response.ok) {
        throw new TtsEngineUnavailableError();
      }
      const payload = await readJson(response);
      if (!Array.isArray(payload)) {
        throw new TtsEngineUnavailableError("音声エンジンの応答が不正です。");
      }
      const voices = payload.flatMap((entry) =>
        toVoices(entry as VoicevoxSpeaker, options.defaultLocale),
      );
      let engineVersion: string | null = null;
      try {
        engineVersion = await fetchEngineVersion(context.baseUrl);
      } catch {
        engineVersion = null;
      }
      return { voices, engineVersion };
    },

    async synthesize(
      context: TtsAdapterContext,
      requestBody: TtsSynthesisRequest,
    ): Promise<TtsSynthesisAudio> {
      const { styleId } = decodeVoicevoxVoiceId(requestBody.voiceId);
      const queryUrl = new URL(`${context.baseUrl}/audio_query`);
      queryUrl.searchParams.set("text", requestBody.text);
      queryUrl.searchParams.set("speaker", String(styleId));
      const queryResponse = await request(queryUrl.toString(), { method: "POST" });
      if (queryResponse.status >= 400 && queryResponse.status < 500) {
        throw new TtsInputRejectedError();
      }
      if (!queryResponse.ok) {
        throw new TtsEngineUnavailableError();
      }
      const query = await readJson(queryResponse);
      if (typeof query !== "object" || query === null || Array.isArray(query)) {
        throw new TtsEngineUnavailableError("音声エンジンの応答が不正です。");
      }
      (query as Record<string, unknown>).speedScale = requestBody.speedScale;

      const synthesisUrl = new URL(`${context.baseUrl}/synthesis`);
      synthesisUrl.searchParams.set("speaker", String(styleId));
      const synthesisResponse = await request(synthesisUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      if (synthesisResponse.status >= 400 && synthesisResponse.status < 500) {
        throw new TtsInputRejectedError();
      }
      if (!synthesisResponse.ok) {
        throw new TtsEngineUnavailableError();
      }
      const contentLength = Number(synthesisResponse.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_TTS_AUDIO_BYTES) {
        throw new TtsEngineUnavailableError("音声エンジンの応答が大きすぎます。");
      }
      const buffer = await synthesisResponse.arrayBuffer();
      if (buffer.byteLength === 0) {
        throw new Error("音声エンジンが空の音声を返しました。");
      }
      if (buffer.byteLength > MAX_TTS_AUDIO_BYTES) {
        throw new TtsEngineUnavailableError("音声エンジンの応答が大きすぎます。");
      }
      return { data: new Uint8Array(buffer), mediaType: "audio/wav" };
    },
  };
}
