import {
  liveFormatDocumentV1Schema,
  type LiveFormatDetail,
  type LiveFormatDocumentV1,
  type LiveFormatSummary,
  type LiveFormatList,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationErrorFromZod } from "../http/validation.ts";
import { canonicalJson } from "../live/canonical-json.ts";
import { isPrismaCode } from "./live-programs/common.ts";

type LiveFormatRow = {
  id: string;
  name: string;
  documentJson: string;
  createdAt: Date;
  updatedAt: Date;
};

function parseDocument(row: LiveFormatRow): LiveFormatDocumentV1 {
  try {
    return liveFormatDocumentV1Schema.parse(JSON.parse(row.documentJson));
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      `保存済みの Live Format を解釈できません: ${row.id}`,
    );
  }
}

function toSummaryFromDocument(
  row: LiveFormatRow,
  document: LiveFormatDocumentV1,
): LiveFormatSummary {
  return {
    id: row.id,
    name: row.name,
    title: document.title,
    locale: document.locale,
    targetDurationMs: document.targetDurationMs,
    segmentCount: document.segments.length,
    cardCount: document.cards.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSummary(row: LiveFormatRow): LiveFormatSummary {
  return toSummaryFromDocument(row, parseDocument(row));
}

function toDetail(row: LiveFormatRow): LiveFormatDetail {
  const document = parseDocument(row);
  return {
    ...toSummaryFromDocument(row, document),
    document,
  };
}

export interface LiveFormatListWindow {
  limit?: number;
  offset?: number;
}

export async function listLiveFormats(
  prisma: PrismaClient,
  window: LiveFormatListWindow = {},
): Promise<LiveFormatList> {
  const limit = window.limit ?? 200;
  const offset = window.offset ?? 0;
  const [rows, total] = await Promise.all([
    prisma.liveFormat.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.liveFormat.count(),
  ]);
  return { items: rows.map(toSummary), limit, offset, total };
}

export async function getLiveFormat(
  prisma: PrismaClient,
  id: string,
): Promise<LiveFormatDetail> {
  const row = await prisma.liveFormat.findUnique({ where: { id } });
  if (row === null) {
    throw resourceNotFound("live_format", id);
  }
  return toDetail(row);
}

export async function createLiveFormat(
  prisma: PrismaClient,
  documentInput: LiveFormatDocumentV1,
): Promise<LiveFormatDetail> {
  const parsed = liveFormatDocumentV1Schema.safeParse(documentInput);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }
  const document = parsed.data;
  const row = await prisma.liveFormat.create({
    data: {
      name: document.name,
      documentJson: canonicalJson(document),
    },
  });
  return toDetail(row);
}

export async function updateLiveFormat(
  prisma: PrismaClient,
  id: string,
  documentInput: LiveFormatDocumentV1,
): Promise<LiveFormatDetail> {
  const parsed = liveFormatDocumentV1Schema.safeParse(documentInput);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }
  const document = parsed.data;
  const existing = await prisma.liveFormat.findUnique({ where: { id } });
  if (existing === null) {
    throw resourceNotFound("live_format", id);
  }
  let row;
  try {
    row = await prisma.liveFormat.update({
      where: { id },
      data: {
        name: document.name,
        documentJson: canonicalJson(document),
      },
    });
  } catch (error) {
    // The row may be deleted between findUnique and update.
    if (isPrismaCode(error, "P2025")) {
      throw resourceNotFound("live_format", id);
    }
    throw error;
  }
  return toDetail(row);
}

export async function duplicateLiveFormat(
  prisma: PrismaClient,
  id: string,
  name?: string,
): Promise<LiveFormatDetail> {
  const existing = await prisma.liveFormat.findUnique({ where: { id } });
  if (existing === null) {
    throw resourceNotFound("live_format", id);
  }
  const source = parseDocument(existing);
  const nextName = name ?? source.name;
  const parsed = liveFormatDocumentV1Schema.safeParse({ ...source, name: nextName });
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }
  const document = parsed.data;
  const row = await prisma.liveFormat.create({
    data: {
      name: nextName,
      documentJson: canonicalJson(document),
    },
  });
  return toDetail(row);
}
