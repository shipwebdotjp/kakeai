import { isPrismaCode } from "./internal";
import { rm } from "node:fs/promises";
import {
  SNAPSHOT_SCHEMA_VERSION,
  assetIngestJobSnapshotSchema,
  type Asset,
  type AssetKindName,
} from "@kakeai/contracts";
import type { LimitsConfig } from "../../config.ts";
import { bigIntToSafeNumber, toAsset } from "../../dto/mappers.ts";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { allowedMediaTypes, detectMedia } from "../../media/kind.ts";
import { probeMedia, type MediaProbe } from "../../media/probe.ts";
import {
  assetStorageKey,
  commitFile,
  fileMatches,
  removeStorageFile,
  resolveStoragePath,
} from "../../storage/asset-store.ts";
import type { DataDirectories } from "../../storage/paths.ts";

export interface UploadInput {
  tempPath: string;
  originalFilename: string;
  sha256: string;
  byteSize: number;
  /** Defaults to `uploaded`. Agent imports with provenance are `generated`. */
  origin?: "uploaded" | "generated";
  /** Optional JSON provenance (model, prompt, generation parameters). */
  provenanceJson?: string;
}

export interface IngestOutcome {
  asset: Asset;
  deduplicated: boolean;
  httpStatus: 200 | 202;
  /** The enqueued ingest job, or null when an already-ready asset was reused. */
  jobId: string | null;
}

export interface ContentLocation {
  path: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}

type Transaction = Prisma.TransactionClient;

function limitViolation(
  probe: MediaProbe,
  limits: LimitsConfig,
): { measured: Record<string, number>; limits: Record<string, number> } | null {
  const measured: Record<string, number> = {};
  const exceeded: Record<string, number> = {};
  if (
    probe.durationMs !== null &&
    probe.durationMs > limits.maxMediaDurationMs
  ) {
    measured.durationMs = probe.durationMs;
    exceeded.maxMediaDurationMs = limits.maxMediaDurationMs;
  }
  if (probe.widthPx !== null && probe.widthPx > limits.maxWidthPx) {
    measured.widthPx = probe.widthPx;
    exceeded.maxWidthPx = limits.maxWidthPx;
  }
  if (probe.heightPx !== null && probe.heightPx > limits.maxHeightPx) {
    measured.heightPx = probe.heightPx;
    exceeded.maxHeightPx = limits.maxHeightPx;
  }
  return Object.keys(measured).length > 0
    ? { measured, limits: exceeded }
    : null;
}

function createIngestJob(
  transaction: Transaction,
  asset: { id: string; sha256: string; mediaType: string; storageKey: string },
) {
  const snapshot = assetIngestJobSnapshotSchema.parse({
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "asset_ingest",
    assetId: asset.id,
    sha256: asset.sha256,
    mediaType: asset.mediaType,
    storageKey: asset.storageKey,
  });
  return transaction.job.create({
    data: {
      kind: "asset_ingest",
      status: "queued",
      assetId: asset.id,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      inputSnapshotJson: JSON.stringify(snapshot),
    },
  });
}

async function inspectUpload(
  tempPath: string,
  limits: LimitsConfig,
): Promise<{ kind: AssetKindName; mediaType: string; probe: MediaProbe }> {
  const detected = await detectMedia(tempPath);
  if (detected === null) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", undefined, {
      allowedMediaTypes: allowedMediaTypes(),
    });
  }
  let probe: MediaProbe;
  try {
    probe = await probeMedia(tempPath, detected.kind, detected.mediaType);
  } catch {
    throw new ApiError(422, "MEDIA_INSPECTION_FAILED");
  }
  const violation = limitViolation(probe, limits);
  if (violation !== null) {
    throw new ApiError(422, "MEDIA_LIMIT_EXCEEDED", undefined, violation);
  }
  return { kind: detected.kind, mediaType: detected.mediaType, probe };
}

/**
 * Reuses an existing asset. Provenance is additive: the first metadata that
 * described the bytes wins, so a later agent import never relabels a human
 * upload or replaces TTS generation metadata.
 */
