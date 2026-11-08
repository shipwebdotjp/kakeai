import type { LiveCommand } from "@kakeai/contracts";
import type { CueControl, LiveCuePatch } from "./control-queue.ts";

export type CueCommand = Extract<
  LiveCommand,
  {
    kind:
      | "edit_cue"
      | "cancel_cue"
      | "regenerate_cue"
      | "delete_cue"
      | "move_cue"
      | "play_correction";
  }
>;

export type CueCommandResult = { ok: true } | { ok: false; message: string };

const CUE_COMMAND_KINDS = [
  "edit_cue",
  "cancel_cue",
  "regenerate_cue",
  "delete_cue",
  "move_cue",
  "play_correction",
] as const;

export function isCueCommand(command: LiveCommand): command is CueCommand {
  return (CUE_COMMAND_KINDS as readonly string[]).includes(command.kind);
}

/**
 * Cue-level command handling. Edit/cancel/delete/move use the existing queue
 * controls; regeneration and correction playback are wired by the P5b
 * director/comment integration, so they stay explicit rejections here.
 */
export function handleCueCommand(
  cueControl: CueControl,
  command: CueCommand,
): CueCommandResult {
  switch (command.kind) {
    case "edit_cue": {
      const patch: LiveCuePatch = {};
      if (command.caption !== undefined) patch.caption = command.caption;
      if (command.speech !== undefined) patch.speech = command.speech;
      if (command.expression !== undefined) patch.expression = command.expression;
      return cueControl.updateCue(command.cueId, patch)
        ? { ok: true }
        : { ok: false, message: "編集できるキューがありません。" };
    }
    case "cancel_cue":
      return cueControl.removeCue(command.cueId)
        ? { ok: true }
        : {
            ok: false,
            message: "キャンセルできるキューがありません。再生開始後は停止・訂正を使ってください。",
          };
    case "delete_cue":
      return cueControl.removeCue(command.cueId)
        ? { ok: true }
        : {
            ok: false,
            message: "削除できるキューがありません。再生開始後は停止・訂正を使ってください。",
          };
    case "move_cue":
      return cueControl.moveCue(command.cueId, command.beforeCueId)
        ? { ok: true }
        : { ok: false, message: "並べ替えできるキューがありません。" };
    case "regenerate_cue":
      return { ok: false, message: "再生成できる生成レスがありません。" };
    case "play_correction":
      return { ok: false, message: "訂正キューを再生できません。" };
    default: {
      const exhaustive: never = command;
      throw new Error(`Unsupported cue command: ${JSON.stringify(exhaustive)}`);
    }
  }
}
