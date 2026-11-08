import type {
  ConsoleSnapshot,
  LiveCharacterSheet,
  LiveNoticeLevel,
  LivePackageShow,
  LivePreloadCue,
  RunLogEvent,
  StageState,
} from "@kakeai/contracts";
import type { RunStore } from "../runs/run-store.ts";
import type { CommentCorner } from "./comment-corner.ts";
import type { PlayoutScheduler } from "./playout.ts";

export type LiveControllerChange =
  | { type: "state"; state: StageState }
  | { type: "snapshot"; snapshot: ConsoleSnapshot }
  | { type: "preload"; cues: LivePreloadCue[] }
  | { type: "event"; event: RunLogEvent }
  | { type: "notice"; level: LiveNoticeLevel; message: string };

export interface LiveControllerOptions {
  runId: string;
  show: LivePackageShow;
  characters: LiveCharacterSheet;
  runStore?: RunStore;
  now?: () => Date;
  leaseTtlMs?: number;
  playoutScheduler?: PlayoutScheduler;
  /** Comment corner implementation. Omit to skip comment segments. */
  comments?: CommentCorner;
}
