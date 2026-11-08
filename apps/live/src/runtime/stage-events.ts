import type { StageEvent } from "@kakeai/contracts";
import type { CutInRuntime } from "./cut-in-runtime.ts";
import type { StageLeaseManager } from "./lease.ts";
import type { Playout } from "./playout.ts";

export interface StageEventHost {
  readonly runId: string;
  readonly leases: StageLeaseManager;
  readonly playout: Playout;
  readonly cutIn?: CutInRuntime;
  logIgnored(event: StageEvent, reason: string): void;
}

/**
 * Accepts audio events only from the current program session. Heartbeats and
 * stage_ready refresh the lease; preview events never reach playout.
 */
export function handleProgramStageEvent(
  host: StageEventHost,
  sessionId: string,
  event: StageEvent,
): void {
  if (host.leases.roleOf(sessionId) !== "program") {
    return;
  }
  if (event.runId !== host.runId || event.sessionId !== sessionId) {
    return;
  }
  if (event.kind === "stage_heartbeat" || event.kind === "stage_ready") {
    host.leases.touch(sessionId);
    return;
  }
  host.leases.touch(sessionId);
  if (event.kind === "cut_in_ended" || event.kind === "cut_in_error") {
    if (host.cutIn === undefined) {
      host.logIgnored(event, "cut_in_unavailable");
      return;
    }
    const result = host.cutIn.handleStageEvent(event);
    if (!result.accepted) {
      host.logIgnored(event, result.reason);
    }
    return;
  }
  const audioEvent = {
    cueId: event.cueId,
    attempt: event.attempt,
    sequence: event.sequence,
  };
  if (event.kind === "audio_ended") {
    const result = host.playout.handleAudioEnded(audioEvent);
    if (!result.accepted) {
      host.logIgnored(event, result.reason);
    }
    return;
  }
  if (event.kind === "audio_error") {
    const result = host.playout.handleAudioError(audioEvent, event.error);
    if (!result.accepted) {
      host.logIgnored(event, result.reason);
    }
    return;
  }
  host.logIgnored(event, "unsupported_kind");
}
