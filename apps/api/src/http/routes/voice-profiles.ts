import { Router } from "express";
import {
  createVoiceProfileRequestSchema,
  updateVoiceProfileRequestSchema,
} from "@kakeai/contracts";
import type { AppConfig } from "../../config.ts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { validationError, parseBody, pathParam } from "../validation.ts";
import * as voiceProfiles from "../../services/voice-profiles.ts";

export interface VoiceProfilesRouterDependencies {
  prisma: PrismaClient;
  config: AppConfig;
}

function adapterIdQuery(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0) {
    throw validationError([
      {
        path: ["adapterId"],
        code: "invalid_value",
        message: "adapterId が必要です。",
      },
    ]);
  }
  return value;
}

export function createVoiceProfilesRouter(
  dependencies: VoiceProfilesRouterDependencies,
): Router {
  const { prisma, config } = dependencies;
  const router = Router();

  router.get(
    "/voice-adapters",
    asyncHandler(async (_req, res) => {
      sendData(res, 200, voiceProfiles.listVoiceAdapters());
    }),
  );

  router.get(
    "/voice-profiles/voices",
    asyncHandler(async (req, res) => {
      const rawModel = req.query.model;
      const model = Array.isArray(rawModel) ? rawModel[0] : rawModel;
      sendData(
        res,
        200,
        await voiceProfiles.listAdapterVoices(
          config,
          voiceProfiles.parseAdapterId(adapterIdQuery(req.query.adapterId)),
          typeof model === "string" ? model : undefined,
        ),
      );
    }),
  );

  router.get(
    "/voice-profiles/models",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await voiceProfiles.listAdapterModels(
          config,
          voiceProfiles.parseAdapterId(adapterIdQuery(req.query.adapterId)),
        ),
      );
    }),
  );

  router.get(
    "/voice-profiles",
    asyncHandler(async (_req, res) => {
      sendData(res, 200, await voiceProfiles.listVoiceProfiles(prisma));
    }),
  );

  router.get(
    "/voice-profiles/:voiceProfileId",
    asyncHandler(async (req, res) => {
      sendData(
        res,
        200,
        await voiceProfiles.getVoiceProfile(prisma, pathParam(req, "voiceProfileId")),
      );
    }),
  );

  router.post(
    "/voice-profiles",
    asyncHandler(async (req, res) => {
      const input = parseBody(createVoiceProfileRequestSchema, req.body);
      sendData(res, 201, await voiceProfiles.createVoiceProfile(prisma, input));
    }),
  );

  router.patch(
    "/voice-profiles/:voiceProfileId",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateVoiceProfileRequestSchema, req.body);
      sendData(
        res,
        200,
        await voiceProfiles.updateVoiceProfile(prisma, pathParam(req, "voiceProfileId"), input),
      );
    }),
  );

  router.delete(
    "/voice-profiles/:voiceProfileId",
    asyncHandler(async (req, res) => {
      await voiceProfiles.deleteVoiceProfile(prisma, pathParam(req, "voiceProfileId"));
      res.status(204).end();
    }),
  );

  return router;
}
