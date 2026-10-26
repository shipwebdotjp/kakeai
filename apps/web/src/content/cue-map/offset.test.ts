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

describe("buildCueMap offset ranges", () => {
  const scenes = () => [
    makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], [
      makeCue({
        sceneId: "p1",
        templateId: "media.card",
        templateVersion: 1,
        layer: "card",
        order: 0,
        rangeKind: "offset",
        startMs: 100,
        endMs: 900,
      }),
    ]),
  ];
  const timeline = () =>
    makeTimeline([
      {
        sceneId: "p1",
        startMs: 1000,
        durationMs: 2000,
        lines: [
          { lineId: "l1", startMs: 1000, durationMs: 1000 },
          { lineId: "l2", startMs: 2000, durationMs: 1000 },
        ],
      },
    ]);

  it("places offset bands on rows intersecting the resolved window", () => {
    const input = { ...baseInput(scenes()), timeline: timeline(), timelineReady: true };
    const model = buildCueMap(input);
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]).toMatchObject({ startRow: 0, endRow: 0 });
    expect(model.markers).toHaveLength(0);
  });

  it("falls back to a scene-rail marker when the timeline is not ready", () => {
    const input = { ...baseInput(scenes()), timeline: timeline(), timelineReady: false };
    const model = buildCueMap(input);
    expect(model.bands).toHaveLength(0);
    expect(model.markers).toHaveLength(1);
    expect(model.markers[0]).toMatchObject({ sceneId: "p1", railRow: 0, rangeKind: "offset" });
  });

  it("staggers multiple markers of one scene so each stays reachable", () => {
    const scenes = [
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], [
        makeCue({
          sceneId: "p1",
          templateId: "media.card",
          templateVersion: 1,
          layer: "card",
          order: 0,
          rangeKind: "offset",
          startMs: 0,
          endMs: 100,
        }),
        makeCue({
          sceneId: "p1",
          templateId: "media.card",
          templateVersion: 1,
          layer: "card",
          order: 1,
          rangeKind: "offset",
          startMs: 200,
          endMs: 300,
        }),
      ]),
    ];
    const model = buildCueMap(baseInput(scenes));
    expect(model.markers).toHaveLength(2);
    expect(model.markers.map((marker) => marker.railRow)).toEqual([0, 1]);
  });

  it("falls back to a marker when the scene is missing from the timeline", () => {
    const input = {
      ...baseInput(scenes()),
      timeline: makeTimeline([]),
      timelineReady: true,
    };
    const model = buildCueMap(input);
    expect(model.bands).toHaveLength(0);
    expect(model.markers).toHaveLength(1);
  });

  it("falls back to a marker for an empty offset window", () => {
    const empty = [
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], [
        makeCue({
          sceneId: "p1",
          templateId: "media.card",
          templateVersion: 1,
          layer: "card",
          order: 0,
          rangeKind: "offset",
          startMs: 500,
          endMs: 500,
        }),
      ]),
    ];
    const input = {
      ...baseInput(empty),
      timeline: makeTimeline([
        {
          sceneId: "p1",
          startMs: 1000,
          durationMs: 2000,
          lines: [
            { lineId: "l1", startMs: 1000, durationMs: 1000 },
            { lineId: "l2", startMs: 2000, durationMs: 1000 },
          ],
        },
      ]),
      timelineReady: true,
    };
    const model = buildCueMap(input);
    expect(model.bands).toHaveLength(0);
    expect(model.markers).toHaveLength(1);
    expect(model.markers[0]).toMatchObject({ sceneId: "p1", rangeKind: "offset" });
  });

  it("falls back to a marker when the resolved window hits no rows", () => {
    const gapped = [
      makeScene("p1", "point", [makeLine("l1", "a"), makeLine("l2", "b")], [
        makeCue({
          sceneId: "p1",
          templateId: "media.card",
          templateVersion: 1,
          layer: "card",
          order: 0,
          rangeKind: "offset",
          startMs: 0,
          endMs: 100,
        }),
      ]),
    ];
    const input = {
      ...baseInput(gapped),
      timeline: makeTimeline([
        {
          sceneId: "p1",
          startMs: 1000,
          durationMs: 2000,
          lines: [
            { lineId: "l1", startMs: 1500, durationMs: 400 },
            { lineId: "l2", startMs: 2000, durationMs: 400 },
          ],
        },
      ]),
      timelineReady: true,
    };
    const model = buildCueMap(input);
    expect(model.bands).toHaveLength(0);
    expect(model.markers).toHaveLength(1);
    expect(model.markers[0]).toMatchObject({ sceneId: "p1", railRow: 0, rangeKind: "offset" });
  });
});

