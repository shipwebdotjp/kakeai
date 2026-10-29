import { Router } from "express";
import {
  bulkDeleteScriptVersionsRequestSchema,
  draftPreviewRequestSchema,
  saveScriptVersionRequestSchema,
  updateYouTubeVideoSettingsRequestSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as scriptVersions from "../../services/script-versions.ts";
import * as works from "../../services/works.ts";
import * as youtubeSettings from "../../services/youtube-settings.ts";

export interface LanguageEditionsRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
}

export function createLanguageEditionsRouter(
  dependencies: LanguageEditionsRouterDependencies,
): Router {
  const { prisma, directories } = dependencies;
  const router = Router();

  router.get(
    "/language-editions/:editionId/youtube-settings",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await youtubeSettings.getYouTubeVideoSettings(prisma, pathParam(req, "editionId")),
      );
    }),
  );

  router.put(
    "/language-editions/:editionId/youtube-settings",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateYouTubeVideoSettingsRequestSchema, req.body);
      sendData(
        res,
        200,
        await youtubeSettings.updateYouTubeVideoSettings(
          prisma,
          pathParam(req, "editionId"),
          input,
        ),
      );
    }),
  );

  router.get(
    "/language-editions/:editionId/current-script-version",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await scriptVersions.getCurrentScriptVersion(prisma, pathParam(req, "editionId")),
      );
    }),
  );

  router.get(
    "/language-editions/:editionId/script-versions",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await scriptVersions.listScriptVersions(prisma, pathParam(req, "editionId")));
    }),
  );

  router.post(
    "/language-editions/:editionId/script-versions",
    asyncHandler(async (req, res) => {
      const input = parseBody(saveScriptVersionRequestSchema, req.body);
      const result = await scriptVersions.saveScriptVersion(prisma, pathParam(req, "editionId"), input);
      sendData(
        res,
        201,
        result.scriptVersion,
        result.warnings.length > 0 ? { warnings: result.warnings } : undefined,
      );
    }),
  );

  router.post(
    "/language-editions/:editionId/script-versions/bulk-delete",
    asyncHandler(async (req, res) => {
      const input = parseBody(bulkDeleteScriptVersionsRequestSchema, req.body);
      await scriptVersions.deleteScriptVersions(
        prisma,
        directories,
        pathParam(req, "editionId"),
        input.scriptVersionIds,
      );
      res.status(204).end();
    }),
  );

  router.post(
    "/language-editions/:editionId/draft-preview",
    asyncHandler(async (req, res) => {
      const input = parseBody(draftPreviewRequestSchema, req.body);
      sendData(
        res,
        200,
        await scriptVersions.createDraftPreview(
          prisma,
          directories,
          pathParam(req, "editionId"),
          input,
        ),
      );
    }),
  );

  router.delete(
    "/language-editions/:editionId",
    asyncHandler(async (req, res) => {
      await works.deleteLanguageEdition(prisma, directories, pathParam(req, "editionId"));
      res.status(204).end();
    }),
  );

  return router;
}
