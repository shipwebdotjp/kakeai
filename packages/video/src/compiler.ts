import {
  characterStandingV1,
  characterStandingV1InputSchema,
  mediaCardInputSchema,
  mediaCardV1,
  mediaFullBleedInputSchema,
  mediaFullBleedV1,
  sceneDeviceFrameV1,
  sceneSiteMockupV1,
  tableSimpleV1,
  chartBarV1,
  listCalloutV1,
  compositionFullBleedV1,
  compositionFullBleedInputSchema,
  deviceFrameInputSchema,
  textBlockV1,
  type AnimationPreset,
  type ContentDocument,
  type CueLayer,
  type FigureAction,
  type FigureEase,
  type NarrationSegment,
  type NestedVisual,
  type VisualCue,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import type { CompositionVersionResolver, CompositionVersionResolved } from "./composition-resolver";
import { CompositionCompileError } from "./compile-error";
import { escapeCssFontFamily, escapeHtmlAttribute, escapeHtmlText } from "./escape";
import { getGsapBundleSource } from "./gsap-bundle";
import { hexToRgb } from "./theme";
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./meta";
import type { AssetResolver, FaceSetResolver } from "./resolver";
import { cueScope, type RenderScope } from "./scope";
import { seededRandom } from "./random";
import type { RenderedCue, ExpressionTarget, RenderContext, CueTiming, LineInterval, StateInterval } from "./render-context";
import {
  THEME_FONT_STACKS,
  mixHex,
  overlayToRgba,
  resolveSceneAccentHex,
  resolveVisualTheme,
  sceneAccentStyle,
  themeRootStyle,
} from "./theme";
import { COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_CODE, COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_MESSAGE, compositionClipReachesSceneEnd, compositionCrossfadeExceedsChild, compositionTransitionOverflowMessage, cueTransitionTotalMs, resolveCueWindow, resolveTimeline, sceneTransitionOf, sceneTransitionOverflowIssue, type LinePlacement, type ResolvedTimeline } from "./timeline";
import { renderTextBlock } from "./templates/text-block";
import { renderMediaFullBleed } from "./templates/media-full-bleed";
import { renderMediaCard } from "./templates/media-card";
import {
  renderCharacterStanding,
} from "./templates/character-standing";
import { renderDeviceFrame } from "./templates/device-frame";
import { renderTableSimple } from "./templates/table-simple";
import { renderChartBar } from "./templates/chart-bar";
import { renderListCallout } from "./templates/list-callout";
import { renderSiteMockup } from "./templates/site-mockup";
import { focalPointStyle, resolveCueMedia, MAX_LOOP_COPIES } from "./templates/shared";

export const COMPOSITION_ID = "kakeai-main";

export interface CompileDocumentOptions {
  document: ContentDocument;
  assetResolver: AssetResolver;
  compositionResolver?: CompositionVersionResolver;
  faceSetResolver?: FaceSetResolver;
  themeResolver?: (id: string, version: number) => VisualThemeDefinition | undefined;
  resolvedTheme?: VisualThemeDefinition;
}

export interface CompiledComposition {
  html: string;
  assetIds: string[];
  compositionVersions: CompositionVersionResolved[];
  durationMs: number;
}

const LAYER_ORDER: Record<CueLayer, number> = {
  background: 0,
  card: 1,
  standing: 2,
  overlay: 3,
};

export function toSecondsText(ms: number): string {
  const seconds = ms / 1000;
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }
  return String(Math.round(seconds * 1000) / 1000);
}

