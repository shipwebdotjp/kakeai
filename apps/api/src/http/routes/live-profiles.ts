import { Router } from "express";
import { liveAutoProfileRequestSchema } from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody } from "../validation.ts";
import { buildLiveAutoProfile } from "../../services/live-profiles.ts";

export function createLiveProfilesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post(
    "/live-profiles/auto",
    asyncHandler(async (req, res) => {
      const body = parseBody(liveAutoProfileRequestSchema, req.body);
      sendData(res, 200, await buildLiveAutoProfile(prisma, body));
    }),
  );

  return router;
}
