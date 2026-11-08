import { randomBytes } from "node:crypto";
import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  isLoopbackHostname,
  type LiveRuntimeConfig,
  type LiveSpeaker,
  type TtsAdapter,
  type VoiceAdapterId,
  type VoiceProfileExtras,
} from "@kakeai/contracts";
import { getTtsAdapter } from "@kakeai/tts";
import { resolveContainedPath } from "../package/paths.ts";
import { estimateSpeechDurationMs, probeMp3DurationMs, wavDurationMs } from "./duration.ts";
import { Semaphore } from "./semaphore.ts";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_CUE_TOKEN = 64;
const DEFAULT_TTS_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CONCURRENT_TTS = 2;

export class TtsNotConfiguredError extends Error {
  constructor(
    message = "生成レス用の TTS が設定されていません。",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TtsNotConfiguredError";
  }
}

export type GeneratedSpeechFailureReason =
  | "timeout"
  | "tts"
  | "invalid_audio"
  | "too_large"
  | "write";

export class GeneratedSpeechError extends Error {
  constructor(
    readonly reason: GeneratedSpeechFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GeneratedSpeechError";
  }
}

export interface GenerateSpeechInput {
  /** `runs/<runId>` */
  runDir: string;
  packageRoot: string;
  speaker: LiveSpeaker;
  text: string;
  cueId: string;
  config: LiveRuntimeConfig;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Test seam. Production uses `getTtsAdapter`. */
  adapterFor?: (id: VoiceAdapterId) => TtsAdapter;
}

export interface GeneratedSpeechResult {
  audio: `run:generated/${string}`;
  durationMs: number;
  mediaType: "audio/wav" | "audio/mpeg";
  byteSize: number;
  path: string;
}

const semaphores = new WeakMap<LiveRuntimeConfig, Semaphore>();

function semaphoreFor(config: LiveRuntimeConfig): Semaphore {
  const existing = semaphores.get(config);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Semaphore(
    config.tts.maxConcurrentTts ?? DEFAULT_MAX_CONCURRENT_TTS,
  );
  semaphores.set(config, created);
  return created;
}

function adapterContext(input: GenerateSpeechInput): { baseUrl: string; apiKey?: string } {
  const adapterConfig = input.config.tts.adapters[input.speaker.voice.adapterId];
  if (adapterConfig === undefined) {
    throw new TtsNotConfiguredError(
      `TTS アダプター ${input.speaker.voice.adapterId} の接続設定がありません。`,
    );
  }
  let hostname: string;
  try {
    hostname = new URL(adapterConfig.baseUrl).hostname;
  } catch {
    throw new TtsNotConfiguredError(
      `TTS アダプター ${input.speaker.voice.adapterId} の baseUrl が不正です。`,
    );
  }
  if (!isLoopbackHostname(hostname)) {
    throw new TtsNotConfiguredError(
      "ライブの生成レス TTS はループバックのローカルエンジンだけを使えます。",
    );
  }
  return {
    baseUrl: adapterConfig.baseUrl,
    ...(adapterConfig.apiKey === undefined ? {} : { apiKey: adapterConfig.apiKey }),
  };
}

async function resolveRefAudio(input: GenerateSpeechInput): Promise<string | undefined> {
  const relativePath = input.speaker.voice.refAudio;
  if (relativePath === undefined) {
    return undefined;
  }
  try {
    const absolutePath = resolveContainedPath(input.packageRoot, relativePath);
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TtsNotConfiguredError(`参照音声がファイルではありません: ${relativePath}`);
    }
    return absolutePath;
  } catch (error) {
    if (error instanceof TtsNotConfiguredError) {
      throw error;
    }
    throw new TtsNotConfiguredError(`参照音声を読み込めません: ${relativePath}`, {
      cause: error,
    });
  }
}

function safeCueToken(cueId: string): string {
  const token = cueId
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^[^A-Za-z0-9]+/u, "")
    .slice(0, MAX_CUE_TOKEN);
  return token.length > 0 ? token : "cue";
}

