import { Router } from "express";
import {
  createFaceSetRequestSchema,
  updateFaceSetRequestSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as faceSets from "../../services/face-sets.ts";

export interface FaceSetsRouterDependencies {
  prisma: PrismaClient;
}

export function createFaceSetsRouter(dependencies: FaceSetsRouterDependencies): Router {
  const { prisma } = dependencies;
  const router = Router();

  router.get(
    "/face-sets",
    asyncHandler(async (_req, res) => {
      sendData(res, 200, await faceSets.listFaceSets(prisma));
    }),
  );

  router.post(
    "/face-sets",
    asyncHandler(async (req, res) => {
      const input = parseBody(createFaceSetRequestSchema, req.body);
      sendData(res, 201, await faceSets.createFaceSet(prisma, input));
    }),
  );

  router.get(
    "/face-sets/:faceSetId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await faceSets.getFaceSet(prisma, pathParam(req, "faceSetId")));
    }),
  );

  router.get(
    "/face-sets/:faceSetId/revisions",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await faceSets.getFaceSetRevisions(prisma, pathParam(req, "faceSetId")),
      );
    }),
  );

  router.get(
    "/face-sets/:faceSetId/usages",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await faceSets.getFaceSetUsages(prisma, pathParam(req, "faceSetId")),
      );
    }),
  );

  router.patch(
    "/face-sets/:faceSetId",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateFaceSetRequestSchema, req.body);
      sendData(
        res,
        200,
        await faceSets.updateFaceSet(prisma, pathParam(req, "faceSetId"), input),
      );
    }),
  );

  router.delete(
    "/face-sets/:faceSetId",
    asyncHandler(async (req, res) => {
      await faceSets.deleteFaceSet(prisma, pathParam(req, "faceSetId"));
      res.status(204).end();
    }),
  );

  return router;
}
