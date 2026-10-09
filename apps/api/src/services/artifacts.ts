import { rm, stat } from "node:fs/promises";
import type { Artifact as ArtifactDto } from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { bigIntToSafeNumber, toArtifact } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound } from "../http/validation.ts";
import { resolveStoragePath } from "../storage/asset-store.ts";
import type { DataDirectories } from "../storage/paths.ts";

export interface ArtifactLocation {
  path: string;
  mediaType: string;
  byteSize: number;
}

const ARTIFACT_MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  png: "image/png",
  jpeg: "image/jpeg",
  vtt: "text/vtt",
};

function artifactMediaType(format: string): string {
  const mediaType = ARTIFACT_MEDIA_TYPES[format];
  if (mediaType === undefined) {
    throw new ApiError(500, "INTERNAL_ERROR", "Artifactの形式が不正です。");
  }
  return mediaType;
}

export async function getArtifact(
  prisma: PrismaClient,
  artifactId: string,
): Promise<ArtifactDto> {
  const row = await prisma.artifact.findUnique({ where: { id: artifactId } });
  if (row === null) {
    throw resourceNotFound("artifact", artifactId);
  }
  return toArtifact(row);
}

export async function resolveArtifactContent(
  prisma: PrismaClient,
  directories: DataDirectories,
  artifactId: string,
): Promise<ArtifactLocation> {
  const row = await prisma.artifact.findUnique({ where: { id: artifactId } });
  if (row === null) {
    throw resourceNotFound("artifact", artifactId);
  }
  const path = resolveStoragePath(directories, row.storageKey);
  const info = await stat(path).catch(() => null);
  if (info === null || !info.isFile() || info.size !== bigIntToSafeNumber(row.byteSize)) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "出力ファイルが見つかりません。", {
      resource: "artifact",
      id: artifactId,
    });
  }
  return { path, mediaType: artifactMediaType(row.format), byteSize: info.size };
}

export async function deleteArtifact(
  prisma: PrismaClient,
  directories: DataDirectories,
  artifactId: string,
): Promise<void> {
  const row = await prisma.artifact.findUnique({ where: { id: artifactId } });
  if (row === null) {
    throw resourceNotFound("artifact", artifactId);
  }
  await prisma.artifact.delete({ where: { id: artifactId } });
  await rm(resolveStoragePath(directories, row.storageKey), { force: true }).catch(
    () => undefined,
  );
}
