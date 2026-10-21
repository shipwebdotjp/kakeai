import {
  characterStandingV1,
  getVisualTemplate,
  type Asset,
  type CueLayer,
  type PreviewTimeline,
} from "@kakeai/contracts";
import {
  lineCaptionText,
  type CharacterFormValue,
  type CueFormValue,
  type CueRangeKind,
  type LineFormValue,
  type SceneFormValue,
} from "./form";

export const CUE_MAP_ROW_HEIGHT_PX = 32;
export const CUE_MAP_LANE_WIDTH_PX = 30;
export const CUE_MAP_RAIL_WIDTH_PX = 22;
export const CUE_MAP_NUMBER_WIDTH_PX = 44;
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
    return { sceneId: null, lineId: null, cueId: targetId.slice("cue-".length) };
  }
  if (targetId.startsWith("line-")) {
    return { sceneId: null, lineId: targetId.slice("line-".length), cueId: null };
  }
  if (targetId.startsWith("scene-")) {
    return { sceneId: targetId.slice("scene-".length), lineId: null, cueId: null };
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
export function cueMapLaneOffsetRightPx(lane: number, laneSpan: number): number {
  return Math.max(0, laneSpan - 1 - lane) * CUE_MAP_LANE_WIDTH_PX;
}

export interface CueMapInput {
  scenes: SceneFormValue[];
  characters: CharacterFormValue[];
  assets: Asset[];
  sceneLabels: ReadonlyMap<string, string>;
  timeline: PreviewTimeline | undefined;
  timelineReady: boolean;
  paneWidthPx: number;
  active: CueMapActive;
}

export interface CueMapRow {
  index: number;
  sceneId: string;
  sceneIndex: number;
  kind: "line" | "sceneBlock";
  lineId: string | null;
  displayNumber: string | null;
  captionHead: string;
}

export interface CueMapSceneRail {
  sceneId: string;
  sceneIndex: number;
  kind: SceneFormValue["kind"];
  label: string;
  startRow: number;
  endRow: number;
}

export type CueMapRangeDetail =
  | { kind: "scene" }
  | { kind: "lines"; startNumber: string; endNumber: string }
  | { kind: "offset"; startMs: number; endMs: number };

export type CueMapSeek =
  | { kind: "scene"; id: string }
  | { kind: "cue"; id: string }
  | { kind: "line"; id: string };

export interface CueMapCueInfo {
  cueId: string;
  sceneId: string;
  sceneIndex: number;
  templateId: string;
  templateVersion: number;
  templateLabel: string;
  layer: CueLayer;
  order: number;
  rangeKind: CueRangeKind;
  rangeDetail: CueMapRangeDetail;
  spanFallback: boolean;
  isStanding: boolean;
  characterName: string | null;
  representativeAssetId: string | null;
  assetIds: string[];
  jumpTargetId: string;
  jumpSeek: CueMapSeek;
  active: boolean;
}

export interface CueMapBandPlacement extends CueMapCueInfo {
  startRow: number;
  endRow: number;
  lane: number;
}

export interface CueMapAggregateEntry extends CueMapCueInfo {}

export interface CueMapAggregate {
  lane: number;
  entries: CueMapAggregateEntry[];
}

export interface CueMapMarker extends CueMapCueInfo {
  railRow: number;
}

export interface CueMapModel {
  rows: CueMapRow[];
  rails: CueMapSceneRail[];
  bands: CueMapBandPlacement[];
  aggregate: CueMapAggregate | null;
  markers: CueMapMarker[];
  requiredLaneCount: number;
  visibleLaneCount: number;
}

interface CueSpanInput {
  inputIndex: number;
  cueId: string;
  sceneId: string;
  sceneIndex: number;
  templateId: string;
  templateVersion: number;
  templateLabel: string;
  layer: CueLayer;
  order: number;
  rangeKind: CueRangeKind;
  rangeDetail: CueMapRangeDetail;
  spanFallback: boolean;
  isStanding: boolean;
  characterName: string | null;
  representativeAssetId: string | null;
  assetIds: string[];
  jumpTargetId: string;
  jumpSeek: CueMapSeek;
  startLineId: string;
  endLineId: string;
  startMs: number;
  endMs: number;
}

interface CueSpan extends CueSpanInput {
  startRow: number;
  endRow: number;
}

function captionHeadOf(line: LineFormValue): string {
  const firstLine = (line.captionText.split("\n")[0] ?? "").trim();
  return lineCaptionText({ ...line, captionText: firstLine });
}

function layerRank(layer: CueLayer): number {
  const rank = CUE_LAYERS_IN_DRAW_ORDER.indexOf(layer);
  return rank === -1 ? CUE_LAYERS_IN_DRAW_ORDER.length : rank;
}

function mediaAssetIdsOf(cue: CueFormValue): string[] {
  const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
  const fields = definition?.inputFields ?? [];
  const ids: string[] = [];
  for (const field of fields) {
    if (field.kind !== "media" && field.kind !== "nestedMedia") {
      continue;
    }
    const assetId = (cue.fields[field.key] ?? "").trim();
    if (assetId.length > 0 && !ids.includes(assetId)) {
      ids.push(assetId);
    }
  }
  return ids;
}

function representativeOf(
  assetIds: string[],
  assetById: ReadonlyMap<string, Asset>,
): string | null {
  for (const assetId of assetIds) {
    const asset = assetById.get(assetId);
    if (asset !== undefined && (asset.kind === "image" || asset.kind === "video")) {
      return assetId;
    }
  }
  return null;
}

function lineDisplayNumber(
  scene: SceneFormValue,
  pointOrdinal: number,
  lineIndex: number,
): string {
  return scene.kind === "point"
    ? `${pointOrdinal}.${lineIndex + 1}`
    : `${lineIndex + 1}`;
}

function formCueRangeDetail(
  scene: SceneFormValue,
  cue: CueFormValue,
  pointOrdinal: number,
): CueMapRangeDetail {
  if (cue.rangeKind === "offset") {
    return { kind: "offset", startMs: cue.startMs, endMs: cue.endMs };
  }
  if (cue.rangeKind !== "lines") {
    return { kind: "scene" };
  }
  const indexById = new Map(scene.lines.map((line, index) => [line.id, index]));
  const start = indexById.get(cue.startLineId);
  const end = indexById.get(cue.endLineId);
  if (start === undefined || end === undefined) {
    return { kind: "scene" };
  }
  return {
    kind: "lines",
    startNumber: lineDisplayNumber(scene, pointOrdinal, Math.min(start, end)),
    endNumber: lineDisplayNumber(scene, pointOrdinal, Math.max(start, end)),
  };
}

function collectSpanInputs(
  scenes: SceneFormValue[],
  characters: CharacterFormValue[],
  assetById: ReadonlyMap<string, Asset>,
  pointOrdinalBySceneId: ReadonlyMap<string, number>,
): CueSpanInput[] {
  const inputs: CueSpanInput[] = [];
  scenes.forEach((scene, sceneIndex) => {
    scene.cues.forEach((cue) => {
      const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
      const assetIds = mediaAssetIdsOf(cue);
      inputs.push({
        inputIndex: inputs.length,
        cueId: cue.id,
        sceneId: scene.id,
        sceneIndex,
        templateId: cue.templateId,
        templateVersion: cue.templateVersion,
        templateLabel: definition?.display.label ?? cue.templateId,
        layer: cue.layer,
        order: cue.order,
        rangeKind: cue.rangeKind,
        rangeDetail: formCueRangeDetail(scene, cue, pointOrdinalBySceneId.get(scene.id) ?? 0),
        spanFallback: false,
        isStanding: false,
        characterName: null,
        representativeAssetId: representativeOf(assetIds, assetById),
        assetIds,
        jumpTargetId: `cue-${cue.id}`,
        jumpSeek: { kind: "cue", id: cue.id },
        startLineId: cue.startLineId,
        endLineId: cue.endLineId,
        startMs: cue.startMs,
        endMs: cue.endMs,
      });
    });
    scene.standings.forEach((standing) => {
      if (standing.characterId === null) {
        return;
      }
      const character = characters.find((entry) => entry.id === standing.characterId);
      const appearance = character?.appearances.find(
        (entry) => entry.id === standing.appearanceId,
      );
      const assetId = appearance?.assetId ?? null;
      const assetIds = assetId === null || assetId.length === 0 ? [] : [assetId];
      const cueId = standing.cueId ?? `standing-${scene.id}-${standing.side}`;
      inputs.push({
        inputIndex: inputs.length,
        cueId,
        sceneId: scene.id,
        sceneIndex,
        templateId: characterStandingV1.id,
        templateVersion: characterStandingV1.version,
        templateLabel: characterStandingV1.display.label,
        layer: "standing",
        order: sceneIndex,
        rangeKind: "scene",
        rangeDetail: { kind: "scene" },
        spanFallback: false,
        isStanding: true,
        characterName: character?.name?.trim() ? character.name.trim() : null,
        representativeAssetId: representativeOf(assetIds, assetById),
        assetIds,
        jumpTargetId: `scene-${scene.id}`,
        jumpSeek: { kind: "scene", id: scene.id },
        startLineId: "",
        endLineId: "",
        startMs: 0,
        endMs: 0,
      });
    });
  });
  return inputs;
}

function rowsOverlap(
  a: { startRow: number; endRow: number },
  b: { startRow: number; endRow: number },
): boolean {
  return a.startRow <= b.endRow && b.startRow <= a.endRow;
}

function compareDrawOrder(a: CueSpanInput, b: CueSpanInput): number {
  return (
    layerRank(a.layer) - layerRank(b.layer) ||
    a.order - b.order ||
    a.sceneIndex - b.sceneIndex ||
    a.inputIndex - b.inputIndex
  );
}

function assignLanes(spans: readonly CueSpan[]): number[] {
  const lanes: number[] = new Array(spans.length).fill(0);
  const occupants: CueSpan[][] = [];
  spans.forEach((span, index) => {
    let lane = 0;
    while (
      lane < occupants.length &&
      (occupants[lane] ?? []).some((other) => rowsOverlap(span, other))
    ) {
      lane += 1;
    }
    if (lane === occupants.length) {
      occupants.push([]);
    }
    occupants[lane]!.push(span);
    lanes[index] = lane;
  });
  return lanes;
}

function isActiveBand(
  band: { cueId: string; sceneId: string; startRow: number; endRow: number },
  active: CueMapActive,
  lineRowById: ReadonlyMap<string, number>,
): boolean {
  if (active.cueId !== null) {
    return band.cueId === active.cueId;
  }
  if (active.lineId !== null) {
    const row = lineRowById.get(active.lineId);
    return row !== undefined && band.startRow <= row && row <= band.endRow;
  }
  if (active.sceneId !== null) {
    return band.sceneId === active.sceneId;
  }
  return false;
}

function toPlacement(
  entry: CueSpan,
  lane: number,
  active: boolean,
): CueMapBandPlacement {
  return {
    cueId: entry.cueId,
    sceneId: entry.sceneId,
    sceneIndex: entry.sceneIndex,
    templateId: entry.templateId,
    templateVersion: entry.templateVersion,
    templateLabel: entry.templateLabel,
    layer: entry.layer,
    order: entry.order,
    rangeKind: entry.rangeKind,
    rangeDetail: entry.rangeDetail,
    spanFallback: entry.spanFallback,
    isStanding: entry.isStanding,
    characterName: entry.characterName,
    representativeAssetId: entry.representativeAssetId,
    assetIds: entry.assetIds,
    jumpTargetId: entry.jumpTargetId,
    jumpSeek: entry.jumpSeek,
    active,
    startRow: entry.startRow,
    endRow: entry.endRow,
    lane,
  };
}

function toAggregateEntry(entry: CueSpan, active: boolean): CueMapAggregateEntry {
  return {
    cueId: entry.cueId,
    sceneId: entry.sceneId,
    sceneIndex: entry.sceneIndex,
    templateId: entry.templateId,
    templateVersion: entry.templateVersion,
    templateLabel: entry.templateLabel,
    layer: entry.layer,
    order: entry.order,
    rangeKind: entry.rangeKind,
    rangeDetail: entry.rangeDetail,
    spanFallback: entry.spanFallback,
    isStanding: entry.isStanding,
    characterName: entry.characterName,
    representativeAssetId: entry.representativeAssetId,
    assetIds: entry.assetIds,
    jumpTargetId: entry.jumpTargetId,
    jumpSeek: entry.jumpSeek,
    active,
  };
}

function promoteActive(
  ordered: CueSpan[],
  visible: CueMapBandPlacement[],
  aggregated: CueSpan[],
  aggregateLane: number,
  isActive: (band: CueSpan) => boolean,
): void {
  const promoted = aggregated.filter(isActive).sort(compareDrawOrder);
  for (const candidate of promoted) {
    const occupants = visible.filter((band) => band.lane === aggregateLane);
    const blocked = occupants.some((band) => band.active && rowsOverlap(band, candidate));
    if (blocked) {
      continue;
    }
    const demotedIds = new Set(
      occupants
        .filter((band) => !band.active && rowsOverlap(band, candidate))
        .map((band) => band.cueId),
    );
    const demoted = ordered.filter((band) => demotedIds.has(band.cueId));
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      if (demotedIds.has(visible[index]!.cueId)) {
        visible.splice(index, 1);
      }
    }
    visible.push(toPlacement(candidate, aggregateLane, true));
    aggregated.push(...demoted);
    const candidateIndex = aggregated.findIndex((band) => band.cueId === candidate.cueId);
    if (candidateIndex !== -1) {
      aggregated.splice(candidateIndex, 1);
    }
  }
}

