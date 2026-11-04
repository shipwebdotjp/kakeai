export { mulberry32, seededRandom } from "./random";

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

/**
 * Deterministic blink events for a standing character. The renderer and the
 * Face Set preview share these distributions so the preview shows the same
 * kind of idle motion without tying it to a cue seed.
 */
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

/** Deterministic mouth-flap events inside each speaking window. */
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
