import {
  characterStandingV1,
  characterStandingV2,
  characterStandingV2InputSchema,
  mediaCardV1,
  mediaFullBleedV1,
  sceneDeviceFrameV1,
  sceneDeviceFrameV2,
  deviceFrameInputSchema,
  deviceFrameV2InputSchema,
  textBodyV1,
  textTitleV1,
  type AnimationPreset,
  type ContentDocument,
  type CueLayer,
  type NestedVisual,
  type Scene,
  type VisualCue,
} from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";
import { escapeHtmlAttribute, escapeHtmlText } from "./escape";
import { getGsapBundleSource } from "./gsap-bundle";
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./meta";
import type { AssetResolver } from "./resolver";
import { cueScope, type RenderScope } from "./scope";
import type { RenderedCue, RenderContext } from "./render-context";
import { cueTransitionTotalMs, resolveCueWindow, resolveTimeline, type ScenePlacement } from "./timeline";
import { renderTextTitle } from "./templates/text-title";
import { renderTextBody } from "./templates/text-body";
import { renderMediaFullBleed } from "./templates/media-full-bleed";
import { renderMediaCard } from "./templates/media-card";
import {
  renderCharacterStandingV1,
  renderCharacterStandingV2,
} from "./templates/character-standing";
import { renderDeviceFrame } from "./templates/device-frame";
import { focalPointStyle, resolveCueMedia } from "./templates/shared";

export const COMPOSITION_ID = "kakeai-main";

export interface CompileDocumentOptions {
  document: ContentDocument;
  assetResolver: AssetResolver;
}

export interface CompiledComposition {
  html: string;
  assetIds: string[];
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

function shade(hex: string, factor: number): string {
  const channel = (offset: number): number =>
    Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(offset, offset + 2), 16) * factor)));
  return `rgb(${channel(1)},${channel(3)},${channel(5)})`;
}

