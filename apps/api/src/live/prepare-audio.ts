import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type PreparedCue,
  type TtsAdapter,
  type TtsSynthesisAudio,
  type VoiceAdapterId,
  type VoiceProfileExtras,
} from "@kakeai/contracts";
import { resolveVoiceBaseUrl, type AppConfig } from "../config.ts";
import { createRendition } from "../media/normalize.ts";
import { probeMedia, type MediaProbe } from "../media/probe.ts";
import { getTtsAdapter } from "../tts/index.ts";
import { LiveExportError } from "./errors";
import type { PackageWriter } from "./package-writer";
import type { ResolvedAssetFile, ResolvedCueSeed } from "./resolved-assets";
import type { PreparedVoices } from "./prepare-voices";

export interface PrepareAudioDependencies {
  adapterFor?: (id: VoiceAdapterId) => TtsAdapter;
  isCancelled?: () => Promise<boolean>;
}

function fail(message: string, id: string | null): never {
  throw new LiveExportError("LIVE_EXPORT_TTS_FAILED", "tts", message, id);
}

function extensionForAudio(mediaType: string): "wav" | "mp3" {
  return mediaType === "audio/mpeg" ? "mp3" : "wav";
}

async function probeDuration(
  path: string,
  mediaType: string,
  cueId: string,
): Promise<number> {
  let probe: MediaProbe;
  try {
    probe = await probeMedia(path, "audio", mediaType);
  } catch {
    fail(`音声の情報を取得できませんでした: ${cueId}`, cueId);
  }
  if (probe.durationMs === null || probe.durationMs <= 0) {
    fail(`音声の尺を取得できませんでした: ${cueId}`, cueId);
  }
  return probe.durationMs;
}