function fileNameFor(input: GenerateSpeechInput, extension: "wav" | "mp3"): string {
  const stamp = (input.now?.() ?? new Date()).getTime().toString(36);
  const nonce = randomBytes(4).toString("hex");
  return `${safeCueToken(input.cueId)}-${stamp}${nonce}.${extension}`;
}

function normalizeMediaType(mediaType: string): "audio/wav" | "audio/mpeg" | null {
  if (mediaType === "audio/wav") return "audio/wav";
  if (mediaType === "audio/mpeg") return "audio/mpeg";
  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(
        new GeneratedSpeechError("timeout", "生成レスの TTS がタイムアウトしました。"),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

async function synthesize(input: GenerateSpeechInput): Promise<GeneratedSpeechResult> {
  const context = adapterContext(input);
  const adapter = (input.adapterFor ?? getTtsAdapter)(input.speaker.voice.adapterId);
  const refAudioPath = await resolveRefAudio(input);
  const timeoutMs = input.config.tts.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;

  let audio;
  try {
    audio = await withTimeout(
      adapter.synthesize(context, {
        text: input.text,
        voiceId: input.speaker.voice.voiceId,
        speedScale: input.speaker.voice.speedScale,
        settings: input.speaker.voice.settings as VoiceProfileExtras,
        ...(refAudioPath === undefined ? {} : { refAudioPath }),
      }),
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof GeneratedSpeechError) {
      throw error;
    }
    throw new GeneratedSpeechError("tts", "生成レスの TTS に失敗しました。", { cause: error });
  }

  if (audio.data.byteLength === 0) {
    throw new GeneratedSpeechError("invalid_audio", "TTS が空の音声を返しました。");
  }
  if (audio.data.byteLength > MAX_AUDIO_BYTES) {
    throw new GeneratedSpeechError("too_large", "生成音声がサイズ上限を超えました。");
  }
  const mediaType = normalizeMediaType(audio.mediaType);
  if (mediaType === null) {
    throw new GeneratedSpeechError(
      "invalid_audio",
      `未対応の音声形式です: ${audio.mediaType}`,
    );
  }

  const generatedDir = resolve(input.runDir, "generated");
  await mkdir(generatedDir, { recursive: true });
  const [realRunDir, realGeneratedDir] = await Promise.all([
    realpath(input.runDir),
    realpath(generatedDir),
  ]);
  if (!realGeneratedDir.startsWith(`${realRunDir}${sep}`)) {
    throw new GeneratedSpeechError("write", "生成音声の出力先が実行ディレクトリ外です。");
  }
  const fileName = fileNameFor(input, mediaType === "audio/mpeg" ? "mp3" : "wav");
  const path = join(generatedDir, fileName);
  if (path !== generatedDir && !path.startsWith(`${generatedDir}${sep}`)) {
    throw new GeneratedSpeechError("write", "生成音声の出力先が実行ディレクトリ外です。");
  }
  try {
    await writeFile(path, audio.data, { flag: "wx" });
  } catch (error) {
    throw new GeneratedSpeechError("write", "生成音声を書き込めませんでした。", { cause: error });
  }

  const durationMs =
    mediaType === "audio/wav"
      ? wavDurationMs(audio.data)
      : ((await probeMp3DurationMs(path)) ?? estimateSpeechDurationMs(input.text));
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    await rm(path, { force: true }).catch(() => undefined);
    throw new GeneratedSpeechError("invalid_audio", "生成音声の長さを取得できませんでした。");
  }

  return {
    audio: `run:generated/${fileName}`,
    durationMs: Math.round(durationMs),
    mediaType,
    byteSize: audio.data.byteLength,
    path,
  };
}

/**
 * Synthesizes one generated-response cue. Every call for the same runtime
 * config shares `maxConcurrentTts`; the file lands only under
 * `<runDir>/generated/` and the returned URL is the reserved `run:` form.
 */
export async function generateGeneratedSpeech(
  input: GenerateSpeechInput,
): Promise<GeneratedSpeechResult> {
  return semaphoreFor(input.config).run(() => synthesize(input));
}

/** Short alias for callers that import from the director namespace. */
export const generateSpeech = generateGeneratedSpeech;
