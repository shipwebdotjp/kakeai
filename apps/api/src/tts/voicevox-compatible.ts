import type {
  TtsAdapter,
  TtsSynthesisAudio,
  TtsSynthesisRequest,
  TtsVoice,
  TtsVoiceListing,
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

function toVoice(speaker: VoicevoxSpeaker): TtsVoice | null {
  if (typeof speaker.speaker_uuid !== "string" || typeof speaker.name !== "string") {
    return null;
  }
  if (!Array.isArray(speaker.styles)) {
    return null;
  }
  const styles = speaker.styles
    .map((style) => {
      const candidate = style as VoicevoxStyle;
      if (typeof candidate.id !== "number" || typeof candidate.name !== "string") {
        return null;
      }
      return { styleId: candidate.id, name: candidate.name };
    })
    .filter((style): style is { styleId: number; name: string } => style !== null);
  return { voiceId: speaker.speaker_uuid, name: speaker.name, styles };
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

export function createVoicevoxCompatibleAdapter(id: VoiceAdapterId): TtsAdapter {
  return {
    id,

    async listVoices(baseUrl: string): Promise<TtsVoiceListing> {
      const response = await request(`${baseUrl}/speakers`, { method: "GET" });
      if (!response.ok) {
        throw new TtsEngineUnavailableError();
      }
      const payload = await readJson(response);
      if (!Array.isArray(payload)) {
        throw new TtsEngineUnavailableError("音声エンジンの応答が不正です。");
      }
      const voices = payload
        .map((entry) => toVoice(entry as VoicevoxSpeaker))
        .filter((voice): voice is TtsVoice => voice !== null);
      let engineVersion: string | null = null;
      try {
        engineVersion = await fetchEngineVersion(baseUrl);
      } catch {
        engineVersion = null;
      }
      return { voices, engineVersion };
    },

    async synthesize(
      baseUrl: string,
      requestBody: TtsSynthesisRequest,
    ): Promise<TtsSynthesisAudio> {
      const queryUrl = new URL(`${baseUrl}/audio_query`);
      queryUrl.searchParams.set("text", requestBody.text);
      queryUrl.searchParams.set("speaker", String(requestBody.styleId));
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

      const synthesisUrl = new URL(`${baseUrl}/synthesis`);
      synthesisUrl.searchParams.set("speaker", String(requestBody.styleId));
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
