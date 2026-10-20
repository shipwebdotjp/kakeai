import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  listCalloutV1,
  mediaFullBleedV1,
  type ContentDocument,
  type NarrationSegment,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import { applyScriptOperation } from "./apply.ts";
import { createTestContext } from "./testing.ts";

function line(id: string, text: string): NarrationSegment {
  return {
    id,
    speakerId: null,
    captionText: text,
    speechText: text,
    selectedAudioTakeId: null,
    expressionId: null,
  };
}

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

describe("scene.splitAtLine", () => {
  it("行の直前で分割し、Cueの範囲・offset・Gateを両Sceneへ振り分ける", () => {
    const document = createInitialContentDocument();
    const point = pointScene(document);
    point.lines = [line("line-a", "A"), line("line-b", "B"), line("line-c", "C")];
    point.visualCues.push(
      mediaCue(
        "cue-gates",
        { kind: "lines", startLineId: "line-a", endLineId: "line-c" },
        {
          assetId: "asset-video",
          fit: "cover",
          videoPlayback: {
            mode: "gated",
            gates: [
              { narrationSegmentId: "line-a", sourceMs: 0 },
              { narrationSegmentId: "line-c", sourceMs: 1000 },
            ],
          },
        },
      ),
      mediaCue(
        "cue-offset",
        { kind: "offset", startMs: 4000, endMs: 7000 },
        { assetId: "asset-video", fit: "cover" },
      ),
      {
        id: "cue-callout",
        template: { id: listCalloutV1.id, version: listCalloutV1.version },
        range: { kind: "lines", startLineId: "line-a", endLineId: "line-c" },
        layer: "overlay",
        order: 20,
        transition: cutTransition(),
        input: {
          items: [
            {
              text: "A",
              trigger: {
                kind: "lines",
                startLineId: "line-a",
                endLineId: "line-a",
              },
              effect: { kind: "appear", preset: "fade", durationMs: 200 },
            },
          ],
          appear: {
            trigger: {
              kind: "lines",
              startLineId: "line-c",
              endLineId: "line-c",
            },
            effect: { kind: "appear", preset: "fade", durationMs: 200 },
          },
        },
      },
    );

    const result = applyScriptOperation(
      document,
      { op: "scene.splitAtLine", sceneId: point.id, lineId: "line-c" },
      createTestContext(),
    );

    expect(result.document.scenes.map((scene) => scene.id)).toEqual([
      DEFAULT_SCENE_IDS.intro,
      DEFAULT_SCENE_IDS.point1,
      "scene-new-1",
      DEFAULT_SCENE_IDS.outro,
    ]);
    const first = result.document.scenes[1]!;
    const second = result.document.scenes[2]!;
    if (first.kind !== "point" || second.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(first.lines.map((entry) => entry.id)).toEqual(["line-a", "line-b"]);
    expect(second.lines.map((entry) => entry.id)).toEqual(["line-c"]);
    expect(second.label).toBe("要点 2");
    expect(second.accent).toEqual(first.accent);
    expect(second.timing).toEqual({ mode: "auto" });
    expect(second.transition).toBeUndefined();

    const firstGates = first.visualCues.find((cue) => cue.id === "cue-gates");
    expect(firstGates?.range).toEqual({
      kind: "lines",
      startLineId: "line-a",
      endLineId: "line-b",
    });
    const firstGatesInput = firstGates?.input as {
      videoPlayback: { gates: { narrationSegmentId: string }[] };
    };
    expect(
      firstGatesInput.videoPlayback.gates.map((gate) => gate.narrationSegmentId),
    ).toEqual(["line-a"]);

    const secondGates = second.visualCues.find((cue) => {
      const input = cue.input as { videoPlayback?: unknown };
      return input.videoPlayback !== undefined;
    });
    expect(secondGates?.range).toEqual({
      kind: "lines",
      startLineId: "line-c",
      endLineId: "line-c",
    });
    const secondGatesInput = secondGates?.input as {
      videoPlayback: { gates: { narrationSegmentId: string }[] };
    };
    expect(
      secondGatesInput.videoPlayback.gates.map((gate) => gate.narrationSegmentId),
    ).toEqual(["line-c"]);
    expect(secondGates?.id).not.toBe("cue-gates");

    const firstOffset = first.visualCues.find((cue) => cue.id === "cue-offset");
    expect(firstOffset?.range).toEqual({
      kind: "offset",
      startMs: 4000,
      endMs: 5500,
    });
    const secondOffset = second.visualCues.find(
      (cue) => cue.range.kind === "offset",
    );
    expect(secondOffset?.range).toEqual({ kind: "offset", startMs: 0, endMs: 1500 });
    expect(secondOffset?.id).not.toBe("cue-offset");

    const firstCallout = first.visualCues.find((cue) => cue.id === "cue-callout");
    const firstCalloutInput = firstCallout?.input as {
      items: unknown[];
      appear?: unknown;
    };
    expect(firstCalloutInput.items).toHaveLength(1);
    expect(firstCalloutInput.appear).toBeUndefined();
    expect(
      second.visualCues.some((cue) => cue.template.id === listCalloutV1.id),
    ).toBe(false);
    expect(
      result.warnings.some((warning) => warning.code === "cue_removed_after_split"),
    ).toBe(true);

    expect(result.created.sceneIds).toEqual(["scene-new-1"]);
    expect(result.created.cueIds).toHaveLength(4);
    expect(new Set(result.created.cueIds).size).toBe(4);
  });

  it("要点Scene以外や両側が空になる分割を拒否する", () => {
    const document = createInitialContentDocument();
    const point = pointScene(document);
    point.lines = [line("line-a", "A")];

    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "scene.splitAtLine",
          sceneId: DEFAULT_SCENE_IDS.intro,
          lineId: "line-a",
        },
        createTestContext(),
      ),
    ).toThrow(/要点Scene/);
    expect(() =>
      applyScriptOperation(
        document,
        { op: "scene.splitAtLine", sceneId: point.id, lineId: "line-a" },
        createTestContext(),
      ),
    ).toThrow(/前後に1行以上/);
  });
});
