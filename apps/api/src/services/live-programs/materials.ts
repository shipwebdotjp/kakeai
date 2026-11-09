import {
  LIVE_MATERIAL_DEFAULT_DURATION_MS,
  collectAssetReferences,
  liveMaterialProvenanceSchema,
  liveMaterialSnapshotSchema,
  liveProgramDocumentSchema,
  sceneSchema,
  type ContentDocument,
  type LiveMaterialDetail,
  type LiveMaterialFormat,
  type LiveMaterialImportResult,
  type LiveMaterialList,
  type LiveMaterialSnapshot,
  type LiveMaterialSummary,
  type LiveMaterialProvenance,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { deserializeContent } from "../../domain/content-json.ts";
import { ApiError } from "../../http/errors.ts";
import { resourceNotFound } from "../../http/validation.ts";
import { canonicalJson } from "../../live/canonical-json.ts";
import { LiveExportError } from "../../live/errors.ts";
import { newLiveId } from "../../live/ids.ts";
import { validateMaterialScene } from "../../live/material-scene-validation.ts";
import { toLiveAssetSnapshot } from "../../live/asset-snapshot.ts";
import {
  assertExpectedRevision,
  parseLiveProgramDocumentJson,
  revisionConflict,
  loadLiveProgramDetail,
} from "./common.ts";

type MaterialRow = Prisma.LiveMaterialGetPayload<object>;

export interface ImportLiveMaterialInput {
  expectedRevision: number;
  workId: string;
  sceneId: string;
  name?: string;
  format?: LiveMaterialFormat;
  durationMs?: number;
}

function parseMaterial(
  row: MaterialRow,
): { snapshot: LiveMaterialSnapshot; provenance: LiveMaterialProvenance } {
  try {
    return {
      snapshot: liveMaterialSnapshotSchema.parse(JSON.parse(row.snapshotJson)),
      provenance: liveMaterialProvenanceSchema.parse(
        JSON.parse(row.provenanceJson),
      ),
    };
  } catch {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      `保存済みの Live Material を解釈できません: ${row.id}`,
    );
  }
}

