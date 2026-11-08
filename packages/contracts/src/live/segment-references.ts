import type { RefinementCtx } from "zod";
import type { LiveSegment } from "./profile";

/**
 * Validates that every cue reference exists and that a cue is used by one
 * segment only. A cue is one playout occurrence; reusing it would share attempt
 * numbers and make console cue operations ambiguous.
 */
export function validateSegmentCueReferences(
  segments: readonly LiveSegment[],
  cueIds: ReadonlySet<string>,
  ctx: RefinementCtx,
): void {
  const cueSegmentIndex = new Map<string, number>();
  for (const [index, segment] of segments.entries()) {
    if (!("cues" in segment)) {
      continue;
    }
    const seenInSegment = new Set<string>();
    for (const cueId of segment.cues) {
      if (!cueIds.has(cueId)) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "cues"],
          message: `キューが見つかりません: ${cueId}`,
        });
      }
      if (seenInSegment.has(cueId)) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "cues"],
          message: `同じセグメント内でキューが重複しています: ${cueId}`,
        });
      }
      seenInSegment.add(cueId);
      const previousSegment = cueSegmentIndex.get(cueId);
      if (previousSegment !== undefined && previousSegment !== index) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "cues"],
          message: `キューは複数のセグメントで再利用できません: ${cueId}`,
        });
      } else if (previousSegment === undefined) {
        cueSegmentIndex.set(cueId, index);
      }
    }
  }
}
