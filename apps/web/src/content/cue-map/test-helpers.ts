import { describe, expect, it } from "vitest";
import type { Asset, PreviewTimeline } from "@kakeai/contracts";
import {
  buildCueMap,
  cueMapLaneOffsetRightPx,
  CUE_MAP_EMPTY_SCENE_ROWS,
  CUE_MAP_LANE_WIDTH_PX,
  CUE_MAP_MAX_LANES,
  CUE_MAP_NO_ACTIVE,
  locatePlaybackActive,
  resolveVisibleLaneCount,
  targetIdToActive,
  type CueMapInput,
} from "../cueMap";
import {
  createCueFormValue,
  type CueFormValue,
  type LineFormValue,
  type SceneFormValue,
} from "../form";


export function makeLine(id: string, captionText: string): LineFormValue {
  return {
    id,
    speakerId: null,
    captionText,
    speechText: "",
    selectedAudioTakeId: null,
    expressionId: null,
    gapBeforeMs: 0,
    takes: [],
  };
}

export function makeScene(
  id: string,
  kind: SceneFormValue["kind"],
  lines: LineFormValue[],
  cues: CueFormValue[] = [],
): SceneFormValue {
  return {
    id,
    kind,
    label: "",
    accentKind: "theme",
    accentToken: "primary",
    accentColor: "",
    timingMode: "auto",
    durationMs: 4000,
    transitionPreset: "cut",
    transitionDurationMs: 0,
    lines,
    cues,
    standings: [],
    audioCues: [],
    mainVisualCueId: "",
    embeddedAudio: true,
    embeddedAudioGainDb: 0,
  };
}

export function makeCue(options: {
  sceneId: string;
  templateId: string;
  templateVersion: number;
  layer: CueFormValue["layer"];
  order: number;
  rangeKind: CueFormValue["rangeKind"];
  startLineId?: string;
  endLineId?: string;
  startMs?: number;
  endMs?: number;
  fields?: Record<string, string>;
}): CueFormValue {
  const cue = createCueFormValue({
    sceneId: options.sceneId,
    templateId: options.templateId,
    templateVersion: options.templateVersion,
    layer: options.layer,
    order: options.order,
  });
  return {
    ...cue,
    rangeKind: options.rangeKind,
    startLineId: options.startLineId ?? "",
    endLineId: options.endLineId ?? "",
    startMs: options.startMs ?? 0,
    endMs: options.endMs ?? 0,
    fields: options.fields ?? cue.fields,
  };
}

export function makeAsset(id: string, kind: Asset["kind"]): Asset {
  return {
    id,
    kind,
    origin: "uploaded",
    status: "ready",
    originalFilename: `${id}.bin`,
    mediaType: "application/octet-stream",
    byteSize: 1,
    sha256: "sha",
    durationMs: null,
    widthPx: null,
    heightPx: null,
    hasAudio: false,
    tags: [],
    favoritedAt: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    contentUrl: `/content/${id}`,
  } as Asset;
}

export function makeTimeline(
  scenes: {
    sceneId: string;
    startMs: number;
    durationMs: number;
    lines: { lineId: string; startMs: number; durationMs: number }[];
  }[],
): PreviewTimeline {
  return {
    totalDurationMs: scenes.reduce(
      (total, scene) => Math.max(total, scene.startMs + scene.durationMs),
      0,
    ),
    fps: 30,
    scenes: scenes.map((scene) => ({ ...scene, cues: [] })),
  };
}

export function baseInput(scenes: SceneFormValue[]): CueMapInput {
  const labels = new Map(scenes.map((scene) => [scene.id, `label-${scene.id}`]));
  return {
    scenes,
    characters: [],
    assets: [],
    sceneLabels: labels,
    timeline: undefined,
    timelineReady: false,
    paneWidthPx: 2000,
    active: { ...CUE_MAP_NO_ACTIVE },
  };
}

