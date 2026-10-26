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

describe("buildCueMap draw order and lanes", () => {
  function simultaneousScenes(): SceneFormValue[] {
    const lines = [makeLine("l1", "a"), makeLine("l2", "b")];
    return [
      makeScene("p1", "point", lines, [
        makeCue({
          sceneId: "p1",
          templateId: "media.full-bleed",
          templateVersion: 1,
          layer: "background",
          order: 0,
          rangeKind: "scene",
        }),
        makeCue({
          sceneId: "p1",
          templateId: "media.card",
          templateVersion: 1,
          layer: "card",
          order: 0,
          rangeKind: "scene",
        }),
        makeCue({
          sceneId: "p1",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 0,
          rangeKind: "scene",
        }),
      ]),
    ];
  }

  it("places front layers on left lanes and back layers on right lanes", () => {
    const model = buildCueMap(baseInput(simultaneousScenes()));
    const laneByLayer = new Map(model.bands.map((band) => [band.layer, band.lane]));
    expect(laneByLayer.get("overlay")).toBe(0);
    expect(laneByLayer.get("card")).toBe(1);
    expect(laneByLayer.get("background")).toBe(2);
    expect(model.rails[0]!.laneSpan).toBe(3);
  });

  it("reuses one lane for cues that never overlap", () => {
    const scenes = [
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b"), makeLine("l3", "c")], [
        makeCue({
          sceneId: "p1",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 0,
          rangeKind: "lines",
          startLineId: "l1",
          endLineId: "l1",
        }),
        makeCue({
          sceneId: "p1",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 1,
          rangeKind: "lines",
          startLineId: "l3",
          endLineId: "l3",
        }),
      ]),
    ];
    const model = buildCueMap(baseInput(scenes));
    expect(model.bands.map((band) => band.lane)).toEqual([0, 0]);
    expect(model.rails[0]!.laneSpan).toBe(1);
    expect(model.rails[0]!.aggregate).toBeNull();
  });

  it("resets lanes per scene and right-aligns each scene's lanes", () => {
    const threeLaneCues = [
      makeCue({
        sceneId: "p1",
        templateId: "media.full-bleed",
        templateVersion: 1,
        layer: "background",
        order: 0,
        rangeKind: "scene",
      }),
      makeCue({
        sceneId: "p1",
        templateId: "media.card",
        templateVersion: 1,
        layer: "card",
        order: 0,
        rangeKind: "scene",
      }),
      makeCue({
        sceneId: "p1",
        templateId: "text.block",
        templateVersion: 1,
        layer: "overlay",
        order: 0,
        rangeKind: "scene",
      }),
    ];
    const singleCue = makeCue({
      sceneId: "p2",
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 0,
      rangeKind: "scene",
    });
    const scenes = [
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], threeLaneCues),
      makeScene("p2", "point", [makeLine("l3", "c")], [singleCue]),
    ];
    const model = buildCueMap(baseInput(scenes));

    expect(model.rails.map((rail) => [rail.sceneId, rail.laneSpan])).toEqual([
      ["p1", 3],
      ["p2", 1],
    ]);

    const p1Background = model.bands.find(
      (band) => band.sceneId === "p1" && band.layer === "background",
    )!;
    const p2Background = model.bands.find((band) => band.sceneId === "p2")!;
    expect(p1Background.lane).toBe(2);
    expect(p2Background.lane).toBe(0);
    expect(cueMapLaneOffsetRightPx(p1Background.lane, 3)).toBe(0);
    expect(cueMapLaneOffsetRightPx(p2Background.lane, 1)).toBe(0);
  });

  it("aggregates overflow within a scene without widening other scenes", () => {
    const scenes = [
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], [
        makeCue({
          sceneId: "p1",
          templateId: "media.full-bleed",
          templateVersion: 1,
          layer: "background",
          order: 0,
          rangeKind: "scene",
        }),
        makeCue({
          sceneId: "p1",
          templateId: "media.card",
          templateVersion: 1,
          layer: "card",
          order: 0,
          rangeKind: "scene",
        }),
        makeCue({
          sceneId: "p1",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 0,
          rangeKind: "scene",
        }),
      ]),
      makeScene("p2", "point", [makeLine("l3", "c")], [
        makeCue({
          sceneId: "p2",
          templateId: "media.full-bleed",
          templateVersion: 1,
          layer: "background",
          order: 0,
          rangeKind: "scene",
        }),
      ]),
    ];
    const input = { ...baseInput(scenes), paneWidthPx: 150 };
    const model = buildCueMap(input);

    expect(model.rails[0]!.laneSpan).toBe(2);
    expect(model.rails[0]!.aggregate).not.toBeNull();
    expect(model.rails[0]!.aggregate!.entries).toHaveLength(2);
    expect(model.rails[1]!.laneSpan).toBe(1);
    expect(model.rails[1]!.aggregate).toBeNull();
    expect(model.bands.find((band) => band.sceneId === "p2")!.lane).toBe(0);
  });

  it("stabilizes order ties by scene and input order", () => {
    const scenes = [
      makeScene("p1", "point", [makeLine("l1", "a")], [
        makeCue({
          sceneId: "p1",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 0,
          rangeKind: "scene",
        }),
        makeCue({
          sceneId: "p1",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 0,
          rangeKind: "scene",
        }),
      ]),
    ];
    const model = buildCueMap(baseInput(scenes));
    expect(model.bands.map((band) => band.lane)).toEqual([1, 0]);
    expect(model.bands[0]!.cueId).toBe(scenes[0]!.cues[0]!.id);
    expect(model.bands[1]!.cueId).toBe(scenes[0]!.cues[1]!.id);
  });
});

