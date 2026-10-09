import { Router } from "express";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { pathParam } from "../validation.ts";
import * as jobs from "../../services/jobs.ts";

export function createJobsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    "/jobs/:jobId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await jobs.getJob(prisma, pathParam(req, "jobId")));
    }),
  );

  router.post(
    "/jobs/:jobId/cancel",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await jobs.cancelJob(prisma, pathParam(req, "jobId")));
    }),
  );

  return router;
}
