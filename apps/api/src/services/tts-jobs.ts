import {
  DEFAULT_TTS_SPEED_SCALE,
  MAX_TTS_SPEECH_TEXT_LENGTH,
  SNAPSHOT_SCHEMA_VERSION,
  ttsJobSnapshotSchema,
  openAiAdapterExtrasSchema,
  voiceAdapterDescriptorFor,
  voiceAdapterIdSchema,
  voiceProfileExtrasSchemaFor,
  type BulkTtsJobEntry,
  type BulkTtsJobExclusion,
  type BulkTtsJobsResult,
  type ContentDocument,
  type CreateTtsJobRequest,
  type Job as JobDto,
  type NarrationSegment,
  type TtsJobSnapshot,
  type TtsVoice,
  type TtsVoiceListing,
  type VoiceAdapterId,
  type VoiceProfileExtras,
} from "@kakeai/contracts";
import { resolveVoiceBaseUrl, type AppConfig } from "../config.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { toJob } from "../dto/mappers.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import { getTtsAdapter, TtsEngineUnavailableError } from "../tts/index.ts";
import { findReadyAudioAsset } from "./assets.ts";

interface LoadedScriptVersion {
  id: string;
  contentJson: string;
  languageEdition: { id: string; workId: string };
}

interface TtsJobCaches {
  voiceListings: Map<string, TtsVoiceListing>;
  voiceListingErrors: Map<string, ApiError>;
}

function voiceCacheKey(adapterId: VoiceAdapterId, settings: VoiceProfileExtras | null): string {
  const parsedModel = settings === null ? null : openAiAdapterExtrasSchema.safeParse(settings);
  const model = parsedModel !== null && parsedModel.success ? parsedModel.data.model.trim() : "";
  return `${adapterId}\u0000${model}`;
}

function emptyCaches(): TtsJobCaches {
  return { voiceListings: new Map(), voiceListingErrors: new Map() };
}

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

const MAX_SNAPSHOT_NAME_LENGTH = 200;

function truncateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let truncated = trimmed.slice(0, MAX_SNAPSHOT_NAME_LENGTH);
  const lastCode = truncated.charCodeAt(truncated.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  truncated = truncated.trimEnd();
  return truncated.length === 0 ? undefined : truncated;
}

async function loadScriptVersion(
  prisma: PrismaClient,
  scriptVersionId: string,
): Promise<LoadedScriptVersion> {
  const row = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
    include: { languageEdition: { select: { id: true, workId: true } } },
  });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }
  return { id: row.id, contentJson: row.contentJson, languageEdition: row.languageEdition };
}