function secondsText(seconds: number): string {
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

function setTweenLine(
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

function applyCueTiming(html: string, startMs: number, spanMs: number): string {
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

const BOUNCE_AMPLITUDE_PX = 20;
const BOUNCE_PERIOD_SEC = 1.6;
const BOUNCE_MIN_INTERVAL_SEC = 0.12;

interface SpeakingInterval {
  startMs: number;
  endMs: number;
}

interface BounceUnit {
  elementId: string;
  startMs: number;
  endMs: number;
}

function mergeIntervals(intervals: SpeakingInterval[]): SpeakingInterval[] {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: SpeakingInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function bounceTweenLines(unit: BounceUnit): string[] {
  const totalSec = (unit.endMs - unit.startMs) / 1000;
  if (totalSec < BOUNCE_MIN_INTERVAL_SEC) {
    return [];
  }
  const target = `document.getElementById("${unit.elementId}")`;
  let tween: string;
  if (totalSec >= BOUNCE_PERIOD_SEC) {
    const cycles = Math.floor(totalSec / BOUNCE_PERIOD_SEC);
    const halfSec = BOUNCE_PERIOD_SEC / 2;
    tween = `tl.to(${target},{y:-${BOUNCE_AMPLITUDE_PX},duration:${secondsText(halfSec)},ease:"sine.inOut",yoyo:true,repeat:${cycles * 2 - 1},immediateRender:false},${toSecondsText(unit.startMs)});`;
  } else {
    tween = `tl.to(${target},{y:-${BOUNCE_AMPLITUDE_PX},duration:${secondsText(totalSec / 2)},ease:"sine.inOut",yoyo:true,repeat:1,immediateRender:false},${toSecondsText(unit.startMs)});`;
  }
  const reset = `tl.set(${target},{y:0},${toSecondsText(unit.endMs)});`;
  return [tween, reset];
}

interface ExpressionInterval {
  presetId: string;
  startMs: number;
  endMs: number;
}

function expressionIntervalsForCharacter(
  characterId: string,
  lines: readonly LinePlacement[],
  lineById: ReadonlyMap<string, NarrationSegment>,
  characterIdBySpeakerId: ReadonlyMap<string, string | null>,
  knownPresets: ReadonlySet<string>,
  cueStartMs: number,
  cueEndMs: number,
): ExpressionInterval[] {
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const raw: ExpressionInterval[] = [];
  for (const placement of sorted) {
    const startMs = Math.max(placement.startMs, cueStartMs);
    const endMs = Math.min(placement.endMs, cueEndMs);
    if (endMs <= startMs) {
      continue;
    }
    let presetId = "normal";
    const line = lineById.get(placement.lineId);
    if (line !== undefined && line.speakerId !== null) {
      if (characterIdBySpeakerId.get(line.speakerId) === characterId) {
        const requested = line.expressionId ?? "normal";
        presetId = knownPresets.has(requested) ? requested : "normal";
      }
    }
    raw.push({ presetId, startMs, endMs });
  }
  const filled: ExpressionInterval[] = [];
  let cursor = cueStartMs;
  for (const interval of raw) {
    if (interval.startMs > cursor) {
      filled.push({ presetId: "normal", startMs: cursor, endMs: interval.startMs });
    }
    filled.push(interval);
    cursor = Math.max(cursor, interval.endMs);
  }
  if (cursor < cueEndMs) {
    filled.push({ presetId: "normal", startMs: cursor, endMs: cueEndMs });
  }
  const merged: ExpressionInterval[] = [];
  for (const interval of filled) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      last.presetId === interval.presetId &&
      interval.startMs <= last.endMs
    ) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function expressionTweenLines(
  targets: readonly ExpressionTarget[],
  intervals: readonly ExpressionInterval[],
): string[] {
  const lines: string[] = [];
  const setLine = (target: ExpressionTarget, visible: boolean, startMs: number): void => {
    lines.push(setTweenLine(target.elementId, { opacity: visible ? 1 : 0 }, startMs));
  };
  let previous: string | null = null;
  for (const interval of intervals) {
    if (previous === null) {
      for (const target of targets) {
        setLine(target, target.presetId === interval.presetId, interval.startMs);
      }
    } else if (previous !== interval.presetId) {
      const leaving = targets.find((target) => target.presetId === previous);
      const entering = targets.find((target) => target.presetId === interval.presetId);
      if (leaving !== undefined) {
        setLine(leaving, false, interval.startMs);
      }
      if (entering !== undefined) {
        setLine(entering, true, interval.startMs);
      }
    }
    previous = interval.presetId;
  }
  return lines;
}

const BLINK_GAP_MIN_MS = 2500;
const BLINK_GAP_MAX_MS = 5500;
const BLINK_DURATION_MIN_MS = 90;
const BLINK_DURATION_MAX_MS = 160;
const MOUTH_OPEN_MIN_MS = 90;
const MOUTH_OPEN_MAX_MS = 150;
const MOUTH_CLOSED_MIN_MS = 130;
const MOUTH_CLOSED_MAX_MS = 260;
const MIN_FACE_EVENT_MS = 30;

interface FaceEvent {
  startMs: number;
  endMs: number;
}

function blinkSchedule(random: () => number, startMs: number, endMs: number): FaceEvent[] {
  const events: FaceEvent[] = [];
  let cursor = startMs + 800 + random() * 2200;
  while (cursor < endMs) {
    const durationMs =
      BLINK_DURATION_MIN_MS + random() * (BLINK_DURATION_MAX_MS - BLINK_DURATION_MIN_MS);
    const eventEndMs = Math.min(cursor + durationMs, endMs);
    if (eventEndMs - cursor >= MIN_FACE_EVENT_MS) {
      events.push({ startMs: Math.round(cursor), endMs: Math.round(eventEndMs) });
    }
    cursor =
      eventEndMs + BLINK_GAP_MIN_MS + random() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS);
  }
  return events;
}

function mouthSchedule(
  random: () => number,
  windows: readonly FaceEvent[],
): FaceEvent[] {
  const events: FaceEvent[] = [];
  for (const window of windows) {
    let cursor = window.startMs + random() * MOUTH_CLOSED_MAX_MS;
    while (cursor < window.endMs) {
      const openMs = MOUTH_OPEN_MIN_MS + random() * (MOUTH_OPEN_MAX_MS - MOUTH_OPEN_MIN_MS);
      const openEndMs = Math.min(cursor + openMs, window.endMs);
      if (openEndMs - cursor >= MIN_FACE_EVENT_MS) {
        events.push({ startMs: Math.round(cursor), endMs: Math.round(openEndMs) });
      }
      cursor =
        openEndMs + MOUTH_CLOSED_MIN_MS + random() * (MOUTH_CLOSED_MAX_MS - MOUTH_CLOSED_MIN_MS);
    }
  }
  return events;
}

function activePresetAt(intervals: readonly ExpressionInterval[], timeMs: number): string {
  for (const interval of intervals) {
    if (timeMs >= interval.startMs && timeMs < interval.endMs) {
      return interval.presetId;
    }
  }
  return "normal";
}

function faceVariantTweenLines(
  targets: readonly ExpressionTarget[],
  intervals: readonly ExpressionInterval[],
  blinks: readonly FaceEvent[],
  mouths: readonly FaceEvent[],
): string[] {
  const byPreset = new Map(targets.map((target) => [target.presetId, target]));
  const lines: string[] = [];
  const setLine = (elementId: string, visible: boolean, startMs: number): void => {
    lines.push(setTweenLine(elementId, { opacity: visible ? 1 : 0 }, startMs));
  };
  let previous: string | null = null;
  for (const interval of intervals) {
    if (previous !== interval.presetId) {
      const entering = byPreset.get(interval.presetId);
      if (entering?.eyeBlinkId !== undefined) {
        setLine(entering.eyeBlinkId, false, interval.startMs);
        if (entering.eyeBaseId !== undefined) {
          setLine(entering.eyeBaseId, true, interval.startMs);
        }
      }
      if (entering?.mouthSpeakingId !== undefined) {
        setLine(entering.mouthSpeakingId, false, interval.startMs);
        if (entering.mouthBaseId !== undefined) {
          setLine(entering.mouthBaseId, true, interval.startMs);
        }
      }
    }
    previous = interval.presetId;
  }
  for (const blink of blinks) {
    const target = byPreset.get(activePresetAt(intervals, blink.startMs));
    const blinkId = target?.eyeBlinkId;
    if (target === undefined || blinkId === undefined) {
      continue;
    }
    setLine(blinkId, true, blink.startMs);
    if (target.eyeBaseId !== undefined) {
      setLine(target.eyeBaseId, false, blink.startMs);
    }
    setLine(blinkId, false, blink.endMs);
    if (target.eyeBaseId !== undefined) {
      setLine(target.eyeBaseId, true, blink.endMs);
    }
  }
  for (const mouth of mouths) {
    const target = byPreset.get(activePresetAt(intervals, mouth.startMs));
    const speakingId = target?.mouthSpeakingId;
    if (target === undefined || speakingId === undefined) {
      continue;
    }
    setLine(speakingId, true, mouth.startMs);
    if (target.mouthBaseId !== undefined) {
      setLine(target.mouthBaseId, false, mouth.startMs);
    }
    setLine(speakingId, false, mouth.endMs);
    if (target.mouthBaseId !== undefined) {
      setLine(target.mouthBaseId, true, mouth.endMs);
    }
  }
  return lines;
}

function sceneBackground(accentHex: string, theme: VisualThemeDefinition): string {
  return `linear-gradient(135deg, ${mixHex(accentHex, theme.canvas.base, 0.72)} 0%, ${mixHex(accentHex, theme.canvas.base, 0.88)} 100%)`;
}

function renderNestedMedia(node: NestedVisual & { kind: "media" }, context: RenderContext): RenderedCue {
  const media = resolveCueMedia(node.assetId, context.assetResolver, context.path);
  const id = context.scope.id("media");
  const fit = node.fit === "contain" ? "contain" : "cover";
  const style = `object-fit:${fit};${focalPointStyle(node.focalPoint)}`;
  if (media.kind === "video") {
    return {
      html: `<video id="${id}" class="kakeai-nestedmedia" src="${escapeHtmlAttribute(media.url)}" style="${style}" muted playsinline preload="auto" data-media-start="0"></video>`,
      assetIds: [node.assetId],
      animation: [],
    };
  }
  return {
    html: `<img id="${id}" class="kakeai-nestedmedia" src="${escapeHtmlAttribute(media.url)}" style="${style}" alt="">`,
    assetIds: [node.assetId],
    animation: [],
  };
}

function renderCompositionFullBleed(
  input: unknown,
  context: RenderContext,
  compositionResolver?: CompositionVersionResolver,
): RenderedCue & { compositionVersion?: CompositionVersionResolved } {
  const parsed = compositionFullBleedInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "input"],
        code: "invalid_input",
        message: "compositionVersionId を指定してください",
      },
    ]);
  }
  if (!compositionResolver) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "input"],
        code: "missing_composition_resolver",
        message: "CompositionVersionResolver が設定されていません",
      },
    ]);
  }
  let resolved: CompositionVersionResolved;
  try {
    resolved = compositionResolver(parsed.data.compositionVersionId);
  } catch (err) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "input", "compositionVersionId"],
        code: "unknown_composition_version",
        message: `CompositionVersion を解釈できません: ${(err as Error).message}`,
      },
    ]);
  }

  const hostId = context.scope.id("comp-host");
  const src = resolved.previewUrl ?? resolved.entrypoint;
  const width = resolved.manifest.width;
  const height = resolved.manifest.height;
  return {
    html: `<div id="${hostId}" class="kakeai-fullbleed" data-composition-id="${escapeHtmlAttribute(resolved.runtimeCompositionId)}" data-composition-src="${escapeHtmlAttribute(src)}" data-width="${width}" data-height="${height}"></div>`,
    assetIds: [],
    animation: [],
    compositionVersion: resolved,
  };
}

