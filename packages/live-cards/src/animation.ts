import type {
  LiveCard,
  LiveCardAnimation,
  LiveCardAnimationPreset,
} from "@kakeai/contracts";
import type {
  LiveCardAnimationAdapter,
  LiveCardAnimationRequest,
} from "./types";

const ENTER_FALLBACK = {
  preset: "fade",
  durationMs: 400,
  delayMs: 0,
  staggerMs: 0,
} as const;

const UPDATE_FALLBACK = {
  preset: "fade",
  durationMs: 300,
  delayMs: 0,
  staggerMs: 0,
} as const;

const PRESET_CLASS: Record<Exclude<LiveCardAnimationPreset, "none">, string> = {
  fade: "kc-anim-fade",
  "slide-up": "kc-anim-slide-up",
  "slide-down": "kc-anim-slide-down",
  "slide-left": "kc-anim-slide-left",
  "slide-right": "kc-anim-slide-right",
  "scale-in": "kc-anim-scale-in",
};

interface RunningAnimation {
  cancel?: () => void;
  finished?: Promise<unknown>;
}

function trackRunning(
  animation: RunningAnimation,
  running: Set<RunningAnimation>,
  durationMs: number,
  delayMs: number,
): void {
  running.add(animation);
  if (animation.finished === undefined) {
    // Some test doubles do not expose `finished`; expire the entry so it does
    // not accumulate for the lifetime of the page.
    const timer = setTimeout(
      () => running.delete(animation),
      durationMs + delayMs + 32,
    );
    (timer as unknown as { unref?: () => void }).unref?.();
    return;
  }
  void animation.finished.then(
    () => running.delete(animation),
    () => running.delete(animation),
  );
}

