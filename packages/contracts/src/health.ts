import { z } from "zod";
import { localeSchema, nonNegativeInt } from "./content/primitives";
import { assetKindSchema, jobKindSchema } from "./dto";

export const workerStatusSchema = z.enum(["ready", "notReady"]);
export const storageStatusSchema = z.enum(["ok", "warning"]);

export const healthResponseSchema = z.object({
  apiVersion: z.literal("v1"),
  worker: z.object({
    status: workerStatusSchema,
  }),
  capabilities: z.object({
    locales: z.array(localeSchema),
    jobKinds: z.array(jobKindSchema),
    assetKinds: z.array(assetKindSchema),
  }),
  storage: z.object({
    warningThresholdBytes: nonNegativeInt,
    status: storageStatusSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type WorkerStatus = z.infer<typeof workerStatusSchema>;
export type StorageStatus = z.infer<typeof storageStatusSchema>;
