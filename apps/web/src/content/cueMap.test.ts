import { describe, expect, it } from "vitest";
import type { Asset, PreviewTimeline } from "@kakeai/contracts";
import {
  buildCueMap,
  CUE_MAP_EMPTY_SCENE_ROWS,
  CUE_MAP_NO_ACTIVE,
  locatePlaybackActive,
  resolveVisibleLaneCount,
  targetIdToActive,
  type CueMapInput,
} from "./cueMap";
import {
  createCueFormValue,
  type CueFormValue,
  type LineFormValue,
  type SceneFormValue,
} from "./form";

function makeLine(id: string, captionText: string): LineFormValue {
  return {
    id,
    speakerId: null,
    captionText,
    speechText: "",
    selectedAudioTakeId: null,
    expressionId: null,
    takes: [],
  };
}

function makeScene(
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
  };
}

function makeCue(options: {
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

function makeAsset(id: string, kind: Asset["kind"]): Asset {
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
    tags: [],
    favoritedAt: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    contentUrl: `/content/${id}`,
  } as Asset;
}

function makeTimeline(
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

function baseInput(scenes: SceneFormValue[]): CueMapInput {
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
    expect(model.requiredLaneCount).toBe(3);
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
    expect(model.requiredLaneCount).toBe(1);
    expect(model.aggregate).toBeNull();
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
});

describe("buildCueMap standings and representative media", () => {
  it("includes configured standings as standing-layer bands", () => {
    const scenes = [makeScene("p1", "point", [makeLine("l1", "a")])];
    scenes[0]!.standings = [
      {
        cueId: "standing-cue-1",
        characterId: "char-1",
        appearanceId: "app-1",
        side: "left",
        scale: 1,
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
    ];
    const input: CueMapInput = {
      ...baseInput(scenes),
      characters: [
        {
          id: "char-1",
          name: "リン",
          voiceProfileId: null,
          voices: [],
          appearances: [
            {
              id: "app-1",
              assetId: "asset-image-1",
              expression: "normal",
              pose: "front",
              label: "",
              faceSetId: null,
            },
          ],
        },
      ],
      assets: [makeAsset("asset-image-1", "image")],
    };
    const model = buildCueMap(input);
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]).toMatchObject({
      cueId: "standing-cue-1",
      layer: "standing",
      isStanding: true,
      characterName: "リン",
      representativeAssetId: "asset-image-1",
      jumpTargetId: "scene-p1",
    });
  });

  it("resolves the representative asset from the first media field", () => {
    const cue = makeCue({
      sceneId: "p1",
      templateId: "media.card",
      templateVersion: 1,
      layer: "card",
      order: 0,
      rangeKind: "scene",
      fields: { assetId: "asset-video-1" },
    });
    const scenes = [makeScene("p1", "point", [makeLine("l1", "a")], [cue])];
    const input: CueMapInput = {
      ...baseInput(scenes),
      assets: [makeAsset("asset-video-1", "video")],
    };
    const model = buildCueMap(input);
    expect(model.bands[0]).toMatchObject({
      representativeAssetId: "asset-video-1",
      assetIds: ["asset-video-1"],
    });
  });

  it("leaves the representative empty when no media is referenced", () => {
    const cue = makeCue({
      sceneId: "p1",
      templateId: "text.block",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
      rangeKind: "scene",
    });
    const scenes = [makeScene("p1", "point", [makeLine("l1", "a")], [cue])];
    const model = buildCueMap(baseInput(scenes));
    expect(model.bands[0]).toMatchObject({ representativeAssetId: null, assetIds: [] });
  });
});

describe("resolveVisibleLaneCount", () => {
  it("derives lane counts from the pane width", () => {
    expect(resolveVisibleLaneCount(192)).toBe(1);
    expect(resolveVisibleLaneCount(288)).toBe(2);
    expect(resolveVisibleLaneCount(360)).toBe(4);
    expect(resolveVisibleLaneCount(2000)).toBeGreaterThan(4);
  });

  it("keeps at least one lane for narrow or invalid widths", () => {
    expect(resolveVisibleLaneCount(100)).toBe(1);
    expect(resolveVisibleLaneCount(0)).toBe(1);
    expect(resolveVisibleLaneCount(Number.NaN)).toBe(1);
  });
});

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
    const input = { ...baseInput(scenes), paneWidthPx: 288 };
    const model = buildCueMap(input);
    expect(model.requiredLaneCount).toBe(3);
    expect(model.visibleLaneCount).toBe(2);
    expect(model.aggregate).not.toBeNull();
    expect(model.aggregate!.lane).toBe(1);
    expect(model.aggregate!.entries).toHaveLength(2);
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]!.layer).toBe("overlay");
  });

  it("promotes an aggregated active cue into a visible lane", () => {
    const scenes = threeLaneScenes();
    const backgroundCueId = scenes[0]!.cues[0]!.id;
    const input: CueMapInput = {
      ...baseInput(scenes),
      paneWidthPx: 288,
      active: { sceneId: null, lineId: null, cueId: backgroundCueId },
    };
    const model = buildCueMap(input);
    const visibleIds = model.bands.map((band) => band.cueId);
    expect(visibleIds).toContain(backgroundCueId);
    expect(model.aggregate!.entries.map((entry) => entry.cueId)).not.toContain(
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