function dispatchTemplate(
  key: string,
  input: unknown,
  context: RenderContext,
  compositionResolver?: CompositionVersionResolver,
): RenderedCue & { compositionVersion?: CompositionVersionResolved } {
  switch (key) {
    case `${textBlockV1.id}@${textBlockV1.version}`:
      return { html: renderTextBlock(input, context.path, context.theme), assetIds: [], animation: [] };
    case `${mediaFullBleedV1.id}@${mediaFullBleedV1.version}`:
      return renderMediaFullBleed(input, context, mediaFullBleedInputSchema);
    case `${mediaCardV1.id}@${mediaCardV1.version}`:
      return renderMediaCard(input, context, mediaCardInputSchema);
    case `${characterStandingV1.id}@${characterStandingV1.version}`:
      return renderCharacterStanding(input, context);
    case `${sceneDeviceFrameV1.id}@${sceneDeviceFrameV1.version}`:
      return renderDeviceFrame(input, context, deviceFrameInputSchema);
    case `${sceneSiteMockupV1.id}@${sceneSiteMockupV1.version}`:
      return renderSiteMockup(input, context);
    case `${tableSimpleV1.id}@${tableSimpleV1.version}`:
      return renderTableSimple(input, context);
    case `${chartBarV1.id}@${chartBarV1.version}`:
      return renderChartBar(input, context);
    case `${listCalloutV1.id}@${listCalloutV1.version}`:
      return renderListCallout(input, context);
    case `${compositionFullBleedV1.id}@${compositionFullBleedV1.version}`:
      return renderCompositionFullBleed(input, context, compositionResolver);
    default:
      throw new CompositionCompileError([
        {
          path: [...context.path, "template"],
          code: "unknown_template",
          message: `未対応のVisualTemplateです: ${key}`,
        },
      ]);
  }
}

function makeContext(
  document: ContentDocument,
  theme: VisualThemeDefinition,
  assetResolver: AssetResolver,
  scope: RenderScope,
  path: (string | number)[],
  faceSetResolver?: FaceSetResolver,
  cueTiming?: CueTiming,
  lineIntervals?: LineInterval[],
  compositionResolver?: CompositionVersionResolver,
  collectComposition?: (resolved: CompositionVersionResolved) => void,
): RenderContext {
  const context: RenderContext = {
    document,
    theme,
    assetResolver,
    faceSetResolver,
    compositionResolver,
    collectComposition,
    scope,
    path,
    cueTiming,
    lineIntervals,
    renderNested: (node, nestedScope, nestedPath) =>
      renderNestedVisual(
        node,
        makeContext(
          document,
          theme,
          assetResolver,
          nestedScope,
          nestedPath,
          faceSetResolver,
          cueTiming,
          lineIntervals,
          compositionResolver,
          collectComposition,
        ),
      ),
  };
  return context;
}

function renderNestedComposition(
  node: NestedVisual & { kind: "composition" },
  context: RenderContext,
): RenderedCue & { compositionVersion?: CompositionVersionResolved } {
  if (!context.compositionResolver) {
    throw new CompositionCompileError([
      {
        path: context.path,
        code: "missing_composition_resolver",
        message: "CompositionVersionResolver が設定されていません",
      },
    ]);
  }
  let resolved: CompositionVersionResolved;
  try {
    resolved = context.compositionResolver(node.compositionVersionId);
  } catch (err) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "compositionVersionId"],
        code: "unknown_composition_version",
        message: `CompositionVersion を解釈できません: ${(err as Error).message}`,
      },
    ]);
  }
  context.collectComposition?.(resolved);
  const width = resolved.manifest.width;
  const height = resolved.manifest.height;
  const durationMs = resolved.manifest.durationMs;
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "compositionVersionId"],
        code: "invalid_composition_manifest",
        message: "CompositionVersion の寸法または尺が不正です",
      },
    ]);
  }
  const zoom = node.zoom ?? 1;
  const posX = node.position?.x ?? 0.5;
  const posY = node.position?.y ?? 0.5;
  const base =
    node.fit === "contain"
      ? `min(tan(atan2(100cqw,${width}px)),tan(atan2(100cqh,${height}px)))`
      : `max(tan(atan2(100cqw,${width}px)),tan(atan2(100cqh,${height}px)))`;
  const scale = zoom === 1 ? base : `calc(${base} * ${zoom})`;
  const slotId = context.scope.id("compslot");
  const zoomId = context.scope.id("compzoom");
  const hostId = context.scope.id("comp-host");
  const src = resolved.previewUrl ?? resolved.entrypoint;
  return {
    html: `<div id="${slotId}" class="kakeai-compslot" style="--kakeai-cw:${width}px;--kakeai-ch:${height}px;--kakeai-s:${scale};--kakeai-posx:${posX};--kakeai-posy:${posY}"><div id="${zoomId}" class="kakeai-compzoom"><div id="${hostId}" class="kakeai-compchild" data-composition-id="${escapeHtmlAttribute(resolved.runtimeCompositionId)}" data-composition-src="${escapeHtmlAttribute(src)}" data-width="${width}" data-height="${height}"></div></div></div>`,
    assetIds: [],
    animation: [],
    compositionVersion: resolved,
    nestedCompositionWindows: [{ targetId: zoomId, durationMs }],
  };
}

function renderNestedVisual(node: NestedVisual, context: RenderContext): RenderedCue {
  if (node.kind === "media") {
    return renderNestedMedia(node, context);
  }
  if (node.kind === "composition") {
    return renderNestedComposition(node, context);
  }
  return dispatchTemplate(
    `${node.template.id}@${node.template.version}`,
    node.input,
    context,
    context.compositionResolver,
  );
}

