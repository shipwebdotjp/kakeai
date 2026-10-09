import { Router } from "express";
import {
  SUPPORTED_LOCALES,
  assetKindSchema,
  healthResponseSchema,
  jobKindSchema,
  voiceAdapterIdSchema,
  type HealthResponse,
  type StorageStatus,
  type WorkerStatus,
} from "@kakeai/contracts";
import type { LimitsConfig } from "../config.ts";
import { sendData } from "./envelope.ts";

export function buildHealthResponse(
  limits: LimitsConfig,
  workerStatus: WorkerStatus,
  storageStatus: StorageStatus = "ok",
): HealthResponse {
  return healthResponseSchema.parse({
    apiVersion: "v1",
    worker: { status: workerStatus },
    capabilities: {
      locales: [...SUPPORTED_LOCALES],
      jobKinds: [...jobKindSchema.options],
      assetKinds: [...assetKindSchema.options],
      voiceAdapters: [...voiceAdapterIdSchema.options],
    },
    storage: {
      warningThresholdBytes: limits.storageWarningBytes,
      status: storageStatus,
    },
  });
}

export interface HealthRouterDependencies {
  limits: LimitsConfig;
  getWorkerStatus: () => WorkerStatus;
  getStorageStatus: () => StorageStatus;
}

export function createHealthRouter(dependencies: HealthRouterDependencies): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    sendData(
      res,
      200,
      buildHealthResponse(dependencies.limits, dependencies.getWorkerStatus(), dependencies.getStorageStatus()),
    );
  });
  return router;
}