function renderSceneSlot(scene: Scene, sceneIndex: number): string {
  const path: (string | number)[] = ["scenes", sceneIndex, "slots"];
  switch (scene.kind) {
    case "intro":
      return renderTextTitle(
        { title: scene.slots.title, subtitle: scene.slots.subtitle, anchor: "center" },
        path,
      );
    case "point":
      return renderTextBody({ heading: scene.slots.heading, body: scene.slots.body }, path);
    case "outro":
      return renderTextTitle({ title: scene.slots.closing, subtitle: "" }, path);
    default:
      throw new CompositionCompileError([
        { path, code: "unknown_scene_kind", message: "未対応のSceneです。" },
      ]);
  }
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

function dispatchTemplate(
  key: string,
  input: unknown,
  context: RenderContext,
): RenderedCue {
  switch (key) {
    case `${textTitleV1.id}@${textTitleV1.version}`:
      return { html: renderTextTitle(input, context.path), assetIds: [], animation: [] };
    case `${textBodyV1.id}@${textBodyV1.version}`:
      return { html: renderTextBody(input, context.path), assetIds: [], animation: [] };
    case `${mediaFullBleedV1.id}@${mediaFullBleedV1.version}`:
      return renderMediaFullBleed(input, context);
    case `${mediaCardV1.id}@${mediaCardV1.version}`:
      return renderMediaCard(input, context);
    case `${characterStandingV1.id}@${characterStandingV1.version}`:
      return renderCharacterStandingV1(input, context);
    case `${characterStandingV2.id}@${characterStandingV2.version}`:
      return renderCharacterStandingV2(input, context);
    case `${sceneDeviceFrameV1.id}@${sceneDeviceFrameV1.version}`:
      return renderDeviceFrame(input, context, deviceFrameInputSchema);
    case `${sceneDeviceFrameV2.id}@${sceneDeviceFrameV2.version}`:
      return renderDeviceFrame(input, context, deviceFrameV2InputSchema);
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
  assetResolver: AssetResolver,
  scope: RenderScope,
  path: (string | number)[],
): RenderContext {
  const context: RenderContext = {
    document,
    assetResolver,
    scope,
    path,
    renderNested: (node, nestedScope, nestedPath) =>
      renderNestedVisual(node, makeContext(document, assetResolver, nestedScope, nestedPath)),
  };
  return context;
}

function renderNestedVisual(node: NestedVisual, context: RenderContext): RenderedCue {
  if (node.kind === "media") {
    return renderNestedMedia(node, context);
  }
  return dispatchTemplate(`${node.template.id}@${node.template.version}`, node.input, context);
}

const STYLES = [
  "html,body{margin:0;padding:0;background:#000;height:100%;}",
  "#kakeai-root{position:relative;width:100%;height:100%;overflow:hidden;background:#000;font-family:'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo',sans-serif;color:#fff;}",
  ".clip{position:absolute;inset:0;}",
  ".kakeai-scenebg{position:absolute;inset:0;}",
  ".kakeai-slotframe{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:120px 140px;box-sizing:border-box;}",
  ".kakeai-titlewrap{max-width:1500px;}",
  ".kakeai-title{margin:0;font-size:96px;font-weight:700;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 4px 24px rgba(0,0,0,.55);}",
  ".kakeai-subtitle{margin:24px 0 0;font-size:48px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 2px 16px rgba(0,0,0,.55);}",
  ".kakeai-bodywrap{max-width:1500px;}",
  ".kakeai-heading{margin:0 0 32px;font-size:72px;font-weight:700;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 4px 24px rgba(0,0,0,.55);}",
  ".kakeai-body{margin:0;font-size:42px;line-height:1.8;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 2px 16px rgba(0,0,0,.55);}",
  ".kakeai-cuebody{position:absolute;inset:0;transform-origin:center center;}",
  ".kakeai-fullbleed{position:absolute;inset:0;width:100%;height:100%;}",
  ".kakeai-card{position:absolute;inset:0;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:90px 160px;box-sizing:border-box;}",
  ".kakeai-cardmedia{width:100%;max-height:640px;object-fit:cover;border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.5);}",
  ".kakeai-cardtext{margin:0;background:rgba(0,0,0,.55);border-radius:16px;padding:28px 48px;max-width:1400px;}",
  ".kakeai-cardheading{margin:0;font-size:56px;font-weight:700;line-height:1.4;}",
  ".kakeai-cardcaption{margin:12px 0 0;font-size:34px;line-height:1.7;}",
  ".kakeai-standing{position:absolute;transform:translate(-50%,-50%);height:auto;filter:drop-shadow(0 12px 32px rgba(0,0,0,.5));}",
  ".kakeai-standingv2{position:absolute;transform:translate(-50%,-50%);}",
  ".kakeai-standingimg{display:block;height:auto;filter:drop-shadow(0 12px 32px rgba(0,0,0,.5));}",
  ".kakeai-nestedmedia{display:block;width:100%;height:100%;}",
  ".kakeai-deviceframe{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:80px;box-sizing:border-box;}",
  ".kakeai-deviceframe-screen{overflow:hidden;background:#000;box-shadow:0 24px 60px rgba(0,0,0,.55);}",
  ".kakeai-deviceframe-laptop .kakeai-deviceframe-screen{width:72%;aspect-ratio:16/9;border-radius:18px;border:24px solid #1f2937;}",
  ".kakeai-deviceframe-phone .kakeai-deviceframe-screen{width:30%;aspect-ratio:9/19.5;border-radius:36px;border:18px solid #1f2937;}",
  ".kakeai-caption{position:absolute;left:0;right:0;bottom:72px;display:flex;justify-content:center;padding:0 160px;box-sizing:border-box;}",
  ".kakeai-captiontext{margin:0;max-width:1600px;font-size:40px;line-height:1.5;white-space:pre-line;text-align:center;background:rgba(0,0,0,.55);border-radius:12px;padding:12px 36px;text-shadow:0 2px 12px rgba(0,0,0,.6);}",
].join("\n");

const FADE_START_EPSILON_MS = 1;
const MAX_LOOP_COPIES = 1000;
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

export function compileDocument(options: CompileDocumentOptions): CompiledComposition {
  const { document, assetResolver } = options;
  const timeline = resolveTimeline(document);
  const sceneById = new Map(document.scenes.map((scene) => [scene.id, scene]));

  const assetIds: string[] = [];
  const seenAssetIds = new Set<string>();
  const clips: string[] = [];
  const audios: string[] = [];
  const tweenLines: string[] = [];

  const trackAsset = (id: string): void => {
    if (!seenAssetIds.has(id)) {
      seenAssetIds.add(id);
      assetIds.push(id);
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
    const bgId = `kakeai-scene-${placement.sceneIndex}-bg`;
    const slotId = `kakeai-scene-${placement.sceneIndex}-slot`;
    const background = `linear-gradient(135deg, ${shade(scene.accentColor, 0.55)} 0%, ${shade(scene.accentColor, 0.22)} 100%)`;
    clips.push(
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
      if (cueTransitionTotalMs(cue) > span) {
        throw new CompositionCompileError([
          {
            path: cuePath,
            code: "transition_range_overflow",
            message: `transition の合計尺がCue範囲（${span}ms）を超えています。`,
          },
        ]);
      }
      const absStartMs = placement.startMs + window.startMs;
      const absEndMs = placement.startMs + window.endMs;
      const scope = cueScope(cue.id);
      const context = makeContext(document, assetResolver, scope, cuePath);
      const rendered = dispatchTemplate(
        `${cue.template.id}@${cue.template.version}`,
        cue.input,
        context,
      );
      for (const assetId of rendered.assetIds) {
        trackAsset(assetId);
      }
      const clipId = scope.id("clip");
      const bodyId = scope.id("body");
      clips.push(
        `<div id="${clipId}" class="clip" data-start="${toSecondsText(absStartMs)}" data-duration="${toSecondsText(span)}"><div id="${bodyId}" class="kakeai-cuebody">${rendered.html}</div></div>`,
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
      for (const item of rendered.animation) {
        if (item.durationMs <= 0) {
          continue;
        }
        const vars = presetVars(item.preset, "enter");
        if (vars !== null) {
          tweenLines.push(
            `tl.from(document.getElementById("${item.targetId}"),{${vars},duration:${secondsText(item.durationMs / 1000)},ease:"power1.out",immediateRender:false},${toSecondsText(absStartMs + item.startMs)});`,
          );
        }
      }

      if (
        rendered.motionTargetId !== undefined &&
        cue.template.id === characterStandingV2.id &&
        cue.template.version === characterStandingV2.version
      ) {
        const parsed = characterStandingV2InputSchema.safeParse(cue.input);
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

    const slotHtml = renderSceneSlot(scene, placement.sceneIndex);
    clips.push(
      `<section id="${slotId}" class="clip" data-start="${startSec}" data-duration="${durationSec}"><div id="${slotId}-body" class="kakeai-slotframe">${slotHtml}</div></section>`,
    );
    const slotFadeSec = Math.min(0.35, placement.durationMs / 2000);
    tweenLines.push(
      `tl.from(document.getElementById("${slotId}-body"),{opacity:0,duration:${slotFadeSec},ease:"power1.out",immediateRender:false},${toSecondsText(placement.startMs + FADE_START_EPSILON_MS)});`,
    );

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
        clips.push(
          `<div id="kakeai-caption-${placement.sceneIndex}-${lineIndex}" class="clip" data-start="${toSecondsText(linePlacement.startMs)}" data-duration="${toSecondsText(linePlacement.durationMs)}"><div class="kakeai-caption"><p class="kakeai-captiontext">${escapeHtmlText(captionText)}</p></div></div>`,
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
  }

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
    `<div id="kakeai-root" data-composition-id="${COMPOSITION_ID}" data-width="${OUTPUT_WIDTH}" data-height="${OUTPUT_HEIGHT}" data-duration="${toSecondsText(timeline.totalDurationMs)}" data-fps="${OUTPUT_FPS}">`,
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

  return { html, assetIds, durationMs: timeline.totalDurationMs };
}