const STYLES = [
  "html,body{margin:0;padding:0;background:#000;height:100%;}",
  "#kakeai-root{position:relative;width:100%;height:100%;overflow:hidden;background:var(--kakeai-canvas);font-family:var(--kakeai-font-sans);color:var(--kakeai-text);}",
  ".clip{position:absolute;inset:0;}",
  ".kakeai-scenebg{position:absolute;inset:0;}",
  ".kakeai-sceneclip{position:absolute;inset:0;}",
  ".kakeai-cuebody{position:absolute;inset:0;transform-origin:center center;}",
  ".kakeai-fullbleed{position:absolute;inset:0;width:100%;height:100%;}",
  ".kakeai-card{position:absolute;inset:0;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:90px 160px;box-sizing:border-box;}",
  ".kakeai-cardmedia-clip{overflow:hidden;border-radius:var(--kakeai-radius-lg);box-shadow:0 12px 48px var(--kakeai-shadow);}",
  ".kakeai-cardmedia{display:block;width:100%;height:100%;object-fit:cover;}",
  ".kakeai-cardtext{margin:0;background:var(--kakeai-scrim);border-radius:var(--kakeai-radius-md);padding:28px 48px;max-width:1400px;}",
  ".kakeai-cardheading{margin:0;font-size:56px;font-weight:700;line-height:1.4;color:var(--kakeai-onmedia);}",
  ".kakeai-cardcaption{margin:12px 0 0;font-size:34px;line-height:1.7;color:var(--kakeai-onmedia);}",
  ".kakeai-standing{position:absolute;transform:translate(-50%,-50%);height:auto;filter:drop-shadow(0 12px 32px var(--kakeai-shadow));}",
  ".kakeai-standingv2{position:absolute;transform:translate(-50%,-50%);}",
  ".kakeai-standingimg{display:block;height:auto;filter:drop-shadow(0 12px 32px var(--kakeai-shadow));}",
  ".kakeai-facegroup{position:absolute;inset:0;}",
  ".kakeai-face{position:absolute;left:0;top:0;width:100%;height:100%;}",
  ".kakeai-nestedmedia{display:block;width:100%;height:100%;}",
  ".kakeai-compslot{position:absolute;inset:0;overflow:hidden;}",
  ".kakeai-compzoom{position:absolute;left:0;top:0;width:var(--kakeai-cw,1920px);height:var(--kakeai-ch,1080px);transform-origin:top left;transform:translate(calc((100cqw - var(--kakeai-cw,1920px) * var(--kakeai-s,1)) * var(--kakeai-posx,0.5)),calc((100cqh - var(--kakeai-ch,1080px) * var(--kakeai-s,1)) * var(--kakeai-posy,0.5))) scale(var(--kakeai-s,1));}",
  ".kakeai-compchild{position:absolute;inset:0;width:100%;height:100%;}",
  ".kakeai-deviceframe{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:80px;box-sizing:border-box;}",
  ".kakeai-deviceframe-screen{overflow:hidden;background:#000;box-shadow:0 24px 60px var(--kakeai-shadow);container-type:size;}",
  ".kakeai-deviceframe-laptop .kakeai-deviceframe-screen{width:72%;aspect-ratio:16/9;border-radius:18px;border:24px solid var(--kakeai-ink);}",
  ".kakeai-deviceframe-phone .kakeai-deviceframe-screen{width:30%;aspect-ratio:9/19.5;border-radius:36px;border:18px solid var(--kakeai-ink);}",
  ".kakeai-caption{position:absolute;left:0;right:0;bottom:72px;display:flex;justify-content:center;padding:0 160px;box-sizing:border-box;}",
  ".kakeai-captiontext{margin:0;max-width:1600px;font-size:40px;line-height:1.5;white-space:pre-line;text-align:center;background:var(--kakeai-scrim);border-radius:var(--kakeai-radius-sm);padding:12px 36px;color:var(--kakeai-onmedia);text-shadow:0 2px 12px rgba(0,0,0,.6);}",
  ".kakeai-mockup{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:80px;box-sizing:border-box;}",
  ".kakeai-mockup-chrome{position:relative;width:auto;max-width:90%;max-height:92%;border-radius:var(--kakeai-radius-md);overflow:hidden;box-shadow:0 24px 60px var(--kakeai-shadow);display:flex;flex-direction:column;background:var(--kakeai-mockup-surface,var(--kakeai-surface));color:var(--kakeai-mockup-fg,var(--kakeai-text));}",
  ".kakeai-mockup-chrome::before{content:'';display:block;height:8px;background:var(--kakeai-mockup-accent,#6b7280);}",
  ".kakeai-mockup-theme-dark .kakeai-mockup-chrome{--kakeai-mockup-surface:#16181c;--kakeai-mockup-fg:#e5e7eb;}",
  ".kakeai-mockup-header{display:flex;align-items:center;gap:16px;padding:20px 28px;border-bottom:1px solid rgba(127,127,127,.25);}",
  ".kakeai-mockup-header .kakeai-nestedmedia{height:40px;width:auto;max-width:120px;object-fit:contain;}",
  ".kakeai-mockup-ident{display:flex;flex-direction:column;min-width:0;}",
  ".kakeai-mockup-name{font-size:26px;font-weight:700;}",
  ".kakeai-mockup-handle{font-size:20px;opacity:.7;}",
  ".kakeai-mockup-url{font-size:18px;opacity:.6;}",
  ".kakeai-mockup-screen{position:relative;height:600px;width:auto;aspect-ratio:16/9;background:#000;overflow:hidden;}",
  ".kakeai-mockup-screen .kakeai-nestedmedia{width:100%;height:100%;display:block;}",
  ".kakeai-mockup-caption{padding:18px 28px;font-size:24px;line-height:1.6;white-space:pre-line;overflow:hidden;}",
  ".kakeai-mockup-x{--kakeai-mockup-accent:#1d9bf0;}",
  ".kakeai-mockup-instagram{--kakeai-mockup-accent:#d62976;}",
  ".kakeai-mockup-instagram .kakeai-mockup-screen{aspect-ratio:1/1;}",
  ".kakeai-mockup-tiktok{--kakeai-mockup-accent:#25f4ee;}",
  ".kakeai-mockup-tiktok .kakeai-mockup-screen{aspect-ratio:9/16;}",
  ".kakeai-mockup-youtube{--kakeai-mockup-accent:#ff0000;}",
  ".kakeai-mockup-github{--kakeai-mockup-accent:#24292f;}",
  ".kakeai-mockup-qiita{--kakeai-mockup-accent:#55c500;}",
  ".kakeai-mockup-zenn{--kakeai-mockup-accent:#3ea8ff;}",
  ".kakeai-mockup-note{--kakeai-mockup-accent:#41c9b4;}",
  ".kakeai-mockup-stackoverflow{--kakeai-mockup-accent:#f48024;}",
  ".kakeai-mockup-hackernews{--kakeai-mockup-accent:#ff6600;}",
  ".kakeai-mockup-reddit{--kakeai-mockup-accent:#ff4500;}",
  ".kakeai-mockup-pixiv{--kakeai-mockup-accent:#0096fa;}",
  ".kakeai-mockup-niconico{--kakeai-mockup-accent:#252525;}",
  ".kakeai-mockup-browser{--kakeai-mockup-accent:#6b7280;}",
  ".kakeai-tablewrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:90px 160px;box-sizing:border-box;}",
  ".kakeai-tableframe{background:var(--kakeai-surface);border-radius:var(--kakeai-radius-lg);box-shadow:0 12px 48px var(--kakeai-shadow);padding:36px 48px;max-width:1500px;max-height:880px;overflow:hidden;}",
  ".kakeai-tablecaption{margin:0 0 20px;font-size:44px;font-weight:700;color:var(--kakeai-text);text-align:center;}",
  ".kakeai-table{border-collapse:collapse;width:100%;font-size:36px;line-height:1.5;color:var(--kakeai-text);}",
  ".kakeai-tablehead{padding:14px 28px;border-bottom:4px solid var(--kakeai-accent-primary);font-weight:700;white-space:normal;word-break:break-word;}",
  ".kakeai-tablecell{padding:14px 28px;white-space:normal;word-break:break-word;}",
  ".kakeai-table-zebra .kakeai-tablerow:nth-child(even) .kakeai-tablecell{background:var(--kakeai-surface-muted);}",
  ".kakeai-table-bordered .kakeai-tablecell{border:2px solid var(--kakeai-border);}",
  ".kakeai-table-bordered .kakeai-tablehead{border:2px solid var(--kakeai-border);border-bottom:4px solid var(--kakeai-accent-primary);}",
  ".kakeai-chartwrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:80px 160px;box-sizing:border-box;}",
  ".kakeai-chartframe{background:var(--kakeai-surface);border-radius:var(--kakeai-radius-lg);box-shadow:0 12px 48px var(--kakeai-shadow);padding:40px 56px;}",
  ".kakeai-charttitle{margin:0 0 12px;font-size:44px;font-weight:700;color:var(--kakeai-text);text-align:center;}",
  ".kakeai-chartlegend{display:flex;flex-wrap:wrap;justify-content:center;gap:24px;margin-bottom:16px;font-size:26px;color:var(--kakeai-muted);}",
  ".kakeai-chartlegenditem{display:inline-flex;align-items:center;gap:10px;}",
  ".kakeai-chartswatch{width:28px;height:28px;border-radius:6px;display:inline-block;}",
  ".kakeai-chartplot{position:relative;width:1280px;}",
  ".kakeai-chartlines{position:absolute;left:0;right:0;}",
  ".kakeai-chartline{position:absolute;left:0;right:0;border-top:1px solid var(--kakeai-border);opacity:.45;}",
  ".kakeai-chart-grid .kakeai-chartline{opacity:1;}",
  ".kakeai-charttick{position:absolute;left:0;width:120px;text-align:right;padding-right:12px;top:0;transform:translateY(-50%);font-size:24px;color:var(--kakeai-muted);}",
  ".kakeai-chartcols{position:absolute;top:0;bottom:0;right:0;display:flex;align-items:stretch;gap:28px;}",
  ".kakeai-chartcol{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;}",
  ".kakeai-chartbars{flex:1;display:flex;align-items:flex-end;gap:10px;}",
  ".kakeai-chartbar{position:relative;width:64px;border-radius:6px 6px 0 0;transform-origin:bottom center;}",
  ".kakeai-chartvalue{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding-bottom:8px;font-size:24px;white-space:nowrap;color:var(--kakeai-text);}",
  ".kakeai-chartcat{height:48px;display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--kakeai-muted);}",
  ".kakeai-chartplot-h{display:flex;flex-direction:column;gap:20px;padding:8px 0 44px;box-sizing:border-box;}",
  ".kakeai-chartlines-h{position:absolute;top:0;bottom:44px;right:0;}",
  ".kakeai-charthline{position:absolute;top:0;bottom:0;border-left:1px solid var(--kakeai-border);opacity:.45;}",
  ".kakeai-chart-grid .kakeai-charthline{opacity:1;}",
  ".kakeai-charthtick{position:absolute;bottom:-34px;left:0;transform:translateX(-50%);font-size:22px;color:var(--kakeai-muted);}",
  ".kakeai-chartrows{display:flex;flex-direction:column;gap:20px;}",
  ".kakeai-chartrow{display:flex;align-items:center;gap:16px;}",
  ".kakeai-charthcat{width:220px;text-align:right;padding-right:16px;font-size:28px;color:var(--kakeai-muted);}",
  ".kakeai-chartbars-h{flex:1;display:flex;flex-direction:column;gap:8px;}",
  ".kakeai-chartbar-h{width:auto;height:34px;border-radius:0 6px 6px 0;transform-origin:left center;}",
  ".kakeai-charthvalue{position:absolute;left:100%;top:50%;transform:translateY(-50%);padding-left:10px;font-size:24px;white-space:nowrap;color:var(--kakeai-text);}",
  ".kakeai-calloutwrap{position:absolute;inset:0;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:120px 200px;box-sizing:border-box;}",
  ".kakeai-callouttitle{font-size:52px;font-weight:700;color:var(--kakeai-text);}",
  ".kakeai-calloutlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:20px;width:100%;max-width:1400px;}",
  ".kakeai-calloutitem{background:var(--kakeai-surface);border-radius:var(--kakeai-radius-lg);padding:24px 36px;font-size:40px;line-height:1.3;color:var(--kakeai-text);box-shadow:0 8px 32px var(--kakeai-shadow);}",
].join("\n");

