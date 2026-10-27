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
import { applyScriptOperation, applyScriptOperations } from "./apply.ts";
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

describe("line operations", () => {
  function documentWithLines(): {
    document: ContentDocument;
    point: PointScene;
  } {
    const document = createInitialContentDocument();
    const point = pointScene(document);
    point.lines = [
      {
        id: "line-a",
        speakerId: null,
        captionText: "A",
        speechText: "A",
        selectedAudioTakeId: null,
        expressionId: null,
      },
      {
        id: "line-b",
        speakerId: "speaker-1",
        captionText: "B",
        speechText: "B",
        selectedAudioTakeId: "take-b",
        expressionId: "expr-1",
        gapBeforeMs: 200,
      },
      {
        id: "line-c",
        speakerId: null,
        captionText: "C",
        speechText: "C",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ];
    document.audioTakes = [
      {
        id: "take-b",
        narrationSegmentId: "line-b",
        source: "manual",
        assetId: "asset-audio",
        durationMs: 1000,
      },
    ];
    return { document, point };
  }

  it("line.addで行を追加し、話者のない行への表情を拒否する", () => {
    const { document, point } = documentWithLines();
    const added = applyScriptOperation(
      document,
      {
        op: "line.add",
        sceneId: point.id,
        index: 1,
        captionText: "X",
        speechText: "エックス",
      },
      createTestContext(),
    );
    const addedScene = added.document.scenes[1]!;
    if (addedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(addedScene.lines.map((line) => line.id)).toEqual([
      "line-a",
      "line-scene-point-1-1",
      "line-b",
      "line-c",
    ]);
    expect(addedScene.lines[1]).toMatchObject({
      captionText: "X",
      speechText: "エックス",
      speakerId: null,
      expressionId: null,
      selectedAudioTakeId: null,
    });
    expect(added.created.lineIds).toEqual(["line-scene-point-1-1"]);

    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "line.add",
          sceneId: point.id,
          expressionId: "expr-1",
        },
        createTestContext(),
      ),
    ).toThrow(/話者/);
  });

  it("line.removeで範囲端点を詰め、単一行Cueと音声を削除する", () => {
    const { document, point } = documentWithLines();
    point.visualCues.push(
      mediaCue(
        "cue-bc",
        { kind: "lines", startLineId: "line-b", endLineId: "line-c" },
        { assetId: "asset-video", fit: "cover" },
      ),
      mediaCue(
        "cue-b",
        { kind: "lines", startLineId: "line-b", endLineId: "line-b" },
        { assetId: "asset-video", fit: "cover" },
      ),
      mediaCue("cue-gate", { kind: "scene" }, {
        assetId: "asset-video",
        fit: "cover",
        videoPlayback: {
          mode: "gated",
          gates: [{ narrationSegmentId: "line-b", sourceMs: 0 }],
        },
      }),
    );

    const result = applyScriptOperation(
      document,
      { op: "line.remove", sceneId: point.id, lineId: "line-b" },
      createTestContext(),
    );

    const scene = result.document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(scene.lines.map((line) => line.id)).toEqual(["line-a", "line-c"]);
    expect(scene.visualCues.find((cue) => cue.id === "cue-b")).toBeUndefined();
    const bc = scene.visualCues.find((cue) => cue.id === "cue-bc");
    expect(bc?.range).toEqual({
      kind: "lines",
      startLineId: "line-c",
      endLineId: "line-c",
    });
    const gateCue = scene.visualCues.find((cue) => cue.id === "cue-gate");
    expect((gateCue?.input as { videoPlayback?: unknown }).videoPlayback).toBeUndefined();
    expect(result.document.audioTakes).toEqual([]);
    expect(
      result.warnings.some(
        (warning) => warning.code === "cue_removed_after_line_removal",
      ),
    ).toBe(true);
  });

  it("line.moveで並び替え、逆転した行範囲を正規化する", () => {
    const { document, point } = documentWithLines();
    point.visualCues.push(
      mediaCue(
        "cue-range",
        { kind: "lines", startLineId: "line-b", endLineId: "line-c" },
        { assetId: "asset-video", fit: "cover" },
      ),
    );

    const result = applyScriptOperation(
      document,
      { op: "line.move", sceneId: point.id, lineId: "line-c", index: 0 },
      createTestContext(),
    );

    const scene = result.document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(scene.lines.map((line) => line.id)).toEqual([
      "line-c",
      "line-a",
      "line-b",
    ]);
    const cue = scene.visualCues.find((entry) => entry.id === "cue-range");
    expect(cue?.range).toEqual({
      kind: "lines",
      startLineId: "line-c",
      endLineId: "line-b",
    });
  });

  it("line.setTextと話者・表情・間の変更を反映する", () => {
    const { document, point } = documentWithLines();
    const edited = applyScriptOperation(
      document,
      {
        op: "line.updateText",
        sceneId: point.id,
        lineId: "line-b",
        captionText: "変更後",
        speechText: "へんこうご",
      },
      createTestContext(),
    );
    const editedScene = edited.document.scenes[1]!;
    if (editedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(editedScene.lines[1]).toMatchObject({
      captionText: "変更後",
      speechText: "へんこうご",
      selectedAudioTakeId: "take-b",
    });

    const speakerChanged = applyScriptOperation(
      edited.document,
      {
        op: "line.setSpeaker",
        sceneId: point.id,
        lineId: "line-b",
        speakerId: null,
      },
      createTestContext(),
    );
    const speakerScene = speakerChanged.document.scenes[1]!;
    if (speakerScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(speakerScene.lines[1]?.speakerId).toBeNull();
    expect(speakerScene.lines[1]?.expressionId).toBeNull();

    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "line.setExpression",
          sceneId: point.id,
          lineId: "line-a",
          expressionId: "expr-1",
        },
        createTestContext(),
      ),
    ).toThrow(/話者/);

    const gapChanged = applyScriptOperation(
      document,
      {
        op: "line.setGap",
        sceneId: point.id,
        lineId: "line-b",
        gapBeforeMs: 0,
      },
      createTestContext(),
    );
    const gapScene = gapChanged.document.scenes[1]!;
    if (gapScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(gapScene.lines[1]?.gapBeforeMs).toBeUndefined();
  });

  it("固定尺を超える間の変更を拒否する", () => {
    const { document, point } = documentWithLines();
    const fixedDocument: ContentDocument = {
      ...document,
      scenes: document.scenes.map((scene) =>
        scene.id === point.id
          ? { ...scene, timing: { mode: "fixed", durationMs: 1000 } }
          : scene,
      ),
    };
    expect(() =>
      applyScriptOperation(
        fixedDocument,
        {
          op: "line.setGap",
          sceneId: point.id,
          lineId: "line-b",
          gapBeforeMs: 1,
        },
        createTestContext(),
      ),
    ).toThrow(/固定尺/);
  });

  it("音声の割り当て・選択・削除をkey参照も含めて扱う", () => {
    const { document, point } = documentWithLines();
    const context = createTestContext({
      "asset-audio-2": {
        kind: "audio",
        status: "ready",
        durationMs: 1200,
        hasAudio: true,
      },
    });
    const assigned = applyScriptOperation(
      document,
      {
        op: "line.assignTake",
        key: "new-take",
        sceneId: point.id,
        lineId: "line-a",
        assetId: "asset-audio-2",
        source: "tts",
      },
      context,
    );
    const assignedScene = assigned.document.scenes[1]!;
    if (assignedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const takeId = assigned.created.audioTakeIds[0]!;
    expect(assignedScene.lines[0]?.selectedAudioTakeId).toBe(takeId);
    expect(assigned.document.audioTakes).toHaveLength(2);
    expect(
      assigned.document.audioTakes.find((take) => take.id === takeId),
    ).toMatchObject({
      narrationSegmentId: "line-a",
      source: "tts",
      durationMs: 1200,
    });

    const removed = applyScriptOperations(
      document,
      [
        {
          op: "line.assignTake",
          key: "new-take",
          sceneId: point.id,
          lineId: "line-a",
          assetId: "asset-audio-2",
          source: "tts",
        },
        {
          op: "line.removeTake",
          sceneId: point.id,
          lineId: "line-a",
          takeId: { key: "new-take" },
        },
      ],
      context,
    );
    const removedScene = removed.document.scenes[1]!;
    if (removedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(removed.document.audioTakes.map((take) => take.id)).toEqual(["take-b"]);
    expect(removedScene.lines[0]?.selectedAudioTakeId).toBeNull();

    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "line.selectTake",
          sceneId: point.id,
          lineId: "line-a",
          takeId: "take-b",
        },
        createTestContext(),
      ),
    ).toThrow(/音声/);
  });
});
