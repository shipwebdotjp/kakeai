import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEFAULT_LIVE_RUN_PORT,
  LIVE_RUN_TERMINAL_STATUSES,
  liveRunConfigSchema,
  liveRunListSchema,
  type CreateLiveRunRequest,
  type LiveRun,
  type LiveRunConfig,
  type LiveRunConfigSource,
  type LiveRunList,
  type LiveRunState,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import type { LiveRun as LiveRunRow } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import { newLiveId } from "../live/ids.ts";
import { httpLiveControlClient, type LiveControlClient } from "../live-runs/control-client.ts";
import { toLiveRun, parseStoredSource } from "../live-runs/dto.ts";
import {
  detachedLiveRunLauncher,
  type LiveRunLauncher,
} from "../live-runs/launcher.ts";
import { verifyRunPackageBuild } from "../live-runs/package.ts";
import { systemProcessController, type LiveProcessController } from "../live-runs/process.ts";
import { reconcileLiveRun } from "../live-runs/reconciler.ts";
import { prepareRunSource } from "../live-runs/source.ts";

export interface LiveRunsDependencies {
  prisma: PrismaClient;
  /** Kakeai data root; Runs live under `<root>/live-runs/<runId>`. */
  dataRoot: string;
  liveConfigPath?: string;
  launcher?: LiveRunLauncher;
  controlClient?: LiveControlClient;
  processController?: LiveProcessController;
  now?: () => Date;
}

function resolved(deps: LiveRunsDependencies) {
  return {
    launcher: deps.launcher ?? detachedLiveRunLauncher,
    controlClient: deps.controlClient ?? httpLiveControlClient,
    processController: deps.processController ?? systemProcessController,
    now: deps.now ?? (() => new Date()),
  };
}

function runDirFor(deps: LiveRunsDependencies, runId: string): string {
  return join(deps.dataRoot, "live-runs", runId);
}

function configSourceFor(
  source: ReturnType<typeof parseStoredSource>,
  logDir: string,
): LiveRunConfigSource {
  if (source.kind === "youtube") {
    return source;
  }
  return {
    kind: "fixture",
    fixturePath: join(logDir, source.fixtureFile),
    fixtureSha256: source.fixtureSha256,
  };
}

async function buildRunConfig(
  row: LiveRunRow,
  source: ReturnType<typeof parseStoredSource>,
): Promise<LiveRunConfig> {
  return liveRunConfigSchema.parse({
    schemaVersion: 1,
    runId: row.id,
    programVersionId: row.programVersionId,
    package: {
      packageId: row.packageId,
      manifestSha256: row.manifestSha256,
      packagePath: row.packagePath,
    },
    source: configSourceFor(source, row.logDir),
    startAt: row.startAt?.toISOString() ?? null,
    requestedPort: row.requestedPort,
  });
}

async function writeRunConfig(row: LiveRunRow, source: ReturnType<typeof parseStoredSource>) {
  const config = await buildRunConfig(row, source);
  const path = join(row.logDir, "run-config.json");
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return { config, path };
}

async function getRow(
  deps: LiveRunsDependencies,
  runId: string,
): Promise<LiveRunRow> {
  const row = await deps.prisma.liveRun.findUnique({ where: { id: runId } });
  if (row === null) {
    throw resourceNotFound("live_run", runId);
  }
  return row;
}

/**
 * The database has no partial unique index on the port (SQLite would keep the
 * port reserved after a Run ends), so both creation and launch re-check it.
 */
async function assertPortAvailable(
  prisma: PrismaClient,
  requestedPort: number,
  excludeRunId?: string,
): Promise<void> {
  const portInUse = await prisma.liveRun.findFirst({
    where: {
      requestedPort,
      status: { notIn: [...LIVE_RUN_TERMINAL_STATUSES] },
      ...(excludeRunId === undefined ? {} : { id: { not: excludeRunId } }),
    },
    select: { id: true },
  });
  if (portInUse !== null) {
    throw new ApiError(
      409,
      "INVALID_STATE",
      `requestedPort ${requestedPort} は実行中の Run が使用しています。`,
      { requestedPort, runId: portInUse.id },
    );
  }
}