const FADE_START_EPSILON_MS = 1;
const PRESET_OFFSET_PX = 60;

function presetVars(preset: AnimationPreset, phase: "enter" | "exit"): string | null {
  switch (preset) {
    case "none":
      return null;
    case "fade":
      return "opacity:0";
    case "slide-up":
      return phase === "enter" ? `opacity:0,y:${PRESET_OFFSET_PX}` : `opacity:0,y:-${PRESET_OFFSET_PX}`;
    case "slide-down":
      return phase === "enter" ? `opacity:0,y:-${PRESET_OFFSET_PX}` : `opacity:0,y:${PRESET_OFFSET_PX}`;
    case "slide-left":
      return phase === "enter" ? `opacity:0,x:${PRESET_OFFSET_PX}` : `opacity:0,x:-${PRESET_OFFSET_PX}`;
    case "slide-right":
      return phase === "enter" ? `opacity:0,x:-${PRESET_OFFSET_PX}` : `opacity:0,x:${PRESET_OFFSET_PX}`;
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

function actionVars(action: FigureAction, axis: "x" | "y" | undefined): string | null {
  switch (action) {
    case "grow":
      return axis === "x" ? "scaleX:0" : "scaleY:0";
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

function actionEase(ease: FigureEase | undefined): string {
  return ease === "overshoot" ? "back.out(1.6)" : "power1.out";
}

function gainToVolume(gainDb: number | undefined): string {
  const db = gainDb ?? 0;
  const volume = Math.min(3.98, Math.max(0, Math.pow(10, db / 20)));
  return String(Math.round(volume * 1000) / 1000);
}

function audioElement(options: {
  id: string;
  url: string;
  startMs: number;
  durationMs: number;
  volume: string;
}): string {
  return `<audio id="${escapeHtmlAttribute(options.id)}" src="${escapeHtmlAttribute(options.url)}" data-start="${toSecondsText(options.startMs)}" data-duration="${toSecondsText(options.durationMs)}" data-volume="${escapeHtmlAttribute(options.volume)}"></audio>`;
}

function buildLoopAudios(options: {
  idPrefix: string;
  url: string;
  spanStartMs: number;
  spanEndMs: number;
  volume: string;
  loop: boolean;
  sourceDurationMs: number | null | undefined;
  path: (string | number)[];
}): string[] {
  const { idPrefix, url, spanStartMs, spanEndMs, volume } = options;
  const spanMs = spanEndMs - spanStartMs;
  if (spanMs <= 0) {
    return [];
  }
  const sourceMs = options.sourceDurationMs ?? null;
  if (!options.loop || sourceMs === null || sourceMs <= 0) {
    const durationMs = sourceMs !== null ? Math.min(sourceMs, spanMs) : spanMs;
    return [
      audioElement({ id: `${idPrefix}-0`, url, startMs: spanStartMs, durationMs, volume }),
    ];
  }
  const copies = Math.ceil(spanMs / sourceMs);
  if (copies > MAX_LOOP_COPIES) {
    throw new CompositionCompileError([
      {
        path: options.path,
        code: "loop_span_too_long",
        message: "ループ音声の繰り返しが多すぎるため、音声を短く設定できません。",
      },
    ]);
  }
  const elements: string[] = [];
  for (let index = 0; index < copies; index += 1) {
    const startMs = spanStartMs + index * sourceMs;
    const durationMs = Math.min(sourceMs, spanEndMs - startMs);
    if (durationMs <= 0) {
      break;
    }
    elements.push(
      audioElement({ id: `${idPrefix}-${index}`, url, startMs, durationMs, volume }),
    );
  }
  return elements;
}

function addClipDurationMs(html: string, extraMs: number): string {
  return html.replace(/<[^>]+>/g, (tag) => {
    if (tag.includes("data-kakeai-loop-segment=") && !tag.includes("data-kakeai-loop-segment-last=")) {
      return tag;
    }
    return tag.replace(/data-duration="([0-9.]+)"/g, (_match, value: string) => {
      const totalMs = Math.round(Number(value) * 1000) + extraMs;
      return `data-duration="${toSecondsText(totalMs)}"`;
    });
  });
}

function clipEndsAtSceneEnd(html: string, sceneEndMs: number): boolean {
  const start = html.match(/data-start="([0-9.]+)"/);
  const duration = html.match(/data-duration="([0-9.]+)"/);
  if (start === null || duration === null) {
    return false;
  }
  const endMs = Math.round(Number(start[1]) * 1000) + Math.round(Number(duration[1]) * 1000);
  return endMs >= sceneEndMs;
}

function assertCompositionCrossfadeWindow(
  html: string,
  extraMs: number,
  sceneIndex: number,
  sceneStartMs: number,
  sceneDurationMs: number,
): void {
  const openTag = html.match(/^<div[^>]*>/);
  if (openTag === null) {
    return;
  }
  const tag = openTag[0];
  const child = tag.match(/data-composition-duration-ms="([0-9.]+)"/);
  const start = tag.match(/data-start="([0-9.]+)"/);
  const duration = tag.match(/data-duration="([0-9.]+)"/);
  if (child === null || start === null || duration === null) {
    return;
  }
  const startMs = Math.round(Number(start[1]) * 1000);
  const spanMs = Math.round(Number(duration[1]) * 1000);
  const childMs = Math.round(Number(child[1]));
  if (!Number.isFinite(startMs) || !Number.isFinite(spanMs) || !Number.isFinite(childMs)) {
    return;
  }
  const windowStartMs = startMs - sceneStartMs;
  if (
    compositionClipReachesSceneEnd(windowStartMs, spanMs, sceneDurationMs) &&
    compositionCrossfadeExceedsChild(spanMs, extraMs, childMs)
  ) {
    throw new CompositionCompileError([
      {
        path: ["scenes", sceneIndex, "transition", "enter", "durationMs"],
        code: COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_CODE,
        message: COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_MESSAGE,
      },
    ]);
  }
}

function applySceneTransitions(
  document: ContentDocument,
  theme: VisualThemeDefinition,
  timeline: ResolvedTimeline,
  groups: readonly string[][],
  tweenLines: string[],
): string[] {
  const extendedGroups = groups.map((group) => group.slice());
  for (let index = 1; index < timeline.scenes.length; index += 1) {
    const placement = timeline.scenes[index];
    const previous = timeline.scenes[index - 1];
    const scene = placement === undefined ? undefined : document.scenes[placement.sceneIndex];
    if (scene === undefined || placement === undefined || previous === undefined) {
      continue;
    }
    const { preset, durationMs } = sceneTransitionOf(scene);
    if (preset === "cut" || durationMs === 0) {
      continue;
    }
    const overflow = sceneTransitionOverflowIssue(
      index,
      previous.durationMs,
      placement.durationMs,
      durationMs,
    );
    if (overflow !== undefined) {
      throw new CompositionCompileError([overflow]);
    }
    const wrapId = `kakeai-scene-${placement.sceneIndex}`;
    if (preset === "crossfade") {
      const previousEndMs = previous.startMs + previous.durationMs;
      extendedGroups[index - 1] = extendedGroups[index - 1]!.map((clip) => {
        if (clip.includes("kakeai-caption") || !clipEndsAtSceneEnd(clip, previousEndMs)) {
          return clip;
        }
        assertCompositionCrossfadeWindow(
          clip,
          durationMs,
          placement.sceneIndex,
          previous.startMs,
          previous.durationMs,
        );
        return addClipDurationMs(clip, durationMs);
      });
      tweenLines.push(
        `tl.from(document.getElementById("${wrapId}"),{opacity:0,duration:${secondsText(durationMs / 1000)},ease:"power1.out",immediateRender:false},${toSecondsText(placement.startMs)});`,
      );
    } else {
      const fadeOutMs = Math.ceil(durationMs / 2);
      const fadeInMs = durationMs - fadeOutMs;
      if (fadeOutMs > 0) {
        tweenLines.push(
          `tl.to(document.getElementById("kakeai-scene-${previous.sceneIndex}"),{opacity:0,duration:${secondsText(fadeOutMs / 1000)},ease:"power1.in",immediateRender:false},${toSecondsText(placement.startMs - fadeOutMs)});`,
        );
      }
      if (fadeInMs > 0) {
        tweenLines.push(
          `tl.from(document.getElementById("${wrapId}"),{opacity:0,duration:${secondsText(fadeInMs / 1000)},ease:"power1.out",immediateRender:false},${toSecondsText(placement.startMs)});`,
        );
      }
    }
  }
  return extendedGroups.map((group, index) => {
    const sceneIndex = timeline.scenes[index]?.sceneIndex ?? index;
    const scene = document.scenes[sceneIndex];
    const accentVars =
      scene === undefined
        ? ""
        : ` style="${sceneAccentStyle(resolveSceneAccentHex(scene, theme), theme)}"`;
    return `<div id="kakeai-scene-${sceneIndex}" class="kakeai-sceneclip"${accentVars}>${group.join("")}</div>`;
  });
}

export function compileDocument(options: CompileDocumentOptions): CompiledComposition {
  const { document, assetResolver, compositionResolver, faceSetResolver } = options;
  const theme =
    options.resolvedTheme ??
    (options.themeResolver ? options.themeResolver(document.visualTheme.id, document.visualTheme.version) : undefined) ??
    resolveVisualTheme(document);
  const timeline = resolveTimeline(document);
  const sceneById = new Map(document.scenes.map((scene) => [scene.id, scene]));

  const assetIds: string[] = [];
  const seenAssetIds = new Set<string>();
  const compositionVersions: CompositionVersionResolved[] = [];
  const seenCompositionVersionIds = new Set<string>();
  const sceneClipGroups: string[][] = [];
  const audios: string[] = [];
  const tweenLines: string[] = [];

  const trackAsset = (id: string): void => {
    if (!seenAssetIds.has(id)) {
      seenAssetIds.add(id);
      assetIds.push(id);
    }
  };

  const recordComposition = (resolved: CompositionVersionResolved): void => {
    if (!seenCompositionVersionIds.has(resolved.id)) {
      seenCompositionVersionIds.add(resolved.id);
      compositionVersions.push(resolved);
    }
  };

  const takeById = new Map(document.audioTakes.map((take) => [take.id, take]));
  const characterIdBySpeakerId = new Map(
    document.speakers.map((speaker) => [speaker.id, speaker.characterId]),
  );
  const bounces: BounceUnit[] = [];

  const resolveAudio = (
    assetId: string,
    path: (string | number)[],
  ): { url: string; durationMs: number | null } => {
    const resolved = assetResolver(assetId);
    if (resolved.kind !== "audio") {
      throw new CompositionCompileError([
        { path, code: "invalid_asset_kind", message: "音声素材を指定してください。" },
      ]);
    }
    trackAsset(assetId);
    return { url: resolved.url, durationMs: resolved.durationMs ?? null };
  };

  for (const placement of timeline.scenes) {
    const scene = sceneById.get(placement.sceneId);
    if (scene === undefined) {
      throw new CompositionCompileError([
        { path: ["scenes"], code: "unknown_scene", message: "シーンを解決できません。" },
      ]);
    }
    const startSec = toSecondsText(placement.startMs);
    const durationSec = toSecondsText(placement.durationMs);
    const sceneClips: string[] = [];
    const bgId = `kakeai-scene-${placement.sceneIndex}-bg`;
    const accentHex = resolveSceneAccentHex(scene, theme);
    const background = sceneBackground(accentHex, theme);
    sceneClips.push(
      `<section id="${bgId}" class="clip" data-start="${startSec}" data-duration="${durationSec}"><div id="${bgId}-body" class="kakeai-scenebg" style="background:${background}"></div></section>`,
    );

    const lineById = new Map(scene.lines.map((line) => [line.id, line]));
    const speakingIntervalsByCharacter = new Map<string, SpeakingInterval[]>();
    for (const linePlacement of placement.lines) {
      const line = lineById.get(linePlacement.lineId);
      if (line === undefined || line.speakerId === null) {
        continue;
      }
      const characterId = characterIdBySpeakerId.get(line.speakerId);
      if (characterId === null || characterId === undefined) {
        continue;
      }
      const intervals = speakingIntervalsByCharacter.get(characterId) ?? [];
      intervals.push({ startMs: linePlacement.startMs, endMs: linePlacement.endMs });
      speakingIntervalsByCharacter.set(characterId, intervals);
    }

    const emitCue = (cue: VisualCue, cueIndex: number): void => {
      const cuePath: (string | number)[] = ["scenes", placement.sceneIndex, "visualCues", cueIndex];
      const window = resolveCueWindow(placement, cue, cuePath);
      if (window === null) {
        return;
      }
      const span = window.endMs - window.startMs;
      const absStartMs = placement.startMs + window.startMs;
      const scope = cueScope(cue.id);
      const lineIntervals: LineInterval[] = placement.lines.map((linePlacement) => ({
        lineId: linePlacement.lineId,
        startMs: linePlacement.startMs - absStartMs,
        endMs: linePlacement.endMs - absStartMs,
      }));
      const context = makeContext(
        document,
        theme,
        assetResolver,
        scope,
        cuePath,
        faceSetResolver,
        {
          startMs: absStartMs,
          spanMs: span,
        },
        lineIntervals,
        compositionResolver,
        recordComposition,
      );
      const rendered = dispatchTemplate(
        `${cue.template.id}@${cue.template.version}`,
        cue.input,
        context,
        compositionResolver,
      );
      for (const assetId of rendered.assetIds) {
        trackAsset(assetId);
      }
      const childDurationMs = rendered.compositionVersion?.manifest.durationMs;
      const effectiveSpanMs =
        childDurationMs === undefined ? span : Math.min(span, childDurationMs);
      if (cueTransitionTotalMs(cue) > effectiveSpanMs) {
        throw new CompositionCompileError([
          {
            path: cuePath,
            code: "transition_range_overflow",
            message: compositionTransitionOverflowMessage(effectiveSpanMs),
          },
        ]);
      }
      const absEndMs = absStartMs + effectiveSpanMs;
      if (rendered.compositionVersion) {
        recordComposition(rendered.compositionVersion);
      }
      if (rendered.html.length === 0) {
        return;
      }
      const cueHtml = applyCueTiming(rendered.html, absStartMs, effectiveSpanMs);
      const clipId = scope.id("clip");
      const bodyId = scope.id("body");
      const compositionWindowAttr =
        childDurationMs === undefined
          ? ""
          : ` data-composition-duration-ms="${childDurationMs}"`;
      sceneClips.push(
        `<div id="${clipId}" class="clip" data-start="${toSecondsText(absStartMs)}" data-duration="${toSecondsText(effectiveSpanMs)}"${compositionWindowAttr}><div id="${bodyId}" class="kakeai-cuebody">${cueHtml}</div></div>`,
      );

      if (cue.transition.enter.durationMs > 0) {
        const vars = presetVars(cue.transition.enter.preset, "enter");
        if (vars !== null) {
          tweenLines.push(
            `tl.from(document.getElementById("${bodyId}"),{${vars},duration:${secondsText(cue.transition.enter.durationMs / 1000)},ease:"power1.out",immediateRender:false},${toSecondsText(absStartMs + FADE_START_EPSILON_MS)});`,
          );
        }
      }
      if (cue.transition.exit.durationMs > 0) {
        const vars = presetVars(cue.transition.exit.preset, "exit");
        if (vars !== null) {
          const exitStartMs = absEndMs - cue.transition.exit.durationMs;
          tweenLines.push(
            `tl.to(document.getElementById("${bodyId}"),{${vars},duration:${secondsText(cue.transition.exit.durationMs / 1000)},ease:"power1.in",immediateRender:false},${toSecondsText(exitStartMs)});`,
          );
        }
      }
      for (const stateLine of stateIntervalTweenLines(
        rendered.stateIntervals ?? [],
        absStartMs,
        effectiveSpanMs,
      )) {
        tweenLines.push(stateLine);
      }

      for (const item of rendered.animation) {
        if (item.durationMs <= 0) {
          continue;
        }
        const vars = actionVars(item.action, item.axis);
        if (vars !== null) {
          tweenLines.push(
            `tl.from(document.getElementById("${item.targetId}"),{${vars},duration:${secondsText(item.durationMs / 1000)},ease:"${actionEase(item.ease)}",immediateRender:false},${toSecondsText(absStartMs + item.startMs)});`,
          );
        }
      }

      for (const nested of rendered.nestedCompositionWindows ?? []) {
        if (nested.durationMs > 0 && nested.durationMs < span) {
          tweenLines.push(
            `tl.set(document.getElementById("${nested.targetId}"),{opacity:0},${toSecondsText(absStartMs + nested.durationMs)});`,
          );
        }
      }

      if (
        rendered.motionTargetId !== undefined &&
        cue.template.id === characterStandingV1.id &&
        cue.template.version === characterStandingV1.version
      ) {
        const parsed = characterStandingV1InputSchema.safeParse(cue.input);
        if (parsed.success) {
          const intervals = speakingIntervalsByCharacter.get(parsed.data.characterId);
          if (intervals !== undefined) {
            const cueStartMs = absStartMs;
            const cueEndMs = absEndMs;
            for (const interval of mergeIntervals(intervals)) {
              const startMs = Math.max(interval.startMs, cueStartMs);
              const endMs = Math.min(interval.endMs, cueEndMs);
              if (endMs > startMs) {
                bounces.push({ elementId: rendered.motionTargetId, startMs, endMs });
              }
            }
          }
        }
      }

      if (
        rendered.expressionTargets !== undefined &&
        rendered.expressionTargets.length > 0 &&
        cue.template.id === characterStandingV1.id &&
        cue.template.version === characterStandingV1.version
      ) {
        const parsed = characterStandingV1InputSchema.safeParse(cue.input);
        if (parsed.success) {
          const knownPresets = new Set(
            rendered.expressionTargets.map((target) => target.presetId),
          );
          const intervals = expressionIntervalsForCharacter(
            parsed.data.characterId,
            placement.lines,
            lineById,
            characterIdBySpeakerId,
            knownPresets,
            absStartMs,
            absEndMs,
          );
          for (const line of expressionTweenLines(rendered.expressionTargets, intervals)) {
            tweenLines.push(line);
          }
          const seedKey = `${cue.id}|${parsed.data.characterId}`;
          const hasBlink = rendered.expressionTargets.some(
            (target) => target.eyeBlinkId !== undefined,
          );
          const hasMouth = rendered.expressionTargets.some(
            (target) => target.mouthSpeakingId !== undefined,
          );
          const blinks =
            hasBlink && absEndMs > absStartMs
              ? blinkSchedule(seededRandom(`${seedKey}|blink`), absStartMs, absEndMs)
              : [];
          let mouths: FaceEvent[] = [];
          if (hasMouth) {
            const speaking = speakingIntervalsByCharacter.get(parsed.data.characterId) ?? [];
            const windows: FaceEvent[] = [];
            for (const interval of mergeIntervals(speaking)) {
              const startMs = Math.max(interval.startMs, absStartMs);
              const endMs = Math.min(interval.endMs, absEndMs);
              if (endMs > startMs) {
                windows.push({ startMs, endMs });
              }
            }
            mouths = mouthSchedule(seededRandom(`${seedKey}|mouth`), windows);
          }
          for (const line of faceVariantTweenLines(
            rendered.expressionTargets,
            intervals,
            blinks,
            mouths,
          )) {
            tweenLines.push(line);
          }
        }
      }
    };

    const orderedCues = scene.visualCues
      .map((cue, cueIndex) => ({ cue, cueIndex }))
      .sort(
        (a, b) =>
          LAYER_ORDER[a.cue.layer] - LAYER_ORDER[b.cue.layer] ||
          a.cue.order - b.cue.order ||
          a.cueIndex - b.cueIndex,
      );

    for (const { cue, cueIndex } of orderedCues) {
      if (LAYER_ORDER[cue.layer] <= LAYER_ORDER.standing) {
        emitCue(cue, cueIndex);
      }
    }

    placement.lines.forEach((linePlacement, lineIndex) => {
      const line = lineById.get(linePlacement.lineId);
      if (line === undefined) {
        throw new CompositionCompileError([
          {
            path: ["scenes", placement.sceneIndex, "lines", lineIndex],
            code: "unknown_line",
            message: "ラインを解決できません。",
          },
        ]);
      }
      const captionText = line.captionText.trim();
      if (captionText.length > 0) {
        const captionToken = theme.textRoles.caption;
        let fontFamily = THEME_FONT_STACKS[captionToken.font];
        if (captionToken.fontFace?.family) {
          fontFamily = `${escapeCssFontFamily(captionToken.fontFace.family)},${THEME_FONT_STACKS[captionToken.font]}`;
        }

        const captionSurface = theme.surfaces?.caption;
        let surfaceBgStyle = `background:${overlayToRgba(theme.scrim)}`;
        if (captionSurface?.enabled) {
          const { r, g, b } = hexToRgb(captionSurface.backgroundColor);
          const bg = `rgba(${r},${g},${b},${captionSurface.backgroundOpacity})`;
          const surfaceParts = [
            `background:${bg}`,
            `padding:${captionSurface.paddingVertical}px ${captionSurface.paddingHorizontal}px`,
            `border-radius:${captionSurface.borderRadius}px`,
          ];
          if (captionSurface.border) {
            surfaceParts.push(`border:${captionSurface.border.width}px solid ${captionSurface.border.color}`);
          }
          surfaceBgStyle = surfaceParts.join(";");
        }

        const captionStyle = [
          `font-family:${fontFamily}`,
          `font-size:${captionToken.fontSize}px`,
          `color:${captionToken.color}`,
          `line-height:${captionToken.lineHeight}`,
          `font-weight:${captionToken.decoration.bold ? "700" : "400"}`,
          `font-style:${captionToken.decoration.italic ? "italic" : "normal"}`,
          surfaceBgStyle,
        ].join(";");
        sceneClips.push(
          `<div id="kakeai-caption-${placement.sceneIndex}-${lineIndex}" class="clip" data-start="${toSecondsText(linePlacement.startMs)}" data-duration="${toSecondsText(linePlacement.durationMs)}"><div class="kakeai-caption"><p class="kakeai-captiontext" style="${captionStyle}">${escapeHtmlText(captionText)}</p></div></div>`,
        );
      }
      if (line.selectedAudioTakeId === null) {
        return;
      }
      const take = takeById.get(line.selectedAudioTakeId);
      if (take === undefined) {
        throw new CompositionCompileError([
          {
            path: ["scenes", placement.sceneIndex, "lines", lineIndex],
            code: "unknown_take",
            message: "音声テイクを解決できません。",
          },
        ]);
      }
      const audio = resolveAudio(take.assetId, [
        "audioTakes",
        document.audioTakes.indexOf(take),
        "assetId",
      ]);
      audios.push(
        audioElement({
          id: `kakeai-audio-take-${line.id}`,
          url: audio.url,
          startMs: linePlacement.startMs,
          durationMs: Math.min(
            audio.durationMs ?? linePlacement.durationMs,
            linePlacement.durationMs,
          ),
          volume: gainToVolume(0),
        }),
      );
    });

    for (const { cue, cueIndex } of orderedCues) {
      if (LAYER_ORDER[cue.layer] === LAYER_ORDER.overlay) {
        emitCue(cue, cueIndex);
      }
    }

    sceneClipGroups.push(sceneClips);
  }

  const clips = applySceneTransitions(document, theme, timeline, sceneClipGroups, tweenLines);

  const placementBySceneId = new Map(
    timeline.scenes.map((placement) => [placement.sceneId, placement]),
  );
  document.audioCues.forEach((cue, cueIndex) => {
    const cuePath: (string | number)[] = ["audioCues", cueIndex];
    const span =
      cue.range.kind === "work"
        ? { startMs: 0, endMs: timeline.totalDurationMs }
        : (() => {
            const placement = placementBySceneId.get(cue.range.sceneId);
            if (placement === undefined) {
              throw new CompositionCompileError([
                { path: cuePath, code: "unknown_scene", message: "シーンを解決できません。" },
              ]);
            }
            return { startMs: placement.startMs, endMs: placement.endMs };
          })();
    const audio = resolveAudio(cue.assetId, [...cuePath, "assetId"]);
    const elements = buildLoopAudios({
      idPrefix: `kakeai-audio-cue-${cue.id}`,
      url: audio.url,
      spanStartMs: span.startMs,
      spanEndMs: span.endMs,
      volume: gainToVolume(cue.gainDb),
      loop: cue.loop === true,
      sourceDurationMs: audio.durationMs,
      path: cuePath,
    });
    audios.push(...elements);
  });

  const bounceLines = bounces.flatMap(bounceTweenLines);

  const html = [
    "<!doctype html>",
    `<html lang="ja">`,
    "<head>",
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=${OUTPUT_WIDTH}, height=${OUTPUT_HEIGHT}">`,
    `<title>プレビュー</title>`,
    `<style>${STYLES}</style>`,
    "</head>",
    "<body>",
    `<div id="kakeai-root" data-composition-id="${COMPOSITION_ID}" data-width="${OUTPUT_WIDTH}" data-height="${OUTPUT_HEIGHT}" data-duration="${toSecondsText(timeline.totalDurationMs)}" data-fps="${OUTPUT_FPS}" style="${themeRootStyle(theme)}">`,
    ...clips,
    ...audios,
    "</div>",
    `<script>${getGsapBundleSource()}</script>`,
    "<script>",
    "const tl = gsap.timeline({ paused: true });",
    ...tweenLines,
    ...bounceLines,
    `window.__timelines["${COMPOSITION_ID}"] = tl;`,
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");

  return { html, assetIds, compositionVersions, durationMs: timeline.totalDurationMs };
}
