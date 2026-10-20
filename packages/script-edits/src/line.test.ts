import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  mediaFullBleedV1,
  type ContentDocument,
  type NarrationSegment,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import { applyScriptOperation } from "./apply.ts";
import { createTestContext } from "./testing.ts";

function cutTransition(): VisualCue["transition"] {
  return {
    enter: { preset: "none", durationMs: 0 },
    exit: { preset: "none", durationMs: 0 },
  };
}

function mediaCue(
  id: string,
  range: VisualCue["range"],
  input: unknown,
): VisualCue {
  return {
    id,
    template: { id: mediaFullBleedV1.id, version: mediaFullBleedV1.version },
    range,
    layer: "background",
    order: 10,
    transition: cutTransition(),
    input,
  };
}

function pointScene(document: ContentDocument): PointScene {
  const scene = document.scenes.find((entry) => entry.id === DEFAULT_SCENE_IDS.point1);
  if (scene === undefined || scene.kind !== "point") {
    throw new Error("要点Sceneがありません。");
  }
  return scene;
}

function prepareDocument(): { document: ContentDocument; line: NarrationSegment } {
  const document = createInitialContentDocument();
  const point = pointScene(document);
  const line: NarrationSegment = {
    id: "line-a",
    speakerId: "speaker-1",
    captionText: "元の文章",
    speechText: "もとのぶんしょう",
    selectedAudioTakeId: "take-a",
    expressionId: "expr-1",
    gapBeforeMs: 300,
  };
  point.lines = [line];
  document.audioTakes = [
    {
      id: "take-a",
      narrationSegmentId: "line-a",
      source: "manual",
      assetId: "asset-audio",
      durationMs: 1000,
    },
  ];
  point.visualCues.push(
    mediaCue(
      "cue-range",
      { kind: "lines", startLineId: "line-a", endLineId: "line-a" },
      { assetId: "asset-video", fit: "cover" },
    ),
    mediaCue("cue-gate", { kind: "scene" }, {
      assetId: "asset-video",
      fit: "cover",
      videoPlayback: {
        mode: "gated",
        gates: [{ narrationSegmentId: "line-a", sourceMs: 0 }],
      },
    }),
  );
  return { document, line };
}

describe("line.split", () => {
  it("行IDを前半に残し、参照・音声・Cue範囲を付け替える", () => {
    const { document, line } = prepareDocument();
    const point = pointScene(document);

    const result = applyScriptOperation(
      document,
      {
        op: "line.split",
        sceneId: point.id,
        lineId: line.id,
        first: { captionText: "前半", speechText: "ぜんはん" },
        second: { captionText: "後半", speechText: "こうはん" },
      },
      createTestContext(),
    );

    const splitScene = result.document.scenes[1]!;
    if (splitScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(splitScene.lines).toHaveLength(2);
    const first = splitScene.lines[0]!;
    const second = splitScene.lines[1]!;
    expect(first).toMatchObject({
      id: "line-a",
      speakerId: "speaker-1",
      expressionId: "expr-1",
      captionText: "前半",
      speechText: "ぜんはん",
      selectedAudioTakeId: null,
      gapBeforeMs: 300,
    });
    expect(second).toMatchObject({
      id: "line-scene-point-1-1",
      speakerId: "speaker-1",
      expressionId: "expr-1",
      captionText: "後半",
      speechText: "こうはん",
      selectedAudioTakeId: null,
    });
    expect(second.gapBeforeMs).toBeUndefined();
    expect(result.document.audioTakes).toEqual([]);
    expect(result.created.lineIds).toEqual(["line-scene-point-1-1"]);

    const rangeCue = splitScene.visualCues.find((cue) => cue.id === "cue-range");
    expect(rangeCue?.range).toEqual({
      kind: "lines",
      startLineId: "line-a",
      endLineId: "line-scene-point-1-1",
    });
    const gateCue = splitScene.visualCues.find((cue) => cue.id === "cue-gate");
    const gateInput = gateCue?.input as {
      videoPlayback: { gates: { narrationSegmentId: string }[] };
    };
    expect(
      gateInput.videoPlayback.gates.map((gate) => gate.narrationSegmentId),
    ).toEqual(["line-a"]);
  });

  it("空の後半や同一文章の複製を拒否する", () => {
    const { document, line } = prepareDocument();
    const point = pointScene(document);

    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "line.split",
          sceneId: point.id,
          lineId: line.id,
          first: { captionText: "前半", speechText: "ぜんはん" },
          second: { captionText: "", speechText: "  " },
        },
        createTestContext(),
      ),
    ).toThrow(/後半/);
    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "line.split",
          sceneId: point.id,
          lineId: line.id,
          first: { captionText: "元の文章", speechText: "もとのぶんしょう" },
          second: { captionText: "元の文章", speechText: "もとのぶんしょう" },
        },
        createTestContext(),
      ),
    ).toThrow(/複製/);
  });
});
