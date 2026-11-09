import type { LivePackageShow, StageVisualState } from "@kakeai/contracts";
import { createLiveCardRenderer, type LiveCardRenderer } from "@kakeai/live-cards";
import { CardErrorReporter, type StageCardFailure, type StageCardVisual } from "./card-errors";
import { packageUrl } from "./elements";
import { StageVisualTracker, type StageVisualAction } from "./visual-decision";

export interface StageCardsOptions {
  /** Called once per card/state/reason after console logging. */
  onError(failure: StageCardFailure): void;
}

/**
 * Native Live Card slot. Owns the shared renderer, the package asset resolver
 * and the stage-side sequence/stale checks. Material cards live in
 * `StageMaterials`; this class never shows one.
 */
export class StageCards {
  private readonly renderer: LiveCardRenderer;
  private readonly errors = new CardErrorReporter();
  private readonly assets = new Map<string, string>();
  private readonly visuals = new StageVisualTracker();
  private requested: StageCardVisual | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: StageCardsOptions,
  ) {
    this.renderer = createLiveCardRenderer(host, {
      resolveAsset: (assetId) => this.assets.get(assetId) ?? "",
      onError: (error) => this.handleError(error),
    });
  }

  setShow(show: LivePackageShow): void {
    // A new package may restart its visual sequence at 0 and reuse card ids.
    // Old ordering and error-dedup state would reject or hide its first card.
    this.reset();
    this.assets.clear();
    for (const asset of show.cardAssets) {
      this.assets.set(asset.id, packageUrl(asset.file));
    }
    this.renderer.setCards(show.cards);
  }

  setConnected(connected: boolean): void {
    this.renderer.setConnected(connected);
  }

  markSettled(): void {
    this.renderer.markSettled();
  }

  /**
   * Forgets ordering and error-dedup state. Called for a new show and for a
   * reconnect snapshot, which is authoritative and may restart at sequence 0.
   */
  reset(): void {
    this.visuals.reset();
    this.errors.reset();
    this.requested = null;
  }

  /** Applies a stage visual and returns what the caller must show/hide. */
  apply(visual: StageVisualState | null, animate: boolean): StageVisualAction {
    const action = this.visuals.decide(visual, animate);
    if (action.type === "none") {
      return action;
    }
    switch (action.type) {
      case "hide":
        this.requested = null;
        this.renderer.setVisual(null);
        this.host.hidden = true;
        break;
      case "card":
        this.requested = {
          cardId: action.cardId,
          stateId: action.stateId,
          sequence: visual === null ? 0 : visual.sequence,
        };
        this.host.hidden = false;
        this.renderer.setVisual(
          { kind: "card", cardId: action.cardId, stateId: action.stateId },
          { animate: action.animate },
        );
        break;
      case "material":
        this.requested = null;
        this.host.hidden = true;
        this.renderer.setVisual(null);
        break;
    }
    return action;
  }

  private handleError(error: unknown): void {
    // The renderer has already hidden the card. Keep the host empty and leave
    // audio, captions and cue progression untouched.
    this.host.hidden = true;
    // Let the same card/state be rendered again on the next state message
    // instead of treating the failed visual as already applied.
    this.visuals.markFailed();
    const failure = this.errors.report(this.requested, error);
    if (failure === null) {
      return;
    }
    console.warn(
      `[live stage] カードの表示に失敗しました: ${failure.cardId ?? "?"}/${failure.stateId ?? "?"}: ${failure.message}`,
    );
    this.options.onError(failure);
  }
}
