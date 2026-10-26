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

import { makeLine, makeScene, makeCue, makeAsset, makeTimeline, baseInput } from "./test-helpers";

describe("buildCueMap rows and rails", () => {
  it("lays out scenes as one continuous map with boundaries and empty-scene blocks", () => {
    const scenes = [
      makeScene("intro", "intro", []),
      makeScene("point-1", "point", [makeLine("l1", "one"), makeLine("l2", "two")]),
      makeScene("outro", "outro", []),
    ];
    const model = buildCueMap(baseInput(scenes));
    expect(model.rows.map((row) => row.kind)).toEqual([
      ...Array<string>(CUE_MAP_EMPTY_SCENE_ROWS).fill("sceneBlock"),
      "line",
      "line",
      ...Array<string>(CUE_MAP_EMPTY_SCENE_ROWS).fill("sceneBlock"),
    ]);
    expect(model.rails.map((rail) => [rail.sceneId, rail.startRow, rail.endRow])).toEqual([
      ["intro", 0, CUE_MAP_EMPTY_SCENE_ROWS - 1],
      ["point-1", CUE_MAP_EMPTY_SCENE_ROWS, CUE_MAP_EMPTY_SCENE_ROWS + 1],
      ["outro", CUE_MAP_EMPTY_SCENE_ROWS + 2, CUE_MAP_EMPTY_SCENE_ROWS * 2 + 1],
    ]);
  });

  it("numbers point lines as pointOrdinal.lineOrdinal", () => {
    const scenes = [
      makeScene("intro", "intro", []),
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")]),
      makeScene("p2", "point", [makeLine("l3", "c")]),
    ];
    const model = buildCueMap(baseInput(scenes));
    expect(
      model.rows.filter((row) => row.kind === "line").map((row) => row.displayNumber),
    ).toEqual(["1.1", "1.2", "2.1"]);
  });

  it("keeps caption heads on line rows", () => {
    const scenes = [makeScene("p1", "point", [makeLine("l1", "hello\nworld")])];
    const model = buildCueMap(baseInput(scenes));
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({
      kind: "line",
      lineId: "l1",
      displayNumber: "1.1",
      captionHead: "hello",
    });
  });
});

describe("buildCueMap scene and lines ranges", () => {
  it("spans scene cues over the whole scene block", () => {
    const cue = makeCue({
      sceneId: "p1",
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 0,
      rangeKind: "scene",
    });
    const scenes = [makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], [cue])];
    const model = buildCueMap(baseInput(scenes));
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]).toMatchObject({
      cueId: cue.id,
      startRow: 0,
      endRow: 1,
      lane: 0,
      jumpTargetId: `cue-${cue.id}`,
    });
    expect(model.bands[0]!.jumpSeek).toEqual({ kind: "cue", id: cue.id });
  });

  it("spans lines cues from start to end line rows", () => {
    const cue = makeCue({
      sceneId: "p1",
      templateId: "text.block",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
      rangeKind: "lines",
      startLineId: "l1",
      endLineId: "l2",
    });
    const scenes = [
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b"), makeLine("l3", "c")], [
        cue,
      ]),
    ];
    const model = buildCueMap(baseInput(scenes));
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]).toMatchObject({ startRow: 0, endRow: 1 });
    expect(model.bands[0]!.rangeDetail).toEqual({
      kind: "lines",
      startNumber: "1.1",
      endNumber: "1.2",
    });
  });

  it("falls back to the scene span when line references are unresolved", () => {
    const cue = makeCue({
      sceneId: "p1",
      templateId: "text.block",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
      rangeKind: "lines",
      startLineId: "missing",
      endLineId: "l2",
    });
    const scenes = [makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], [cue])];
    const model = buildCueMap(baseInput(scenes));
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]).toMatchObject({ startRow: 0, endRow: 1, spanFallback: true });
  });
});

