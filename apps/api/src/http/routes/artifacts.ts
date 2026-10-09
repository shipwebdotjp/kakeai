import { Router, type RequestHandler } from "express";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DataDirectories } from "../../storage/paths.ts";
import { sendContent } from "../content.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { pathParam } from "../validation.ts";
import * as artifacts from "../../services/artifacts.ts";

export interface ArtifactsRouterDependencies {
  prisma: PrismaClient;
  directories: DataDirectories;
  mediaGuard: RequestHandler;
}

export function createArtifactsRouter(dependencies: ArtifactsRouterDependencies): Router {
  const { prisma, directories, mediaGuard } = dependencies;
  const router = Router();

  router.get(
    "/artifacts/:artifactId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await artifacts.getArtifact(prisma, pathParam(req, "artifactId")));
    }),
  );

  router.get(
    "/artifacts/:artifactId/content",
    mediaGuard,
    asyncHandler(async (req, res, next) => {
      const file = await artifacts.resolveArtifactContent(
        prisma,
        directories,
        pathParam(req, "artifactId"),
      );
      sendContent(req, res, next, file);
    }),
  );

  router.delete(
    "/artifacts/:artifactId",
    asyncHandler(async (req, res) => {
      await artifacts.deleteArtifact(prisma, directories, pathParam(req, "artifactId"));
      res.status(204).end();
    }),
  );

  return router;
}
