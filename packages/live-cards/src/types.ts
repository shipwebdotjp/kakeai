import type {
  LiveCard,
  LiveCardAnimationPreset,
  LiveVisualRef,
} from "@kakeai/contracts";

/** A union of every state shape. Individual views narrow to their card type. */
export type LiveCardState = LiveCard["states"][number];

/**
 * Resolves an image card's asset id to a URL. The editor returns an app URL,
 * the live stage returns a package-relative URL. It may be synchronous.
 */
export type LiveCardAssetResolver = (assetId: string) => string | Promise<string>;

export interface LiveCardAnimationRequest {
  /**
   * `enter` on first show/card switch, `update` on a same-card state change,
   * `exit` for keyed nodes that are being removed.
   */
  kind: "enter" | "update" | "exit";
  cardId: string;
  stateId: string;
  preset: LiveCardAnimationPreset;
  durationMs: number;
  delayMs: number;
  staggerMs: number;
  /**
   * Set for the chart-specific animation. When present the adapter animates
   * bar growth or line drawing instead of the generic card preset.
   */
  chartAnimation?: "grow" | "draw";
  /** Elements to animate. Logic never waits for their animations to finish. */
  targets: readonly Element[];
}

/**
 * Injection point for animation. The default adapter uses WAAPI when
 * available and falls back to shadow-root CSS animations. Tests can supply a
 * recorder to observe lifecycle without a real animation runtime.
 */
export interface LiveCardAnimationAdapter {
  /** Preferred entry point. */
  run?(request: LiveCardAnimationRequest): void;
  /** Alias for small test adapters; used when `run` is absent. */
  animate?(request: LiveCardAnimationRequest): void;
  /** Called when the card is hidden/disposed or a reconnect starts. */
  cancel?(): void;
}

export interface LiveCardRendererOptions {
  resolveAsset?: LiveCardAssetResolver;
  /**
   * Allow animations after the first snapshot. Defaults to true, but nothing
   * animates until `markSettled()` and the first `setVisual()` have run.
   */
  animate?: boolean;
  animationAdapter?: LiveCardAnimationAdapter;
  /** Override `prefers-reduced-motion` detection (used by tests/embeds). */
  reducedMotion?: boolean;
  /** Receives card display failures. The renderer still never throws. */
  onError?: (error: unknown) => void;
}

export interface SetLiveCardVisualOptions {
  /** Force animation on/off for this update. Initial snapshots stay silent. */
  animate?: boolean;
}

export interface LiveCardRenderer {
  readonly host: HTMLElement;
  readonly shadowRoot: ShadowRoot;
  /** The shadow-root container that holds the current card, or is hidden. */
  readonly slot: HTMLElement;
  readonly current: { cardId: string; stateId: string } | null;
  /** Stores the card definitions used by subsequent `setVisual` calls. */
  setCards(cards: readonly LiveCard[]): void;
  /**
   * Shows a card state, or hides the centre card for `null`, material refs and
   * unresolved refs. A repeated identical state is a no-op.
   */
  setVisual(
    visual: LiveVisualRef | null | undefined,
    options?: SetLiveCardVisualOptions,
  ): void;
  /**
   * Marks the runtime as caught up with the current snapshot. Only updates
   * after this call animate. Call after applying a reconnect snapshot too.
   */
  markSettled(): void;
  /**
   * Marks a reconnect boundary. The next snapshot is rendered completed with
   * no animation; call `markSettled()` when the snapshot has been applied.
   * `setConnected(false)` also cancels running animations.
   */
  setConnected(connected?: boolean): void;
  dispose(): void;
}
