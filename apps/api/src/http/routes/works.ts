import { Router } from "express";
import { createWorkRequestSchema, updateWorkRequestSchema } from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as jobs from "../../services/jobs.ts";
import * as works from "../../services/works.ts";

export interface WorksRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
}

export function createWorksRouter(dependencies: WorksRouterDependencies): Router {
  const { prisma, directories } = dependencies;
  const router = Router();

  router.get(
    "/works",
    asyncHandler(async (_req, res) => {
      sendData(res, 200, await works.listWorks(prisma));
    }),
  );

  router.post(
    "/works",
    asyncHandler(async (req, res) => {
      const input = parseBody(createWorkRequestSchema, req.body);
      sendData(res, 201, await works.createWork(prisma, input.title, input.originalLocale));
    }),
  );

  router.get(
    "/works/:workId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await works.getWork(prisma, pathParam(req, "workId")));
    }),
  );

  router.patch(
    "/works/:workId",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateWorkRequestSchema, req.body);
      sendData(res, 200, await works.updateWork(prisma, pathParam(req, "workId"), input.title));
    }),
  );

  router.delete(
    "/works/:workId",
    asyncHandler(async (req, res) => {
      await works.deleteWork(prisma, directories, pathParam(req, "workId"));
      res.status(204).end();
    }),
  );

  router.get(
    "/works/:workId/jobs",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await jobs.listWorkJobs(prisma, pathParam(req, "workId")));
    }),
  );

  return router;
}
