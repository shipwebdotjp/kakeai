import { Router } from "express";
import { createRenderJobRequestSchema, createTtsJobRequestSchema } from "@kakeai/contracts";
import type { AppConfig } from "../../config.ts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as renderJobs from "../../services/render-jobs.ts";
import * as scriptVersions from "../../services/script-versions.ts";
import * as ttsJobs from "../../services/tts-jobs.ts";

export interface ScriptVersionsRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
  config: AppConfig;
}

export function createScriptVersionsRouter(dependencies: ScriptVersionsRouterDependencies): Router {
  const { prisma, directories, config } = dependencies;
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

  router.post(
    "/script-versions/:scriptVersionId/render-jobs",
    asyncHandler(async (req, res) => {
      parseBody(createRenderJobRequestSchema, req.body);
      sendData(
        res,
        202,
        await renderJobs.createRenderJob(prisma, pathParam(req, "scriptVersionId")),
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

  return router;
}
