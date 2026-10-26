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
        edge: "margin",
        vertical: "standard",
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
          names: [],
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
  it("derives lane counts from the pane width and caps them", () => {
    expect(resolveVisibleLaneCount(192)).toBe(3);
    expect(resolveVisibleLaneCount(256)).toBe(5);
    expect(resolveVisibleLaneCount(288)).toBe(6);
    expect(resolveVisibleLaneCount(360)).toBe(6);
    expect(resolveVisibleLaneCount(2000)).toBe(CUE_MAP_MAX_LANES);
  });

  it("keeps at least one lane for narrow or invalid widths", () => {
    expect(resolveVisibleLaneCount(100)).toBe(1);
    expect(resolveVisibleLaneCount(0)).toBe(1);
    expect(resolveVisibleLaneCount(Number.NaN)).toBe(1);
  });

  it("offsets lanes from the right edge while keeping lane 0 frontmost", () => {
    expect(cueMapLaneOffsetRightPx(0, 3)).toBe(CUE_MAP_LANE_WIDTH_PX * 2);
    expect(cueMapLaneOffsetRightPx(1, 3)).toBe(CUE_MAP_LANE_WIDTH_PX);
    expect(cueMapLaneOffsetRightPx(2, 3)).toBe(0);
  });
});

