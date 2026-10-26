import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  type CanvasProfile,
  DEFAULT_CANVAS_PROFILE,
  canvasProfileSchema,
} from "@kakeai/contracts";

export async function getCompositionDurationsByVersionId(
  db: PrismaClient,
  versionIds: string[],
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(versionIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const rows = await db.compositionVersion.findMany({
    where: { id: { in: uniqueIds } },
  });
  const durations = new Map<string, number>();
  for (const row of rows) {
    let durationMs: unknown;
    try {
      durationMs = (JSON.parse(row.manifestJson) as { durationMs?: unknown })
        .durationMs;
    } catch {
      continue;
    }
    if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
      durations.set(row.id, durationMs);
    }
  }
  return durations;
}

export async function getCompositionCanvasProfilesByVersionId(
  db: PrismaClient,
  versionIds: string[],
): Promise<Map<string, CanvasProfile>> {
  const uniqueIds = [...new Set(versionIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const rows = await db.compositionVersion.findMany({
    where: { id: { in: uniqueIds } },
  });
  const profiles = new Map<string, CanvasProfile>();
  for (const row of rows) {
    let raw: unknown;
    try {
      raw = (JSON.parse(row.manifestJson) as { canvasProfile?: unknown })
        .canvasProfile;
    } catch {
      continue;
    }
    const parsed = canvasProfileSchema.safeParse(raw);
    profiles.set(row.id, parsed.success ? parsed.data : DEFAULT_CANVAS_PROFILE);
  }
  return profiles;
}
