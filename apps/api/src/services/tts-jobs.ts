import {
  MAX_TTS_SPEECH_TEXT_LENGTH,
  SNAPSHOT_SCHEMA_VERSION,
  ttsJobSnapshotSchema,
  voiceAdapterIdSchema,
  voiceProfileSettingsSchema,
  type ContentDocument,
  type CreateTtsJobRequest,
  type Job as JobDto,
  type NarrationSegment,
  type TtsVoice,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { toJob } from "../dto/mappers.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import { getTtsAdapter, TtsEngineUnavailableError } from "../tts/index.ts";

function findSegment(
  content: ContentDocument,
  narrationSegmentId: string,
): NarrationSegment | undefined {
  for (const scene of content.scenes) {
    const segment = scene.lines.find((line) => line.id === narrationSegmentId);
    if (segment !== undefined) {
      return segment;
    }
  }
  return undefined;
}

function ttsInputIssue(path: (string | number)[], message: string): ApiError {
  return new ApiError(422, "TTS_INPUT_INVALID", undefined, {
    issues: [{ path, code: "invalid_value", message }],
  });
}

function findVoice(voices: TtsVoice[], voiceId: string): TtsVoice | undefined {
  return voices.find((voice) => voice.voiceId === voiceId);
}

export async function createTtsJob(
  prisma: PrismaClient,
  config: AppConfig,
  scriptVersionId: string,
  narrationSegmentId: string,
  input: CreateTtsJobRequest,
): Promise<JobDto> {
  const row = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
    include: { languageEdition: { select: { id: true, workId: true } } },
  });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }

  let content: ContentDocument;
  try {
    content = deserializeContent(row.contentJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
  }

  const segment = findSegment(content, narrationSegmentId);
  if (segment === undefined) {
    throw resourceNotFound("narration_segment", narrationSegmentId);
  }
  const speechText = (input.speechText ?? segment.speechText).trim();
  if (speechText.length === 0) {
    throw ttsInputIssue(["speechText"], "読み上げテキストが空です。");
  }
  if (speechText.length > MAX_TTS_SPEECH_TEXT_LENGTH) {
    throw ttsInputIssue(["speechText"], "読み上げテキストが長すぎます。");
  }
  if (segment.speakerId === null) {
    throw ttsInputIssue(["speakerId"], "このセリフに話者が設定されていません。");
  }
  const speaker = content.speakers.find((entry) => entry.id === segment.speakerId);
  if (speaker === undefined) {
    throw ttsInputIssue(["speakerId"], "話者が台本に見つかりません。");
  }
  if (speaker.voiceProfileId === null) {
    throw ttsInputIssue(["voiceProfileId"], "話者に声プロファイルが設定されていません。");
  }

  const profileRow = await prisma.voiceProfile.findUnique({
    where: { id: speaker.voiceProfileId },
  });
  if (profileRow === null) {
    throw ttsInputIssue(["voiceProfileId"], "声プロファイルが見つかりません。");
  }
  const adapterId = voiceAdapterIdSchema.safeParse(profileRow.adapterId);
  if (!adapterId.success) {
    throw ttsInputIssue(["adapterId"], "未対応の音声アダプターです。");
  }
  let settings: { speakerUuid: string; defaultStyleId: number };
  let rawSettings: unknown;
  try {
    rawSettings = JSON.parse(profileRow.settingsJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "声プロファイルの設定を解釈できません。");
  }
  const parsedSettings = voiceProfileSettingsSchema.safeParse(rawSettings);
  if (!parsedSettings.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "声プロファイルの設定が不正です。");
  }
  settings = parsedSettings.data;

  const styleId = input.styleId ?? settings.defaultStyleId;
  const adapter = getTtsAdapter(adapterId.data);

  let voices: TtsVoice[];
  let engineVersion: string | null;
  try {
    const listing = await adapter.listVoices(config.voicevoxBaseUrl);
    voices = listing.voices;
    engineVersion = listing.engineVersion;
  } catch (error) {
    if (error instanceof TtsEngineUnavailableError) {
      throw new ApiError(503, "TTS_ENGINE_UNAVAILABLE");
    }
    throw error;
  }

  const voice = findVoice(voices, settings.speakerUuid);
  if (voice === undefined) {
    throw ttsInputIssue(
      ["voiceProfileId"],
      "選択した話者が現在のエンジンに見つかりません。声プロファイルを見直してください。",
    );
  }
  if (!voice.styles.some((style) => style.styleId === styleId)) {
    throw ttsInputIssue(["styleId"], "この話者で使えないスタイルです。");
  }

  const snapshot = ttsJobSnapshotSchema.parse({
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "tts",
    scriptVersionId: row.id,
    narrationSegmentId,
    languageEditionId: row.languageEdition.id,
    workId: row.languageEdition.workId,
    speakerId: speaker.id,
    voiceProfileId: speaker.voiceProfileId,
    adapterId: adapterId.data,
    voice: { voiceId: voice.voiceId, styleId },
    speedScale: input.speedScale,
    speechText,
    engineVersion,
  });

  const created = await prisma.job.create({
    data: {
      kind: "tts",
      status: "queued",
      workId: row.languageEdition.workId,
      languageEditionId: row.languageEdition.id,
      scriptVersionId: row.id,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      inputSnapshotJson: JSON.stringify(snapshot),
    },
    include: { artifacts: true },
  });
  return toJob(created);
}
