import { Router } from "express";
import { createRenderJobRequestSchema } from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as renderJobs from "../../services/render-jobs.ts";
import * as scriptVersions from "../../services/script-versions.ts";

export interface ScriptVersionsRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
}

export function createScriptVersionsRouter(dependencies: ScriptVersionsRouterDependencies): Router {
  const { prisma, directories } = dependencies;
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

  return router;
}
