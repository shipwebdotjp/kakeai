import type {
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveCue,
  LiveGenerationStatus,
  LivePackageShow,
  LiveSegment,
  MaterialCard,
  StageClock,
  StagePhase,
  StageState,
  StageStatus,
} from "@kakeai/contracts";
import type { CommentRuntime } from "./comment-runtime.ts";
import type { StageLeaseManager } from "./lease.ts";
import type { Playout } from "./playout.ts";
import type { CueQueueStore } from "./queue.ts";
import {
  buildConsoleSnapshot,
  buildStageState,
  emptyCommentCorner,
  idleCommentSource,
} from "./state.ts";

export interface ControllerViewHost {
  readonly runId: string;
  readonly show: LivePackageShow;
  readonly characters: LiveCharacterSheet;
  readonly playout: Playout;
  readonly queues: CueQueueStore;
  readonly leases: StageLeaseManager;
  readonly comments: CommentRuntime;
  phase(): StagePhase;
  segment(): LiveSegment | null;
  segmentLabel(segment: LiveSegment | null): { id: string; label: string } | null;
  materialForCue(segment: LiveSegment, cue: LiveCue | null): MaterialCard | null;
  clock(): StageClock;
  /** Wired by the director integration (P5b); null until then. */
  generation?(): LiveGenerationStatus | null;
}

/** Assembles the stage state and console snapshot from the live controller. */
export class ControllerView {
  constructor(private readonly host: ControllerViewHost) {}

  getStatus(): StageStatus {
    const { host } = this;
    const phase = host.phase();
    if (
      phase === "paused" ||
      phase === "pre_show" ||
      phase === "post_show" ||
      phase === "error"
    ) {
      return "idle";
    }
    const commentStatus = host.comments.getStageStatus();
    if (host.segment()?.kind === "comment" && commentStatus !== "idle") {
      return commentStatus;
    }
    if (host.playout.isThinking) {
      return "thinking";
    }
    const cue = host.playout.current;
    return cue !== null && cue.audio !== null && host.playout.currentStartedAt !== null
      ? "speaking"
      : "idle";
  }

  getState(): StageState {
    const { host } = this;
    const segment = host.segment();
    const cue = host.playout.current;
    return buildStageState({
      show: host.show,
      characters: host.characters,
      phase: host.phase(),
      segment: host.segmentLabel(segment),
      cue,
      attempt: host.playout.currentAttempt,
      sequence: host.playout.currentSequenceValue,
      cueStartedAt: host.playout.currentStartedAt,
      material: segment === null ? null : host.materialForCue(segment, cue),
      comment: host.comments.getStageComment(),
      status: this.getStatus(),
      clock: host.clock(),
    });
  }

  getSnapshot(): ConsoleSnapshot {
    const { host } = this;
    const segment = host.segment();
    const state = this.getState();
    const queue = host.queues.flatten().map((cue) => ({ ...cue }));
    const currentCueId =
      state.playback?.cueId ??
      (host.playout.isThinking ? (host.playout.current?.id ?? null) : null);
    const found = currentCueId === null ? -1 : queue.findIndex((cue) => cue.id === currentCueId);
    const commentSnapshot = host.comments.getSnapshot();
    return buildConsoleSnapshot({
      runId: host.runId,
      show: host.show,
      phase: host.phase(),
      segment: host.segmentLabel(segment),
      stages: host.leases.list(),
      queue,
      currentCueId,
      queuePosition: found < 0 ? null : found,
      playback: state.playback,
      status: state.status,
      clock: state.clock,
      comments: commentSnapshot?.comments ?? [],
      commentCorner: commentSnapshot?.corner ?? emptyCommentCorner(),
      commentSource:
        commentSnapshot?.source ?? idleCommentSource(host.show.commentSource.kind),
      generation: host.generation?.() ?? null,
    });
  }
}