export function buildCueMap(input: CueMapInput): CueMapModel {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const rows: CueMapRow[] = [];
  const rails: CueMapSceneRail[] = [];
  const lineRowById = new Map<string, number>();
  const pointOrdinalBySceneId = new Map<string, number>();
  let pointOrdinal = 0;
  input.scenes.forEach((scene, sceneIndex) => {
    if (scene.kind === "point") {
      pointOrdinal += 1;
    }
    pointOrdinalBySceneId.set(scene.id, pointOrdinal);
    const startRow = rows.length;
    if (scene.lines.length === 0) {
      for (let block = 0; block < CUE_MAP_EMPTY_SCENE_ROWS; block += 1) {
        rows.push({
          index: rows.length,
          sceneId: scene.id,
          sceneIndex,
          kind: "sceneBlock",
          lineId: null,
          displayNumber: null,
          captionHead: "",
        });
      }
    } else {
      scene.lines.forEach((line, lineIndex) => {
        lineRowById.set(line.id, rows.length);
        rows.push({
          index: rows.length,
          sceneId: scene.id,
          sceneIndex,
          kind: "line",
          lineId: line.id,
          displayNumber: lineDisplayNumber(scene, pointOrdinal, lineIndex),
          captionHead: captionHeadOf(line),
        });
      });
    }
    rails.push({
      sceneId: scene.id,
      sceneIndex,
      kind: scene.kind,
      label: input.sceneLabels.get(scene.id) ?? scene.id,
      startRow,
      endRow: rows.length - 1,
    });
  });
  const railBySceneId = new Map(rails.map((rail) => [rail.sceneId, rail]));
  const timelineSceneById = new Map(
    (input.timeline?.scenes ?? []).map((scene) => [scene.sceneId, scene]),
  );

  const spanInputs = collectSpanInputs(
    input.scenes,
    input.characters,
    assetById,
    pointOrdinalBySceneId,
  );
  const bands: CueSpan[] = [];
  const markers: CueSpanInput[] = [];
  for (const entry of spanInputs) {
    const rail = railBySceneId.get(entry.sceneId);
    if (rail === undefined) {
      continue;
    }
    if (entry.rangeKind === "scene") {
      bands.push({ ...entry, startRow: rail.startRow, endRow: rail.endRow });
      continue;
    }
    if (entry.rangeKind === "lines") {
      const start = lineRowById.get(entry.startLineId);
      const end = lineRowById.get(entry.endLineId);
      const scene = input.scenes[entry.sceneIndex];
      if (start === undefined || end === undefined || scene?.id !== entry.sceneId) {
        bands.push({
          ...entry,
          spanFallback: true,
          startRow: rail.startRow,
          endRow: rail.endRow,
        });
        continue;
      }
      bands.push({
        ...entry,
        startRow: Math.min(start, end),
        endRow: Math.max(start, end),
      });
      continue;
    }
    const placement = input.timelineReady ? timelineSceneById.get(entry.sceneId) : undefined;
    if (placement === undefined) {
      markers.push(entry);
      continue;
    }
    const windowStart = placement.startMs + entry.startMs;
    const windowEnd = placement.startMs + entry.endMs;
    const hitRows: number[] = [];
    for (const line of placement.lines) {
      const lineStart = line.startMs;
      const lineEnd = line.startMs + line.durationMs;
      if (lineStart < windowEnd && windowStart < lineEnd) {
        const row = lineRowById.get(line.lineId);
        if (row !== undefined) {
          hitRows.push(row);
        }
      }
    }
    if (hitRows.length === 0) {
      markers.push(entry);
      continue;
    }
    bands.push({
      ...entry,
      startRow: Math.min(...hitRows),
      endRow: Math.max(...hitRows),
    });
  }

  const ordered = [...bands].sort(compareDrawOrder);
  const frontFirst = [...ordered].sort((a, b) => compareDrawOrder(b, a));
  const assigned = assignLanes(frontFirst);
  const laneByCueId = new Map(
    frontFirst.map((band, index) => [band.cueId, assigned[index]!]),
  );
  const laneOf = (band: CueSpan): number => laneByCueId.get(band.cueId) ?? 0;
  const requiredLaneCount =
    ordered.length === 0 ? 0 : Math.max(...laneByCueId.values()) + 1;
  const visibleLaneCount = resolveVisibleLaneCount(input.paneWidthPx);
  const isActive = (band: CueSpan): boolean => isActiveBand(band, input.active, lineRowById);
  const markerIndexByScene = new Map<string, number>();
  const toMarker = (entry: CueSpanInput): CueMapMarker => {
    const rail = railBySceneId.get(entry.sceneId);
    const startRow = rail?.startRow ?? 0;
    const endRow = rail?.endRow ?? startRow;
    const index = markerIndexByScene.get(entry.sceneId) ?? 0;
    markerIndexByScene.set(entry.sceneId, index + 1);
    return {
      ...toAggregateEntry(
        { ...entry, startRow: 0, endRow: 0 },
        isActiveBand(
          { cueId: entry.cueId, sceneId: entry.sceneId, startRow, endRow },
          input.active,
          lineRowById,
        ),
      ),
      railRow: Math.min(startRow + index, endRow),
    };
  };

  if (requiredLaneCount <= visibleLaneCount) {
    return {
      rows,
      rails,
      bands: ordered.map((band) => toPlacement(band, laneOf(band), isActive(band))),
      aggregate: null,
      markers: markers.map(toMarker),
      requiredLaneCount,
      visibleLaneCount,
    };
  }

  const aggregateLane = Math.max(0, visibleLaneCount - 1);
  const visible: CueMapBandPlacement[] = [];
  const aggregated: CueSpan[] = [];
  ordered.forEach((band) => {
    if (laneOf(band) < aggregateLane) {
      visible.push(toPlacement(band, laneOf(band), isActive(band)));
    } else {
      aggregated.push(band);
    }
  });

  if (visibleLaneCount > 1) {
    promoteActive(ordered, visible, aggregated, aggregateLane, isActive);
  }

  aggregated.sort(compareDrawOrder);
  visible.sort((a, b) => a.lane - b.lane || a.startRow - b.startRow);

  return {
    rows,
    rails,
    bands: visible,
    aggregate: {
      lane: aggregateLane,
      entries: aggregated.map((band) => toAggregateEntry(band, isActive(band))),
    },
    markers: markers.map(toMarker),
    requiredLaneCount,
    visibleLaneCount,
  };
}
