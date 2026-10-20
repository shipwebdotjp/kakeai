import {
  DEFAULT_ANIMATION_POLICY,
  type AppearEffect,
  type EmphasizeEffect,
  type LineTrigger,
  type OnsetPreset,
  type ValueEffect,
} from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";
import type {
  AnimationItem,
  LineInterval,
  StateInterval,
  ValueAnimation,
  ValueFormat,
} from "./render-context";

export interface CueEffectWindow {
  startMs: number;
  endMs: number;
}

export function resolveTriggerWindow(
  trigger: LineTrigger,
  lineIntervals: readonly LineInterval[],
  spanMs: number,
  path: (string | number)[],
): CueEffectWindow | null {
  if (trigger.kind === "cue") {
    return spanMs > 0 ? { startMs: 0, endMs: spanMs } : null;
  }
  const byId = new Map(lineIntervals.map((interval) => [interval.lineId, interval]));
  const start = byId.get(trigger.startLineId);
  const end = byId.get(trigger.endLineId);
  if (start === undefined || end === undefined) {
    throw new CompositionCompileError([
      { path, code: "unresolvable_range", message: "行トリガーの表示区間を解決できません。" },
    ]);
  }
  const startMs = Math.max(0, start.startMs);
  const endMs = Math.min(spanMs, end.endMs);
  return endMs > startMs ? { startMs, endMs } : null;
}

export interface CueEffectPlan {
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
}

export interface AppearTarget {
  id: string;
  step: number;
}

export function planAppearEffect(options: {
  targets: readonly AppearTarget[];
  trigger: LineTrigger;
  effect: AppearEffect;
  lineIntervals: readonly LineInterval[];
  spanMs: number;
  path: (string | number)[];
}): CueEffectPlan {
  const window = resolveTriggerWindow(
    options.trigger,
    options.lineIntervals,
    options.spanMs,
    options.path,
  );
  if (window === null) {
    return { animation: [], stateIntervals: [] };
  }
  const maxDurationMs = Math.min(options.effect.durationMs, DEFAULT_ANIMATION_POLICY.maxDurationMs);
  const staggerMs = options.effect.staggerMs ?? 0;
  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  options.targets.forEach((target) => {
    const startMs = window.startMs + target.step * staggerMs;
    if (startMs >= options.spanMs || startMs >= window.endMs) {
      return;
    }
    const durationMs = Math.max(0, Math.min(maxDurationMs, window.endMs - startMs));
    animation.push({ targetId: target.id, action: options.effect.preset, startMs, durationMs });
    if (startMs > 0) {
      stateIntervals.push({
        targetId: target.id,
        intervals: [{ startMs: 0, endMs: startMs }],
        on: { opacity: 0 },
        off: { opacity: 1 },
      });
    }
  });
  return { animation, stateIntervals };
}

export const SPOTLIGHT_DIM_ON: Record<string, string | number> = { filter: "brightness(0.4)" };
export const SPOTLIGHT_DIM_OFF: Record<string, string | number> = { filter: "none" };

export function onsetOverlayId(elementId: string): string {
  return `${elementId}-onset`;
}

export const PERSISTENT_ONSET_PRESETS: ReadonlySet<OnsetPreset> = new Set([
  "marker",
  "underline",
]);

export function tableNumberFormatToValueFormat(format: string | undefined): ValueFormat {
  switch (format) {
    case "currency":
      return "currency";
    case "percent":
      return "percent";
    case "integer":
      return "integer";
    case "decimal":
      return "decimal";
    default:
      return "raw";
  }
}

export function planValueAnimation(options: {
  targetId: string;
  to: number;
  format: ValueFormat;
  effect: ValueEffect;
  window: CueEffectWindow;
  spanMs: number;
}): ValueAnimation | null {
  const windowMs = options.window.endMs - options.window.startMs;
  const durationMs = Math.max(
    0,
    Math.min(
      options.effect.durationMs ?? windowMs,
      windowMs,
      DEFAULT_ANIMATION_POLICY.maxDurationMs,
    ),
  );
  const startMs = options.window.startMs;
  const from = options.effect.from ?? 0;
  if (
    durationMs <= 0 ||
    startMs >= options.spanMs ||
    !Number.isFinite(from) ||
    !Number.isFinite(options.to)
  ) {
    return null;
  }
  return {
    targetId: options.targetId,
    from,
    to: options.to,
    format: options.format,
    startMs,
    durationMs,
  };
}

export function planOnsetEffect(options: {
  overlayId: string;
  effect: EmphasizeEffect;
  window: CueEffectWindow;
  spanMs: number;
}): CueEffectPlan {
  const onset = options.effect.onset;
  if (onset === undefined) {
    return { animation: [], stateIntervals: [] };
  }
  const windowMs = options.window.endMs - options.window.startMs;
  const durationMs = Math.max(
    0,
    Math.min(onset.durationMs, DEFAULT_ANIMATION_POLICY.maxDurationMs, windowMs, options.spanMs),
  );
  const startMs = options.window.startMs;
  if (durationMs <= 0 || startMs >= options.spanMs) {
    return { animation: [], stateIntervals: [] };
  }
  const animation: AnimationItem[] = [
    {
      targetId: options.overlayId,
      action: onset.preset,
      ease: onset.preset === "pop" ? "overshoot" : "normal",
      startMs,
      durationMs,
    },
  ];
  const stateIntervals: StateInterval[] = PERSISTENT_ONSET_PRESETS.has(onset.preset)
    ? [
        {
          targetId: options.overlayId,
          intervals: [{ startMs: options.window.startMs, endMs: options.window.endMs }],
          on: { opacity: 1 },
          off: { opacity: 0 },
        },
      ]
    : [];
  return { animation, stateIntervals };
}