async function copyOrTranscodeAudio(
  seed: ResolvedCueSeed,
  asset: ResolvedAssetFile,
  relativePathBase: string,
  writer: PackageWriter,
  config: AppConfig,
): Promise<{ relativePath: string; durationMs: number }> {
  const mediaType = asset.mediaType === "audio/mpeg" ? "audio/mpeg" : "audio/wav";
  if (mediaType === asset.mediaType) {
    const relativePath = `${relativePathBase}.${extensionForAudio(mediaType)}`;
    const durationMs = await probeDuration(asset.path, mediaType, seed.id);
    await writer.copyFile(asset.path, relativePath, {
      mediaType,
      kind: "prepared-audio",
      durationMs,
      hasAudio: true,
    });
    if (seed.audio.kind === "asset" && seed.audio.takeId !== undefined) {
      const expected = seed.audio.durationMsHint;
      if (expected !== null && Math.abs(expected - durationMs) > 50) {
        fail(
          `Audio Take ${seed.audio.takeId} の尺が素材と一致しません。`,
          seed.id,
        );
      }
    }
    return { relativePath, durationMs };
  }

  const tempPath = join(config.directories.tmp, `live-audio-${randomUUID()}.wav`);
  try {
    await createRendition(asset.path, tempPath, "audio");
    const durationMs = await probeDuration(tempPath, "audio/wav", seed.id);
    const relativePath = `${relativePathBase}.wav`;
    await writer.copyFile(tempPath, relativePath, {
      mediaType: "audio/wav",
      kind: "prepared-audio",
      durationMs,
      hasAudio: true,
    });
    return { relativePath, durationMs };
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function synthesiseCue(
  seed: ResolvedCueSeed,
  voices: PreparedVoices,
  adapterFor: (id: VoiceAdapterId) => TtsAdapter,
  config: AppConfig,
  writer: PackageWriter,
  relativePathBase: string,
): Promise<{ relativePath: string; durationMs: number }> {
  if (seed.audio.kind !== "tts") {
    throw new Error("synthesiseCue called for an asset cue");
  }
  const voice = voices.byProfileId.get(seed.audio.voiceProfileId);
  if (voice === undefined) {
    fail(`声のスナップショットが見つかりません: ${seed.audio.voiceProfileId}`, seed.id);
  }
  const adapter = adapterFor(voice.adapterId);
  let writtenPath: string | undefined;
  try {
    let result: TtsSynthesisAudio;
    try {
      result = await adapter.synthesize(
        { baseUrl: resolveVoiceBaseUrl(config, voice.adapterId) },
        {
          text: seed.speech,
          voiceId: voice.voiceId,
          speedScale: voice.speedScale,
          settings: voice.settings as VoiceProfileExtras,
          ...(voice.refAudio === undefined
            ? {}
            : { refAudioPath: writer.resolvePath(voice.refAudio) }),
        },
      );
    } catch (error) {
      fail(
        `音声の合成に失敗しました: ${seed.id} (${error instanceof Error ? error.message : String(error)})`,
        seed.id,
      );
    }
    if (result.data.byteLength === 0) {
      fail(`生成音声が空でした: ${seed.id}`, seed.id);
    }
    if (result.mediaType !== "audio/wav" && result.mediaType !== "audio/mpeg") {
      fail(`未対応の音声形式です: ${result.mediaType} (${seed.id})`, seed.id);
    }
    const mediaType = result.mediaType;
    const extension = extensionForAudio(mediaType);
    writtenPath = join(config.directories.tmp, `live-tts-${randomUUID()}.${extension}`);
    await writeFile(writtenPath, result.data);
    const durationMs = await probeDuration(writtenPath, mediaType, seed.id);
    const relativePath = `${relativePathBase}.${extension}`;
    await writer.copyFile(writtenPath, relativePath, {
      mediaType,
      kind: "prepared-audio",
      durationMs,
      hasAudio: true,
    });
    return { relativePath, durationMs };
  } finally {
    if (writtenPath !== undefined) {
      await rm(writtenPath, { force: true }).catch(() => undefined);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let firstError: unknown;
  let hasError = false;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (hasError) {
        return;
      }
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      try {
        results[index] = await run(items[index]!, index);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
        return;
      }
    }
  });
  await Promise.all(workers);
  if (hasError) {
    throw firstError;
  }
  return results;
}

/**
 * Turns resolved cue seeds into PreparedCues with package audio. Existing
 * Audio Takes are copied (or transcoded to WAV); generated cues call the TTS
 * adapter directly, never the Kakeai Job API.
 */
export async function prepareAudio(
  cues: readonly ResolvedCueSeed[],
  voices: PreparedVoices,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  config: AppConfig,
  dependencies: PrepareAudioDependencies = {},
): Promise<PreparedCue[]> {
  const adapterFor = dependencies.adapterFor ?? getTtsAdapter;
  const isCancelled = dependencies.isCancelled ?? (async () => false);

  return mapWithConcurrency(cues, 2, async (seed, index) => {
    if (await isCancelled()) {
      throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "書き出しがキャンセルされました。");
    }
    const relativePathBase = `audio/prepared/cue-${String(index + 1).padStart(4, "0")}`;
    let audio: { relativePath: string; durationMs: number };
    if (seed.audio.kind === "asset") {
      const asset = assetById.get(seed.audio.assetId);
      if (asset === undefined || asset.kind !== "audio") {
        fail(`音声素材が見つかりません: ${seed.audio.assetId}`, seed.id);
      }
      audio = await copyOrTranscodeAudio(seed, asset, relativePathBase, writer, config);
    } else {
      audio = await synthesiseCue(seed, voices, adapterFor, config, writer, relativePathBase);
    }
    return {
      id: seed.id,
      origin: seed.origin,
      ...(seed.visual === undefined ? {} : { visual: seed.visual }),
      speaker: seed.speaker,
      caption: seed.caption,
      speech: seed.speech,
      expression: seed.expression,
      audio: audio.relativePath,
      durationMs: audio.durationMs,
    };
  });
}
