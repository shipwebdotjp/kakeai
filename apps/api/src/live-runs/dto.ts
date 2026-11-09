import {
  emptyLiveRunState,
  liveRunSchema,
  liveRunSourceSchema,
  liveRunStatusSchema,
  type LiveRun,
  type LiveRunState,
} from "@kakeai/contracts";
import type { LiveRun as LiveRunRow } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";

export function parseStoredSource(row: LiveRunRow) {
  let raw: unknown;
  try {
    raw = JSON.parse(row.sourceJson);
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "LiveRun.sourceJson を解釈できません。");
  }
  const parsed = liveRunSourceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "LiveRun.sourceJson が契約に一致しません。");
  }
  return parsed.data;
}

function stageUrl(url: string | null): string | null {
  return url === null ? null : `${url}/stage`;
}

function consoleUrl(url: string | null): string | null {
  return url === null ? null : `${url}/console`;
}

export function toLiveRun(
  row: LiveRunRow,
  state: LiveRunState = emptyLiveRunState(),
): LiveRun {
  const status = liveRunStatusSchema.safeParse(row.status);
  if (!status.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "LiveRun.status が契約に一致しません。");
  }
  return liveRunSchema.parse({
    id: row.id,
    programVersionId: row.programVersionId,
    packageBuild: {
      packageId: row.packageId,
      manifestSha256: row.manifestSha256,
      packagePath: row.packagePath,
    },
    source: parseStoredSource(row),
    startAt: row.startAt?.toISOString() ?? null,
    requestedPort: row.requestedPort,
    status: status.data,
    control: {
      url: row.controlUrl,
      tokenRef: row.controlTokenRef,
      pid: row.pid,
    },
    stageUrl: stageUrl(row.controlUrl),
    consoleUrl: consoleUrl(row.controlUrl),
    logDir: row.logDir,
    failure:
      row.failureCode === null
        ? null
        : {
            code: row.failureCode,
            message: row.failureMessage ?? row.failureCode,
          },
    state,
    launchedAt: row.launchedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
