import { readFile } from "node:fs/promises";
import {
  AGENT_PREVIEW_IMAGE_MAX_BYTES,
  RENDITION_PURPOSE,
  agentPreviewImageMimeTypeSchema,
  type AgentPreviewAssetFrameInput,
  type AgentPreviewAssetFrameOutput,
} from "@kakeai/contracts";
import { bigIntToSafeNumber } from "../dto/mappers.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import { logger } from "../logger.ts";
import { parsePngDimensions } from "../media/png.ts";
import { probeMedia } from "../media/probe.ts";
import { readStillFramePng, stillFrameCacheDir } from "../media/still-frame.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import type { DataDirectories } from "../storage/paths.ts";
import {
  resolveAssetContent,
  type ContentLocation,
} from "./assets.ts";
import { renderSourceDurationMs } from "./script-versions.ts";

function previewMediaType(mediaType: string, assetId: string) {
  const parsed = agentPreviewImageMimeTypeSchema.safeParse(mediaType);
  if (!parsed.success) {
    throw new ApiError(422, "ASSET_UNAVAILABLE", "プレビューできない画像形式です。", {
      assetIds: [assetId],
    });
  }
  return parsed.data;
}

async function resolveImageDimensions(
  location: ContentLocation,
  fallbackWidth: number | null,
  fallbackHeight: number | null,
): Promise<{ width: number; height: number }> {
  if (fallbackWidth !== null && fallbackHeight !== null) {
    return { width: fallbackWidth, height: fallbackHeight };
  }
  const probe = await probeMedia(location.path, "image", location.mediaType);
  if (probe.widthPx === null || probe.heightPx === null) {
    throw new ApiError(500, "INTERNAL_ERROR", "素材の寸法を取得できませんでした。");
  }
  return { width: probe.widthPx, height: probe.heightPx };
}

/**
 * Returns the visual content of one Asset. Images keep their stored bytes and
 * MIME type; videos return a normalized PNG at the requested source time.
 * Audio Assets have no visual content.
 */
export async function getAssetFrame(
  prisma: PrismaClient,
  directories: DataDirectories,
  input: AgentPreviewAssetFrameInput,
): Promise<AgentPreviewAssetFrameOutput> {
  const asset = await prisma.asset.findUnique({
    where: { id: input.assetId },
    include: { renditions: true },
  });
  if (asset === null) {
    throw resourceNotFound("asset", input.assetId);
  }

  if (asset.kind === "image") {
    if (input.timeMs !== undefined) {
      throw validationError([
        {
          path: ["timeMs"],
          code: "invalid_value",
          message: "画像素材には timeMs を指定できません。",
        },
      ]);
    }
    const rendition = asset.renditions.find(
      (row) => row.purpose === RENDITION_PURPOSE,
    );
    const previewByteSize = bigIntToSafeNumber(rendition?.byteSize ?? asset.byteSize);
    if (previewByteSize > AGENT_PREVIEW_IMAGE_MAX_BYTES) {
      throw validationError([
        {
          path: ["assetId"],
          code: "invalid_value",
          message: "プレビューする画像が大きすぎます。",
        },
      ]);
    }
    const mimeType = previewMediaType(
      rendition?.mediaType ?? asset.mediaType,
      asset.id,
    );
    const location = await resolveAssetContent(
      prisma,
      directories,
      input.assetId,
      true,
    );
    const { width, height } = await resolveImageDimensions(
      location,
      rendition?.widthPx ?? asset.widthPx,
      rendition?.heightPx ?? asset.heightPx,
    );
    const bytes = await readFile(location.path);
    return {
      assetId: asset.id,
      kind: "image",
      requestedTimeMs: null,
      resolvedTimeMs: null,
      width,
      height,
      mimeType,
      imageBase64: bytes.toString("base64"),
    };
  }

  if (asset.kind === "video") {
    const requestedTimeMs = input.timeMs ?? 0;
    const durationMs = renderSourceDurationMs(asset);
    if (durationMs !== null && requestedTimeMs > durationMs) {
      throw validationError([
        {
          path: ["timeMs"],
          code: "invalid_value",
          message: "timeMs は動画の確定尺の範囲内にしてください。",
        },
      ]);
    }
    const location = await resolveAssetContent(
      prisma,
      directories,
      input.assetId,
      true,
    );
    const source = {
      filePath: location.path,
      sha256: location.sha256,
    };
    let resolvedTimeMs: number;
    let png: Buffer;
    try {
      ({ resolvedTimeMs, png } = await readStillFramePng(
        source,
        requestedTimeMs,
        stillFrameCacheDir(directories.tmp),
      ));
    } catch (error) {
      logger.warn("asset_preview_still_frame_failed", {
        assetId: asset.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ApiError(422, "ASSET_UNAVAILABLE", "動画の静止画を取得できませんでした。", {
        assetIds: [asset.id],
      });
    }
    const { width, height } = parsePngDimensions(png);
    if (png.byteLength > AGENT_PREVIEW_IMAGE_MAX_BYTES) {
      throw validationError([
        {
          path: ["assetId"],
          code: "invalid_value",
          message: "プレビューする動画の静止画が大きすぎます。",
        },
      ]);
    }
    return {
      assetId: asset.id,
      kind: "video",
      requestedTimeMs,
      resolvedTimeMs,
      width,
      height,
      mimeType: "image/png",
      imageBase64: png.toString("base64"),
    };
  }

  throw validationError([
    {
      path: ["assetId"],
      code: "invalid_value",
      message: "音声素材にはプレビューできる絵がありません。",
    },
  ]);
}
