import {
  characterStandingV1,
  mediaCardV1,
  mediaFullBleedV1,
  textBodyV1,
  textTitleV1,
} from "@kakeai/contracts";
import type { ContentDocument, Scene, VisualCue } from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";
import { getGsapBundleSource } from "./gsap-bundle";
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./meta";
import type { AssetResolver } from "./resolver";
import { resolveTimeline, type ScenePlacement } from "./timeline";
import { renderTextTitle } from "./templates/text-title";
import { renderTextBody } from "./templates/text-body";
import { renderMediaFullBleed } from "./templates/media-full-bleed";
import { renderMediaCard } from "./templates/media-card";
import { renderCharacterStanding } from "./templates/character-standing";

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

interface CueWindow {
  startMs: number;
  endMs: number;
}

interface FadeUnit {
  bodyId: string;
  atSec: number;
  durationSec: number;
}

export function toSecondsText(ms: number): string {
  const seconds = ms / 1000;
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }
  return String(Math.round(seconds * 1000) / 1000);
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

function renderCueInner(
  cue: VisualCue,
  cuePath: (string | number)[],
  document: ContentDocument,
  assetResolver: AssetResolver,
  mediaElementId: string,
): { html: string; assetIds: string[] } {
  const key = templateKey(cue);
  const inputPath = [...cuePath, "input"];
  switch (key) {
    case `${textTitleV1.id}@${textTitleV1.version}`:
      return { html: renderTextTitle(cue.input, inputPath), assetIds: [] };
    case `${textBodyV1.id}@${textBodyV1.version}`:
      return { html: renderTextBody(cue.input, inputPath), assetIds: [] };
    case `${mediaFullBleedV1.id}@${mediaFullBleedV1.version}`:
      return renderMediaFullBleed(cue.input, inputPath, assetResolver, mediaElementId);
    case `${mediaCardV1.id}@${mediaCardV1.version}`:
      return renderMediaCard(cue.input, inputPath, assetResolver, mediaElementId);
    case `${characterStandingV1.id}@${characterStandingV1.version}`:
      return renderCharacterStanding(cue.input, inputPath, document, assetResolver, mediaElementId);
    default:
      throw new CompositionCompileError([
        {
          path: [...cuePath, "template"],
          code: "unknown_template",
          message: `未対応のVisualTemplateです: ${key}`,
        },
      ]);
  }
}

function resolveCueWindow(
  placement: ScenePlacement,
  cue: VisualCue,
  cuePath: (string | number)[],
): CueWindow | null {
  switch (cue.range.kind) {
    case "scene":
      return { startMs: 0, endMs: placement.durationMs };
    case "offset": {
      const startMs = Math.max(0, cue.range.startMs);
      const endMs = Math.min(placement.durationMs, cue.range.endMs);
      return startMs < endMs ? { startMs, endMs } : null;
    }
    case "lines": {
      const byId = new Map(placement.lines.map((line) => [line.lineId, line]));
      const start = byId.get(cue.range.startLineId);
      const end = byId.get(cue.range.endLineId);
      if (start === undefined || end === undefined) {
        throw new CompositionCompileError([
          { path: cuePath, code: "unresolvable_range", message: "表示区間を解決できません。" },
        ]);
      }
      const startMs = start.startMs - placement.startMs;
      const endMs = end.endMs - placement.startMs;
      if (endMs <= startMs) {
        throw new CompositionCompileError([
          { path: cuePath, code: "unresolvable_range", message: "表示区間を解決できません。" },
        ]);
      }
      return { startMs, endMs };
    }
    default:
      throw new CompositionCompileError([
        { path: cuePath, code: "unresolvable_range", message: "表示区間を解決できません。" },
      ]);
  }
}

function fadeDurationSec(windowSec: number): number {
  return Math.min(0.35, windowSec / 2);
}

function templateKey(cue: VisualCue): string {
  return `${cue.template.id}@${cue.template.version}`;
}

function cueLayerRank(cue: VisualCue): number {
  if (cue.template.id === mediaFullBleedV1.id) {
    return 0;
  }
  if (cue.template.id === mediaCardV1.id) {
    return 1;
  }
  return 2;
}

