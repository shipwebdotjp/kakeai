import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  voiceProfileExtrasSchemaFor,
  type LiveManifestVoice,
  type LiveSpeakerVoice,
  type LiveVoiceProfileSnapshot,
  type TtsAdapter,
  type VoiceAdapterId,
  type VoiceProfileExtras,
} from "@kakeai/contracts";
import { resolveVoiceBaseUrl, type AppConfig } from "../config.ts";
import { createRendition } from "../media/normalize.ts";
import { probeMedia } from "../media/probe.ts";
import { getTtsAdapter } from "../tts/index.ts";
import { LiveExportError } from "./errors";
import type { PackageWriter } from "./package-writer";
import type { ResolvedAssetFile, ResolvedLiveProfile, ResolvedSpeaker } from "./profile-resolution";

export interface PreparedVoices {
  /** Voice used by characters.json and generated responses. */
  byProfileId: Map<string, LiveSpeakerVoice>;
  /** Integrity metadata for manifest.voices. */
  manifestVoices: LiveManifestVoice[];
}

export interface PrepareVoicesDependencies {
  adapterFor?: (id: VoiceAdapterId) => TtsAdapter;
  isCancelled?: () => Promise<boolean>;
}

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_TTS_FAILED", "voice", message, id);
}

function parseSettings(profile: LiveVoiceProfileSnapshot): VoiceProfileExtras {
  try {
    return voiceProfileExtrasSchemaFor(profile.adapterId).parse(profile.settings);
  } catch {
    throw new LiveExportError(
      "LIVE_EXPORT_INPUT_INVALID",
      "voice",
      `声プロファイルの設定が不正です: ${profile.id}`,
      profile.id,
    );
  }
}

function extensionForAudio(mediaType: string): string {
  return mediaType === "audio/mpeg" ? "mp3" : "wav";
}

async function testSynthesis(
  adapter: TtsAdapter,
  config: AppConfig,
  profile: LiveVoiceProfileSnapshot,
  settings: VoiceProfileExtras,
  refAudioPath: string | undefined,
): Promise<void> {
  let testPath: string | undefined;
  try {
    const audio = await adapter.synthesize(
      { baseUrl: resolveVoiceBaseUrl(config, profile.adapterId) },
      {
        text: "テスト",
        voiceId: profile.voiceId,
        speedScale: 1,
        settings,
        refAudioPath,
      },
    );
    if (audio.data.byteLength === 0) {
      fail(`テスト合成が空でした: ${profile.id}`, profile.id);
    }
    const mediaType = audio.mediaType === "audio/mpeg" ? "audio/mpeg" : "audio/wav";
    testPath = join(
      config.directories.tmp,
      `live-tts-test-${randomUUID()}.${extensionForAudio(mediaType)}`,
    );
    await writeFile(testPath, audio.data);
    const probe = await probeMedia(testPath, "audio", mediaType);
    if (probe.durationMs === null || probe.durationMs <= 0) {
      fail(`テスト合成の尺を取得できませんでした: ${profile.id}`, profile.id);
    }
  } catch (error) {
    if (error instanceof LiveExportError) {
      throw error;
    }
    fail(
      `テスト合成に失敗しました: ${profile.id} (${error instanceof Error ? error.message : String(error)})`,
      profile.id,
    );
  } finally {
    if (testPath !== undefined) {
      await rm(testPath, { force: true }).catch(() => undefined);
    }
  }
}

