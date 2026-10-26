import {
  openAiAdapterExtrasSchema,
  defaultOpenAiMaxTokens,
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
const SYNTHESIS_TIMEOUT_MS = 180_000;
const MAX_TTS_AUDIO_BYTES = 50 * 1024 * 1024;

async function request(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
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
      const extras = parsed.data;
      // 参照音声モード。ref_text ありは ICL、なしは x-vector（話者埋め込みのみ）。
      const refAudioMode = extras.refAudioAssetId !== undefined;
      let body: Record<string, unknown>;
      if (refAudioMode) {
        // superRefine が参照音声時の langCode を必須化済み。到達しないが、
        // superRefine は出力型を narrow しないため TS 上の型ガードとして必要。
        if (extras.langCode === undefined) {
          throw new TtsInputRejectedError("参照音声を使う場合は言語コードが必要です。");
        }
        if (requestBody.refAudioPath === undefined || requestBody.refAudioPath.length === 0) {
          throw new TtsInputRejectedError("参照音声ファイルを解決できませんでした。");
        }
        // maxTokens 省略時は既定値 4096 を送る（エンジン既定 1200 で長文が切れるのを防ぐ）。
        body = {
          model: extras.model,
          input: requestBody.text,
          ref_audio: requestBody.refAudioPath,
          lang_code: extras.langCode,
          max_tokens: extras.maxTokens ?? defaultOpenAiMaxTokens(),
          response_format: "wav",
        };
        if (extras.refText !== undefined) {
          body.ref_text = extras.refText;
        }
      } else {
        body = {
          model: parsed.data.model,
          input: requestBody.text,
          voice: requestBody.voiceId,
          response_format: "wav",
          speed: requestBody.speedScale,
        };
      }
      const response = await request(
        `${context.baseUrl}/v1/audio/speech`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        SYNTHESIS_TIMEOUT_MS,
      );
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