async function requeueExisting(
  prisma: PrismaClient,
  existing: {
    id: string;
    sha256: string;
    mediaType: string;
    storageKey: string;
    provenanceJson: string | null;
  },
  provenanceJson?: string,
): Promise<IngestOutcome> {
  const { asset: updated, job } = await prisma.$transaction(
    async (transaction) => {
      const asset = await transaction.asset.update({
        where: { id: existing.id },
        data: { status: "processing" },
      });
      if (provenanceJson !== undefined) {
        // Conditional update: never replace provenance that already exists.
        await transaction.asset.updateMany({
          where: { id: existing.id, provenanceJson: null },
          data: { provenanceJson },
        });
      }
      const job = await createIngestJob(transaction, asset);
      return { asset, job };
    },
  );
  return {
    asset: toAsset(updated),
    deduplicated: true,
    httpStatus: 202,
    jobId: job.id,
  };
}

async function storeProvenance(
  prisma: PrismaClient,
  existing: { id: string; provenanceJson: string | null },
  provenanceJson: string | undefined,
): Promise<void> {
  if (existing.provenanceJson !== null || provenanceJson === undefined) {
    return;
  }
  // Conditional update: only the first provenance that describes these bytes wins.
  await prisma.asset.updateMany({
    where: { id: existing.id, provenanceJson: null },
    data: { provenanceJson },
  });
}

/** The in-flight ingest Job for an asset that is still processing, if any. */
async function pendingIngestJobId(
  prisma: PrismaClient,
  assetId: string,
): Promise<string | null> {
  const job = await prisma.job.findFirst({
    where: {
      assetId,
      kind: "asset_ingest",
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return job?.id ?? null;
}

export async function ingestUpload(
  prisma: PrismaClient,
  directories: DataDirectories,
  limits: LimitsConfig,
  input: UploadInput,
): Promise<IngestOutcome> {
  const storageKey = assetStorageKey(input.sha256);

  const existing = await prisma.asset.findUnique({
    where: { sha256: input.sha256 },
  });
  if (existing !== null) {
    const filePath = resolveStoragePath(directories, existing.storageKey);
    const matches = await fileMatches(
      filePath,
      existing.sha256,
      bigIntToSafeNumber(existing.byteSize),
    );
    if (matches && existing.status !== "failed") {
      await rm(input.tempPath, { force: true });
      await storeProvenance(prisma, existing, input.provenanceJson);
      return {
        asset: toAsset(existing),
        deduplicated: true,
        httpStatus: existing.status === "ready" ? 200 : 202,
        jobId:
          existing.status === "ready"
            ? null
            : await pendingIngestJobId(prisma, existing.id),
      };
    }
    await inspectUpload(input.tempPath, limits);
    if (matches) {
      await rm(input.tempPath, { force: true });
    } else {
      await commitFile(input.tempPath, existing.storageKey, directories);
    }
    return requeueExisting(prisma, existing, input.provenanceJson);
  }

  const { kind, mediaType } = await inspectUpload(input.tempPath, limits);
  await commitFile(input.tempPath, storageKey, directories);
  try {
    const { asset: created, jobId } = await prisma.$transaction(
      async (transaction) => {
        const asset = await transaction.asset.create({
          data: {
            kind,
            origin: input.origin ?? "uploaded",
            status: "processing",
            storageKey,
            originalFilename: input.originalFilename,
            mediaType,
            byteSize: BigInt(input.byteSize),
            sha256: input.sha256,
            ...(input.provenanceJson === undefined
              ? {}
              : { provenanceJson: input.provenanceJson }),
          },
        });
        const job = await createIngestJob(transaction, asset);
        return { asset, jobId: job.id };
      },
    );
    return {
      asset: toAsset(created),
      deduplicated: false,
      httpStatus: 202,
      jobId,
    };
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      const raced = await prisma.asset.findUnique({
        where: { sha256: input.sha256 },
      });
      if (raced !== null) {
        return requeueExisting(prisma, raced, input.provenanceJson);
      }
    }
    const claimed = await prisma.asset
      .findUnique({ where: { sha256: input.sha256 } })
      .catch(() => null);
    if (claimed === null) {
      await removeStorageFile(directories, storageKey).catch(() => undefined);
    }
    throw error;
  }
}
