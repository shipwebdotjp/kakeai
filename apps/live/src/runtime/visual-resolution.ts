import {
  resolveLiveCardState,
  type LiveCard,
  type LivePackageSegment,
  type LiveVisualRef,
  type MaterialCard,
  type StageVisualState,
} from "@kakeai/contracts";

/** A resolved visual without the server-wide sequence. */
export type EffectiveVisual =
  | { kind: "card"; cardId: string; stateId: string }
  | { kind: "material"; materialId: string; focus: boolean };

export interface VisualResolutionInput {
  cards: readonly LiveCard[];
  materials: readonly MaterialCard[];
}

/** The cue field that can override the centre visual. */
export interface VisualCueRef {
  visual?: LiveVisualRef | null;
}

/**
 * Resolves the centre visual for the current cue. A cue override wins, an
 * omitted value inherits the segment default and `null` hides the slot.
 */
export function resolveEffectiveVisual(
  input: VisualResolutionInput,
  segment: LivePackageSegment | null,
  cue: VisualCueRef | null,
): EffectiveVisual | null {
  if (segment === null || segment.kind === "cut_in") {
    return null;
  }
  const ref = cue !== null && cue.visual !== undefined ? cue.visual : (segment.visual ?? null);
  return resolveVisualRef(input, ref);
}

function resolveVisualRef(
  input: VisualResolutionInput,
  ref: LiveVisualRef | null,
): EffectiveVisual | null {
  if (ref === null) {
    return null;
  }
  if (ref.kind === "card") {
    // Package load rejects dangling references, but a hand-built show or a
    // future package edit must never throw inside the controller.
    if (resolveLiveCardState(input.cards, ref) === null) {
      return null;
    }
    return { kind: "card", cardId: ref.cardId, stateId: ref.stateId };
  }
  const material = input.materials.find((entry) => entry.id === ref.materialId);
  return material === undefined
    ? null
    : { kind: "material", materialId: material.id, focus: material.focus };
}

/** Stable identity used to decide whether the visual sequence advances. */
export function effectiveVisualKey(visual: EffectiveVisual | null): string {
  if (visual === null) {
    return "null";
  }
  return visual.kind === "card"
    ? `card:${visual.cardId}:${visual.stateId}`
    : `material:${visual.materialId}:${visual.focus ? "focus" : "normal"}`;
}

/**
 * Owns the monotonic visual sequence. The sequence advances only when the
 * effective visual identity changes; republishing the same card state or the
 * same material does not advance it.
 */
export class StageVisualTracker {
  private sequence = 0;
  /** The stage starts hidden; the first hide is not a visual change. */
  private lastKey: string | null = "null";

  update(visual: EffectiveVisual | null): StageVisualState | null {
    const key = effectiveVisualKey(visual);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.sequence += 1;
    }
    return visual === null ? null : { ...visual, sequence: this.sequence };
  }
}
