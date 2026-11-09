import type { StageVisualState } from "@kakeai/contracts";

/** The visual the stage currently shows, without its sequence. */
export type AppliedStageVisual =
  | { kind: "card"; cardId: string; stateId: string }
  | { kind: "material"; materialId: string; focus: boolean }
  | null;

export interface StageVisualDecisionInput {
  visual: StageVisualState | null;
  applied: AppliedStageVisual;
  /** Highest visual sequence applied so far, or null before the first card. */
  lastSequence: number | null;
  /** True only for live program state updates, never initial/preview/reconnect. */
  animate: boolean;
}

export type StageVisualAction =
  | { type: "none" }
  | { type: "hide" }
  | {
      type: "card";
      cardId: string;
      stateId: string;
      transition: "enter" | "update";
      animate: boolean;
    }
  | { type: "material"; materialId: string; focus: boolean };

/**
 * Animation is allowed only for live program state updates. The first
 * snapshot after connect/reconnect and every preview snapshot render settled.
 */
export function shouldAnimateStageVisual(options: {
  snapshot: boolean;
  preview: boolean;
  program: boolean;
}): boolean {
  return !options.snapshot && !options.preview && options.program;
}

/**
 * Pure stage-side visual decision. The server owns effective-visual resolution
 * and the sequence; the stage only rejects stale snapshots and decides whether
 * a card enter or same-card update is needed. Initial, preview and reconnect
 * snapshots pass `animate: false`.
 *
 * A null visual has no sequence, so it cannot be ordered against a card or
 * material. It always hides. Callers must feed this function states in
 * transport order (the stage WebSocket does): with an ordered transport a null
 * state is the latest state, while an unordered replay could deliver a late
 * null and hide a newer card with no way to detect it here.
 */
export function decideStageVisual(input: StageVisualDecisionInput): StageVisualAction {
  const { visual } = input;
  if (visual === null) {
    return { type: "hide" };
  }
  // Only a non-null visual carries an ordering. A late older snapshot must not
  // rewind to a previous card or material.
  if (input.lastSequence !== null && visual.sequence < input.lastSequence) {
    return { type: "none" };
  }
  if (visual.kind === "card") {
    if (
      input.applied?.kind === "card" &&
      input.applied.cardId === visual.cardId &&
      input.applied.stateId === visual.stateId
    ) {
      return { type: "none" };
    }
    const sameCard = input.applied?.kind === "card" && input.applied.cardId === visual.cardId;
    return {
      type: "card",
      cardId: visual.cardId,
      stateId: visual.stateId,
      transition: sameCard ? "update" : "enter",
      animate: input.animate,
    };
  }
  if (
    input.applied?.kind === "material" &&
    input.applied.materialId === visual.materialId &&
    input.applied.focus === visual.focus
  ) {
    return { type: "none" };
  }
  return {
    type: "material",
    materialId: visual.materialId,
    focus: visual.focus,
  };
}

/**
 * Mutable ordering state for the single centre slot. Rendering side effects
 * stay in `StageCards`; this class only tracks what was applied and the last
 * sequence, so the failure/reset policies are testable without a DOM.
 */
export class StageVisualTracker {
  private applied: AppliedStageVisual = null;
  private lastSequence: number | null = null;

  decide(visual: StageVisualState | null, animate: boolean): StageVisualAction {
    const action = decideStageVisual({
      visual,
      applied: this.applied,
      lastSequence: this.lastSequence,
      animate,
    });
    if (action.type === "none") {
      return action;
    }
    if (visual !== null) {
      this.lastSequence = visual.sequence;
    }
    switch (action.type) {
      case "hide":
        this.applied = null;
        break;
      case "card":
        this.applied = {
          kind: "card",
          cardId: action.cardId,
          stateId: action.stateId,
        };
        break;
      case "material":
        this.applied = {
          kind: "material",
          materialId: action.materialId,
          focus: action.focus,
        };
        break;
    }
    return action;
  }

  /**
   * The renderer already hid a failed card. Forget the applied visual (so a
   * retransmitted same card/state is rendered again) but keep the sequence and
   * the error reporter's dedup key.
   */
  markFailed(): void {
    this.applied = null;
  }

  /**
   * A new package/run or an authoritative reconnect snapshot may restart its
   * sequence at 0, so ordering state must not carry over.
   */
  reset(): void {
    this.applied = null;
    this.lastSequence = null;
  }
}
