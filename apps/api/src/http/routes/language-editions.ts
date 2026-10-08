import { Router } from "express";
import { saveScriptVersionRequestSchema } from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as scriptVersions from "../../services/script-versions.ts";

export function createLanguageEditionsRouter(prisma: PrismaClient): Router {
  const router = Router();

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

  return router;
}