function deserializeContentOrThrow(contentJson: string): ContentDocument {
  try {
    return deserializeContent(contentJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
  }
}

function exclusionMessage(error: ApiError): string {
  const details = error.details;
  if (typeof details === "object" && details !== null) {
    const issues = (details as { issues?: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const message = (issues[0] as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
    }
  }
  return error.message;
}

async function listVoicesCached(
  config: AppConfig,
  adapterId: VoiceAdapterId,
  settings: VoiceProfileExtras | null,
  caches: TtsJobCaches,
): Promise<TtsVoiceListing> {
  const key = voiceCacheKey(adapterId, settings);
  const cached = caches.voiceListings.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const cachedError = caches.voiceListingErrors.get(key);
  if (cachedError !== undefined) {
    throw cachedError;
  }
  const adapter = getTtsAdapter(adapterId);
  let listing: TtsVoiceListing;
  try {
    listing = await adapter.listVoices(
      { baseUrl: resolveVoiceBaseUrl(config, adapterId) },
      { settings },
    );
  } catch (error) {
    if (error instanceof TtsEngineUnavailableError) {
      const apiError = new ApiError(503, "TTS_ENGINE_UNAVAILABLE");
      caches.voiceListingErrors.set(key, apiError);
      throw apiError;
    }
    throw error;
  }
  caches.voiceListings.set(key, listing);
  return listing;
}

async function prepareTtsJobSnapshot(
  prisma: PrismaClient,
  config: AppConfig,
  row: LoadedScriptVersion,
  content: ContentDocument,
  segment: NarrationSegment,
  input: CreateTtsJobRequest,
  caches: TtsJobCaches,
): Promise<TtsJobSnapshot> {
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

  let rawSettings: unknown;
  try {
    rawSettings = JSON.parse(profileRow.settingsJson);
  } catch {
    throw ttsInputIssue(["voiceProfileId"], "声プロファイルの設定を解釈できません。設定を見直してください。");
  }
  const parsedSettings = voiceProfileExtrasSchemaFor(adapterId.data).safeParse(rawSettings);
  if (!parsedSettings.success) {
    throw ttsInputIssue(["voiceProfileId"], "声プロファイルの設定が不正です。設定を見直してください。");
  }
  const settings = parsedSettings.data;

  if (adapterId.data === "openai-compatible") {
    const openAiSettings = openAiAdapterExtrasSchema.safeParse(settings);
    if (openAiSettings.success && openAiSettings.data.refAudioAssetId !== undefined) {
      const usable = await findReadyAudioAsset(prisma, openAiSettings.data.refAudioAssetId);
      if (usable === null) {
        throw ttsInputIssue(
          ["voiceProfileId"],
          "参照音声の素材が利用できません。声プロファイルを見直してください。",
        );
      }
    }
  }

  const descriptor = voiceAdapterDescriptorFor(adapterId.data);
  const voiceId = (input.voiceId ?? profileRow.voiceId).trim();
  if (voiceId.length === 0) {
    throw ttsInputIssue(["voiceProfileId"], "声の指定が空です。");
  }
  const listing = await listVoicesCached(config, adapterId.data, settings, caches);
  const voice = findVoice(listing.voices, voiceId);
  if (voice === undefined && descriptor.voiceSelection !== "list-or-manual") {
    throw ttsInputIssue(
      ["voiceProfileId"],
      "選択した声が現在のエンジンに見つかりません。声プロファイルを見直してください。",
    );
  }

  const snapshot = ttsJobSnapshotSchema.safeParse({
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "tts",
    scriptVersionId: row.id,
    narrationSegmentId: segment.id,
    languageEditionId: row.languageEdition.id,
    workId: row.languageEdition.workId,
    speakerId: speaker.id,
    speakerName: truncateName(speaker.name),
    voiceProfileId: speaker.voiceProfileId,
    adapterId: adapterId.data,
    voice: { voiceId },
    voiceName: voice === undefined ? undefined : truncateName(voice.name),
    settings,
    speedScale: input.speedScale,
    speechText,
    engineVersion: listing.engineVersion,
  });
  if (!snapshot.success) {
    throw ttsInputIssue([], "音声生成の情報を組み立てられませんでした。");
  }
  return snapshot.data;
}

function jobCreateData(row: LoadedScriptVersion, snapshot: TtsJobSnapshot) {
  return {
    kind: "tts" as const,
    status: "queued" as const,
    workId: row.languageEdition.workId,
    languageEditionId: row.languageEdition.id,
    scriptVersionId: row.id,
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    inputSnapshotJson: JSON.stringify(snapshot),
  };
}

export async function createTtsJob(
  prisma: PrismaClient,
  config: AppConfig,
  scriptVersionId: string,
  narrationSegmentId: string,
  input: CreateTtsJobRequest,
): Promise<JobDto> {
  const row = await loadScriptVersion(prisma, scriptVersionId);
  const content = deserializeContentOrThrow(row.contentJson);
  const segment = findSegment(content, narrationSegmentId);
  if (segment === undefined) {
    throw resourceNotFound("narration_segment", narrationSegmentId);
  }
  const snapshot = await prepareTtsJobSnapshot(
    prisma,
    config,
    row,
    content,
    segment,
    input,
    emptyCaches(),
  );
  const created = await prisma.job.create({
    data: jobCreateData(row, snapshot),
    include: { artifacts: true },
  });
  return toJob(created);
}

export async function createBulkTtsJobs(
  prisma: PrismaClient,
  config: AppConfig,
  scriptVersionId: string,
): Promise<BulkTtsJobsResult> {
  const row = await loadScriptVersion(prisma, scriptVersionId);
  const content = deserializeContentOrThrow(row.contentJson);
  const caches = emptyCaches();
  const prepared: { narrationSegmentId: string; snapshot: TtsJobSnapshot }[] = [];
  const excluded: BulkTtsJobExclusion[] = [];
  for (const scene of content.scenes) {
    if (scene.kind !== "point") {
      continue;
    }
    for (const segment of scene.lines) {
      if (segment.selectedAudioTakeId !== null) {
        continue;
      }
      try {
        const snapshot = await prepareTtsJobSnapshot(
          prisma,
          config,
          row,
          content,
          segment,
          { speedScale: DEFAULT_TTS_SPEED_SCALE },
          caches,
        );
        prepared.push({ narrationSegmentId: segment.id, snapshot });
      } catch (error) {
        if (error instanceof ApiError) {
          excluded.push({
            narrationSegmentId: segment.id,
            code: error.code,
            message: exclusionMessage(error),
          });
          continue;
        }
        throw error;
      }
    }
  }

  if (prepared.length === 0) {
    return { jobs: [], excluded };
  }
  const rows = await prisma.$transaction(
    prepared.map((entry) =>
      prisma.job.create({ data: jobCreateData(row, entry.snapshot), include: { artifacts: true } }),
    ),
  );
  const jobs: BulkTtsJobEntry[] = rows.map((created, index) => ({
    narrationSegmentId: prepared[index]!.narrationSegmentId,
    job: toJob(created),
  }));
  return { jobs, excluded };
}
