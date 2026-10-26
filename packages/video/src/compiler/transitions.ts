import { secondsText, toSecondsText } from "./animation";
import {
  type ContentDocument,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { GATE_SEGMENT_ATTRIBUTE } from "../video-playback";
import { resolveSceneAccentHex, sceneAccentStyle } from "../theme";
import {
  COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_CODE,
  COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_MESSAGE,
  compositionClipReachesSceneEnd,
  compositionCrossfadeExceedsChild,
  sceneTransitionOf,
  sceneTransitionOverflowIssue,
  type ResolvedTimeline,
} from "../timeline";

function addClipDurationMs(html: string, extraMs: number): string {
  return html.replace(/<[^>]+>/g, (tag) => {
    if (
      tag.includes("data-kakeai-loop-segment=") &&
      !tag.includes("data-kakeai-loop-segment-last=")
    ) {
      return tag;
    }
    if (tag.includes(`${GATE_SEGMENT_ATTRIBUTE}=`)) {
      return tag;
    }
    return tag.replace(
      /data-duration="([0-9.]+)"/g,
      (_match, value: string) => {
        const totalMs = Math.round(Number(value) * 1000) + extraMs;
        return `data-duration="${toSecondsText(totalMs)}"`;
      },
    );
  });
}

function clipEndsAtSceneEnd(html: string, sceneEndMs: number): boolean {
  const start = html.match(/data-start="([0-9.]+)"/);
  const duration = html.match(/data-duration="([0-9.]+)"/);
  if (start === null || duration === null) {
    return false;
  }
  const endMs =
    Math.round(Number(start[1]) * 1000) +
    Math.round(Number(duration[1]) * 1000);
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
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(spanMs) ||
    !Number.isFinite(childMs)
  ) {
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

export function applySceneTransitions(
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
    const scene =
      placement === undefined
        ? undefined
        : document.scenes[placement.sceneIndex];
    if (
      scene === undefined ||
      placement === undefined ||
      previous === undefined
    ) {
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
        if (
          clip.includes("kakeai-caption") ||
          !clipEndsAtSceneEnd(clip, previousEndMs)
        ) {
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
