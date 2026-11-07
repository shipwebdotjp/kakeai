import { Router } from "express";
import { liveExportRequestSchema } from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody } from "../validation.ts";
import { createLiveExportJob } from "../../services/live-exports.ts";
import type { FontCatalogService } from "../../services/font-catalog.ts";

export function createLiveExportsRouter(
  prisma: PrismaClient,
  fontCatalogService?: FontCatalogService,
): Router {
  const router = Router();

  router.post(
    "/live-exports",
    asyncHandler(async (req, res) => {
      const body = parseBody(liveExportRequestSchema, req.body);
      const job = await createLiveExportJob(prisma, body, fontCatalogService);
      sendData(res, 202, job);
    }),
  );

  return router;
}
