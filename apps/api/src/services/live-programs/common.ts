import {
  liveProgramDocumentSchema,
  liveProgramVersionDocumentSchema,
  liveResolutionSnapshotSchema,
  type LiveProgramDetail,
  type LiveProgramDocument,
  type LiveProgramSummary,
  type LiveProgramVersionDetail,
  type LiveProgramVersionSummary,
} from "@kakeai/contracts";
import { ApiError } from "../../http/errors.ts";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";

export type LiveDb = PrismaClient | Prisma.TransactionClient;

export interface ProgramFields {
  id: string;
  title: string;
  draftJson: string;
  draftRevision: number;
  sourceFormatId: string | null;
  sourceFormatUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VersionFields {
  id: string;
  programId: string;
  versionNumber: number;
  schemaVersion: number;
  documentJson: string;
  documentSha256: string;
  resolutionSnapshotJson: string;
  resolutionSnapshotSha256: string;
  note: string | null;
  createdAt: Date;
}

/** A version list/detail summary never needs the large JSON documents. */
export type VersionSummaryFields = Omit<
  VersionFields,
  "documentJson" | "resolutionSnapshotJson"
>;

const versionSummarySelect = {
  id: true,
  programId: true,
  versionNumber: true,
  schemaVersion: true,
  documentSha256: true,
  resolutionSnapshotSha256: true,
  note: true,
  createdAt: true,
} satisfies Prisma.LiveProgramVersionSelect;

const programDetailSelect = {
  id: true,
  title: true,
  draftJson: true,
  draftRevision: true,
  sourceFormatId: true,
  sourceFormatUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  versions: {
    orderBy: { versionNumber: "desc" },
    select: versionSummarySelect,
  },
} satisfies Prisma.LiveProgramSelect;

export function parseLiveProgramDocumentJson(json: string): LiveProgramDocument {
  try {
    return liveProgramDocumentSchema.parse(JSON.parse(json));
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの Live Program を解釈できません。");
  }
}

export function parseLiveProgramVersionDocumentJson(json: string): LiveProgramDocument {
  try {
    return liveProgramVersionDocumentSchema.parse(JSON.parse(json));
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの Live Program Version を解釈できません。");
  }
}

function parseResolutionSnapshotJson(json: string) {
  try {
    return liveResolutionSnapshotSchema.parse(JSON.parse(json));
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの解決スナップショットを解釈できません。");
  }
}

export function toVersionSummary(row: VersionSummaryFields): LiveProgramVersionSummary {
  return {
    id: row.id,
    programId: row.programId,
    versionNumber: row.versionNumber,
    schemaVersion: row.schemaVersion,
    documentSha256: row.documentSha256,
    resolutionSnapshotSha256: row.resolutionSnapshotSha256,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toVersionDetail(row: VersionFields): LiveProgramVersionDetail {
  return {
    ...toVersionSummary(row),
    document: parseLiveProgramVersionDocumentJson(row.documentJson),
    resolutionSnapshot: parseResolutionSnapshotJson(row.resolutionSnapshotJson),
  };
}

export function toProgramSummary(
  row: ProgramFields,
  versions: readonly { versionNumber: number }[],
): LiveProgramSummary {
  const document = parseLiveProgramDocumentJson(row.draftJson);
  const latest = versions.reduce<number | null>(
    (max, version) => (max === null || version.versionNumber > max ? version.versionNumber : max),
    null,
  );
  return {
    id: row.id,
    title: row.title,
    draftRevision: row.draftRevision,
    sourceFormat: document.sourceFormat ?? null,
    versionCount: versions.length,
    latestVersionNumber: latest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProgramDetail(
  row: ProgramFields,
  versions: readonly VersionSummaryFields[],
): LiveProgramDetail {
  return {
    ...toProgramSummary(row, versions),
    draftDocument: parseLiveProgramDocumentJson(row.draftJson),
    versions: versions.map(toVersionSummary),
  };
}

export function revisionConflict(row: ProgramFields): never {
  let currentDocument: unknown = null;
  try {
    currentDocument = parseLiveProgramDocumentJson(row.draftJson);
  } catch {
    currentDocument = null;
  }
  throw new ApiError(
    409,
    "LIVE_PROGRAM_REVISION_CONFLICT",
    undefined,
    {
      programId: row.id,
      currentRevision: row.draftRevision,
      currentDocument,
    },
  );
}

export function assertExpectedRevision(
  row: ProgramFields,
  expectedRevision: number,
): void {
  if (row.draftRevision !== expectedRevision) {
    revisionConflict(row);
  }
}

export function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

export async function loadLiveProgramDetail(
  db: LiveDb,
  id: string,
): Promise<LiveProgramDetail> {
  const row = await db.liveProgram.findUnique({
    where: { id },
    select: programDetailSelect,
  });
  if (row === null) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", undefined, {
      resource: "live_program",
      id,
    });
  }
  return toProgramDetail(row, row.versions);
}
