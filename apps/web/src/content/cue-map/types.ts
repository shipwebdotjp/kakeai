import type { CueMapActive } from "./geometry";
import {
  type Asset,
  type CueLayer,
  type PreviewTimeline,
} from "@kakeai/contracts";
import {
  type CharacterFormValue,
  type CueRangeKind,
  type SceneFormValue,
} from "../form";

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
  /** この Scene のレーン幅。Scene ごとに右詰めするための値。 */
  laneSpan: number;
  /** 表示可能レーンを超えた Cue の集約。超えていなければ null。 */
  aggregate: CueMapAggregate | null;
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
  markers: CueMapMarker[];
}
