import { z } from "zod";
import {
  artifactFormatSchema,
  artifactRoleSchema,
  assetKindSchema,
  assetOriginSchema,
  assetStatusSchema,
  jobErrorCodeSchema,
  jobKindSchema,
  jobStatusSchema,
  localeSchema,
  type Artifact,
  type Asset,
  type Job,
  type LanguageEditionSummary,
  type ScriptVersion,
  type ScriptVersionSummary,
  type Work,
  type WorkSummary,
} from "@kakeai/contracts";
import type {
  Artifact as ArtifactRow,
  Asset as AssetRow,
  Job as JobRow,
  LanguageEdition,
  ScriptVersion as ScriptVersionRow,
  Work as WorkRow,
} from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { API_BASE_PATH } from "../http/security.ts";

export function toIso(value: Date): string {
  return value.toISOString();
}

export function bigIntToSafeNumber(value: bigint): number {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApiError(500, "INTERNAL_ERROR", "値が安全な整数の範囲を超えています。");
  }
  return Number(value);
}

function parseEnum<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(500, "INTERNAL_ERROR", `${label} の値が不正です。`);
  }
  return result.data;
}

function parseAssetEnum<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  return parseEnum(schema, value, `Asset.${field}`);
}

export function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: parseAssetEnum(assetKindSchema, row.kind, "kind"),
    origin: parseAssetEnum(assetOriginSchema, row.origin, "origin"),
    status: parseAssetEnum(assetStatusSchema, row.status, "status"),
    originalFilename: row.originalFilename,
    mediaType: row.mediaType,
    byteSize: bigIntToSafeNumber(row.byteSize),
    sha256: row.sha256,
    durationMs: row.durationMs,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    createdAt: toIso(row.createdAt),
    contentUrl: `${API_BASE_PATH}/assets/${encodeURIComponent(row.id)}/content`,
  };
}

export interface RenderJobRefRow {
  id: string;
  status: string;
  finishedAt: Date | null;
}

export interface CurrentScriptVersionRef {
  id: string;
  versionNumber: number;
  createdAt: Date;
}

export type EditionWithCurrent = LanguageEdition & {
  currentScriptVersion: CurrentScriptVersionRef | null;
};

export function toLanguageEditionSummary(
  edition: EditionWithCurrent,
  latestRenderJob: RenderJobRefRow | undefined,
): LanguageEditionSummary {
  const current = edition.currentScriptVersion;
  if (current === null) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      `LanguageEdition ${edition.id} に currentScriptVersion がありません`,
    );
  }
  return {
    id: edition.id,
    workId: edition.workId,
    locale: localeSchema.parse(edition.locale),
    updatedAt: toIso(edition.updatedAt),
    currentScriptVersion: {
      id: current.id,
      versionNumber: current.versionNumber,
      createdAt: toIso(current.createdAt),
    },
    latestRenderJob:
      latestRenderJob === undefined
        ? null
        : {
            id: latestRenderJob.id,
            status: jobStatusSchema.parse(latestRenderJob.status),
            finishedAt: latestRenderJob.finishedAt === null ? null : toIso(latestRenderJob.finishedAt),
          },
  };
}

export function toWorkSummary(
  work: WorkRow,
  editions: readonly EditionWithCurrent[],
  latestJobs: Map<string, RenderJobRefRow>,
): WorkSummary {
  return {
    id: work.id,
    title: work.title,
    originalLocale: localeSchema.parse(work.originalLocale),
    updatedAt: toIso(work.updatedAt),
    languageEditions: editions.map((edition) =>
      toLanguageEditionSummary(edition, latestJobs.get(edition.id)),
    ),
  };
}

export function toWork(
  work: WorkRow,
  editions: readonly EditionWithCurrent[],
  latestJobs: Map<string, RenderJobRefRow>,
): Work {
  return {
    ...toWorkSummary(work, editions, latestJobs),
    createdAt: toIso(work.createdAt),
    parentWorkId: work.parentWorkId,
  };
}

export function toScriptVersionSummary(row: ScriptVersionRow): ScriptVersionSummary {
  return {
    id: row.id,
    languageEditionId: row.languageEditionId,
    versionNumber: row.versionNumber,
    contentSchemaVersion: row.contentSchemaVersion,
    createdAt: toIso(row.createdAt),
  };
}

export function toScriptVersion(
  row: ScriptVersionRow,
  content: ScriptVersion["content"],
): ScriptVersion {
  return {
    ...toScriptVersionSummary(row),
    content,
  };
}

function parseJobEnum<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  return parseEnum(schema, value, `Job.${field}`);
}

export type JobWithArtifacts = JobRow & { artifacts: ArtifactRow[] };

export function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    jobId: row.jobId,
    role: parseEnum(artifactRoleSchema, row.role, "Artifact.role"),
    format: parseEnum(artifactFormatSchema, row.format, "Artifact.format"),
    byteSize: bigIntToSafeNumber(row.byteSize),
    durationMs: row.durationMs,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    fps: row.fps,
    createdAt: toIso(row.createdAt),
    contentUrl: `${API_BASE_PATH}/artifacts/${encodeURIComponent(row.id)}/content`,
  };
}

export function toJob(row: JobWithArtifacts): Job {
  const errorCode =
    row.errorCode === null ? null : parseJobEnum(jobErrorCodeSchema, row.errorCode, "errorCode");
  return {
    id: row.id,
    kind: parseJobEnum(jobKindSchema, row.kind, "kind"),
    status: parseJobEnum(jobStatusSchema, row.status, "status"),
    workId: row.workId,
    assetId: row.assetId,
    languageEditionId: row.languageEditionId,
    scriptVersionId: row.scriptVersionId,
    progressPercent: row.progressPercent,
    createdAt: toIso(row.createdAt),
    startedAt: row.startedAt === null ? null : toIso(row.startedAt),
    finishedAt: row.finishedAt === null ? null : toIso(row.finishedAt),
    error:
      errorCode === null
        ? null
        : { code: errorCode, message: row.errorMessage ?? "" },
    artifacts: row.artifacts.map(toArtifact),
  };
}

export function renderContentUrl(assetId: string): string {
  return `${API_BASE_PATH}/assets/${encodeURIComponent(assetId)}/render-content`;
}
