import { Router } from "express";
import {
  createYouTubeSettingsTemplateRequestSchema,
  updateYouTubeSettingsTemplateRequestSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as youtubeSettings from "../../services/youtube-settings.ts";

export function createYouTubeTemplatesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    "/youtube-settings-templates",
    asyncHandler(async (_req, res) => {
      sendData(res, 200, await youtubeSettings.listYouTubeSettingsTemplates(prisma));
    }),
  );

  router.post(
    "/youtube-settings-templates",
    asyncHandler(async (req, res) => {
      const input = parseBody(createYouTubeSettingsTemplateRequestSchema, req.body);
      sendData(
        res,
        201,
        await youtubeSettings.createYouTubeSettingsTemplate(prisma, input),
      );
    }),
  );

  router.get(
    "/youtube-settings-templates/:templateId",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await youtubeSettings.getYouTubeSettingsTemplate(prisma, pathParam(req, "templateId")),
      );
    }),
  );

  router.put(
    "/youtube-settings-templates/:templateId",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateYouTubeSettingsTemplateRequestSchema, req.body);
      sendData(
        res,
        200,
        await youtubeSettings.updateYouTubeSettingsTemplate(
          prisma,
          pathParam(req, "templateId"),
          input,
        ),
      );
    }),
  );

  router.delete(
    "/youtube-settings-templates/:templateId",
    asyncHandler(async (req, res) => {
      await youtubeSettings.deleteYouTubeSettingsTemplate(prisma, pathParam(req, "templateId"));
      res.status(204).end();
    }),
  );

  return router;
}
