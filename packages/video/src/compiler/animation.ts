import { currencyForLocale } from "../templates/table-format";
import { type AnimationPreset, type FigureEase } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import type {
  StateInterval,
  RenderAnimationAction,
  ValueAnimation,
} from "../render-context";

export function toSecondsText(ms: number): string {
  const seconds = ms / 1000;
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }
  return String(Math.round(seconds * 1000) / 1000);
}

export function secondsText(seconds: number): string {
  return toSecondsText(seconds * 1000);
}

function tweenVarsText(vars: Record<string, string | number>): string {
  return Object.entries(vars)
    .map(([key, value]) => {
      if (typeof value !== "number") {
        return `${key}:${JSON.stringify(value)}`;
      }
      return `${key}:${Number.isFinite(value) ? value : 0}`;
    })
    .join(",");
}

export function setTweenLine(
  elementId: string,
  vars: Record<string, string | number>,
  atMs: number,
): string {
  return `tl.set(document.getElementById("${elementId}"),{${tweenVarsText(vars)}},${toSecondsText(atMs)});`;
}

export function stateIntervalTweenLines(
  states: readonly StateInterval[],
  absStartMs: number,
  spanMs: number,
): string[] {
  const lines: string[] = [];
  for (const state of states) {
    for (const interval of state.intervals) {
      const startMs = Math.max(0, Math.min(interval.startMs, spanMs));
      const endMs = Math.max(0, Math.min(interval.endMs, spanMs));
      if (endMs <= startMs) {
        continue;
      }
      lines.push(setTweenLine(state.targetId, state.on, absStartMs + startMs));
      if (state.off !== undefined) {
        lines.push(setTweenLine(state.targetId, state.off, absStartMs + endMs));
      }
    }
  }
  return lines;
}

export function applyCueTiming(
  html: string,
  startMs: number,
  spanMs: number,
): string {
  const start = toSecondsText(startMs);
  const duration = toSecondsText(spanMs);
  const withVideos = html.replace(
    /<video\b(?![^>]*\bdata-start=)/g,
    `<video data-start="${start}" data-duration="${duration}"`,
  );
  return withVideos.replace(
    /<div\b([^>]*\bdata-composition-src=[^>]*)>/g,
    `<div data-start="${start}" data-duration="${duration}"$1>`,
  );
}

export const FADE_START_EPSILON_MS = 1;
const PRESET_OFFSET_PX = 60;

export function presetVars(
  preset: AnimationPreset,
  phase: "enter" | "exit",
): string | null {
  switch (preset) {
    case "none":
      return null;
    case "fade":
      return "opacity:0";
    case "slide-up":
      return phase === "enter"
        ? `opacity:0,y:${PRESET_OFFSET_PX}`
        : `opacity:0,y:-${PRESET_OFFSET_PX}`;
    case "slide-down":
      return phase === "enter"
        ? `opacity:0,y:-${PRESET_OFFSET_PX}`
        : `opacity:0,y:${PRESET_OFFSET_PX}`;
    case "slide-left":
      return phase === "enter"
        ? `opacity:0,x:${PRESET_OFFSET_PX}`
        : `opacity:0,x:-${PRESET_OFFSET_PX}`;
    case "slide-right":
      return phase === "enter"
        ? `opacity:0,x:-${PRESET_OFFSET_PX}`
        : `opacity:0,x:${PRESET_OFFSET_PX}`;
    case "scale-in":
      return phase === "enter" ? "opacity:0,scale:0.9" : "opacity:0,scale:1.05";
    case "pulse":
      return phase === "enter" ? "scale:1.06" : "scale:0.98";
    default: {
      const exhaustive: never = preset;
      throw new CompositionCompileError([
        {
          path: [],
          code: "unknown_preset",
          message: `未対応のアニメーションpresetです: ${String(exhaustive)}`,
        },
      ]);
    }
  }
}

export function actionVars(
  action: RenderAnimationAction,
  axis: "x" | "y" | undefined,
): string | null {
  switch (action) {
    case "grow":
      return axis === "x" ? "scaleX:0" : "scaleY:0";
    case "sweep":
      return 'opacity:1,"--kakeai-onset-progress":0';
    case "flash":
      return "opacity:1";
    case "pop":
      return "opacity:1,scale:0.85";
    case "marker":
    case "underline":
      return '"--kakeai-onset-progress":0';
    case "none":
    case "fade":
    case "slide-up":
    case "slide-down":
    case "slide-left":
    case "slide-right":
    case "scale-in":
    case "pulse":
      return presetVars(action, "enter");
    default: {
      const exhaustive: never = action;
      throw new CompositionCompileError([
        {
          path: [],
          code: "unknown_action",
          message: `未対応の図形アクションです: ${String(exhaustive)}`,
        },
      ]);
    }
  }
}

export function actionEase(ease: FigureEase | undefined): string {
  return ease === "overshoot" ? "back.out(1.6)" : "power1.out";
}

function valueFormatterExpr(
  format: ValueAnimation["format"],
  locale = "ja-JP",
): string {
  switch (format) {
    case "integer":
      return `(function(){var f=new Intl.NumberFormat(${JSON.stringify(locale)},{maximumFractionDigits:0});return function(v){return f.format(v);};})()`;
    case "decimal":
      return `(function(){var f=new Intl.NumberFormat(${JSON.stringify(locale)},{minimumFractionDigits:1,maximumFractionDigits:2});return function(v){return f.format(v);};})()`;
    case "percent":
      return `(function(){var f=new Intl.NumberFormat(${JSON.stringify(locale)},{style:"percent",maximumFractionDigits:1});return function(v){return f.format(v);};})()`;
    case "currency":
      return `(function(){var f=new Intl.NumberFormat(${JSON.stringify(locale)},{style:"currency",currency:${JSON.stringify(currencyForLocale(locale))},maximumFractionDigits:0});return function(v){return f.format(v);};})()`;
    case "raw":
      return `function(v){return String(v);}`;
  }
}

export function valueTweenLine(
  item: ValueAnimation,
  absStartMs: number,
  locale: string,
): string | null {
  if (
    item.durationMs <= 0 ||
    !Number.isFinite(item.from) ||
    !Number.isFinite(item.to)
  ) {
    return null;
  }
  const formatter = valueFormatterExpr(item.format, locale);
  const startMs = absStartMs + item.startMs;
  const targetId = JSON.stringify(item.targetId);
  return `(function(){var _fmt=${formatter};var _o={v:${item.from}};tl.fromTo(_o,{v:${item.from}},{v:${item.to},duration:${secondsText(item.durationMs / 1000)},ease:"power1.out",immediateRender:true,onUpdate:function(){var el=document.getElementById(${targetId});if(el){el.textContent=_fmt(this.targets()[0].v);}}},${toSecondsText(startMs)});})();`;
}
