import { secondsText, setTweenLine, toSecondsText } from "./animation";
import { type NarrationSegment } from "@kakeai/contracts";
import type { ExpressionTarget } from "../render-context";
import { type LinePlacement } from "../timeline";

const BOUNCE_AMPLITUDE_PX = 20;
const BOUNCE_PERIOD_SEC = 1.6;
const BOUNCE_MIN_INTERVAL_SEC = 0.12;

export interface SpeakingInterval {
  startMs: number;
  endMs: number;
}

export interface BounceUnit {
  elementId: string;
  startMs: number;
  endMs: number;
}

export function mergeIntervals(
  intervals: SpeakingInterval[],
): SpeakingInterval[] {
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

export function bounceTweenLines(unit: BounceUnit): string[] {
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

export interface ExpressionInterval {
  presetId: string;
  startMs: number;
  endMs: number;
}

export function expressionIntervalsForCharacter(
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
      filled.push({
        presetId: "normal",
        startMs: cursor,
        endMs: interval.startMs,
      });
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

export function expressionTweenLines(
  targets: readonly ExpressionTarget[],
  intervals: readonly ExpressionInterval[],
): string[] {
  const lines: string[] = [];
  const setLine = (
    target: ExpressionTarget,
    visible: boolean,
    startMs: number,
  ): void => {
    lines.push(
      setTweenLine(target.elementId, { opacity: visible ? 1 : 0 }, startMs),
    );
  };
  let previous: string | null = null;
  for (const interval of intervals) {
    if (previous === null) {
      for (const target of targets) {
        setLine(
          target,
          target.presetId === interval.presetId,
          interval.startMs,
        );
      }
    } else if (previous !== interval.presetId) {
      const leaving = targets.find((target) => target.presetId === previous);
      const entering = targets.find(
        (target) => target.presetId === interval.presetId,
      );
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

export interface FaceEvent {
  startMs: number;
  endMs: number;
}

export function blinkSchedule(
  random: () => number,
  startMs: number,
  endMs: number,
): FaceEvent[] {
  const events: FaceEvent[] = [];
  let cursor = startMs + 800 + random() * 2200;
  while (cursor < endMs) {
    const durationMs =
      BLINK_DURATION_MIN_MS +
      random() * (BLINK_DURATION_MAX_MS - BLINK_DURATION_MIN_MS);
    const eventEndMs = Math.min(cursor + durationMs, endMs);
    if (eventEndMs - cursor >= MIN_FACE_EVENT_MS) {
      events.push({
        startMs: Math.round(cursor),
        endMs: Math.round(eventEndMs),
      });
    }
    cursor =
      eventEndMs +
      BLINK_GAP_MIN_MS +
      random() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS);
  }
  return events;
}

export function mouthSchedule(
  random: () => number,
  windows: readonly FaceEvent[],
): FaceEvent[] {
  const events: FaceEvent[] = [];
  for (const window of windows) {
    let cursor = window.startMs + random() * MOUTH_CLOSED_MAX_MS;
    while (cursor < window.endMs) {
      const openMs =
        MOUTH_OPEN_MIN_MS + random() * (MOUTH_OPEN_MAX_MS - MOUTH_OPEN_MIN_MS);
      const openEndMs = Math.min(cursor + openMs, window.endMs);
      if (openEndMs - cursor >= MIN_FACE_EVENT_MS) {
        events.push({
          startMs: Math.round(cursor),
          endMs: Math.round(openEndMs),
        });
      }
      cursor =
        openEndMs +
        MOUTH_CLOSED_MIN_MS +
        random() * (MOUTH_CLOSED_MAX_MS - MOUTH_CLOSED_MIN_MS);
    }
  }
  return events;
}

function activePresetAt(
  intervals: readonly ExpressionInterval[],
  timeMs: number,
): string {
  for (const interval of intervals) {
    if (timeMs >= interval.startMs && timeMs < interval.endMs) {
      return interval.presetId;
    }
  }
  return "normal";
}

export function faceVariantTweenLines(
  targets: readonly ExpressionTarget[],
  intervals: readonly ExpressionInterval[],
  blinks: readonly FaceEvent[],
  mouths: readonly FaceEvent[],
): string[] {
  const byPreset = new Map(targets.map((target) => [target.presetId, target]));
  const lines: string[] = [];
  const setLine = (
    elementId: string,
    visible: boolean,
    startMs: number,
  ): void => {
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
