import { Router } from "express";
import { createWorkRequestSchema, updateWorkRequestSchema } from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as works from "../../services/works.ts";

export function createWorksRouter(prisma: PrismaClient): Router {
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
      await works.deleteWork(prisma, pathParam(req, "workId"));
      res.status(204).end();
    }),
  );

  return router;
}
