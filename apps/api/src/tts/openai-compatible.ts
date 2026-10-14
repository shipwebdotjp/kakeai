import {
  openAiAdapterExtrasSchema,
  type TtsAdapter,
  type TtsAdapterContext,
  type TtsSynthesisAudio,
  type TtsSynthesisRequest,
  type TtsVoice,
  type TtsVoiceListing,
  type TtsVoiceQuery,
  type VoiceAdapterId,
} from "@kakeai/contracts";
import { TtsEngineUnavailableError, TtsInputRejectedError } from "./errors.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TTS_AUDIO_BYTES = 50 * 1024 * 1024;

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TtsEngineUnavailableError();
  }
}

function readModel(settings: TtsVoiceQuery["settings"]): string | null {
  if (settings === null) {
    return null;
  }
  const parsed = openAiAdapterExtrasSchema.safeParse(settings);
  return parsed.success ? parsed.data.model : null;
}

function isEngineUnavailableStatus(status: number): boolean {
  return status >= 500 || status === 401 || status === 403 || status === 429;
}

async function fetchModels(baseUrl: string): Promise<string[]> {
  const response = await request(`${baseUrl}/v1/models`, { method: "GET" });
  if (isEngineUnavailableStatus(response.status)) {
    throw new TtsEngineUnavailableError();
  }
  if (!response.ok) {
    return [];
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return [];
  }
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  const models: string[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      models.push(id);
    }
  }
  return models;
}

async function fetchVoices(baseUrl: string, model: string): Promise<TtsVoice[]> {
  const url = new URL(`${baseUrl}/v1/audio/voices`);
  url.searchParams.set("model", model);
  const response = await request(url.toString(), { method: "GET" });
  if (isEngineUnavailableStatus(response.status)) {
    throw new TtsEngineUnavailableError();
  }
  if (!response.ok) {
    return [];
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return [];
  }
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  const voices: TtsVoice[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    const name = (entry as { name?: unknown }).name;
    if (typeof id === "string" && id.length > 0) {
      voices.push({ voiceId: id, name: typeof name === "string" && name.length > 0 ? name : id });
    }
  }
  return voices;
}

export function createOpenAiCompatibleAdapter(id: VoiceAdapterId): TtsAdapter {
  return {
    id,

    async listVoices(context: TtsAdapterContext, query: TtsVoiceQuery): Promise<TtsVoiceListing> {
      const model = readModel(query.settings);
      const voices = model === null ? [] : await fetchVoices(context.baseUrl, model);
      return { voices, engineVersion: null };
    },

    async listModels(context: TtsAdapterContext): Promise<string[]> {
      return fetchModels(context.baseUrl);
    },

    async synthesize(
      context: TtsAdapterContext,
      requestBody: TtsSynthesisRequest,
    ): Promise<TtsSynthesisAudio> {
      const parsed = openAiAdapterExtrasSchema.safeParse(requestBody.settings);
      if (!parsed.success) {
        throw new TtsInputRejectedError("音声モデルが設定されていません。");
      }
      const response = await request(`${context.baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: parsed.data.model,
          input: requestBody.text,
          voice: requestBody.voiceId,
          response_format: "wav",
          speed: requestBody.speedScale,
        }),
      });
      if (response.status >= 400 && response.status < 500) {
        throw new TtsInputRejectedError();
      }
      if (!response.ok) {
        throw new TtsEngineUnavailableError();
      }
      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_TTS_AUDIO_BYTES) {
        throw new TtsEngineUnavailableError("音声エンジンの応答が大きすぎます。");
      }
      const buffer = await response.arrayBuffer();
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
