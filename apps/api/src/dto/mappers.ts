import {
  jobStatusSchema,
  localeSchema,
  type LanguageEditionSummary,
  type ScriptVersion,
  type ScriptVersionSummary,
  type Work,
  type WorkSummary,
} from "@kakeai/contracts";
import type {
  LanguageEdition,
  ScriptVersion as ScriptVersionRow,
  Work as WorkRow,
} from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";

export function toIso(value: Date): string {
  return value.toISOString();
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
