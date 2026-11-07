export type AudioEventRejection =
  | "paused"
  | "no_current"
  | "thinking"
  | "cue_mismatch"
  | "attempt_mismatch"
  | "stale_sequence"
  | "future_sequence";

export type AudioEventResult =
  | { accepted: true }
  | { accepted: false; reason: AudioEventRejection };

export interface PlayoutAudioEvent {
  cueId: string | null;
  attempt: number;
  sequence: number;
}

export interface AudioEventState {
  paused: boolean;
  thinking: boolean;
  currentCueId: string | null;
  started: boolean;
  attempt: number;
  sequence: number | null;
}

/** Only the exact cue, attempt and playback sequence is accepted. */
export function checkAudioEvent(
  state: AudioEventState,
  event: PlayoutAudioEvent,
): AudioEventResult {
  if (state.paused) {
    return { accepted: false, reason: "paused" };
  }
  if (!state.started || state.currentCueId === null || state.sequence === null) {
    return { accepted: false, reason: state.thinking ? "thinking" : "no_current" };
  }
  if (event.cueId !== state.currentCueId) {
    return { accepted: false, reason: "cue_mismatch" };
  }
  if (event.attempt !== state.attempt) {
    return { accepted: false, reason: "attempt_mismatch" };
  }
  if (event.sequence < state.sequence) {
    return { accepted: false, reason: "stale_sequence" };
  }
  if (event.sequence > state.sequence) {
    return { accepted: false, reason: "future_sequence" };
  }
  return { accepted: true };
}
