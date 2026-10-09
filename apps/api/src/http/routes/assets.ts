import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import Busboy from "busboy";
import { Router, type Request, type RequestHandler } from "express";
import { assetKindSchema, type AssetKindName } from "@kakeai/contracts";
import type { LimitsConfig } from "../../config.ts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { ApiError } from "../errors.ts";
import { sendContent } from "../content.ts";
import { pathParam, validationError } from "../validation.ts";
import * as assets from "../../services/assets.ts";
import type { UploadInput } from "../../services/assets.ts";

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

export function createAssetsRouter(dependencies: AssetsRouterDependencies): Router {
  const { prisma, directories, limits, mediaGuard } = dependencies;
  const router = Router();

  router.get(
    "/assets",
    asyncHandler(async (req, res) => {
      let kind: AssetKindName | undefined;
      const raw = req.query.kind;
      if (raw !== undefined) {
        const parsed = assetKindSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
        if (!parsed.success) {
          throw validationError([
            { path: ["kind"], code: "invalid_value", message: "kind は image / video / audio のいずれかです。" },
          ]);
        }
        kind = parsed.data;
      }
      sendData(res, 200, await assets.listAssets(prisma, kind));
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

  router.delete(
    "/assets/:assetId",
    asyncHandler(async (req, res) => {
      await assets.deleteAsset(prisma, directories, pathParam(req, "assetId"));
      res.status(204).end();
    }),
  );

  return router;
}