function toSummary(row: MaterialRow): LiveMaterialSummary {
  const { provenance } = parseMaterial(row);
  return {
    id: row.id,
    programId: row.programId,
    name: row.name,
    provenance,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: MaterialRow): LiveMaterialDetail {
  return {
    ...toSummary(row),
    snapshot: parseMaterial(row).snapshot,
  };
}

async function ensureProgram(db: Prisma.TransactionClient | PrismaClient, programId: string) {
  const program = await db.liveProgram.findUnique({
    where: { id: programId },
    select: { id: true },
  });
  if (program === null) {
    throw resourceNotFound("live_program", programId);
  }
}

export interface LiveMaterialListWindow {
  limit?: number;
  offset?: number;
}

export async function listLiveMaterials(
  prisma: PrismaClient,
  programId: string,
  window: LiveMaterialListWindow = {},
): Promise<LiveMaterialList> {
  await ensureProgram(prisma, programId);
  const limit = window.limit ?? 200;
  const offset = window.offset ?? 0;
  const [rows, total] = await Promise.all([
    prisma.liveMaterial.findMany({
      where: { programId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.liveMaterial.count({ where: { programId } }),
  ]);
  return { items: rows.map(toSummary), limit, offset, total };
}

function sceneDocument(content: ContentDocument, sceneId: string): ContentDocument {
  const scene = content.scenes.find((entry) => entry.id === sceneId);
  if (scene === undefined) {
    throw resourceNotFound("scene", sceneId);
  }
  return {
    ...content,
    characters: [],
    audioTakes: [],
    audioCues: [],
    scenes: [scene],
  };
}

/**
 * Imports a Work Scene as a self-contained Live Material. Scene text, visual
 * cues and every referenced image Asset hash are copied; Work/Scene ids are
 * kept only in provenance. The program draft is updated under the same
 * optimistic-lock revision as a normal save.
 */
export async function importLiveMaterial(
  prisma: PrismaClient,
  programId: string,
  input: ImportLiveMaterialInput,
): Promise<LiveMaterialImportResult> {
  // Capture which edition/version the import started from. The Scene and its
  // assets are read again inside the transaction; if the current version moved
  // on, the request fails instead of freezing a stale Scene.
  const work = await prisma.work.findUnique({
    where: { id: input.workId },
    include: {
      languageEditions: {
        include: { currentScriptVersion: { select: { id: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (work === null) {
    throw resourceNotFound("work", input.workId);
  }
  const edition =
    work.languageEditions.find(
      (entry) => entry.locale === "ja-JP" && entry.currentScriptVersion !== null,
    ) ??
    work.languageEditions.find((entry) => entry.currentScriptVersion !== null);
  if (edition === undefined || edition.currentScriptVersion === null) {
    throw new ApiError(422, "VALIDATION_ERROR", "現在の台本版がありません。");
  }
  const scriptVersionId = edition.currentScriptVersion.id;

  const materialId = newLiveId("mat");
  const format = input.format ?? "png";
  // Only MP4 cards carry a custom duration; PNG/HTML are always exported as
  // 4000ms stills, so the stored snapshot must not claim otherwise.
  const durationMs =
    format === "mp4"
      ? input.durationMs ?? LIVE_MATERIAL_DEFAULT_DURATION_MS
      : LIVE_MATERIAL_DEFAULT_DURATION_MS;
  const provenance = liveMaterialProvenanceSchema.parse({
    workId: input.workId,
    sceneId: input.sceneId,
    importedAt: new Date().toISOString(),
  });

  return prisma.$transaction(async (tx) => {
    const row = await tx.liveProgram.findUnique({ where: { id: programId } });
    if (row === null) {
      throw resourceNotFound("live_program", programId);
    }
    assertExpectedRevision(row, input.expectedRevision);

    const currentEdition = await tx.languageEdition.findUnique({
      where: { id: edition.id },
      select: {
        currentScriptVersion: { select: { id: true, contentJson: true } },
      },
    });
    if (
      currentEdition === null ||
      currentEdition.currentScriptVersion === null ||
      currentEdition.currentScriptVersion.id !== scriptVersionId
    ) {
      throw new ApiError(
        409,
        "INVALID_STATE",
        "台本の現在の版が更新されました。もう一度読み込んでください。",
      );
    }
    let content: ContentDocument;
    try {
      content = deserializeContent(currentEdition.currentScriptVersion.contentJson);
    } catch {
      throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
    }
    const scene = content.scenes.find((entry) => entry.id === input.sceneId);
    if (scene === undefined) {
      throw resourceNotFound("scene", input.sceneId);
    }
    const sceneContent = sceneDocument(content, input.sceneId);
    const assetIds = [
      ...new Set(collectAssetReferences(sceneContent).map((reference) => reference.assetId)),
    ];

    // Read the assets inside the transaction: an Asset may have been deleted
    // or moved out of `ready` after the request started. The snapshot is built
    // from these rows so it never freezes stale metadata.
    const currentAssets = assetIds.length === 0
      ? []
      : await tx.asset.findMany({
          where: { id: { in: assetIds } },
          include: { renditions: true },
        });
    const currentById = new Map(currentAssets.map((asset) => [asset.id, asset]));
    const missingNow = assetIds.filter((id) => !currentById.has(id));
    if (missingNow.length > 0) {
      throw new ApiError(422, "ASSET_NOT_FOUND", undefined, { assetIds: missingNow });
    }
    const unavailableNow = assetIds.filter(
      (id) => currentById.get(id)?.status !== "ready",
    );
    if (unavailableNow.length > 0) {
      throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, {
        assetIds: unavailableNow,
      });
    }
    try {
      validateMaterialScene(
        { id: materialId, sceneId: input.sceneId, format, durationMs },
        content,
        new Map(
          [...currentById].map(([id, asset]) => [id, { kind: asset.kind }]),
        ),
      );
    } catch (error) {
      if (error instanceof LiveExportError) {
        throw new ApiError(422, "VALIDATION_ERROR", error.message, error.failure);
      }
      throw error;
    }
    // Keep the snapshot in assetIds order so the canonical JSON (and its
    // hash) does not depend on the database's findMany order.
    const orderedAssets = assetIds.map((id) => {
      const asset = currentById.get(id);
      if (asset === undefined) {
        throw new ApiError(422, "ASSET_NOT_FOUND", undefined, { assetIds: [id] });
      }
      return asset;
    });
    const snapshot = liveMaterialSnapshotSchema.parse({
      schemaVersion: 1,
      format,
      durationMs,
      scene: sceneSchema.parse(scene),
      assets: orderedAssets.map((asset) => toLiveAssetSnapshot(asset)),
    });
    const name = input.name ?? scene.label;

    const document = parseLiveProgramDocumentJson(row.draftJson);
    const updatedDocument = liveProgramDocumentSchema.parse({
      ...document,
      materials: [...document.materials, { id: materialId, name }],
    });
    const material = await tx.liveMaterial.create({
      data: {
        id: materialId,
        programId,
        name,
        snapshotJson: canonicalJson(snapshot),
        provenanceJson: canonicalJson(provenance),
      },
    });
    const updated = await tx.liveProgram.updateMany({
      where: { id: programId, draftRevision: input.expectedRevision },
      data: {
        draftJson: canonicalJson(updatedDocument),
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
    return {
      material: toDetail(material),
      program: await loadLiveProgramDetail(tx, programId),
    };
  });
}
