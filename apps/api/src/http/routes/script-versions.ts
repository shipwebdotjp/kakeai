import { Router } from "express";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { pathParam } from "../validation.ts";
import * as scriptVersions from "../../services/script-versions.ts";

export function createScriptVersionsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    "/script-versions/:scriptVersionId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await scriptVersions.getScriptVersion(prisma, pathParam(req, "scriptVersionId")));
    }),
  );

  return router;
}
