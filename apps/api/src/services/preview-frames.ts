import { readFile } from "node:fs/promises";
import type {
  AgentPreviewFrameInput,
  AgentPreviewFrameOutput,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import {
  ensureStillFramePngAtPts,
  resolveStillFramePtsMs,
  stillFrameCacheDir,
} from "../media/still-frame.ts";
import { resolveArtifactContent } from "./artifacts.ts";
import type { DataDirectories } from "../storage/paths.ts";

export type PreviewFrameResult = AgentPreviewFrameOutput;

/** PNG chunk layout after the 8-byte signature. */
const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";
const PNG_IHDR_LENGTH_OFFSET = 8;
const PNG_IHDR_TYPE_OFFSET = 12;
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_IHDR_MIN_LENGTH = 24;
const INVALID_STILL_PNG_MESSAGE = "静止画の形式が不正です。";

/** PNG signature (8) + IHDR length (4) + type (4) + width (4) + height (4). */
function parsePngDimensions(png: Buffer): { width: number; height: number } {
  if (
    png.length < PNG_IHDR_MIN_LENGTH ||
    png.subarray(0, 8).toString("hex") !== PNG_SIGNATURE_HEX ||
    png.readUInt32BE(PNG_IHDR_LENGTH_OFFSET) !== 13 ||
    png.toString("ascii", PNG_IHDR_TYPE_OFFSET, PNG_IHDR_TYPE_OFFSET + 4) !== "IHDR"
  ) {
    throw new ApiError(500, "INTERNAL_ERROR", INVALID_STILL_PNG_MESSAGE);
  }
  const width = png.readUInt32BE(PNG_WIDTH_OFFSET);
  const height = png.readUInt32BE(PNG_HEIGHT_OFFSET);
  if (width <= 0 || height <= 0) {
    throw new ApiError(500, "INTERNAL_ERROR", INVALID_STILL_PNG_MESSAGE);
  }
  return { width, height };
}

/**
 * Returns a full-resolution still PNG of a render artifact at the requested
 * time. Only `role: "render"` MP4 artifacts are eligible; this operation adds
 * no version and creates no artifact, so it is a read.
 */
export async function getPreviewFrame(
  prisma: PrismaClient,
  directories: DataDirectories,
  input: AgentPreviewFrameInput,
): Promise<PreviewFrameResult> {
  const row = await prisma.artifact.findUnique({ where: { id: input.artifactId } });
  if (row === null) {
    throw resourceNotFound("artifact", input.artifactId);
  }
  if (row.role !== "render" || row.format !== "mp4") {
    throw validationError([
      {
        path: ["artifactId"],
        code: "invalid_value",
        message: "preview.frame は render の MP4 成果物だけを対象にします。",
      },
    ]);
  }
  if (row.durationMs !== null && input.timeMs > row.durationMs) {
    throw validationError([
      {
        path: ["timeMs"],
        code: "invalid_value",
        message: "timeMs は成果物の確定尺の範囲内にしてください。",
      },
    ]);
  }
  const location = await resolveArtifactContent(prisma, directories, input.artifactId);
  const source = { filePath: location.path, sha256: row.sha256 };
  const resolvedTimeMs = await resolveStillFramePtsMs(source, input.timeMs);
  const pngPath = await ensureStillFramePngAtPts(
    source,
    resolvedTimeMs,
    stillFrameCacheDir(directories.tmp),
  );
  const png = await readFile(pngPath);
  const { width, height } = parsePngDimensions(png);
  return {
    artifactId: row.id,
    requestedTimeMs: input.timeMs,
    resolvedTimeMs,
    width,
    height,
    mimeType: "image/png",
    pngBase64: png.toString("base64"),
  };
}
