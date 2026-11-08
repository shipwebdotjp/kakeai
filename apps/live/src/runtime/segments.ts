import type { LiveSegment, StagePhase } from "@kakeai/contracts";

export const ACTIVE_PHASES: ReadonlySet<StagePhase> = new Set([
  "opening",
  "script",
  "comment",
  "closing",
  "cut_in",
  "safe_mode",
]);

/** Maps a spine segment to the stage phase used while it plays. */
export function phaseForSegment(segment: LiveSegment): StagePhase {
  switch (segment.kind) {
    case "opening":
    case "closing":
    case "comment":
    case "script":
    case "cut_in":
      return segment.kind;
    default: {
      const exhaustive: never = segment;
      throw new Error(`Unsupported live segment kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * A new comment corner may only start while the closing reserve is intact.
 * `comment` corners themselves arrive in P4; the reserve check is in place so
 * `end` and segment advancement already stop at the right boundary.
 */
export function shouldStartCommentCorner(
  remainingMs: number,
  closingReserveMs: number,
): boolean {
  return remainingMs >= closingReserveMs;
}
