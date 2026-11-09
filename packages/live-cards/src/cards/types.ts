import type { LiveCardAssetResolver, LiveCardState } from "../types";

/**
 * A rendered card keeps its root element for its whole lifetime. Keyed child
 * updates report the delta so the renderer can animate only changed nodes.
 */
export interface CardUpdate {
  /** Added or changed nodes for the card's `update` animation. */
  updateTargets: Element[];
  /** Nodes for the chart-specific grow/draw animation. */
  chartTargets: Element[];
  /**
   * Keyed nodes removed by this update. They stay in the DOM until the
   * renderer has played (or skipped) their exit animation.
   */
  exitTargets: Element[];
}

export interface CardView {
  readonly element: HTMLElement;
  update(state: LiveCardState): CardUpdate;
  dispose?(): void;
}

export interface CardViewDependencies {
  resolveAsset?: LiveCardAssetResolver;
  /** A card-level failure (for example an image load error). */
  onFailure: (error: unknown) => void;
}
