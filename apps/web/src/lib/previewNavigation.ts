import type { PreviewTimeline } from "@kakeai/contracts";
import { normalizeOutputFps } from "./player";

export function sceneStartTimesSeconds(timeline: PreviewTimeline): number[] {
  return timeline.scenes.map((scene) => scene.startMs / 1000);
}

export function lineStartTimesSeconds(timeline: PreviewTimeline): number[] {
  return timeline.scenes.flatMap((scene) => scene.lines.map((line) => line.startMs / 1000));
}

export function sceneStartSeconds(
  timeline: PreviewTimeline,
  sceneId: string,
): number | null {
  const scene = timeline.scenes.find((entry) => entry.sceneId === sceneId);
  return scene === undefined ? null : scene.startMs / 1000;
}

export function lineStartSeconds(timeline: PreviewTimeline, lineId: string): number | null {
  for (const scene of timeline.scenes) {
    const line = scene.lines.find((entry) => entry.lineId === lineId);
    if (line !== undefined) {
      return line.startMs / 1000;
    }
  }
  return null;
}

export function cueStartSeconds(timeline: PreviewTimeline, cueId: string): number | null {
  for (const scene of timeline.scenes) {
    const cue = scene.cues.find((entry) => entry.cueId === cueId);
    if (cue !== undefined) {
      return cue.startMs / 1000;
    }
  }
  return null;
}

export function nextTime(times: number[], current: number, direction: 1 | -1): number | null {
  if (direction === 1) {
    return times.find((value) => value > current + 0.001) ?? null;
  }
  for (let index = times.length - 1; index >= 0; index -= 1) {
    if (times[index]! < current - 0.001) {
      return times[index]!;
    }
  }
  return null;
}

export function adjacentStartSeconds(
  timeline: PreviewTimeline,
  currentSeconds: number,
  target: "line" | "scene",
  direction: 1 | -1,
): number | null {
  const times =
    target === "line" ? lineStartTimesSeconds(timeline) : sceneStartTimesSeconds(timeline);
  const probe =
    direction === -1 ? currentSeconds - 1 / normalizeOutputFps(timeline.fps) : currentSeconds;
  return nextTime(times, probe, direction);
}

export type PreviewKeyAction =
  | { kind: "toggle-play" }
  | { kind: "step-seconds"; seconds: number }
  | { kind: "frame-step"; frames: 1 | -1 }
  | { kind: "line"; direction: 1 | -1 }
  | { kind: "scene"; direction: 1 | -1 };

export interface PreviewKeyEvent {
  key: string;
  shiftKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

const EDITABLE_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY", "A"]);

export function previewKeyAction(
  event: PreviewKeyEvent,
  stepSeconds: number,
): PreviewKeyAction | null {
  const target = event.target;
  if (target === null) {
    return null;
  }
  if (target.isContentEditable === true) {
    return null;
  }
  if (typeof target.tagName === "string" && EDITABLE_TAGS.has(target.tagName.toUpperCase())) {
    return null;
  }
  if (event.key === " " || event.key === "Spacebar") {
    return { kind: "toggle-play" };
  }
  if (event.key === "ArrowLeft") {
    return event.shiftKey ? { kind: "frame-step", frames: -1 } : { kind: "step-seconds", seconds: -stepSeconds };
  }
  if (event.key === "ArrowRight") {
    return event.shiftKey ? { kind: "frame-step", frames: 1 } : { kind: "step-seconds", seconds: stepSeconds };
  }
  const lower = event.key.toLowerCase();
  if (lower === "j") {
    return event.shiftKey ? { kind: "scene", direction: -1 } : { kind: "line", direction: -1 };
  }
  if (lower === "l") {
    return event.shiftKey ? { kind: "scene", direction: 1 } : { kind: "line", direction: 1 };
  }
  return null;
}
