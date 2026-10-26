import { requireEdition } from "./common";
import { buildSrt, CompositionCompileError } from "@kakeai/video";
import {
  type ContentDocument,
  type ScriptVersion as ScriptVersionDto,
  type ScriptVersionSummary,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { deserializeContent } from "../../domain/content-json.ts";
import { toScriptVersion, toScriptVersionSummary } from "../../dto/mappers.ts";
import { ApiError } from "../../http/errors.ts";
import { resourceNotFound } from "../../http/validation.ts";

export async function getCurrentScriptVersion(
  prisma: PrismaClient,
  editionId: string,
): Promise<ScriptVersionDto> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: editionId },
    include: { currentScriptVersion: true },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  const current = edition.currentScriptVersion;
  if (current === null) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "現在の台本版が設定されていません。",
    );
  }
  return toScriptVersion(current, deserializeContent(current.contentJson));
}

export interface ScriptVersionHistory {
  currentScriptVersionId: string;
  scriptVersions: ScriptVersionSummary[];
}

export async function listScriptVersions(
  prisma: PrismaClient,
  editionId: string,
): Promise<ScriptVersionSummary[]> {
  await requireEdition(prisma, editionId);
  const rows = await prisma.scriptVersion.findMany({
    where: { languageEditionId: editionId },
    orderBy: { versionNumber: "desc" },
  });
  return rows.map(toScriptVersionSummary);
}

/**
 * The Edition's version history and its current version id. The Agent surface
 * needs both in one read so it can choose a restore source and a base guard
 * without a second call.
 */
export async function getScriptVersionHistory(
  prisma: PrismaClient,
  editionId: string,
): Promise<ScriptVersionHistory> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: editionId },
    select: { currentScriptVersionId: true },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  if (edition.currentScriptVersionId === null) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "現在の台本版が設定されていません。",
    );
  }
  return {
    currentScriptVersionId: edition.currentScriptVersionId,
    scriptVersions: await listScriptVersions(prisma, editionId),
  };
}

export async function getScriptVersion(
  prisma: PrismaClient,
  scriptVersionId: string,
): Promise<ScriptVersionDto> {
  const row = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
  });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }
  return toScriptVersion(row, deserializeContent(row.contentJson));
}

export interface ScriptVersionSubtitles {
  filename: string;
  srt: string;
}

function subtitleFilename(title: string): string {
  const cleaned = title
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|\p{C}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = [...cleaned]
    .slice(0, 80)
    .join("")
    .replace(/[.\s]+$/u, "")
    .replace(/^\.+/u, "");
  const base = truncated.length === 0 ? "subtitles" : truncated;
  return `${base}.srt`;
}

export async function getScriptVersionSubtitles(
  prisma: PrismaClient,
  scriptVersionId: string,
): Promise<ScriptVersionSubtitles> {
  const row = await prisma.scriptVersion.findUnique({
    where: { id: scriptVersionId },
    include: { languageEdition: { include: { work: true } } },
  });
  if (row === null) {
    throw resourceNotFound("script_version", scriptVersionId);
  }
  let content: ContentDocument;
  try {
    content = deserializeContent(row.contentJson);
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "保存済みの台本を解釈できません。",
    );
  }
  let srt: string;
  try {
    srt = buildSrt(content);
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "RENDER_INPUT_INVALID", undefined, {
        issues: error.issues,
      });
    }
    throw error;
  }
  return { filename: subtitleFilename(row.languageEdition.work.title), srt };
}
