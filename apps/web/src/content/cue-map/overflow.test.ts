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

describe("buildCueMap overflow and promotion", () => {
  function threeLaneScenes(): SceneFormValue[] {
    return [
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
    ];
  }

  it("aggregates overflowing cues into one right-end lane", () => {
    const scenes = threeLaneScenes();
    const input = { ...baseInput(scenes), paneWidthPx: 150 };
    const model = buildCueMap(input);
    expect(model.rails[0]!.laneSpan).toBe(2);
    expect(model.rails[0]!.aggregate).not.toBeNull();
    expect(model.rails[0]!.aggregate!.lane).toBe(1);
    expect(model.rails[0]!.aggregate!.entries).toHaveLength(2);
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]!.layer).toBe("overlay");
  });

  it("promotes an aggregated active cue into a visible lane", () => {
    const scenes = threeLaneScenes();
    const backgroundCueId = scenes[0]!.cues[0]!.id;
    const input: CueMapInput = {
      ...baseInput(scenes),
      paneWidthPx: 150,
      active: { sceneId: null, lineId: null, cueId: backgroundCueId },
    };
    const model = buildCueMap(input);
    const visibleIds = model.bands.map((band) => band.cueId);
    expect(visibleIds).toContain(backgroundCueId);
    expect(model.rails[0]!.aggregate!.entries.map((entry) => entry.cueId)).not.toContain(
      backgroundCueId,
    );
    expect(model.bands.find((band) => band.cueId === backgroundCueId)!.active).toBe(true);
    for (let a = 0; a < model.bands.length; a += 1) {
      for (let b = a + 1; b < model.bands.length; b += 1) {
        const first = model.bands[a]!;
        const second = model.bands[b]!;
        if (first.lane === second.lane) {
          expect(first.startRow > second.endRow || second.startRow > first.endRow).toBe(true);
        }
      }
    }
  });

  it("marks bands active from the active line", () => {
    const scenes = threeLaneScenes();
    const input: CueMapInput = {
      ...baseInput(scenes),
      active: { sceneId: null, lineId: "l1", cueId: null },
    };
    const model = buildCueMap(input);
    expect(model.bands.every((band) => band.active)).toBe(true);
  });
});

describe("active helpers", () => {
  it("maps element target ids to active selections", () => {
    expect(targetIdToActive("cue-abc")).toEqual({
      sceneId: null,
      lineId: null,
      cueId: "abc",
    });
    expect(targetIdToActive("line-abc")).toEqual({
      sceneId: null,
      lineId: "abc",
      cueId: null,
    });
    expect(targetIdToActive("scene-abc")).toEqual({
      sceneId: "abc",
      lineId: null,
      cueId: null,
    });
    expect(targetIdToActive(null)).toEqual({ ...CUE_MAP_NO_ACTIVE });
  });

  it("locates the scene and line containing the playback time", () => {
    const timeline = makeTimeline([
      {
        sceneId: "s1",
        startMs: 0,
        durationMs: 1000,
        lines: [{ lineId: "l1", startMs: 0, durationMs: 1000 }],
      },
      {
        sceneId: "s2",
        startMs: 1000,
        durationMs: 1000,
        lines: [{ lineId: "l2", startMs: 1000, durationMs: 1000 }],
      },
    ]);
    expect(locatePlaybackActive(timeline, 500)).toEqual({
      sceneId: "s1",
      lineId: "l1",
      cueId: null,
    });
    expect(locatePlaybackActive(timeline, 1500)).toEqual({
      sceneId: "s2",
      lineId: "l2",
      cueId: null,
    });
    expect(locatePlaybackActive(timeline, 5000)).toEqual({ ...CUE_MAP_NO_ACTIVE });
    expect(locatePlaybackActive(undefined, 100)).toEqual({ ...CUE_MAP_NO_ACTIVE });
  });
});
