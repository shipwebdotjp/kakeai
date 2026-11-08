import type {
  CommentSourceStatus,
  ConsoleCutIn,
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveCommentCorner,
  LiveCommentEntry,
  LiveCue,
  LiveGenerationStatus,
  LivePackageShow,
  LiveServerShowMeta,
  LiveStageConnection,
  MaterialCard,
  StageClock,
  StageCommentState,
  StageCutIn,
  StagePhase,
  StageState,
  StageStatus,
} from "@kakeai/contracts";

export interface StageStateInput {
  show: LivePackageShow;
  characters: LiveCharacterSheet;
  phase: StagePhase;
  segment: { id: string; label: string } | null;
  cue: LiveCue | null;
  attempt: number;
  sequence: number | null;
  cueStartedAt: Date | null;
  material: MaterialCard | null;
  comment: StageCommentState | null;
  status: StageStatus;
  cutIn: StageCutIn | null;
  clock: StageClock;
}

export function buildShowMeta(show: LivePackageShow): LiveServerShowMeta {
  return {
    title: show.show.title,
    targetDurationMs: show.show.targetDurationMs,
    segments: show.segments.map((segment) => {
      if (segment.kind === "cut_in") {
        const cutIn = show.cutIns.find((entry) => entry.id === segment.cutInId);
        return {
          id: segment.id,
          label: segment.label,
          kind: segment.kind,
          // Package load-time validation rejects a missing CutIn. Fall back to
          // a positive duration so snapshot generation never throws on a
          // corrupt show (the contract requires positiveInt, not 0).
          targetDurationMs: cutIn?.durationMs ?? 1,
        };
      }
      return {
        id: segment.id,
        label: segment.label,
        kind: segment.kind,
        targetDurationMs: segment.targetDurationMs,
      };
    }),
  };
}

export function computeClock(
  show: LivePackageShow,
  showStartedAtMs: number | null,
  nowMs: number,
): StageClock {
  if (showStartedAtMs === null) {
    return { elapsedMs: 0, remainingMs: show.show.targetDurationMs };
  }
  const elapsedMs = Math.max(0, Math.floor(nowMs - showStartedAtMs));
  return {
    elapsedMs,
    remainingMs: Math.max(0, show.show.targetDurationMs - elapsedMs),
  };
}

function characterState(
  characters: LiveCharacterSheet,
  side: "left" | "right",
  cue: LiveCue | null,
  speaking: boolean,
) {
  const character = characters.characters.find((entry) => entry.side === side);
  if (character === undefined) {
    return null;
  }
  // The speaking side uses the cue's preset; the listener keeps the neutral
  // expression. Character art rendering is handled by the stage.
  const isSpeaker = speaking && cue !== null && cue.speaker === side;
  return {
    expression: isSpeaker && cue !== null ? cue.expression : "normal",
    speaking: isSpeaker,
  };
}

/**
 * Builds the stage state. Character art is placeholder-only for now; the
 * expression and speaking flags already match the contract that P3 will draw.
 */
export function buildStageState(input: StageStateInput): StageState {
  const { cue } = input;
  if (input.cutIn !== null) {
    // CutIn is a full-screen layer: characters, captions, material cards and
    // comments are hidden while it plays, and it is never cue playback.
    return {
      phase: input.phase,
      show: {
        title: input.show.show.title,
        startAt: input.show.show.startAt,
      },
      segment: input.segment,
      characters: { left: null, right: null },
      caption: null,
      material: null,
      comment: null,
      status: "idle",
      playback: null,
      cutIn: input.cutIn,
      clock: input.clock,
    };
  }
  const isSpeaking = input.status === "speaking";
  return {
    phase: input.phase,
    show: {
      title: input.show.show.title,
      startAt: input.show.show.startAt,
    },
    segment: input.segment,
    characters: {
      left: characterState(input.characters, "left", cue, isSpeaking),
      right: characterState(input.characters, "right", cue, isSpeaking),
    },
    caption: cue === null ? null : { speaker: cue.speaker, text: cue.caption },
    material:
      input.material === null
        ? null
        : { id: input.material.id, focus: input.material.focus },
    comment: input.comment,
    status: input.status,
    playback:
      cue === null ||
      cue.audio === null ||
      input.cueStartedAt === null ||
      input.sequence === null
        ? null
        : {
            cueId: cue.id,
            attempt: input.attempt,
            sequence: input.sequence,
            startedAt: input.cueStartedAt.toISOString(),
            audioUrl: cue.audio,
          },
    cutIn: input.cutIn,
    clock: input.clock,
  };
}

export function buildConsoleSnapshot(input: {
  runId: string;
  show: LivePackageShow;
  phase: StagePhase;
  segment: { id: string; label: string } | null;
  stages: LiveStageConnection[];
  queue: LiveCue[];
  currentCueId: string | null;
  queuePosition: number | null;
  playback: StageState["playback"];
  status: StageStatus;
  clock: StageClock;
  comments: LiveCommentEntry[];
  commentCorner: LiveCommentCorner;
  commentSource: CommentSourceStatus;
  generation: LiveGenerationStatus | null;
  cutIn: ConsoleCutIn | null;
}): ConsoleSnapshot {
  return {
    runId: input.runId,
    show: buildShowMeta(input.show),
    phase: input.phase,
    segment: input.segment,
    stages: input.stages,
    queue: input.queue,
    currentCueId: input.currentCueId,
    queuePosition: input.queuePosition,
    playback: input.playback,
    status: input.status,
    clock: input.clock,
    cutIn: input.cutIn,
    comments: input.comments,
    commentCorner: input.commentCorner,
    commentSource: input.commentSource,
    generation: input.generation,
  };
}

export function emptyCommentCorner(): LiveCommentCorner {
  return {
    state: "idle",
    segmentId: null,
    selectedCommentIds: [],
    currentCommentId: null,
    deferredPinIds: [],
    remainingSlots: 0,
  };
}

export function idleCommentSource(kind: CommentSourceStatus["kind"]): CommentSourceStatus {
  return {
    kind,
    state: "idle",
    liveChatId: null,
    pollingIntervalMs: 0,
    lastPolledAt: null,
    lastError: null,
    quota: null,
    authMode: null,
    fallbackAvailable: false,
    authExpiresAt: null,
    needsReauth: false,
  };
}
