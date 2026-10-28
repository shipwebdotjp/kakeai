import { Router, type RequestHandler } from "express";
import {
  createThumbnailAppearancePresetRequestSchema,
  createThumbnailRequestSchema,
  saveThumbnailRequestSchema,
  setPrimaryThumbnailRequestSchema,
  thumbnailPreviewRequestSchema,
  updateThumbnailAppearancePresetRequestSchema,
  updateThumbnailAppearanceRequestSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import type { Rasterizer } from "../../media/rasterize.ts";
import { getSharedRasterizer } from "../../media/rasterize.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam, validationError } from "../validation.ts";
import * as thumbnails from "../../services/thumbnails.ts";
import * as thumbnailAppearancePresets from "../../services/thumbnail-appearance-presets.ts";

export interface ThumbnailsRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
  mediaGuard: RequestHandler;
  rasterizer?: Rasterizer;
}

function requiredQuery(req: { query: Record<string, unknown> }, name: string): string {
  const value = req.query[name];
  if (typeof value !== "string" || value.length === 0) {
    throw validationError([
      {
        path: [name],
        code: "invalid_value",
        message: `クエリ ${name} が必要です。`,
      },
    ]);
  }
  return value;
}

export function createThumbnailsRouter(dependencies: ThumbnailsRouterDependencies): Router {
  const { prisma, directories, mediaGuard } = dependencies;
  const rasterizer = dependencies.rasterizer ?? getSharedRasterizer();
  const router = Router();

  router.get(
    "/thumbnail-appearance-presets",
    asyncHandler(async (_req, res) => {
      sendData(res, 200, await thumbnailAppearancePresets.listThumbnailAppearancePresets(prisma));
    }),
  );

  router.post(
    "/thumbnail-appearance-presets",
    asyncHandler(async (req, res) => {
      const input = parseBody(createThumbnailAppearancePresetRequestSchema, req.body);
      sendData(
        res,
        201,
        await thumbnailAppearancePresets.createThumbnailAppearancePreset(prisma, input),
      );
    }),
  );

  router.get(
    "/thumbnail-appearance-presets/:presetId",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await thumbnailAppearancePresets.getThumbnailAppearancePreset(
          prisma,
          pathParam(req, "presetId"),
        ),
      );
    }),
  );

  router.put(
    "/thumbnail-appearance-presets/:presetId",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateThumbnailAppearancePresetRequestSchema, req.body);
      sendData(
        res,
        200,
        await thumbnailAppearancePresets.updateThumbnailAppearancePreset(
          prisma,
          pathParam(req, "presetId"),
          input,
        ),
      );
    }),
  );

  router.delete(
    "/thumbnail-appearance-presets/:presetId",
    asyncHandler(async (req, res) => {
      await thumbnailAppearancePresets.deleteThumbnailAppearancePreset(
        prisma,
        pathParam(req, "presetId"),
      );
      res.status(204).end();
    }),
  );

  router.get(
    "/language-editions/:editionId/thumbnails",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await thumbnails.listThumbnails(prisma, pathParam(req, "editionId")));
    }),
  );

  router.post(
    "/language-editions/:editionId/thumbnails",
    asyncHandler(async (req, res) => {
      const input = parseBody(createThumbnailRequestSchema, req.body);
      sendData(res, 201, await thumbnails.createThumbnail(prisma, pathParam(req, "editionId"), input));
    }),
  );

  router.put(
    "/language-editions/:editionId/primary-thumbnail",
    asyncHandler(async (req, res) => {
      const input = parseBody(setPrimaryThumbnailRequestSchema, req.body);
      sendData(
        res,
        200,
        await thumbnails.setPrimaryThumbnail(prisma, pathParam(req, "editionId"), input.thumbnailId),
      );
    }),
  );

  router.get(
    "/works/:workId/thumbnail-appearance",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await thumbnails.getThumbnailAppearance(
          prisma,
          pathParam(req, "workId"),
          requiredQuery(req, "languageEditionId"),
        ),
      );
    }),
  );

  router.put(
    "/works/:workId/thumbnail-appearance",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateThumbnailAppearanceRequestSchema, req.body);
      sendData(
        res,
        200,
        await thumbnails.saveThumbnailAppearance(
          prisma,
          pathParam(req, "workId"),
          requiredQuery(req, "languageEditionId"),
          input.appearance,
        ),
      );
    }),
  );

  router.post(
    "/language-editions/:editionId/thumbnail-preview",
    asyncHandler(async (req, res) => {
      const input = parseBody(thumbnailPreviewRequestSchema, req.body);
      sendData(
        res,
        200,
        await thumbnails.createThumbnailPreview(prisma, pathParam(req, "editionId"), input),
      );
    }),
  );

  router.get(
    "/thumbnails/:thumbnailId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await thumbnails.getThumbnail(prisma, pathParam(req, "thumbnailId")));
    }),
  );

  router.put(
    "/thumbnails/:thumbnailId",
    asyncHandler(async (req, res) => {
      const input = parseBody(saveThumbnailRequestSchema, req.body);
      sendData(res, 200, await thumbnails.saveThumbnail(prisma, pathParam(req, "thumbnailId"), input));
    }),
  );

  router.delete(
    "/thumbnails/:thumbnailId",
    asyncHandler(async (req, res) => {
      await thumbnails.deleteThumbnail(prisma, pathParam(req, "thumbnailId"));
      res.status(204).end();
    }),
  );

  router.get(
    "/thumbnails/:thumbnailId/image",
    mediaGuard,
    asyncHandler(async (req, res) => {
      const image = await thumbnails.generateThumbnailImage(
        prisma,
        directories,
        rasterizer,
        pathParam(req, "thumbnailId"),
      );
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(image.filename)}`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      res.status(200).send(image.png);
    }),
  );

  return router;
}
