import { Router } from "express";
import {
  createBulkTtsJobsRequestSchema,
  createRenderJobRequestSchema,
  createTtsJobRequestSchema,
} from "@kakeai/contracts";
import type { AppConfig } from "../../config.ts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as renderJobs from "../../services/render-jobs.ts";
import * as scriptVersions from "../../services/script-versions.ts";
import * as ttsJobs from "../../services/tts-jobs.ts";
import * as youtubeSettings from "../../services/youtube-settings.ts";
import type { FontCatalogService } from "../../services/font-catalog.ts";

export interface ScriptVersionsRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
  config: AppConfig;
  fontCatalogService?: FontCatalogService;
}

export function createScriptVersionsRouter(dependencies: ScriptVersionsRouterDependencies): Router {
  const { prisma, directories, config, fontCatalogService } = dependencies;
  const router = Router();

  router.get(
    "/script-versions/:scriptVersionId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await scriptVersions.getScriptVersion(prisma, pathParam(req, "scriptVersionId")));
    }),
  );

  router.get(
    "/script-versions/:scriptVersionId/preview",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await scriptVersions.getScriptVersionPreview(
          prisma,
          directories,
          pathParam(req, "scriptVersionId"),
        ),
      );
    }),
  );

  router.get(
    "/script-versions/:scriptVersionId/youtube-chapters",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await youtubeSettings.getYouTubeChaptersForScriptVersion(
          prisma,
          pathParam(req, "scriptVersionId"),
        ),
      );
    }),
  );

  router.get(
    "/script-versions/:scriptVersionId/subtitles",
    asyncHandler(async (req, res) => {
      const { filename, srt } = await scriptVersions.getScriptVersionSubtitles(
        prisma,
        pathParam(req, "scriptVersionId"),
      );
      res.attachment(filename);
      res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      res.status(200).send(Buffer.from(srt, "utf8"));
    }),
  );

  router.post(
    "/script-versions/:scriptVersionId/render-jobs",
    asyncHandler(async (req, res) => {
      parseBody(createRenderJobRequestSchema, req.body);
      sendData(
        res,
        202,
        await renderJobs.createRenderJob(prisma, pathParam(req, "scriptVersionId"), fontCatalogService),
      );
    }),
  );

  router.post(
    "/script-versions/:scriptVersionId/narration-segments/:narrationSegmentId/tts-jobs",
    asyncHandler(async (req, res) => {
      const input = parseBody(createTtsJobRequestSchema, req.body);
      sendData(
        res,
        202,
        await ttsJobs.createTtsJob(
          prisma,
          config,
          pathParam(req, "scriptVersionId"),
          pathParam(req, "narrationSegmentId"),
          input,
        ),
      );
    }),
  );

  router.post(
    "/script-versions/:scriptVersionId/tts-jobs",
    asyncHandler(async (req, res) => {
      parseBody(createBulkTtsJobsRequestSchema, req.body);
      sendData(
        res,
        202,
        await ttsJobs.createBulkTtsJobs(prisma, config, pathParam(req, "scriptVersionId")),
      );
    }),
  );

  return router;
}
