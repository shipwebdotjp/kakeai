import { Router } from "express";
import { createLiveRunRequestSchema } from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { LiveControlClient } from "../../live-runs/control-client.ts";
import type { LiveRunLauncher } from "../../live-runs/launcher.ts";
import type { LiveProcessController } from "../../live-runs/process.ts";
import * as liveRuns from "../../services/live-runs.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { listWindow, parseBody, pathParam } from "../validation.ts";

export interface LiveRunsRouterDependencies {
  prisma: PrismaClient;
  dataRoot: string;
  liveConfigPath?: string;
  launcher?: LiveRunLauncher;
  controlClient?: LiveControlClient;
  processController?: LiveProcessController;
  now?: () => Date;
}

export function createLiveRunsRouter(dependencies: LiveRunsRouterDependencies): Router {
  const router = Router();
  const deps: liveRuns.LiveRunsDependencies = {
    prisma: dependencies.prisma,
    dataRoot: dependencies.dataRoot,
    ...(dependencies.liveConfigPath === undefined
      ? {}
      : { liveConfigPath: dependencies.liveConfigPath }),
    ...(dependencies.launcher === undefined ? {} : { launcher: dependencies.launcher }),
    ...(dependencies.controlClient === undefined
      ? {}
      : { controlClient: dependencies.controlClient }),
    ...(dependencies.processController === undefined
      ? {}
      : { processController: dependencies.processController }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  };

  router.post(
    "/live-runs",
    asyncHandler(async (req, res) => {
      const body = parseBody(createLiveRunRequestSchema, req.body);
      sendData(res, 201, await liveRuns.createLiveRun(deps, body));
    }),
  );

  router.get(
    "/live-runs",
    asyncHandler(async (req, res) => {
      const { limit, offset } = listWindow(req);
      sendData(res, 200, await liveRuns.listLiveRuns(deps, limit, offset));
    }),
  );

  router.get(
    "/live-runs/:runId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await liveRuns.getLiveRun(deps, pathParam(req, "runId")));
    }),
  );

  router.post(
    "/live-runs/:runId/launch",
    asyncHandler(async (req, res) => {
      sendData(res, 202, await liveRuns.launchLiveRun(deps, pathParam(req, "runId")));
    }),
  );

  router.post(
    "/live-runs/:runId/stop",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await liveRuns.stopLiveRun(deps, pathParam(req, "runId")));
    }),
  );

  return router;
}