async function copyReferenceAudio(
  asset: ResolvedAssetFile,
  relativePath: string,
  writer: PackageWriter,
  config: AppConfig,
): Promise<string> {
  if (asset.mediaType === "audio/wav" || asset.mediaType === "audio/mpeg") {
    await writer.copyFile(asset.path, relativePath, {
      mediaType: asset.mediaType,
      kind: "voice-ref",
      durationMs: asset.durationMs,
      hasAudio: true,
    });
    return relativePath;
  }
  const tempPath = join(config.directories.tmp, `live-ref-${randomUUID()}.wav`);
  const wavPath = relativePath.replace(/\.[^.]+$/, ".wav");
  try {
    await createRendition(asset.path, tempPath, "audio");
    const probe = await probeMedia(tempPath, "audio", "audio/wav");
    await writer.copyFile(tempPath, wavPath, {
      mediaType: "audio/wav",
      kind: "voice-ref",
      durationMs: probe.durationMs ?? asset.durationMs,
      hasAudio: true,
    });
    return wavPath;
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Copies reference audio, verifies each distinct Voice Profile with a short
 * synthesis, and returns the voice snapshots used by the package.
 */
export async function prepareVoices(
  resolved: ResolvedLiveProfile,
  voiceProfiles: Map<string, LiveVoiceProfileSnapshot>,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
  config: AppConfig,
  dependencies: PrepareVoicesDependencies = {},
): Promise<PreparedVoices> {
  const adapterFor = dependencies.adapterFor ?? getTtsAdapter;
  const isCancelled = dependencies.isCancelled ?? (async () => false);
  const byProfileId = new Map<string, LiveSpeakerVoice>();
  const manifestVoices: LiveManifestVoice[] = [];
  const refByProfileId = new Map<string, { path: string; sha256: string }>();

  let refIndex = 1;
  for (const speaker of resolved.speakers) {
    if (speaker.voiceProfileId === null) {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "voice",
        `話者 ${speaker.id} に声プロファイルがありません。`,
        speaker.id,
      );
    }
    const profile = voiceProfiles.get(speaker.voiceProfileId);
    if (profile === undefined) {
      throw new LiveExportError(
        "LIVE_EXPORT_INPUT_INVALID",
        "voice",
        `声プロファイルが見つかりません: ${speaker.voiceProfileId}`,
        speaker.voiceProfileId,
      );
    }
    if (!byProfileId.has(profile.id)) {
      if (await isCancelled()) {
        throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "書き出しがキャンセルされました。");
      }
      const settings = parseSettings(profile);
      const refAudioAssetId =
        typeof settings.refAudioAssetId === "string" ? settings.refAudioAssetId : undefined;
      let refAudioPath: string | undefined;
      let refAudioPackagePath: string | undefined;
      let refAudioSha256: string | undefined;
      if (refAudioAssetId !== undefined) {
        const asset = assetById.get(refAudioAssetId);
        if (asset === undefined || asset.kind !== "audio") {
          throw new LiveExportError(
            "LIVE_EXPORT_INPUT_INVALID",
            "voice",
            `参照音声が見つかりません: ${refAudioAssetId}`,
            refAudioAssetId,
          );
        }
        const relativePath = `media/voice/ref-${String(refIndex).padStart(4, "0")}.${extensionForAudio(asset.mediaType)}`;
        const copiedRelativePath = await copyReferenceAudio(asset, relativePath, writer, config);
        refIndex += 1;
        refAudioPath = writer.resolvePath(copiedRelativePath);
        refAudioPackagePath = copiedRelativePath;
        const copied = writer.fileList().find((file) => file.path === copiedRelativePath);
        if (copied === undefined) {
          throw new LiveExportError(
            "LIVE_EXPORT_FAILED",
            "output",
            `参照音声の記録が見つかりません: ${copiedRelativePath}`,
          );
        }
        refAudioSha256 = copied.sha256;
      }

      const settingsWithoutInternalId: Record<string, unknown> = { ...settings };
      delete settingsWithoutInternalId.refAudioAssetId;
      byProfileId.set(profile.id, {
        adapterId: profile.adapterId,
        voiceId: profile.voiceId,
        speedScale: 1,
        settings: settingsWithoutInternalId,
        ...(refAudioPackagePath === undefined ? {} : { refAudio: refAudioPackagePath }),
      });
      if (refAudioPackagePath !== undefined && refAudioSha256 !== undefined) {
        refByProfileId.set(profile.id, {
          path: refAudioPackagePath,
          sha256: refAudioSha256,
        });
      }

      await testSynthesis(
        adapterFor(profile.adapterId),
        config,
        profile,
        settingsWithoutInternalId as VoiceProfileExtras,
        refAudioPath,
      );
    }

    const voice = byProfileId.get(profile.id)!;
    const ref = refByProfileId.get(profile.id);
    manifestVoices.push({
      speakerId: speaker.id,
      characterId: speaker.characterId,
      adapterId: voice.adapterId,
      voiceId: voice.voiceId,
      refAudio: ref?.path ?? null,
      refAudioSha256: ref?.sha256 ?? null,
      testSynthesis: "ok",
    });
  }

  return { byProfileId, manifestVoices };
}

export function voiceForSpeaker(
  speaker: ResolvedSpeaker,
  voices: PreparedVoices,
): LiveSpeakerVoice {
  if (speaker.voiceProfileId === null) {
    throw new LiveExportError(
      "LIVE_EXPORT_INPUT_INVALID",
      "voice",
      `話者 ${speaker.id} に声プロファイルがありません。`,
      speaker.id,
    );
  }
  const voice = voices.byProfileId.get(speaker.voiceProfileId);
  if (voice === undefined) {
    throw new LiveExportError(
      "LIVE_EXPORT_INPUT_INVALID",
      "voice",
      `声のスナップショットが見つかりません: ${speaker.voiceProfileId}`,
      speaker.voiceProfileId,
    );
  }
  return voice;
}
