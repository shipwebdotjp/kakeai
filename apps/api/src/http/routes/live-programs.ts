import { Router } from "express";
import {
  createLiveProgramRequestSchema,
  finalizeLiveProgramVersionRequestSchema,
  importLiveMaterialRequestSchema,
  restoreLiveProgramVersionDraftRequestSchema,
  saveLiveProgramDraftRequestSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { listWindow, parseBody, pathParam } from "../validation.ts";
import * as livePrograms from "../../services/live-programs.ts";

export function createLiveProgramsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    "/live-programs",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await livePrograms.listLivePrograms(prisma, listWindow(req)),
      );
    }),
  );

  router.post(
    "/live-programs",
    asyncHandler(async (req, res) => {
      const body = parseBody(createLiveProgramRequestSchema, req.body);
      sendData(
        res,
        201,
        await livePrograms.createLiveProgram(prisma, {
          formatId: body.formatId,
          ...(body.title === undefined ? {} : { title: body.title }),
        }),
      );
    }),
  );

  router.get(
    "/live-programs/:id",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await livePrograms.getLiveProgram(prisma, pathParam(req, "id")));
    }),
  );

  router.put(
    "/live-programs/:id/draft",
    asyncHandler(async (req, res) => {
      const body = parseBody(saveLiveProgramDraftRequestSchema, req.body);
      sendData(
        res,
        200,
        await livePrograms.saveLiveProgramDraft(prisma, pathParam(req, "id"), {
          expectedRevision: body.expectedRevision,
          document: body.document,
        }),
      );
    }),
  );

  router.post(
    "/live-programs/:id/versions",
    asyncHandler(async (req, res) => {
      const body = parseBody(finalizeLiveProgramVersionRequestSchema, req.body);
      sendData(
        res,
        201,
        await livePrograms.finalizeLiveProgramVersion(prisma, pathParam(req, "id"), {
          expectedRevision: body.expectedRevision,
          ...(body.note === undefined ? {} : { note: body.note }),
        }),
      );
    }),
  );

  router.get(
    "/live-programs/:id/versions",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await livePrograms.listLiveProgramVersions(prisma, pathParam(req, "id")),
      );
    }),
  );

  router.get(
    "/live-programs/:id/versions/:versionId",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await livePrograms.getLiveProgramVersion(
          prisma,
          pathParam(req, "id"),
          pathParam(req, "versionId"),
        ),
      );
    }),
  );

  router.post(
    "/live-programs/:id/versions/:versionId/draft",
    asyncHandler(async (req, res) => {
      const body = parseBody(restoreLiveProgramVersionDraftRequestSchema, req.body);
      sendData(
        res,
        200,
        await livePrograms.restoreLiveProgramVersionDraft(
          prisma,
          pathParam(req, "id"),
          pathParam(req, "versionId"),
          { expectedRevision: body.expectedRevision },
        ),
      );
    }),
  );

  router.get(
    "/live-programs/:id/materials",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await livePrograms.listLiveMaterials(
          prisma,
          pathParam(req, "id"),
          listWindow(req),
        ),
      );
    }),
  );

  router.post(
    "/live-programs/:id/materials/import",
    asyncHandler(async (req, res) => {
      const body = parseBody(importLiveMaterialRequestSchema, req.body);
      sendData(
        res,
        201,
        await livePrograms.importLiveMaterial(prisma, pathParam(req, "id"), {
          expectedRevision: body.expectedRevision,
          workId: body.workId,
          sceneId: body.sceneId,
          ...(body.name === undefined ? {} : { name: body.name }),
          format: body.format,
          durationMs: body.durationMs,
        }),
      );
    }),
  );

  return router;
}
