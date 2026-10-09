import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ttsJobSnapshotSchema, type TtsJobResult, type TtsJobSnapshot } from "@kakeai/contracts";
import { resolveVoiceBaseUrl, type AppConfig } from "../config.ts";
import { bigIntToSafeNumber } from "../dto/mappers.ts";
import type { Job, PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import { probeMedia } from "../media/probe.ts";
import {
  assetStorageKey,
  commitFile,
  fileMatches,
  hashFile,
  removeStorageFile,
  resolveStoragePath,
} from "../storage/asset-store.ts";
import {
  getTtsAdapter,
  TtsEngineUnavailableError,
  TtsInputRejectedError,
} from "../tts/index.ts";

export type TtsErrorCode =
  | "TTS_ENGINE_UNAVAILABLE"
  | "TTS_INPUT_REJECTED"
  | "TTS_SYNTHESIS_FAILED";

export class TtsJobError extends Error {
  readonly code: TtsErrorCode;

  constructor(code: TtsErrorCode, message: string) {
    super(message);
    this.name = "TtsJobError";
    this.code = code;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function parseSnapshot(job: Job): TtsJobSnapshot {
  try {
    return ttsJobSnapshotSchema.parse(JSON.parse(job.inputSnapshotJson));
  } catch {
    throw new TtsJobError("TTS_SYNTHESIS_FAILED", "TTS入力を解釈できません。");
  }
}

export async function processTtsJob(
  prisma: PrismaClient,
  config: AppConfig,
  job: Job,
): Promise<void> {
  const snapshot = parseSnapshot(job);
  const adapter = getTtsAdapter(snapshot.adapterId);

  const tempPath = join(config.directories.tmp, `tts-${randomUUID()}.wav`);
  let committed = false;
  try {
    let audio: Uint8Array;
    try {
      audio = (
        await adapter.synthesize(resolveVoiceBaseUrl(config, snapshot.adapterId), {
          text: snapshot.speechText,
          styleId: snapshot.voice.styleId,
          speedScale: snapshot.speedScale,
        })
      ).data;
    } catch (error) {
      if (error instanceof TtsEngineUnavailableError) {
        throw new TtsJobError("TTS_ENGINE_UNAVAILABLE", error.message);
      }
      if (error instanceof TtsInputRejectedError) {
        throw new TtsJobError("TTS_INPUT_REJECTED", error.message);
      }
      throw new TtsJobError("TTS_SYNTHESIS_FAILED", "音声の合成に失敗しました。");
    }

    await writeFile(tempPath, audio);
    const digest = await hashFile(tempPath);
    let durationMs: number | null;
    try {
      durationMs = (await probeMedia(tempPath, "audio", "audio/wav")).durationMs;
    } catch {
      throw new TtsJobError("TTS_SYNTHESIS_FAILED", "生成音声の情報を取得できませんでした。");
    }
    if (durationMs === null) {
      throw new TtsJobError("TTS_SYNTHESIS_FAILED", "生成音声の長さを取得できませんでした。");
    }

    const provenance = {
      adapterId: snapshot.adapterId,
      voiceId: snapshot.voice.voiceId,
      styleId: snapshot.voice.styleId,
      speedScale: snapshot.speedScale,
      engineVersion: snapshot.engineVersion,
      voiceProfileId: snapshot.voiceProfileId,
      speakerId: snapshot.speakerId,
      scriptVersionId: snapshot.scriptVersionId,
      narrationSegmentId: snapshot.narrationSegmentId,
    };

    const existing = await prisma.asset.findUnique({ where: { sha256: digest.sha256 } });
    let assetId: string;
    let takeDurationMs: number;
    if (existing !== null) {
      const path = resolveStoragePath(config.directories, existing.storageKey);
      const matches = await fileMatches(
        path,
        digest.sha256,
        bigIntToSafeNumber(existing.byteSize),
      );
      if (matches) {
        await rm(tempPath, { force: true });
      } else {
        await commitFile(tempPath, existing.storageKey, config.directories);
        committed = true;
      }
      const updated = await prisma.asset.update({
        where: { id: existing.id },
        data: {
          status: "ready",
          durationMs: existing.durationMs ?? durationMs,
        },
      });
      assetId = updated.id;
      takeDurationMs = updated.durationMs ?? durationMs;
    } else {
      const storageKey = assetStorageKey(digest.sha256);
      await commitFile(tempPath, storageKey, config.directories);
      committed = true;
      try {
        const created = await prisma.asset.create({
          data: {
            kind: "audio",
            origin: "generated",
            status: "ready",
            storageKey,
            originalFilename: `tts-${snapshot.narrationSegmentId}.wav`,
            mediaType: "audio/wav",
            byteSize: BigInt(digest.byteSize),
            sha256: digest.sha256,
            durationMs,
            provenanceJson: JSON.stringify(provenance),
            generatedByJobId: job.id,
          },
        });
        assetId = created.id;
        takeDurationMs = durationMs;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          const stillReferenced = await prisma.asset
            .findUnique({ where: { sha256: digest.sha256 }, select: { id: true } })
            .catch(() => null);
          if (stillReferenced === null) {
            await removeStorageFile(config.directories, storageKey).catch(() => undefined);
          }
          committed = false;
          throw error;
        }
        const raced = await prisma.asset.findUnique({ where: { sha256: digest.sha256 } });
        if (raced === null) {
          throw error;
        }
        const reused = await prisma.asset.update({
          where: { id: raced.id },
          data: { status: "ready", durationMs: raced.durationMs ?? durationMs },
        });
        assetId = reused.id;
        takeDurationMs = reused.durationMs ?? durationMs;
      }
    }

    const result: TtsJobResult = {
      narrationSegmentId: snapshot.narrationSegmentId,
      assetId,
      durationMs: takeDurationMs,
      source: "tts",
    };
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        progressPercent: 100,
        finishedAt: new Date(),
        resultJson: JSON.stringify(result),
      },
    });
    logger.info("tts_succeeded", { jobId: job.id, assetId });
  } catch (error) {
    if (!committed) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}
