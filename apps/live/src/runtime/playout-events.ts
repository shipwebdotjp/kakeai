import type { LiveNoticeLevel, LivePreloadCue } from "@kakeai/contracts";
import type { RunLogEventInput, RunStore } from "../runs/run-store.ts";
import type { PlayoutEvent } from "./playout.ts";

export interface PlayoutEventHost {
  readonly runStore: RunStore | undefined;
  segmentId(): string | null;
  log(input: RunLogEventInput): void;
  notice(level: LiveNoticeLevel, message: string): void;
  publish(): void;
  emitPreload(cues: LivePreloadCue[]): void;
  pauseForFailure(): void;
  handleQueueFinished(): void;
}

/** Applies playout events to run logs, notices and phase transitions. */
export function dispatchPlayoutEvent(host: PlayoutEventHost, event: PlayoutEvent): void {
  switch (event.type) {
    case "cue_started":
      host.runStore?.appendCue({
        event: "started",
        cueId: event.cue.id,
        status: "playing",
        attempt: event.attempt,
        sequence: event.sequence,
        segmentId: host.segmentId(),
      });
      host.emitPreload(event.preload);
      host.publish();
      return;
    case "cue_finished":
      host.runStore?.appendCue({
        event: "finished",
        cueId: event.cue.id,
        status: event.status,
        attempt: event.attempt,
        sequence: event.sequence,
        reason: event.reason,
      });
      if (event.status === "skipped") {
        host.log({
          type: "cue_skipped",
          cueId: event.cue.id,
          data: { reason: event.reason },
        });
      }
      if (event.status !== "failed") {
        host.publish();
      }
      return;
    case "cue_skipped":
      host.runStore?.appendCue({
        event: "skipped",
        cueId: event.cue.id,
        status: "skipped",
        reason: event.reason,
      });
      host.log({
        type: "cue_skipped",
        cueId: event.cue.id,
        data: { reason: event.reason },
      });
      if (event.reason === "not_ready") {
        host.notice(
          "warning",
          `キューが時間内に準備できなかったためスキップしました: ${event.cue.id}`,
        );
      }
      host.publish();
      return;
    case "failure":
      host.runStore?.appendError(event.message);
      host.log({
        type: "error",
        cueId: event.cue.id,
        data: {
          message: event.message,
          reason: event.reason,
          attempt: event.attempt,
          sequence: event.sequence,
          consecutiveFailures: event.consecutiveFailures,
        },
      });
      if (event.suspended) {
        host.pauseForFailure();
      }
      host.notice(
        event.suspended ? "error" : "warning",
        event.suspended
          ? `${event.message}（連続 ${event.consecutiveFailures} 回失敗したため一時停止しました）`
          : event.message,
      );
      host.publish();
      return;
    case "thinking":
      host.publish();
      return;
    case "queue_finished":
      host.handleQueueFinished();
      return;
    default: {
      const exhaustive: never = event;
      throw new Error(`Unsupported playout event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
