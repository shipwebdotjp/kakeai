import type { RefinementCtx } from "zod";

/** Structural subset shared by the Live Program document and package show. */
export interface SpineSegmentShape {
  id: string;
  kind: string;
  cues?: readonly string[];
}

export interface SpineCueShape {
  id: string;
  speaker?: "left" | "right";
}

export interface SpineSpeakerShape {
  side: "left" | "right";
}

/**
 * Checks the ordered spine shape shared by version freeze and v2 package load.
 * The caller is responsible for draft-only shape validation.
 */
export function validateSpineStructure(
  segments: readonly SpineSegmentShape[],
  ctx: RefinementCtx,
  options: { requireCues: boolean },
): void {
  if (segments.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["segments"],
      message: "セグメントが1つもありません。",
    });
    return;
  }

  const lastIndex = segments.length - 1;
  const first = segments[0]!;
  const last = segments[lastIndex]!;
  if (first.kind !== "opening") {
    ctx.addIssue({
      code: "custom",
      path: ["segments", 0, "kind"],
      message: "segments の先頭は opening にしてください。",
    });
  }
  if (last.kind !== "closing") {
    ctx.addIssue({
      code: "custom",
      path: ["segments", lastIndex, "kind"],
      message: "segments の末尾は closing にしてください。",
    });
  }
  if (segments.filter((segment) => segment.kind === "opening").length !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["segments"],
      message: "opening セグメントはちょうど1つにしてください。",
    });
  }
  if (segments.filter((segment) => segment.kind === "closing").length !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["segments"],
      message: "closing セグメントはちょうど1つにしてください。",
    });
  }
  if (!segments.some((segment) => segment.kind === "script")) {
    ctx.addIssue({
      code: "custom",
      path: ["segments"],
      message: "script セグメントを1つ以上含めてください。",
    });
  }

  for (const [index, segment] of segments.entries()) {
    if (segment.kind === "cut_in" && (index === 0 || index === lastIndex)) {
      ctx.addIssue({
        code: "custom",
        path: ["segments", index, "kind"],
        message: "cut_in は opening と closing の間に置いてください。",
      });
    }
    if (
      options.requireCues &&
      (segment.kind === "opening" ||
        segment.kind === "script" ||
        segment.kind === "closing") &&
      (segment.cues === undefined || segment.cues.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["segments", index, "cues"],
        message: "opening / script / closing には1つ以上のキューが必要です。",
      });
    }
  }
}

export function collectReferencedCueIds(
  segments: readonly SpineSegmentShape[],
): Set<string> {
  const referencedCueIds = new Set<string>();
  for (const segment of segments) {
    for (const cueId of segment.cues ?? []) {
      referencedCueIds.add(cueId);
    }
  }
  return referencedCueIds;
}

/**
 * Checks ownership, unknown references, duplicates, orphan cues and the
 * dedicated fallback. Callers that already ran `validateSegmentCueReferences`
 * should use `validateFallbackAndOrphans` to avoid duplicate diagnostics.
 */
export function validateCueMembership(
  segments: readonly SpineSegmentShape[],
  cues: readonly SpineCueShape[],
  fallbackCueId: string,
  ctx: RefinementCtx,
): void {
  const cueIds = new Set(cues.map((cue) => cue.id));
  const referencedCueIds = collectReferencedCueIds(segments);
  for (const [index, segment] of segments.entries()) {
    if (segment.cues === undefined) {
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
    }
  }
  validateFallbackAndOrphans(segments, cues, fallbackCueId, ctx);
}

/** Checks only the fallback reuse and orphan cues, assuming references exist. */
export function validateFallbackAndOrphans(
  segments: readonly SpineSegmentShape[],
  cues: readonly SpineCueShape[],
  fallbackCueId: string,
  ctx: RefinementCtx,
): void {
  const referencedCueIds = collectReferencedCueIds(segments);
  if (referencedCueIds.has(fallbackCueId)) {
    ctx.addIssue({
      code: "custom",
      path: ["safety", "fallbackCueId"],
      message: "退避キューは通常のスパインで再利用しないでください。",
    });
  }
  for (const [index, cue] of cues.entries()) {
    if (cue.id === fallbackCueId) {
      continue;
    }
    if (!referencedCueIds.has(cue.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "id"],
        message: `通常キューがどのセグメントにも属していません: ${cue.id}`,
      });
    }
  }
}

export function validateClosingReserve(
  targetDurationMs: number,
  closingReserveMs: number,
  ctx: RefinementCtx,
): void {
  if (closingReserveMs >= targetDurationMs) {
    ctx.addIssue({
      code: "custom",
      path: ["playout", "closingReserveMs"],
      message: "closingReserveMs は targetDurationMs より小さくしてください。",
    });
  }
}

export function validateRightCast(
  hasRightCharacter: boolean,
  cues: readonly SpineCueShape[],
  speakers: readonly SpineSpeakerShape[] | undefined,
  ctx: RefinementCtx,
): void {
  if (hasRightCharacter) {
    return;
  }
  for (const [index, cue] of cues.entries()) {
    if (cue.speaker === "right") {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "speaker"],
        message: "右キャラクターがいない番組に右話者を設定できません。",
      });
    }
  }
  if (speakers?.some((speaker) => speaker.side === "right")) {
    ctx.addIssue({
      code: "custom",
      path: ["speakers"],
      message: "右キャラクターがいない番組に右話者を設定できません。",
    });
  }
}