interface FallbackAnimation {
  target: Element;
  className: string;
  timer: ReturnType<typeof setTimeout>;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Safe when `matchMedia` is absent (tests, SSR-like environments). */
export function prefersReducedMotion(scope: typeof globalThis = globalThis): boolean {
  const candidate = scope as unknown as {
    matchMedia?: (query: string) => { matches?: boolean } | undefined;
    window?: { matchMedia?: (query: string) => { matches?: boolean } | undefined };
  };
  if (typeof candidate.matchMedia === "function") {
    try {
      return candidate.matchMedia(REDUCED_MOTION_QUERY)?.matches === true;
    } catch {
      return false;
    }
  }
  // Some test DOMs expose matchMedia on their window object only.
  if (typeof candidate.window?.matchMedia === "function") {
    try {
      return candidate.window.matchMedia(REDUCED_MOTION_QUERY)?.matches === true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Contract defaults are applied by Zod, but tolerate hand-built objects. */
export function resolveCardAnimation(
  card: LiveCard,
  kind: "enter" | "update",
): LiveCardAnimation {
  const fallback = kind === "enter" ? ENTER_FALLBACK : UPDATE_FALLBACK;
  const animation = card.animation?.[kind];
  return {
    preset: animation?.preset ?? fallback.preset,
    durationMs: animation?.durationMs ?? fallback.durationMs,
    delayMs: animation?.delayMs ?? fallback.delayMs,
    staggerMs: animation?.staggerMs ?? fallback.staggerMs,
  };
}

export function resolveChartAnimation(card: LiveCard): "none" | "grow" | "draw" {
  if (card.type !== "chart") {
    return "none";
  }
  return card.chartAnimation ?? (card.variant === "bar" ? "grow" : "draw");
}

function cancelFallback(
  animation: FallbackAnimation,
  fallbacks: Set<FallbackAnimation>,
): void {
  clearTimeout(animation.timer);
  animation.target.classList.remove(animation.className);
  const style = (animation.target as HTMLElement).style;
  style?.removeProperty("--kc-anim-duration");
  style?.removeProperty("--kc-anim-delay");
  style?.removeProperty("animation-direction");
  fallbacks.delete(animation);
}

function scheduleFallback(
  target: Element,
  className: string,
  durationMs: number,
  delayMs: number,
  fallbacks: Set<FallbackAnimation>,
  reverse = false,
): void {
  const classList = target.classList;
  if (classList === undefined) {
    return;
  }
  // A newer update on the same element replaces the old fallback instead of
  // letting an earlier timer strip the new class.
  for (const animation of [...fallbacks]) {
    if (animation.target === target) {
      cancelFallback(animation, fallbacks);
    }
  }
  classList.add(className);
  const style = (target as HTMLElement).style;
  style?.setProperty("--kc-anim-duration", `${durationMs}ms`);
  style?.setProperty("--kc-anim-delay", `${delayMs}ms`);
  if (reverse) {
    // Reuse the entrance keyframes backwards for the exit animation.
    style?.setProperty("animation-direction", "reverse");
  }
  const timer = setTimeout(
    () => {
      classList.remove(className);
      style?.removeProperty("--kc-anim-duration");
      style?.removeProperty("--kc-anim-delay");
      style?.removeProperty("animation-direction");
      for (const entry of [...fallbacks]) {
        if (entry.timer === timer) {
          fallbacks.delete(entry);
        }
      }
    },
    durationMs + delayMs + 32,
  );
  const animation: FallbackAnimation = { target, className, timer };
  fallbacks.add(animation);
  (timer as unknown as { unref?: () => void }).unref?.();
}

function applyCssFallback(
  target: Element,
  preset: LiveCardAnimationPreset,
  durationMs: number,
  delayMs: number,
  fallbacks: Set<FallbackAnimation>,
  reverse = false,
): void {
  if (preset === "none") {
    return;
  }
  const className = (PRESET_CLASS as Record<string, string | undefined>)[preset];
  if (className === undefined) {
    return;
  }
  scheduleFallback(target, className, durationMs, delayMs, fallbacks, reverse);
}

function applyPreset(
  target: Element,
  preset: LiveCardAnimationPreset,
  durationMs: number,
  delayMs: number,
  running: Set<RunningAnimation>,
  fallbacks: Set<FallbackAnimation>,
  direction: "in" | "out" = "in",
): void {
  if (preset === "none" || durationMs <= 0 || !Object.hasOwn(PRESET_CLASS, preset)) {
    return;
  }
  if (typeof target.animate === "function") {
    try {
      const animation = target.animate(
        presetKeyframes(preset, direction),
        {
          duration: durationMs,
          delay: delayMs,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "both",
        },
      );
      trackRunning(animation, running, durationMs, delayMs);
      return;
    } catch {
      // Fall through to the CSS class path.
    }
  }
  applyCssFallback(target, preset, durationMs, delayMs, fallbacks, direction === "out");
}

function presetKeyframes(
  preset: Exclude<LiveCardAnimationPreset, "none">,
  direction: "in" | "out" = "in",
): Keyframe[] {
  const frames: Keyframe[] = (() => {
    switch (preset) {
      case "fade":
        return [{ opacity: 0 }, { opacity: 1 }];
      case "slide-up":
        return [
          { opacity: 0, transform: "translateY(28px)" },
          { opacity: 1, transform: "translateY(0)" },
        ];
      case "slide-down":
        return [
          { opacity: 0, transform: "translateY(-28px)" },
          { opacity: 1, transform: "translateY(0)" },
        ];
      case "slide-left":
        return [
          { opacity: 0, transform: "translateX(28px)" },
          { opacity: 1, transform: "translateX(0)" },
        ];
      case "slide-right":
        return [
          { opacity: 0, transform: "translateX(-28px)" },
          { opacity: 1, transform: "translateX(0)" },
        ];
      case "scale-in":
        return [
          { opacity: 0, transform: "scale(0.94)" },
          { opacity: 1, transform: "scale(1)" },
        ];
    }
  })();
  // Exits play the entrance keyframes backwards: visible -> hidden/offset.
  return direction === "out" ? frames.reverse() : frames;
}

function applyChartAnimation(
  target: Element,
  chartAnimation: "grow" | "draw",
  durationMs: number,
  delayMs: number,
  running: Set<RunningAnimation>,
  fallbacks: Set<FallbackAnimation>,
): void {
  const keyframes: Keyframe[] =
    chartAnimation === "grow"
      ? [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }]
      : [
          { strokeDasharray: "1 1", strokeDashoffset: 1 },
          { strokeDasharray: "1 1", strokeDashoffset: 0 },
        ];
  if (typeof target.animate === "function") {
    try {
      const animation = target.animate(keyframes, {
        duration: durationMs,
        delay: delayMs,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        fill: "both",
      });
      trackRunning(animation, running, durationMs, delayMs);
      return;
    } catch {
      // Fall through to CSS classes.
    }
  }
  scheduleFallback(
    target,
    chartAnimation === "grow" ? "kc-chart-anim-grow" : "kc-chart-anim-draw",
    durationMs,
    delayMs,
    fallbacks,
  );
}

export interface DefaultAnimationAdapterOptions {
  /** Overrides the global `prefers-reduced-motion` query. */
  reducedMotion?: () => boolean;
}

/**
 * Browser adapter for the card contract. WAAPI is preferred; a CSS class is
 * used when `Element.animate` is unavailable. Reduced motion completes
 * immediately, and adapter failures never escape into card logic.
 */
export function createDefaultAnimationAdapter(
  options: DefaultAnimationAdapterOptions = {},
): LiveCardAnimationAdapter {
  const running = new Set<RunningAnimation>();
  const fallbacks = new Set<FallbackAnimation>();
  const isReducedMotion = options.reducedMotion ?? (() => prefersReducedMotion());
  return {
    run(request: LiveCardAnimationRequest): void {
      if (isReducedMotion() || request.targets.length === 0) {
        return;
      }
      try {
        const targets = [...request.targets];
        targets.forEach((target, index) => {
          const delay = request.delayMs + request.staggerMs * index;
          if (request.chartAnimation !== undefined) {
            applyChartAnimation(
              target,
              request.chartAnimation,
              request.durationMs,
              delay,
              running,
              fallbacks,
            );
            return;
          }
          applyPreset(
            target,
            request.preset,
            request.durationMs,
            delay,
            running,
            fallbacks,
            request.kind === "exit" ? "out" : "in",
          );
        });
      } catch {
        // Animation is cosmetic; never let it break the card.
      }
    },
    cancel(): void {
      for (const animation of running) {
        try {
          animation.cancel?.();
        } catch {
          // Ignore cancellation races.
        }
      }
      running.clear();
      for (const animation of [...fallbacks]) {
        cancelFallback(animation, fallbacks);
      }
    },
  };
}

export interface RecordingAnimationAdapter extends LiveCardAnimationAdapter {
  readonly requests: LiveCardAnimationRequest[];
  clear(): void;
}

/** Deterministic adapter for tests and animation auditing. */
export function createRecordingAnimationAdapter(): RecordingAnimationAdapter {
  const requests: LiveCardAnimationRequest[] = [];
  return {
    requests,
    run(request: LiveCardAnimationRequest): void {
      requests.push(request);
    },
    clear(): void {
      requests.length = 0;
    },
  };
}
