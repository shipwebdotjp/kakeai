import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import Busboy from "busboy";
import { Router, type Request, type RequestHandler } from "express";
import { assetListQuerySchema, updateAssetRequestSchema } from "@kakeai/contracts";
import type { LimitsConfig } from "../../config.ts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { ApiError } from "../errors.ts";
import { sendContent } from "../content.ts";
import { parseBody, pathParam, validationError } from "../validation.ts";
import * as assets from "../../services/assets.ts";
import type { UploadInput } from "../../services/assets.ts";
import { renderSourceDurationMs } from "../../services/script-versions.ts";
import { ensureStillFramePng, stillFrameCacheDir } from "../../media/still-frame.ts";

export interface AssetsRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
  limits: LimitsConfig;
  mediaGuard: RequestHandler;
}

function receiveUpload(
  req: Request,
  directories: DataDirectories,
  maxBytes: number,
): Promise<UploadInput> {
  return new Promise((resolve, reject) => {
    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: { files: 1, fileSize: maxBytes, fields: 10, parts: 2, fieldSize: 1024 },
      });
    } catch {
      reject(new ApiError(400, "MALFORMED_JSON", "multipart/form-data を解釈できませんでした。"));
      return;
    }

    let settled = false;
    let tempPath = "";
    let originalFilename = "";
    let byteSize = 0;
    let fileSeen = false;
    let limitReached = false;
    let writeStream: WriteStream | undefined;
    let fileStream: Readable | undefined;
    const hash = createHash("sha256");

    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      fileStream?.destroy();
      writeStream?.destroy();
      busboy.destroy();
      if (tempPath.length > 0) {
        void rm(tempPath, { force: true }).catch(() => undefined);
      }
      reject(error);
    };

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "file" || fileSeen) {
        file.resume();
        return;
      }
      fileSeen = true;
      fileStream = file;
      originalFilename = typeof info.filename === "string" ? info.filename : "";
      tempPath = join(directories.tmp, `upload-${randomUUID()}`);
      writeStream = createWriteStream(tempPath);
      file.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        byteSize += chunk.length;
      });
      file.on("limit", () => {
        limitReached = true;
      });
      file.on("error", fail);
      writeStream.on("error", fail);
      file.pipe(writeStream);
    });

    busboy.on("error", fail);
    busboy.on("close", () => {
      if (settled) {
        return;
      }
      if (!fileSeen || writeStream === undefined) {
        fail(
          validationError([
            { path: ["file"], code: "custom", message: "file フィールドが必要です。" },
          ]),
        );
        return;
      }
      if (limitReached) {
        fail(new ApiError(413, "FILE_TOO_LARGE", undefined, { maxBytes }));
        return;
      }
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ tempPath, originalFilename, sha256: hash.digest("hex"), byteSize });
      };
      if (writeStream.closed) {
        finish();
        return;
      }
      writeStream.once("close", finish);
      writeStream.once("error", fail);
    });

    req.on("error", fail);
    req.on("close", () => {
      if (!req.complete) {
        fail(new ApiError(400, "MALFORMED_JSON", "リクエストが中断されました。"));
      }
    });
    req.pipe(busboy);
  });
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function tagQueryValues(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entries = Array.isArray(value) ? value : [value];
  const tags: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      tags.push("");
      continue;
    }
    for (const part of entry.split(",")) {
      const tag = part.trim();
      if (tag.length > 0) {
        tags.push(tag);
      }
    }
  }
  // An explicitly empty tag filter is a contract violation, not "all assets".
  return tags.length > 0 ? tags : [""];
}

/**
 * Turns a query value into a boolean. Anything that is not `true` / `false`
 * is passed through unchanged so the contract schema reports it as an
 * invalid value.
 */
function booleanQueryValue(value: unknown): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}

/**
 * Turns a query value into an integer. Only a plain decimal integer is
 * accepted; other forms are passed through unchanged so the contract schema
 * reports them as invalid values.
 */
function integerQueryValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const text = value.trim();
  if (!/^-?\d+$/u.test(text)) {
    return value;
  }
  const parsed = Number(text);
  // A value that cannot be represented exactly is left to the schema so it is
  // rejected instead of silently rounded.
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function parseAssetListQuery(req: Request) {
  const raw: Record<string, unknown> = {};
  for (const key of [
    "kind",
    "status",
    "filename",
    "tagMode",
    "archived",
    "cursor",
    "sort",
  ] as const) {
    const value = firstQueryValue(req.query[key]);
    if (value !== undefined) {
      raw[key] = value;
    }
  }
  // `tags` matches the Agent Access field name; `tag` stays as the shorter
  // HTTP alias documented in the API contract.
  const tags = tagQueryValues(req.query.tags ?? req.query.tag);
  if (tags !== undefined) {
    raw.tags = tags;
  }
  for (const key of ["favorite", "hasAudio"] as const) {
    const value = firstQueryValue(req.query[key]);
    if (value !== undefined) {
      raw[key] = booleanQueryValue(value);
    }
  }
  for (const key of ["limit", "durationMinMs", "durationMaxMs"] as const) {
    const value = firstQueryValue(req.query[key]);
    if (value !== undefined) {
      raw[key] = integerQueryValue(value);
    }
  }

  return parseBody(assetListQuerySchema, raw);
}

export function createAssetsRouter(dependencies: AssetsRouterDependencies): Router {
  const { prisma, directories, limits, mediaGuard } = dependencies;
  const router = Router();

  router.get(
    "/assets",
    asyncHandler(async (req, res) => {
      const query = parseAssetListQuery(req);
      sendData(res, 200, await assets.searchAssets(prisma, query));
    }),
  );

  router.post(
    "/assets",
    asyncHandler(async (req, res) => {
      const upload = await receiveUpload(req, directories, limits.maxUploadBytes);
      try {
        const outcome = await assets.ingestUpload(prisma, directories, limits, upload);
        sendData(
          res,
          outcome.httpStatus,
          outcome.asset,
          outcome.deduplicated ? { deduplicated: true } : undefined,
        );
      } catch (error) {
        await rm(upload.tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    }),
  );

  router.get(
    "/assets/:assetId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await assets.getAsset(prisma, pathParam(req, "assetId")));
    }),
  );

  router.patch(
    "/assets/:assetId",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateAssetRequestSchema, req.body);
      sendData(
        res,
        200,
        await assets.updateAsset(prisma, pathParam(req, "assetId"), input),
      );
    }),
  );

  router.get(
    "/assets/:assetId/content",
    mediaGuard,
    asyncHandler(async (req, res, next) => {
      const file = await assets.resolveAssetContent(prisma, directories, pathParam(req, "assetId"), false);
      sendContent(req, res, next, file);
    }),
  );

  router.get(
    "/assets/:assetId/render-content",
    mediaGuard,
    asyncHandler(async (req, res, next) => {
      const file = await assets.resolveAssetContent(prisma, directories, pathParam(req, "assetId"), true);
      sendContent(req, res, next, file);
    }),
  );

  router.get(
    "/assets/:assetId/frame",
    mediaGuard,
    asyncHandler(async (req, res, next) => {
      const assetId = pathParam(req, "assetId");
      const rawMs = req.query.ms;
      const msText = Array.isArray(rawMs) ? rawMs[0] : rawMs;
      const ms =
        typeof msText === "string" && /^-?\d+$/.test(msText) ? Number(msText) : Number.NaN;
      if (!Number.isInteger(ms) || ms < 0) {
        throw validationError([
          { path: ["ms"], code: "invalid_value", message: "ms は0以上の整数で指定してください。" },
        ]);
      }
      const asset = await prisma.asset.findUnique({
        where: { id: assetId },
        include: { renditions: true },
      });
      if (asset === null || asset.kind !== "video") {
        throw new ApiError(422, "ASSET_UNAVAILABLE", undefined, { assetIds: [assetId] });
      }
      const durationMs = renderSourceDurationMs(asset);
      if (durationMs === null || ms > durationMs) {
        throw validationError([
          {
            path: ["ms"],
            code: "invalid_value",
            message: "ms は動画の確定尺の範囲内にしてください。",
          },
        ]);
      }
      const location = await assets.resolveAssetContent(prisma, directories, assetId, true);
      const pngPath = await ensureStillFramePng(
        { filePath: location.path, sha256: location.sha256 },
        ms,
        stillFrameCacheDir(directories.tmp),
      );
      const info = await stat(pngPath);
      sendContent(req, res, next, { path: pngPath, mediaType: "image/png", byteSize: info.size });
    }),
  );

  router.delete(
    "/assets/:assetId",
    asyncHandler(async (req, res) => {
      await assets.deleteAsset(prisma, directories, pathParam(req, "assetId"));
      res.status(204).end();
    }),
  );

  return router;
}
