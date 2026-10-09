import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  RENDITION_PURPOSE,
  SNAPSHOT_SCHEMA_VERSION,
  assetIngestJobSnapshotSchema,
  assetKindSchema,
  type AssetKindName,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { bigIntToSafeNumber } from "../dto/mappers.ts";
import type { Job, Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { renditionPlanFor, requiresRenderRendition } from "../media/classify.ts";
import { createRendition } from "../media/normalize.ts";
import { probeMedia } from "../media/probe.ts";
import {
  commitFile,
  fileMatches,
  hashFile,
  renditionStorageKey,
  removeStorageFile,
  resolveStoragePath,
} from "../storage/asset-store.ts";

interface RenditionRecord {
  storageKey: string;
  mediaType: string;
  sha256: string;
  byteSize: number;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
}

async function buildRendition(
  config: AppConfig,
  kind: AssetKindName,
  originalPath: string,
): Promise<{ record: RenditionRecord; durationMs: number | null; widthPx: number | null; heightPx: number | null }> {
  const plan = renditionPlanFor(kind);
  const tempOutput = join(config.directories.tmp, `rendition-${randomUUID()}.${plan.extension}`);
  try {
    await createRendition(originalPath, tempOutput, kind);
    const digest = await hashFile(tempOutput);
    const probe = await probeMedia(tempOutput, kind, plan.mediaType);
    const storageKey = renditionStorageKey(digest.sha256);
    await commitFile(tempOutput, storageKey, config.directories);
    return {
      record: {
        storageKey,
        mediaType: plan.mediaType,
        sha256: digest.sha256,
        byteSize: digest.byteSize,
        durationMs: probe.durationMs,
        widthPx: probe.widthPx,
        heightPx: probe.heightPx,
      },
      durationMs: probe.durationMs,
      widthPx: probe.widthPx,
      heightPx: probe.heightPx,
    };
  } catch (error) {
    await rm(tempOutput, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function processAssetIngest(
  prisma: PrismaClient,
  config: AppConfig,
  job: Job,
): Promise<void> {
  const snapshot = assetIngestJobSnapshotSchema.parse(JSON.parse(job.inputSnapshotJson));
  const asset = await prisma.asset.findUnique({ where: { id: snapshot.assetId } });
  if (asset === null) {
    throw new Error("取り込み対象の素材が見つかりません。");
  }
  const kind = assetKindSchema.parse(asset.kind);
  const originalPath = resolveStoragePath(config.directories, asset.storageKey);
  const matches = await fileMatches(
    originalPath,
    asset.sha256,
    bigIntToSafeNumber(asset.byteSize),
  );
  if (!matches) {
    throw new Error("原本ファイルが見つからないか、内容が改変されています。");
  }

  const originalProbe = await probeMedia(originalPath, kind, asset.mediaType);
  let rendition: RenditionRecord | null = null;
  let finalProbe = originalProbe;
  if (requiresRenderRendition(originalProbe)) {
    const built = await buildRendition(config, kind, originalPath);
    rendition = built.record;
    finalProbe = {
      ...originalProbe,
      durationMs: built.durationMs,
      widthPx: built.widthPx,
      heightPx: built.heightPx,
    };
  }

  const durationMs = kind === "image" ? null : finalProbe.durationMs;
  const widthPx = kind === "audio" ? null : finalProbe.widthPx;
  const heightPx = kind === "audio" ? null : finalProbe.heightPx;

  const previousRendition = await prisma.assetRendition.findUnique({
    where: { assetId_purpose: { assetId: asset.id, purpose: RENDITION_PURPOSE } },
  });

  await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
    if (rendition !== null) {
      await transaction.assetRendition.upsert({
        where: { assetId_purpose: { assetId: asset.id, purpose: RENDITION_PURPOSE } },
        create: { assetId: asset.id, purpose: RENDITION_PURPOSE, ...rendition },
        update: rendition,
      });
    } else {
      await transaction.assetRendition.deleteMany({
        where: { assetId: asset.id, purpose: RENDITION_PURPOSE },
      });
    }
    await transaction.asset.update({
      where: { id: asset.id },
      data: { status: "ready", durationMs, widthPx, heightPx },
    });
    await transaction.job.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        progressPercent: 100,
        finishedAt: new Date(),
        resultJson: JSON.stringify({
          snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
          kind: "asset_ingest",
          assetId: asset.id,
          status: "ready",
          rendition: rendition !== null,
        }),
      },
    });
  });

  if (previousRendition !== null && previousRendition.storageKey !== rendition?.storageKey) {
    const stillReferenced = await prisma.assetRendition.count({
      where: { storageKey: previousRendition.storageKey, assetId: { not: asset.id } },
    });
    if (stillReferenced === 0) {
      await removeStorageFile(config.directories, previousRendition.storageKey).catch(() => undefined);
    }
  }
}
