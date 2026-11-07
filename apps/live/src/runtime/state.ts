import type {
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveCue,
  LivePackageShow,
  LiveServerShowMeta,
  LiveStageConnection,
  MaterialCard,
  StageClock,
  StageCommentState,
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
  cueStartedAt: Date | null;
  material: MaterialCard | null;
  comment: StageCommentState | null;
  status: StageStatus;
  clock: StageClock;
}

export function buildShowMeta(show: LivePackageShow): LiveServerShowMeta {
  return {
    title: show.show.title,
    targetDurationMs: show.show.targetDurationMs,
    segments: show.segments.map((segment) => ({
      id: segment.id,
      label: segment.label,
      kind: segment.kind,
      targetDurationMs: segment.targetDurationMs,
    })),
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
) {
  const character = characters.characters.find((entry) => entry.side === side);
  if (character === undefined) {
    return null;
  }
  const speaking = cue !== null && cue.speaker === side;
  // P2 draws placeholder characters, so both sides use the required neutral
  // expression. P3 resolves per-cue expression presets from characters.json.
  return {
    expression: "normal",
    speaking,
  };
}

/**
 * Builds the P2 stage state. Character art is placeholder-only for now; the
 * expression and speaking flags already match the contract that P3 will draw.
 */
export function buildStageState(input: StageStateInput): StageState {
  const { cue } = input;
  return {
    phase: input.phase,
    show: {
      title: input.show.show.title,
      startAt: input.show.show.startAt,
    },
    segment: input.segment,
    characters: {
      left: characterState(input.characters, "left", cue),
      right: characterState(input.characters, "right", cue),
    },
    caption: cue === null ? null : { speaker: cue.speaker, text: cue.caption },
    material:
      input.material === null
        ? null
        : { id: input.material.id, focus: input.material.focus },
    comment: input.comment,
    status: input.status,
    playback:
      cue === null || cue.audio === null || input.cueStartedAt === null
        ? null
        : {
            cueId: cue.id,
            attempt: input.attempt,
            startedAt: input.cueStartedAt.toISOString(),
            audioUrl: cue.audio,
          },
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
  playback: StageState["playback"];
  status: StageStatus;
  clock: StageClock;
}): ConsoleSnapshot {
  return {
    runId: input.runId,
    show: buildShowMeta(input.show),
    phase: input.phase,
    segment: input.segment,
    stages: input.stages,
    queue: input.queue,
    currentCueId: input.currentCueId,
    playback: input.playback,
    status: input.status,
    clock: input.clock,
  };
}
