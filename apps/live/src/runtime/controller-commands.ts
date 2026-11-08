import type { LiveNoticeLevel, LiveSegment, StagePhase } from "@kakeai/contracts";
import type { RunLogEventInput } from "../runs/run-store.ts";
import type { CommentRuntime } from "./comment-runtime.ts";
import type { CommandResult } from "./command-dispatch.ts";
import type { Playout } from "./playout.ts";
import type { CueQueueStore } from "./queue.ts";
import { ACTIVE_PHASES } from "./segments.ts";
import type { Spine } from "./spine.ts";

/** Narrow controller surface used by phase and operator commands. */
export interface PhaseCommandsHost {
  phase(): StagePhase;
  setPhase(phase: StagePhase): void;
  showStartedAtMs(): number | null;
  beginShow(atMs: number): void;
  phaseBeforePause(): StagePhase | null;
  setPhaseBeforePause(phase: StagePhase | null): void;
  endRequested(): boolean;
  setEndRequested(value: boolean): void;
  safeMode(): boolean;
  setSafeMode(value: boolean): void;
  now(): Date;
  readonly comments: CommentRuntime;
  readonly spine: Spine;
  readonly playout: Playout;
  readonly queues: CueQueueStore;
  currentSegment(): LiveSegment | null;
  log(input: RunLogEventInput): void;
  notice(level: LiveNoticeLevel, message: string): void;
  reject(message: string): CommandResult;
  publish(): void;
  publishPreload(): void;
  clearGeneration(): void;
  cancelResponse(): void;
  enterPostShow(): void;
}

/**
 * Operator-facing phase commands: start/end/pause/resume/stop/safe mode/skip.
 * State mutations go through the host so the controller stays the single
 * owner while this file keeps the transition rules in one place.
 */
export class PhaseCommands {
  constructor(private readonly host: PhaseCommandsHost) {}

  start(): CommandResult {
    const { host } = this;
    const canStart =
      host.phase() === "pre_show" ||
      (host.phase() === "safe_mode" && host.showStartedAtMs() === null);
    if (!canStart) {
      return host.reject("開始できるのは pre_show のときだけです。");
    }
    host.beginShow(host.now().getTime());
    host.comments.startSources();
    host.spine.enterSegment(0);
    return { ok: true };
  }

  end(): CommandResult {
    const { host } = this;
    const phase = host.phase();
    if (phase === "post_show" || phase === "pre_show" || phase === "error") {
      return host.reject("終了できる状態ではありません。");
    }
    if (host.showStartedAtMs() === null) {
      return host.reject("まだ開始していません。");
    }
    if (host.currentSegment()?.kind === "closing") {
      host.enterPostShow();
      return { ok: true };
    }
    if (phase === "paused") {
      host.setEndRequested(false);
      host.comments.interrupt("skip");
      host.spine.enterClosing();
      return { ok: true };
    }
    host.setEndRequested(true);
    host.notice("info", "現在のキューの終了後にクロージングへ進みます。");
    return { ok: true };
  }

  pause(): CommandResult {
    const { host } = this;
    if (!ACTIVE_PHASES.has(host.phase()) || host.showStartedAtMs() === null) {
      return host.reject("一時停止できる状態ではありません。");
    }
    host.setPhaseBeforePause(host.phase());
    host.setPhase("paused");
    host.playout.pause();
    host.comments.pause();
    host.publish();
    return { ok: true };
  }

  resume(): CommandResult {
    const { host } = this;
    if (host.phase() !== "paused") {
      return host.reject("再開できる状態ではありません。");
    }
    if (host.safeMode() && host.currentSegment()?.kind === "comment" && !host.comments.isActive()) {
      host.setPhase("safe_mode");
      host.log({ type: "resumed" });
      host.spine.handleQueueFinished();
      host.publish();
      return { ok: true };
    }
    const resumePhase = host.safeMode()
      ? "safe_mode"
      : (host.phaseBeforePause() ?? "script");
    host.setPhase(resumePhase);
    host.playout.resume();
    host.comments.resume();
    host.log({
      type: "resumed",
      ...(host.playout.current === null ? {} : { cueId: host.playout.current.id }),
    });
    host.publish();
    return { ok: true };
  }

