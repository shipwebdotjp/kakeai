import type { LiveCommand } from "@kakeai/contracts";
import type { CueControl, LiveCuePatch } from "./control-queue.ts";
import type { GeneratedCueCommandResult, GeneratedCueEdit } from "../director/generation-service.ts";

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

export interface CueCommandHooks {
  editGeneratedCue(cueId: string, patch: GeneratedCueEdit): GeneratedCueCommandResult;
  regenerateGeneratedCue(cueId: string): GeneratedCueCommandResult;
  playCorrection(cueId: string): CueCommandResult;
}

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
 * Cue-level command handling. Generated cues with a speech change re-run TTS
 * through the generation service; prepared cues keep the P3 edit path.
 */
export function handleCueCommand(
  cueControl: CueControl,
  command: CueCommand,
  hooks?: CueCommandHooks,
): CueCommandResult {
  switch (command.kind) {
    case "edit_cue": {
      const patch: LiveCuePatch = {};
      if (command.caption !== undefined) patch.caption = command.caption;
      if (command.speech !== undefined) patch.speech = command.speech;
      if (command.expression !== undefined) patch.expression = command.expression;
      const cue = cueControl.getCue(command.cueId);
      if (cue === null) {
        return { ok: false, message: "編集できるキューがありません。" };
      }
      if (cue.source === "generated") {
        if (hooks === undefined) {
          return { ok: false, message: "生成レスの編集が設定されていません。" };
        }
        const generated: GeneratedCueEdit = {};
        if (command.caption !== undefined) generated.caption = command.caption;
        if (command.speech !== undefined) generated.speech = command.speech;
        if (command.expression !== undefined) generated.expression = command.expression;
        return hooks.editGeneratedCue(command.cueId, generated);
      }
      return cueControl.updateCue(command.cueId, patch)
        ? { ok: true }
        : { ok: false, message: "編集できるキューがありません。" };
    }
    case "cancel_cue": {
      const cue = cueControl.getCue(command.cueId);
      if (cue === null || (cue.source !== "generated" && cue.source !== "manual")) {
        return {
          ok: false,
          message: "キャンセルできる生成キューがありません。再生開始後は停止・訂正を使ってください。",
        };
      }
      return cueControl.removeCue(command.cueId)
        ? { ok: true }
        : {
            ok: false,
            message: "キャンセルできるキューがありません。再生開始後は停止・訂正を使ってください。",
          };
    }
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
      return hooks === undefined
        ? { ok: false, message: "再生成できる生成レスがありません。" }
        : hooks.regenerateGeneratedCue(command.cueId);
    case "play_correction":
      return hooks === undefined
        ? { ok: false, message: "訂正キューを再生できません。" }
        : hooks.playCorrection(command.cueId);
    default: {
      const exhaustive: never = command;
      throw new Error(`Unsupported cue command: ${JSON.stringify(exhaustive)}`);
    }
  }
}
