import type { LiveCommand } from "@kakeai/contracts";
import { isCommentCommand, type CommentRuntime } from "./comment-runtime.ts";
import { isCueCommand, type CueCommand } from "./cue-commands.ts";

export type CommandResult = { ok: true } | { ok: false; message: string };

/** The controller surface used by the command dispatcher. */
export interface LiveCommandAdapter {
  readonly comments: CommentRuntime;
  start(): CommandResult;
  end(): CommandResult;
  pause(): CommandResult;
  resume(): CommandResult;
  stop(): CommandResult;
  enterSafeMode(): CommandResult;
  skipCue(): CommandResult;
  skipCutIn(): CommandResult;
  takeover(sessionId: string): CommandResult;
  cueCommand(command: CueCommand): CommandResult;
  reject(message: string): CommandResult;
}

export function dispatchLiveCommand(
  adapter: LiveCommandAdapter,
  command: LiveCommand,
): CommandResult {
  if (isCommentCommand(command)) {
    const result = adapter.comments.handleCommand(command);
    return result.ok ? { ok: true } : adapter.reject(result.message);
  }
  if (isCueCommand(command)) {
    return adapter.cueCommand(command);
  }
  switch (command.kind) {
    case "start":
      return adapter.start();
    case "end":
      return adapter.end();
    case "pause":
      return adapter.pause();
    case "resume":
      return adapter.resume();
    case "stop":
      return adapter.stop();
    case "safe_mode":
      return adapter.enterSafeMode();
    case "skip_cue":
      return adapter.skipCue();
    case "skip_cut_in":
      return adapter.skipCutIn();
    case "takeover_program":
      return adapter.takeover(command.sessionId);
    default:
      throw new Error(`Unsupported live command: ${JSON.stringify(command satisfies never)}`);
  }
}
