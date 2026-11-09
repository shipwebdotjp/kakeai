import {
  liveFormatDocumentV1Schema,
  liveProgramDocumentSchema,
  type LiveProgramDetail,
  type LiveProgramList,
  type LiveProgramVersionDetail,
  type LiveProgramVersionList,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { resourceNotFound, validationErrorFromZod } from "../../http/validation.ts";
import { canonicalJson } from "../../live/canonical-json.ts";
import { materializeLiveProgramFromFormat } from "../../live/format-materialize.ts";
import {
  assertExpectedRevision,
  loadLiveProgramDetail,
  parseLiveProgramDocumentJson,
  revisionConflict,
  toProgramDetail,
  toProgramSummary,
  toVersionDetail,
  toVersionSummary,
} from "./common.ts";

export interface CreateLiveProgramInput {
  formatId: string;
  title?: string;
}

export interface LiveProgramListWindow {
  limit?: number;
  offset?: number;
}

export async function listLivePrograms(
  prisma: PrismaClient,
  window: LiveProgramListWindow = {},
): Promise<LiveProgramList> {
  const limit = window.limit ?? 200;
  const offset = window.offset ?? 0;
  const [rows, total] = await Promise.all([
    prisma.liveProgram.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        versions: { select: { versionNumber: true } },
      },
    }),
    prisma.liveProgram.count(),
  ]);
  return {
    items: rows.map((row) => toProgramSummary(row, row.versions)),
    limit,
    offset,
    total,
  };
}

export async function getLiveProgram(
  prisma: PrismaClient,
  id: string,
): Promise<LiveProgramDetail> {
  return loadLiveProgramDetail(prisma, id);
}

/** Copies a format into a new draft. The format is never referenced again. */
export async function createLiveProgram(
  prisma: PrismaClient,
  input: CreateLiveProgramInput,
): Promise<LiveProgramDetail> {
  const formatRow = await prisma.liveFormat.findUnique({ where: { id: input.formatId } });
  if (formatRow === null) {
    throw resourceNotFound("live_format", input.formatId);
  }
  let format;
  try {
    format = liveFormatDocumentV1Schema.parse(JSON.parse(formatRow.documentJson));
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      `保存済みの Live Format を解釈できません: ${formatRow.id}`,
    );
  }
  const document = materializeLiveProgramFromFormat({
    formatId: formatRow.id,
    formatUpdatedAt: formatRow.updatedAt.toISOString(),
    format,
    ...(input.title === undefined ? {} : { title: input.title }),
  });
  const row = await prisma.liveProgram.create({
    data: {
      title: document.title,
      draftJson: canonicalJson(document),
      draftRevision: 0,
      sourceFormatId: formatRow.id,
      sourceFormatUpdatedAt: formatRow.updatedAt,
    },
  });
  return toProgramDetail(row, []);
}

export interface SaveLiveProgramDraftInput {
  expectedRevision: number;
  document: unknown;
}

export async function saveLiveProgramDraft(
  prisma: PrismaClient,
  id: string,
  input: SaveLiveProgramDraftInput,
): Promise<LiveProgramDetail> {
  const parsed = liveProgramDocumentSchema.safeParse(input.document);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }
  const document = parsed.data;
  return prisma.$transaction(async (tx) => {
    const row = await tx.liveProgram.findUnique({ where: { id } });
    if (row === null) {
      throw resourceNotFound("live_program", id);
    }
    assertExpectedRevision(row, input.expectedRevision);
    const updated = await tx.liveProgram.updateMany({
      where: { id, draftRevision: input.expectedRevision },
      data: {
        title: document.title,
        draftJson: canonicalJson(document),
        draftRevision: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      const current = await tx.liveProgram.findUnique({ where: { id } });
      if (current === null) {
        throw resourceNotFound("live_program", id);
      }
      revisionConflict(current);
    }
    return loadLiveProgramDetail(tx, id);
  });
}

export interface RestoreLiveProgramVersionDraftInput {
  expectedRevision: number;
}

/** Copies a confirmed version back into the editable draft without touching it. */
export async function restoreLiveProgramVersionDraft(
  prisma: PrismaClient,
  programId: string,
  versionId: string,
  input: RestoreLiveProgramVersionDraftInput,
): Promise<LiveProgramDetail> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.liveProgramVersion.findUnique({ where: { id: versionId } });
    if (version === null || version.programId !== programId) {
      throw resourceNotFound("live_program_version", versionId);
    }
    const row = await tx.liveProgram.findUnique({ where: { id: programId } });
    if (row === null) {
      throw resourceNotFound("live_program", programId);
    }
    assertExpectedRevision(row, input.expectedRevision);
    const document = parseLiveProgramDocumentJson(version.documentJson);
    const updated = await tx.liveProgram.updateMany({
      where: { id: programId, draftRevision: input.expectedRevision },
      data: {
        title: document.title,
        draftJson: version.documentJson,
        draftRevision: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      const current = await tx.liveProgram.findUnique({ where: { id: programId } });
      if (current === null) {
        throw resourceNotFound("live_program", programId);
      }
      revisionConflict(current);
    }
    return loadLiveProgramDetail(tx, programId);
  });
}

export async function listLiveProgramVersions(
  prisma: PrismaClient,
  programId: string,
): Promise<LiveProgramVersionList> {
  const program = await prisma.liveProgram.findUnique({
    where: { id: programId },
    select: { id: true },
  });
  if (program === null) {
    throw resourceNotFound("live_program", programId);
  }
  const rows = await prisma.liveProgramVersion.findMany({
    where: { programId },
    orderBy: { versionNumber: "desc" },
  });
  return rows.map(toVersionSummary);
}

export async function getLiveProgramVersion(
  prisma: PrismaClient,
  programId: string,
  versionId: string,
): Promise<LiveProgramVersionDetail> {
  const program = await prisma.liveProgram.findUnique({
    where: { id: programId },
    select: { id: true },
  });
  if (program === null) {
    throw resourceNotFound("live_program", programId);
  }
  const row = await prisma.liveProgramVersion.findUnique({ where: { id: versionId } });
  if (row === null || row.programId !== programId) {
    throw resourceNotFound("live_program_version", versionId);
  }
  return toVersionDetail(row);
}
