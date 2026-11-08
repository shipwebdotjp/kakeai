import type { RunLogEventInput } from "../runs/run-store.ts";
import type { CornerEntry } from "./comment-corner-model.ts";

/**
 * Applies one finished response to its comment entry. A failed generation is
 * skipped (the corner moves to the next candidate); a completed one is marked
 * done. Human pins are consumed on either path and logged once.
 */
export function settleCornerEntry(input: {
  entry: CornerEntry;
  failed: boolean;
  log: (event: RunLogEventInput) => void;
}): void {
  const { entry } = input;
  if (input.failed) {
    entry.state = "skipped";
    entry.selected = false;
  } else {
    entry.state = "done";
    entry.selected = true;
  }
  if (entry.pinned) {
    entry.pinned = false;
    entry.pinNote = null;
    input.log({
      type: "pin_removed",
      commentId: entry.event.id,
      data: { reason: input.failed ? "failed" : "consumed" },
    });
  }
}
