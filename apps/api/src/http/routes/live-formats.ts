import { Router } from "express";
import {
  createLiveFormatRequestSchema,
  duplicateLiveFormatRequestSchema,
  updateLiveFormatRequestSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { listWindow, parseBody, pathParam } from "../validation.ts";
import * as liveFormats from "../../services/live-formats.ts";

export function createLiveFormatsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    "/live-formats",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await liveFormats.listLiveFormats(prisma, listWindow(req)),
      );
    }),
  );

  router.post(
    "/live-formats",
    asyncHandler(async (req, res) => {
      const body = parseBody(createLiveFormatRequestSchema, req.body);
      sendData(res, 201, await liveFormats.createLiveFormat(prisma, body.document));
    }),
  );

  router.get(
    "/live-formats/:id",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await liveFormats.getLiveFormat(prisma, pathParam(req, "id")));
    }),
  );

  router.patch(
    "/live-formats/:id",
    asyncHandler(async (req, res) => {
      const body = parseBody(updateLiveFormatRequestSchema, req.body);
      sendData(
        res,
        200,
        await liveFormats.updateLiveFormat(prisma, pathParam(req, "id"), body.document),
      );
    }),
  );

  router.post(
    "/live-formats/:id/duplicate",
    asyncHandler(async (req, res) => {
      const body = parseBody(duplicateLiveFormatRequestSchema, req.body);
      sendData(
        res,
        201,
        await liveFormats.duplicateLiveFormat(
          prisma,
          pathParam(req, "id"),
          body.name,
        ),
      );
    }),
  );

  return router;
}
