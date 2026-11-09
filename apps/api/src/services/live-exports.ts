import type { Job as JobDto, LiveExportRequest } from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { FontCatalogService, getSharedFontCatalogService } from "./font-catalog.ts";
import { createProgramLiveExportJob } from "./live-export-program.ts";

/**
 * Creates a live export Job for one immutable Live Program Version. The
 * version owns its script, cast, theme, materials and CutIns, so Work,
 * ScriptVersion and Show Profile inputs are not accepted.
 */
export async function createLiveExportJob(
  prisma: PrismaClient,
  input: LiveExportRequest,
  fontCatalogService: FontCatalogService = getSharedFontCatalogService(),
): Promise<JobDto> {
  return createProgramLiveExportJob(prisma, input, fontCatalogService);
}
