import { type CueLayer, type PreviewTimeline } from "@kakeai/contracts";

export const CUE_MAP_ROW_HEIGHT_PX = 32;
export const CUE_MAP_LANE_WIDTH_PX = 30;
export const CUE_MAP_RAIL_WIDTH_PX = 22;
export const CUE_MAP_NUMBER_WIDTH_PX = 44;
export const CUE_MAP_MARKER_WIDTH_PX = 24;
export const CUE_MAP_GAPS_PX = 22;
export const CUE_MAP_MAX_LANES = 6;
export const CUE_MAP_EMPTY_SCENE_ROWS = 3;

export const CUE_LAYERS_IN_DRAW_ORDER: readonly CueLayer[] = [
  "background",
  "card",
  "standing",
  "overlay",
];

export interface CueMapActive {
  sceneId: string | null;
  lineId: string | null;
  cueId: string | null;
}

export const CUE_MAP_NO_ACTIVE: CueMapActive = {
  sceneId: null,
  lineId: null,
  cueId: null,
};

export function targetIdToActive(targetId: string | null): CueMapActive {
  if (targetId === null) {
    return { ...CUE_MAP_NO_ACTIVE };
  }
  if (targetId.startsWith("cue-")) {
    return {
      sceneId: null,
      lineId: null,
      cueId: targetId.slice("cue-".length),
    };
  }
  if (targetId.startsWith("line-")) {
    return {
      sceneId: null,
      lineId: targetId.slice("line-".length),
      cueId: null,
    };
  }
  if (targetId.startsWith("scene-")) {
    return {
      sceneId: targetId.slice("scene-".length),
      lineId: null,
      cueId: null,
    };
  }
  return { ...CUE_MAP_NO_ACTIVE };
}

export function locatePlaybackActive(
  timeline: PreviewTimeline | undefined,
  nowMs: number,
): CueMapActive {
  if (timeline === undefined) {
    return { ...CUE_MAP_NO_ACTIVE };
  }
  for (const scene of timeline.scenes) {
    if (nowMs < scene.startMs || nowMs >= scene.startMs + scene.durationMs) {
      continue;
    }
    let lineId: string | null = null;
    for (const line of scene.lines) {
      if (nowMs >= line.startMs && nowMs < line.startMs + line.durationMs) {
        lineId = line.lineId;
        break;
      }
    }
    return { sceneId: scene.sceneId, lineId, cueId: null };
  }
  return { ...CUE_MAP_NO_ACTIVE };
}

export function resolveVisibleLaneCount(paneWidthPx: number): number {
  if (!Number.isFinite(paneWidthPx) || paneWidthPx <= 0) {
    return 1;
  }
  const reserved =
    CUE_MAP_RAIL_WIDTH_PX + CUE_MAP_NUMBER_WIDTH_PX + CUE_MAP_GAPS_PX;
  return Math.min(
    CUE_MAP_MAX_LANES,
    Math.max(1, Math.floor((paneWidthPx - reserved) / CUE_MAP_LANE_WIDTH_PX)),
  );
}

/**
 * レーンはペイン右端を基準に並べる。lane 0 が最も前面で、右端（最大lane）が最も奥。
 */
export function cueMapLaneOffsetRightPx(
  lane: number,
  laneSpan: number,
): number {
  return Math.max(0, laneSpan - 1 - lane) * CUE_MAP_LANE_WIDTH_PX;
}
