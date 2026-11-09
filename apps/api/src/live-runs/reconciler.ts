import {
  emptyLiveRunState,
  isLiveRunTerminal,
  type LiveControlStatus,
  type LiveRunFailure,
  type LiveRunState,
  type LiveRunStatus,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import type { LiveRun as LiveRunRow } from "../generated/prisma/client.ts";
import type { LiveControlClient } from "./control-client.ts";
import type { LiveProcessController } from "./process.ts";

export interface ReconcileDependencies {
  prisma: PrismaClient;
  controlClient: LiveControlClient;
  processController: LiveProcessController;
  now?: () => Date;
}

export interface ReconcileResult {
  row: LiveRunRow;
  state: LiveRunState;
}

/** A launched app may need a few seconds before /control/status answers. */
const LAUNCH_GRACE_MS = 30_000;

function withinLaunchGrace(row: LiveRunRow, now: Date): boolean {
  return (
    row.status === "launching" &&
    row.launchedAt !== null &&
    now.getTime() - row.launchedAt.getTime() < LAUNCH_GRACE_MS
  );
}

function stateFromControl(control: LiveControlStatus): LiveRunState {
  return {
    ready: control.ready,
    showStarted: control.showStarted,
    showEnded: control.showEnded,
    phase: control.phase,
  };
}

function terminalState(row: LiveRunRow): LiveRunState {
  return {
    ...emptyLiveRunState(),
    showEnded: row.status === "ended",
  };
}

async function markFailed(
  deps: ReconcileDependencies,
  row: LiveRunRow,
  failure: LiveRunFailure,
): Promise<ReconcileResult> {
  const now = deps.now ?? (() => new Date());
  const updated = await deps.prisma.liveRun.update({
    where: { id: row.id },
    data: {
      status: "failed",
      failureCode: failure.code,
      failureMessage: failure.message,
      endedAt: row.endedAt ?? now(),
    },
  });
  return { row: updated, state: terminalState(updated) };
}

/**
 * Reconnects to a launched Run. A dead process or an unreachable control
 * endpoint is recorded as a failure; nothing is restarted and the show is
 * never auto-played.
 */
export async function reconcileLiveRun(
  deps: ReconcileDependencies,
  row: LiveRunRow,
): Promise<ReconcileResult> {
  if (isLiveRunTerminal(row.status as LiveRunStatus) || row.status === "preparing") {
    return { row, state: terminalState(row) };
  }
  if (row.controlUrl === null || row.controlTokenRef === null) {
    return markFailed(deps, row, {
      code: "control_unreachable",
      message: "Run に control URL または token 参照がありません。",
    });
  }
  const pid = row.pid;
  const now = (deps.now ?? (() => new Date()))();
  if (pid === null) {
    // A Run between the `launching` claim and the PID update is not dead yet.
    if (withinLaunchGrace(row, now)) {
      return { row, state: terminalState(row) };
    }
    return markFailed(deps, row, {
      code: "process_exited",
      message: "ライブアプリの PID が記録されていません。",
    });
  }
  if (!deps.processController.isAlive(pid)) {
    return markFailed(deps, row, {
      code: "process_exited",
      message: "ライブアプリのプロセスが終了しています。自動再起動は行いません。",
    });
  }

  let control: LiveControlStatus;
  try {
    control = await deps.controlClient.status({
      url: row.controlUrl,
      tokenFile: row.controlTokenRef,
      logDir: row.logDir,
      expectedPort: row.requestedPort,
    });
  } catch (error) {
    if (withinLaunchGrace(row, now)) {
      return { row, state: terminalState(row) };
    }
    return markFailed(deps, row, {
      code: "control_unreachable",
      message: `ライブアプリの control endpoint に接続できません: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  if (control.status === "failed") {
    return markFailed(
      deps,
      row,
      control.failure ?? {
        code: "live_failed",
        message: "ライブアプリが失敗を報告しました。",
      },
    );
  }

  const nextStatus =
    control.status === "stopped"
      ? "stopped"
      : control.status === "ended"
        ? "ended"
        : control.status === "starting"
          ? "launching"
          : "running";
  const ended = nextStatus === "stopped" || nextStatus === "ended";
  if (nextStatus === row.status && !ended) {
    return { row, state: stateFromControl(control) };
  }
  const updated = await deps.prisma.liveRun.update({
    where: { id: row.id },
    data: {
      status: nextStatus,
      ...(ended ? { endedAt: row.endedAt ?? now } : {}),
    },
  });
  return { row: updated, state: stateFromControl(control) };
}
