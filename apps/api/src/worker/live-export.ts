import type { LiveExportJobSnapshot } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import type { Job, PrismaClient } from "../generated/prisma/client.ts";
import { processProgramLiveExportJob } from "./live-export-program.ts";
import {
  failJob,
  parseSnapshot,
  type LiveExportJobDependencies,
} from "./live-export-common.ts";

export type { LiveExportJobDependencies } from "./live-export-common.ts";

/**
 * The worker only accepts Live Program exports. A queued snapshot from the
 * removed Work/Show Profile exporter fails as invalid input instead of being
 * interpreted as a different Job shape.
 */
export async function processLiveExportJob(
  prisma: PrismaClient,
  config: AppConfig,
  job: Job,
  dependencies: LiveExportJobDependencies = {},
): Promise<void> {
  let snapshot: LiveExportJobSnapshot;
  try {
    snapshot = parseSnapshot(job);
  } catch (error) {
    await failJob(prisma, job, error, []);
    return;
  }
  await processProgramLiveExportJob(prisma, config, job, snapshot, dependencies);
}