/** Creates the operational snapshot; package verification happens first. */
export async function createLiveRun(
  deps: LiveRunsDependencies,
  input: CreateLiveRunRequest,
): Promise<LiveRun> {
  const version = await deps.prisma.liveProgramVersion.findUnique({
    where: { id: input.programVersionId },
  });
  if (version === null) {
    throw resourceNotFound("live_program_version", input.programVersionId);
  }
  const requestedPort = input.requestedPort ?? DEFAULT_LIVE_RUN_PORT;
  if (requestedPort < 1024 || requestedPort > 65535) {
    throw validationError([
      {
        path: ["requestedPort"],
        code: "custom",
        message: "requestedPort には 1024 以上 65535 以下を指定してください。",
      },
    ]);
  }
  await assertPortAvailable(deps.prisma, requestedPort);
  await verifyRunPackageBuild(deps.prisma, input.packageBuild, {
    id: version.id,
    programId: version.programId,
    documentSha256: version.documentSha256,
    resolutionSnapshotSha256: version.resolutionSnapshotSha256,
  });

  const runId = newLiveId("run");
  const logDir = runDirFor(deps, runId);
  let createdId: string | null = null;
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  try {
    const source = await prepareRunSource(input.source, logDir);
    const now = resolved(deps).now();
    const row = await deps.prisma.liveRun.create({
      data: {
        id: runId,
        programVersionId: version.id,
        packageId: input.packageBuild.packageId,
        manifestSha256: input.packageBuild.manifestSha256,
        packagePath: input.packageBuild.packagePath,
        sourceKind: source.stored.kind,
        sourceJson: JSON.stringify(source.stored),
        startAt: input.startAt === undefined || input.startAt === null
          ? null
          : new Date(input.startAt),
        requestedPort,
        status: "preparing",
        logDir,
        createdAt: now,
        updatedAt: now,
      },
    });
    createdId = row.id;
    await writeRunConfig(row, source.stored);
    return toLiveRun(row);
  } catch (error) {
    if (createdId !== null) {
      await deps.prisma.liveRun.delete({ where: { id: createdId } }).catch(() => undefined);
    }
    await rm(logDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Reconciles a launched Run without ever restarting it. */
export async function getLiveRun(
  deps: LiveRunsDependencies,
  runId: string,
): Promise<LiveRun> {
  const row = await getRow(deps, runId);
  const environment = resolved(deps);
  const result = await reconcileLiveRun(
    {
      prisma: deps.prisma,
      controlClient: environment.controlClient,
      processController: environment.processController,
      now: environment.now,
    },
    row,
  );
  return toLiveRun(result.row, result.state);
}

export async function listLiveRuns(
  deps: LiveRunsDependencies,
  limit: number,
  offset: number,
): Promise<LiveRunList> {
  const [rows, total] = await Promise.all([
    deps.prisma.liveRun.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      skip: offset,
    }),
    deps.prisma.liveRun.count(),
  ]);
  const environment = resolved(deps);
  // One broken control endpoint must not hide the whole list. Keep the last
  // persisted row for Runs whose reconciliation failed.
  const settled = await Promise.allSettled(
    rows.map(async (row) => {
      const result = await reconcileLiveRun(
        {
          prisma: deps.prisma,
          controlClient: environment.controlClient,
          processController: environment.processController,
          now: environment.now,
        },
        row,
      );
      return toLiveRun(result.row, result.state);
    }),
  );
  const items = settled.map((result, index) =>
    result.status === "fulfilled" ? result.value : toLiveRun(rows[index]!),
  );
  return liveRunListSchema.parse({ items, limit, offset, total });
}

async function failLaunch(
  deps: LiveRunsDependencies,
  row: LiveRunRow,
  message: string,
): Promise<never> {
  const now = resolved(deps).now();
  await deps.prisma.liveRun.update({
    where: { id: row.id },
    data: {
      status: "failed",
      failureCode: "launch_failed",
      failureMessage: message.slice(0, 2000),
      endedAt: now,
    },
  });
  throw new ApiError(500, "LIVE_RUN_LAUNCH_FAILED", message);
}

/**
 * Issues the one-time control token and spawns the detached app. This does not
 * start the show: the console operator still presses 番組開始.
 */
export async function launchLiveRun(
  deps: LiveRunsDependencies,
  runId: string,
): Promise<LiveRun> {
  const row = await getRow(deps, runId);
  if (row.status !== "preparing" || row.launchedAt !== null || row.pid !== null) {
    throw new ApiError(409, "LIVE_RUN_ALREADY_LAUNCHED");
  }
  // Creating several Runs concurrently narrows but does not close the race;
  // check again right before claiming the launch.
  await assertPortAvailable(deps.prisma, row.requestedPort, row.id);
  const version = await deps.prisma.liveProgramVersion.findUnique({
    where: { id: row.programVersionId },
  });
  if (version === null) {
    throw resourceNotFound("live_program_version", row.programVersionId);
  }
  await verifyRunPackageBuild(
    deps.prisma,
    {
      packageId: row.packageId,
      manifestSha256: row.manifestSha256,
      packagePath: row.packagePath,
    },
    {
      id: version.id,
      programId: version.programId,
      documentSha256: version.documentSha256,
      resolutionSnapshotSha256: version.resolutionSnapshotSha256,
    },
  );

  const source = parseStoredSource(row);
  const environment = resolved(deps);
  const now = environment.now();
  const controlUrl = `http://127.0.0.1:${row.requestedPort}`;
  const tokenPath = join(row.logDir, "control-token");

  const claimed = await deps.prisma.liveRun.updateMany({
    where: { id: row.id, status: "preparing", launchedAt: null },
    data: {
      status: "launching",
      controlUrl,
      controlTokenRef: tokenPath,
      launchedAt: now,
    },
  });
  if (claimed.count === 0) {
    throw new ApiError(409, "LIVE_RUN_ALREADY_LAUNCHED");
  }

  let runConfigPath: string;
  try {
    const token = randomBytes(32).toString("base64url");
    await writeFile(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(tokenPath, 0o600);
    ({ path: runConfigPath } = await writeRunConfig(row, source));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failLaunch(deps, row, message);
  }

  let pid: number;
  try {
    const launched = await environment.launcher.launch({
      runId: row.id,
      packagePath: row.packagePath,
      runDir: row.logDir,
      port: row.requestedPort,
      controlTokenFile: tokenPath,
      runConfigPath,
      ...(deps.liveConfigPath === undefined ? {} : { configPath: deps.liveConfigPath }),
    });
    pid = launched.pid;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failLaunch(deps, row, message);
  }

  const updated = await deps.prisma.liveRun
    .update({
      where: { id: row.id },
      data: { pid },
    })
    .catch(async (error: unknown) => {
      // The child is already running detached. If the PID cannot be stored,
      // terminate it so the Run cannot leave an orphan process behind.
      await environment.processController.stop(pid).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      return failLaunch(deps, row, `PID を保存できませんでした: ${message}`);
    });
  const state: LiveRunState = {
    ready: false,
    showStarted: false,
    showEnded: false,
    phase: null,
  };
  return toLiveRun(updated, state);
}

/** Graceful control stop, then PID termination if the app did not exit. */
export async function stopLiveRun(
  deps: LiveRunsDependencies,
  runId: string,
): Promise<LiveRun> {
  const row = await getRow(deps, runId);
  if (row.status === "stopped" || row.status === "failed" || row.status === "ended") {
    return toLiveRun(row);
  }
  const environment = resolved(deps);
  if (row.status === "preparing") {
    const updated = await deps.prisma.liveRun.update({
      where: { id: row.id },
      data: { status: "stopped", endedAt: environment.now() },
    });
    return toLiveRun(updated);
  }

  let stopError: unknown = null;
  let controlAttempted = false;
  let controlStopped = false;
  if (row.controlUrl !== null && row.controlTokenRef !== null) {
    controlAttempted = true;
    try {
      await environment.controlClient.stop({
        url: row.controlUrl,
        tokenFile: row.controlTokenRef,
        logDir: row.logDir,
        expectedPort: row.requestedPort,
      });
      controlStopped = true;
    } catch (error) {
      stopError = error;
    }
  }
  if (row.pid !== null && controlStopped) {
    // Give the control stop a chance to exit gracefully before signaling.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (!environment.processController.isAlive(row.pid)) {
        break;
      }
      await delay(100);
    }
  }
  if (row.pid !== null && environment.processController.isAlive(row.pid)) {
    try {
      await environment.processController.stop(row.pid);
    } catch (error) {
      const message = [
        stopError instanceof Error ? stopError.message : null,
        error instanceof Error ? error.message : String(error),
      ]
        .filter((entry): entry is string => entry !== null)
        .join(" / ");
      const updated = await deps.prisma.liveRun.update({
        where: { id: row.id },
        data: {
          status: "failed",
          failureCode: "stop_failed",
          failureMessage: message.slice(0, 2000),
          endedAt: environment.now(),
        },
      });
      return toLiveRun(updated);
    }
  }

  // Without a control endpoint and a PID there is nothing left to signal. Do
  // not claim the Run stopped when its stop could not be confirmed.
  if (row.pid === null && (!controlAttempted || !controlStopped)) {
    const detail = controlAttempted
      ? stopError instanceof Error
        ? stopError.message
        : String(stopError)
      : "control URL または token 参照がありません。";
    const updated = await deps.prisma.liveRun.update({
      where: { id: row.id },
      data: {
        status: "failed",
        failureCode: "stop_failed",
        failureMessage: `ライブアプリを停止できませんでした: ${detail}`.slice(0, 2000),
        endedAt: environment.now(),
      },
    });
    return toLiveRun(updated);
  }

  const updated = await deps.prisma.liveRun.update({
    where: { id: row.id },
    data: { status: "stopped", endedAt: environment.now() },
  });
  return toLiveRun(updated);
}
