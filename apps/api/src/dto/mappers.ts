import { z } from "zod";
import {
  assetKindSchema,
  assetOriginSchema,
  assetStatusSchema,
  jobStatusSchema,
  localeSchema,
  type Asset,
  type LanguageEditionSummary,
  type ScriptVersion,
  type ScriptVersionSummary,
  type Work,
  type WorkSummary,
} from "@kakeai/contracts";
import type {
  Asset as AssetRow,
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

function parseAssetEnum<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(500, "INTERNAL_ERROR", `Asset.${field} の値が不正です。`);
  }
  return result.data;
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