const FADE_START_EPSILON_SEC = 0.001;

function fadeAtSec(startMs: number): number {
  return startMs / 1000 + FADE_START_EPSILON_SEC;
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
  ".kakeai-cuebody{position:absolute;inset:0;}",
  ".kakeai-fullbleed{position:absolute;inset:0;width:100%;height:100%;}",
  ".kakeai-card{position:absolute;inset:0;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:90px 160px;box-sizing:border-box;}",
  ".kakeai-cardmedia{width:100%;max-height:640px;object-fit:cover;border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.5);}",
  ".kakeai-cardtext{margin:0;background:rgba(0,0,0,.55);border-radius:16px;padding:28px 48px;max-width:1400px;}",
  ".kakeai-cardheading{margin:0;font-size:56px;font-weight:700;line-height:1.4;}",
  ".kakeai-cardcaption{margin:12px 0 0;font-size:34px;line-height:1.7;}",
  ".kakeai-standing{position:absolute;transform:translate(-50%,-50%);height:auto;filter:drop-shadow(0 12px 32px rgba(0,0,0,.5));}",
].join("\n");

export function compileDocument(options: CompileDocumentOptions): CompiledComposition {
  const { document, assetResolver } = options;
  const timeline = resolveTimeline(document);
  const sceneById = new Map(document.scenes.map((scene) => [scene.id, scene]));

  const assetIds: string[] = [];
  const seenAssetIds = new Set<string>();
  const clips: string[] = [];
  const fades: FadeUnit[] = [];

  const trackAsset = (id: string): void => {
    if (!seenAssetIds.has(id)) {
      seenAssetIds.add(id);
      assetIds.push(id);
    }
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

    const orderedCues = scene.visualCues
      .map((cue, cueIndex) => ({ cue, cueIndex }))
      .sort((a, b) => cueLayerRank(a.cue) - cueLayerRank(b.cue) || a.cueIndex - b.cueIndex);
    for (const { cue, cueIndex } of orderedCues) {
      const cuePath: (string | number)[] = ["scenes", placement.sceneIndex, "visualCues", cueIndex];
      const window = resolveCueWindow(placement, cue, cuePath);
      if (window === null) {
        continue;
      }
      const absoluteStartMs = placement.startMs + window.startMs;
      const cueDurationMs = window.endMs - window.startMs;
      const clipId = `kakeai-cue-${placement.sceneIndex}-${cueIndex}`;
      const mediaId = `${clipId}-media`;
      const rendered = renderCueInner(cue, cuePath, document, assetResolver, mediaId);
      for (const assetId of rendered.assetIds) {
        trackAsset(assetId);
      }
      clips.push(
        `<div id="${clipId}" class="clip" data-start="${toSecondsText(absoluteStartMs)}" data-duration="${toSecondsText(cueDurationMs)}"><div id="${clipId}-body" class="kakeai-cuebody">${rendered.html}</div></div>`,
      );
      fades.push({
        bodyId: `${clipId}-body`,
        atSec: fadeAtSec(absoluteStartMs),
        durationSec: fadeDurationSec(cueDurationMs / 1000),
      });
    }

    const slotHtml = renderSceneSlot(scene, placement.sceneIndex);
    clips.push(
      `<section id="${slotId}" class="clip" data-start="${startSec}" data-duration="${durationSec}"><div id="${slotId}-body" class="kakeai-slotframe">${slotHtml}</div></section>`,
    );
    fades.push({
      bodyId: `${slotId}-body`,
      atSec: fadeAtSec(placement.startMs),
      durationSec: fadeDurationSec(placement.durationMs / 1000),
    });
  }

  const tweenLines = fades.map(
    (fade) =>
      `tl.from(document.getElementById("${fade.bodyId}"),{opacity:0,duration:${fade.durationSec},ease:"power1.out",immediateRender:false},${fade.atSec});`,
  );

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
    "</div>",
    `<script>${getGsapBundleSource()}</script>`,
    "<script>",
    "const tl = gsap.timeline({ paused: true });",
    ...tweenLines,
    `window.__timelines["${COMPOSITION_ID}"] = tl;`,
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");

  return { html, assetIds, durationMs: timeline.totalDurationMs };
}