  stop(): CommandResult {
    const { host } = this;
    if (
      host.phase() === "pre_show" ||
      host.phase() === "post_show" ||
      host.phase() === "error" ||
      host.showStartedAtMs() === null
    ) {
      return host.reject("停止できる状態ではありません。");
    }
    const currentCueId = host.playout.current?.id ?? null;
    if (host.phase() !== "paused") {
      host.setPhaseBeforePause(host.phase());
    }
    host.setPhase("paused");
    host.playout.stop();
    host.comments.pause();
    // `continuePlaying: false` cannot emit queue_finished synchronously, so
    // cancel before discard here (safe_mode keeps the flag through discard).
    host.clearGeneration();
    host.cancelResponse();
    const removed = [
      ...host.playout.discardGeneratedCues({ continuePlaying: false }),
      ...host.queues.removeWhere(
        (cue) => cue.source === "generated" || cue.source === "manual",
      ),
    ];
    for (const cue of removed) {
      host.log({ type: "cue_deleted", cueId: cue.id, data: { reason: "stop" } });
    }
    host.log({
      type: "stopped",
      ...(currentCueId === null ? {} : { cueId: currentCueId }),
    });
    host.publishPreload();
    host.publish();
    return { ok: true };
  }

  enterSafeMode(): CommandResult {
    const { host } = this;
    if (
      host.phase() === "post_show" ||
      host.phase() === "error" ||
      host.phase() === "safe_mode"
    ) {
      return host.reject("安全モードへ移行できる状態ではありません。");
    }
    // v1 has no exit command: once the operator enters safe mode, prepared
    // cues continue safely until the show ends.
    host.setSafeMode(true);
    host.clearGeneration();
    host.log({
      type: "safe_mode",
      ...(host.playout.current === null ? {} : { cueId: host.playout.current.id }),
    });
    const paused = host.phase() === "paused";
    const cornerWasActive = host.comments.interrupt("safe_mode") ?? false;
    if (paused) {
      host.playout.stop();
    } else {
      host.setPhase("safe_mode");
    }
    const removed = [
      ...host.playout.discardGeneratedCues({ continuePlaying: !paused }),
      ...host.queues.removeWhere(
        (cue) => cue.source === "generated" || cue.source === "manual",
      ),
    ];
    // Keep the response flag active through the discard: removing the current
    // response cue can emit `queue_finished`, which must not advance the spine.
    host.cancelResponse();
    for (const cue of removed) {
      host.log({ type: "cue_deleted", cueId: cue.id, data: { reason: "safe_mode" } });
    }
    host.publishPreload();
    host.publish();
    if (cornerWasActive && !paused) {
      host.spine.handleQueueFinished();
    }
    return { ok: true };
  }

  skipCue(): CommandResult {
    const { host } = this;
    const phase = host.phase();
    if (phase === "pre_show" || phase === "post_show" || phase === "error") {
      return host.reject("スキップできる状態ではありません。");
    }
    if (host.currentSegment()?.kind === "comment" && host.comments.isActive()) {
      const currentCommentId = host.comments.getCurrentCommentId();
      if (currentCommentId !== null) {
        const result = host.comments.handleCommand({
          kind: "skip_comment",
          commentId: currentCommentId,
        });
        return result.ok ? { ok: true } : host.reject(result.message);
      }
      host.comments.interrupt("skip");
      host.spine.handleQueueFinished();
      return { ok: true };
    }
    if (host.playout.current === null) {
      return host.reject("スキップするキューがありません。");
    }
    if (!host.playout.skipCurrent()) {
      return host.reject("スキップできませんでした。");
    }
    host.publishPreload();
    host.publish();
    return { ok: true };
  }
}
