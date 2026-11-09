import {
  resolveLiveCardState,
  type LiveCard,
  type LiveVisualRef,
} from "@kakeai/contracts";
import {
  createDefaultAnimationAdapter,
  prefersReducedMotion,
  resolveCardAnimation,
  resolveChartAnimation,
} from "./animation";
import { createCardView, type CardUpdate, type CardView } from "./cards";
import { removeElement } from "./dom";
import { LIVE_CARD_CSS } from "./styles";
import type {
  LiveCardAnimationAdapter,
  LiveCardAnimationRequest,
  LiveCardRenderer,
  LiveCardRendererOptions,
  LiveCardState,
  SetLiveCardVisualOptions,
} from "./types";

/**
 * Shared renderer for the editor preview and the live stage.
 *
 * The host element gets an open Shadow DOM. Card CSS is injected there, and
 * theme values are inherited from the host as ordinary CSS custom properties
 * (`--kakeai-*`), so no theme package is required and stage global CSS cannot
 * leak into a card.
 */
export function createLiveCardRenderer(
  host: HTMLElement,
  options: LiveCardRendererOptions = {},
): LiveCardRenderer {
  return new LiveCardRendererImpl(host, options);
}

class LiveCardRendererImpl implements LiveCardRenderer {
  readonly host: HTMLElement;
  readonly shadowRoot: ShadowRoot;
  readonly slot: HTMLElement;
  private readonly document: Document;
  private readonly styleElement: HTMLStyleElement;
  private readonly options: LiveCardRendererOptions;
  private readonly animationAdapter: LiveCardAnimationAdapter;
  private readonly animationEnabled: boolean;
  private cards: LiveCard[] = [];
  private currentCard: LiveCard | null = null;
  private currentState: LiveCardState | null = null;
  private currentView: CardView | null = null;
  private settled = false;
  private pendingSnapshot = true;
  private disposed = false;
  private pendingExits: Array<{
    element: Element;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(host: HTMLElement, options: LiveCardRendererOptions) {
    this.host = host;
    this.options = options;
    this.document = host.ownerDocument;
    this.animationEnabled = options.animate !== false;
    this.animationAdapter =
      options.animationAdapter ??
      createDefaultAnimationAdapter({
        reducedMotion: () => options.reducedMotion ?? prefersReducedMotion(),
      });
    let shadowRoot: ShadowRoot;
    try {
      shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    } catch (error) {
      // A closed shadow root or a non-DOM host cannot be recovered from.
      // Report it through the normal hook before surfacing the construction
      // failure to the caller.
      this.reportError(error);
      throw error;
    }
    this.shadowRoot = shadowRoot;
    // A host has a single card-renderer owner. Remove markers left by an
    // earlier renderer/preview so re-mounting does not stack slots or styles.
    for (const existing of [
      ...shadowRoot.querySelectorAll(
        "[data-live-card-slot],[data-live-card-styles]",
      ),
    ]) {
      removeElement(existing);
    }
    this.styleElement = this.document.createElement("style");
    this.styleElement.setAttribute("data-live-card-styles", "");
    this.styleElement.textContent = LIVE_CARD_CSS;
    this.slot = this.document.createElement("div");
    this.slot.className = "kc-slot";
    this.slot.setAttribute("data-live-card-slot", "");
    this.slot.setAttribute("hidden", "");
    this.shadowRoot.append(this.styleElement, this.slot);
  }

  get current(): { cardId: string; stateId: string } | null {
    if (this.currentCard === null || this.currentState === null) {
      return null;
    }
    return { cardId: this.currentCard.id, stateId: this.currentState.id };
  }

  setCards(cards: readonly LiveCard[]): void {
    if (this.disposed) {
      return;
    }
    this.cards = [...cards];
    if (this.currentCard === null || this.currentState === null) {
      return;
    }
    const resolved = resolveLiveCardState(this.cards, {
      cardId: this.currentCard.id,
      stateId: this.currentState.id,
    });
    if (resolved === null) {
      this.fail(new Error("表示中のカード状態が定義から消えました。"));
      return;
    }
    try {
      // Always reconcile the current view: editors may update a state object
      // in place and then call setCards again. This refresh is silent.
      this.applyResolved(resolved.card, resolved.state, false, true);
    } catch (error) {
      this.fail(error);
    }
  }

  setVisual(
    visual: LiveVisualRef | null | undefined,
    options: SetLiveCardVisualOptions = {},
  ): void {
    if (this.disposed) {
      return;
    }
    const animate = this.shouldAnimate(options);
    // The snapshot (including null/material) is complete for animation
    // purposes. The initial render and a reconnect snapshot stay silent.
    this.pendingSnapshot = false;
    try {
      if (visual === null || visual === undefined || visual.kind !== "card") {
        this.hide();
        return;
      }
      const resolved = resolveLiveCardState(this.cards, visual);
      if (resolved === null) {
        this.fail(
          new Error(`カードまたは状態が見つかりません: ${visual.cardId}/${visual.stateId}`),
        );
        return;
      }
      this.applyResolved(
        resolved.card,
        resolved.state as LiveCardState,
        animate,
        false,
      );
    } catch (error) {
      this.fail(error);
    }
  }

  markSettled(): void {
    if (this.disposed) {
      return;
    }
    this.settled = true;
    // A reconnect snapshot may be applied through setCards() rather than a
    // new setVisual() call. Once a card is displayed, marking settled ends the
    // silent snapshot window. Before the first card, the initial mount stays
    // silent.
    if (this.currentView !== null) {
      this.pendingSnapshot = false;
    }
  }

  setConnected(connected = true): void {
    if (this.disposed) {
      return;
    }
    // A reconnect snapshot arrives after this boundary and must render
    // completed. The caller calls markSettled() once it has been applied.
    this.settled = false;
    this.pendingSnapshot = true;
    if (!connected) {
      this.cancelAnimations();
      this.settleExits();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.hide();
    removeElement(this.slot);
    removeElement(this.styleElement);
    this.cards = [];
  }

  private shouldAnimate(options: SetLiveCardVisualOptions): boolean {
    if (!this.animationEnabled || this.disposed) {
      return false;
    }
    if (this.options.reducedMotion ?? prefersReducedMotion()) {
      return false;
    }
    if (this.pendingSnapshot) {
      return false;
    }
    return options.animate ?? this.settled;
  }

  private applyResolved(
    card: LiveCard,
    state: LiveCardState,
    animate: boolean,
    forceUpdate: boolean,
  ): void {
    const sameCard =
      this.currentView !== null &&
      this.currentCard !== null &&
      this.currentCard.id === card.id &&
      this.currentCard.type === card.type;
    if (sameCard) {
      // A state is identified by card id + state id. Re-sending the same
      // snapshot is a no-op even when the caller rebuilt the state object.
      if (!forceUpdate && this.currentState?.id === state.id) {
        return;
      }
      this.updateCard(card, state, animate);
      return;
    }
    this.showCard(card, state, animate);
  }

  private showCard(card: LiveCard, state: LiveCardState, animate: boolean): void {
    this.settleExits();
    this.disposeView();
    let view: CardView | null = null;
    view = createCardView(card, this.document, {
      resolveAsset: this.options.resolveAsset,
      onFailure: (error: unknown) => {
        if (this.disposed || view === null || this.currentView !== view) {
          return;
        }
        this.fail(error);
      },
    });
    let result: CardUpdate;
    try {
      result = view.update(state);
    } catch (error) {
      try {
        view.dispose?.();
      } catch {
        // The initial update already failed; still release the element.
      }
      removeElement(view.element);
      throw error;
    }
    view.element.setAttribute("data-state-id", state.id);
    this.currentView = view;
    this.currentCard = card;
    this.currentState = state;
    this.slot.removeAttribute("hidden");
    this.slot.appendChild(view.element);
    if (animate) {
      this.runPresetAnimation("enter", card, state, [view.element]);
      this.runChartAnimation("enter", card, state, result.chartTargets);
    }
  }

  private updateCard(card: LiveCard, state: LiveCardState, animate: boolean): void {
    const view = this.currentView;
    if (view === null) {
      this.showCard(card, state, animate);
      return;
    }
    // A new state supersedes any removal animation still running. Detach the
    // old nodes first so reconciliation never sees duplicate keys.
    this.settleExits();
    const result = view.update(state);
    view.element.setAttribute("data-state-id", state.id);
    this.currentCard = card;
    this.currentState = state;
    if (animate) {
      this.runPresetAnimation("update", card, state, result.updateTargets);
      this.runChartAnimation("update", card, state, result.chartTargets);
    }
    this.scheduleExitAnimation(card, state, result.exitTargets, animate);
  }

  private runPresetAnimation(
    kind: "enter" | "update",
    card: LiveCard,
    state: LiveCardState,
    targets: readonly Element[],
  ): void {
    if (targets.length === 0 || this.disposed) {
      return;
    }
    const animation = resolveCardAnimation(card, kind);
    this.emit({
      kind,
      cardId: card.id,
      stateId: state.id,
      ...animation,
      targets,
    });
  }

  private runChartAnimation(
    kind: "enter" | "update",
    card: LiveCard,
    state: LiveCardState,
    targets: readonly Element[],
  ): void {
    if (targets.length === 0 || this.disposed) {
      return;
    }
    const chartAnimation = resolveChartAnimation(card);
    if (chartAnimation === "none") {
      return;
    }
    const animation = resolveCardAnimation(card, kind);
    this.emit({
      kind,
      cardId: card.id,
      stateId: state.id,
      ...animation,
      chartAnimation,
      targets,
    });
  }

  /**
   * Plays the update preset backwards for removed keyed nodes and detaches
   * them when it finishes. A missing/degenerate preset or a disabled animation
   * detaches immediately. Removal never waits on the adapter, so a failing or
   * synchronous-only animation implementation cannot block state updates.
   */
  private scheduleExitAnimation(
    card: LiveCard,
    state: LiveCardState,
    targets: readonly Element[],
    animate: boolean,
  ): void {
    if (targets.length === 0) {
      return;
    }
    const animation = resolveCardAnimation(card, "update");
    if (
      !animate ||
      this.disposed ||
      animation.preset === "none" ||
      animation.durationMs <= 0
    ) {
      for (const target of targets) {
        removeElement(target);
      }
      return;
    }
    this.emit({
      kind: "exit",
      cardId: card.id,
      stateId: state.id,
      ...animation,
      targets,
    });
    targets.forEach((element, index) => {
      const delay = animation.delayMs + animation.staggerMs * index;
      const timer = setTimeout(
        () => {
          this.pendingExits = this.pendingExits.filter(
            (entry) => entry.timer !== timer,
          );
          removeElement(element);
        },
        animation.durationMs + delay + 32,
      );
      (timer as unknown as { unref?: () => void }).unref?.();
      this.pendingExits.push({ element, timer });
    });
  }

  /** Immediately detaches every node still playing an exit animation. */
  private settleExits(): void {
    if (this.pendingExits.length === 0) {
      return;
    }
    const pending = this.pendingExits;
    this.pendingExits = [];
    for (const { element, timer } of pending) {
      clearTimeout(timer);
      removeElement(element);
    }
  }

  private emit(request: LiveCardAnimationRequest): void {
    try {
      if (typeof this.animationAdapter.run === "function") {
        this.animationAdapter.run(request);
      } else {
        this.animationAdapter.animate?.(request);
      }
    } catch {
      // Animation is cosmetic and must never block card state logic.
    }
  }

  private hide(): void {
    this.cancelAnimations();
    this.settleExits();
    this.disposeView();
    this.currentCard = null;
    this.currentState = null;
    this.slot.setAttribute("hidden", "");
  }

  private disposeView(): void {
    const view = this.currentView;
    if (view === null) {
      return;
    }
    this.currentView = null;
    try {
      view.dispose?.();
    } catch {
      // Disposal errors must not keep a stale card on stage.
    }
    removeElement(view.element);
  }

  private cancelAnimations(): void {
    try {
      this.animationAdapter.cancel?.();
    } catch {
      // Ignore adapter cancellation failures.
    }
  }

  private fail(error: unknown): void {
    this.reportError(error);
    this.hide();
  }

  private reportError(error: unknown): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Logging must not throw into the renderer.
    }
  }
}
