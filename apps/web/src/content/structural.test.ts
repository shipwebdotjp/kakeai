import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  DEFAULT_TRANSITION_POLICY,
  type ContentDocument,
  type PointScene,
  type Scene,
  type VisualCue,
} from "@kakeai/contracts";
import { resolveTimeline } from "@kakeai/video/timeline";
import {
  buildContentDocument,
  collectSceneIds,
  createPointSceneFormValue,
  moveLineInScene,
  nextPointLabel,
  removeLineInScene,
  splitPointScene,
  toFormValues,
} from "./form";
import { applyStructuralOperation } from "./structural";

function pointScene(document: ContentDocument): PointScene {
  const scene = document.scenes.find((entry) => entry.id === DEFAULT_SCENE_IDS.point1);
  if (scene === undefined || scene.kind !== "point") {
    throw new Error("要点Sceneがありません。");
  }
  return scene;
}

function textCue(range: VisualCue["range"], text: string): VisualCue {
  return {
    id: "cue-text",
    template: { id: "text.block", version: 1 },
    range,
    layer: "overlay",
    order: 10,
    transition: {
      enter: { ...DEFAULT_TRANSITION_POLICY.defaultEnter },
      exit: { ...DEFAULT_TRANSITION_POLICY.defaultExit },
    },
    input: { text, role: "body" },
  };
}

function lines(document: ContentDocument, ids: string[]): void {
  pointScene(document).lines = ids.map((id) => ({
    id,
    speakerId: null,
    captionText: id,
    speechText: id,
    selectedAudioTakeId: null,
    expressionId: null,
  }));
}

function cueShape(scene: Scene): unknown[] {
  return scene.visualCues
    .map((cue) => ({
      template: cue.template,
      range: cue.range,
      layer: cue.layer,
      input: cue.input,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

describe("structural operation adapter", () => {
  it("要点Sceneの追加が既存フォーム経路と同じ形になる", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const outroIndex = values.scenes.findIndex((scene) => scene.kind === "outro");
    const oldValues = {
      ...values,
      scenes: [
        ...values.scenes.slice(0, outroIndex),
        createPointSceneFormValue(
          nextPointLabel(values.scenes, outroIndex),
          collectSceneIds(values.scenes),
        ),
        ...values.scenes.slice(outroIndex),
      ],
    };
    const oldDocument = buildContentDocument(base, oldValues);
    const { document } = applyStructuralOperation(
      base,
      values,
      { op: "scene.add", kind: "point", index: outroIndex },
      [],
    );

    expect(document.scenes.map((scene) => scene.kind)).toEqual(
      oldDocument.scenes.map((scene) => scene.kind),
    );
    expect(document.scenes[outroIndex]?.label).toBe(
      oldDocument.scenes[outroIndex]?.label,
    );
    expect(cueShape(document.scenes[outroIndex]!)).toEqual(
      cueShape(oldDocument.scenes[outroIndex]!),
    );
  });

  it("行の移動・削除が既存フォーム経路と同じCue範囲になる", () => {
    const base = createInitialContentDocument();
    lines(base, ["line-a", "line-b", "line-c"]);
    pointScene(base).visualCues.push(
      textCue(
        { kind: "lines", startLineId: "line-a", endLineId: "line-c" },
        "T",
      ),
    );
    const values = toFormValues(base);
    const sceneValue = values.scenes[1]!;

    const movedForm = moveLineInScene(sceneValue, 2, 0);
    const movedDocument = buildContentDocument(base, {
      ...values,
      scenes: values.scenes.map((scene, index) =>
        index === 1 ? movedForm : scene,
      ),
    });
    const moved = applyStructuralOperation(
      base,
      values,
      { op: "line.move", sceneId: DEFAULT_SCENE_IDS.point1, lineId: "line-c", index: 0 },
      [],
    );
    expect(moved.document.scenes[1]?.lines.map((line) => line.id)).toEqual(
      movedDocument.scenes[1]?.lines.map((line) => line.id),
    );
    expect(cueShape(moved.document.scenes[1]!)).toEqual(
      cueShape(movedDocument.scenes[1]!),
    );

    const removedForm = removeLineInScene(sceneValue, 0);
    const removedDocument = buildContentDocument(base, {
      ...values,
      scenes: values.scenes.map((scene, index) =>
        index === 1 ? removedForm : scene,
      ),
    });
    const removed = applyStructuralOperation(
      base,
      values,
      { op: "line.remove", sceneId: DEFAULT_SCENE_IDS.point1, lineId: "line-a" },
      [],
    );
    expect(removed.document.scenes[1]?.lines.map((line) => line.id)).toEqual(
      removedDocument.scenes[1]?.lines.map((line) => line.id),
    );
    expect(cueShape(removed.document.scenes[1]!)).toEqual(
      cueShape(removedDocument.scenes[1]!),
    );
  });

  it("Scene分割がプレビュー応答なしで既存経路と同じ形になる", () => {
    const base = createInitialContentDocument();
    lines(base, ["line-a", "line-b", "line-c"]);
    pointScene(base).visualCues.push(
      textCue(
        { kind: "lines", startLineId: "line-a", endLineId: "line-c" },
        "T",
      ),
      {
        ...textCue({ kind: "offset", startMs: 4000, endMs: 7000 }, "U"),
        id: "cue-offset",
        order: 11,
      },
    );
    const values = toFormValues(base);
    const timeline = resolveTimeline(base);
    const placement = timeline.scenes.find(
      (entry) => entry.sceneId === DEFAULT_SCENE_IDS.point1,
    )!;
    const splitLine = placement.lines.find((line) => line.lineId === "line-c")!;
    const splitOffsetMs = splitLine.startMs - placement.startMs;
    const oldSplit = splitPointScene(
      values.scenes[1]!,
      2,
      nextPointLabel(values.scenes, 2),
      collectSceneIds(values.scenes),
      splitOffsetMs,
    );
    const oldDocument = buildContentDocument(base, {
      ...values,
      scenes: [
        ...values.scenes.slice(0, 1),
        oldSplit.first,
        oldSplit.second,
        ...values.scenes.slice(2),
      ],
    });

    const { document } = applyStructuralOperation(
      base,
      values,
      {
        op: "scene.splitAtLine",
        sceneId: DEFAULT_SCENE_IDS.point1,
        lineId: "line-c",
      },
      [],
    );

    expect(document.scenes.map((scene) => scene.kind)).toEqual(
      oldDocument.scenes.map((scene) => scene.kind),
    );
    const oldFirst = oldDocument.scenes[1]!;
    const oldSecond = oldDocument.scenes[2]!;
    const newFirst = document.scenes[1]!;
    const newSecond = document.scenes[2]!;
    expect(newFirst.lines.map((line) => line.id)).toEqual(
      oldFirst.lines.map((line) => line.id),
    );
    expect(newSecond.lines.map((line) => line.id)).toEqual(
      oldSecond.lines.map((line) => line.id),
    );
    expect(newSecond.label).toBe(oldSecond.label);
    expect(cueShape(newFirst)).toEqual(cueShape(oldFirst));
    expect(cueShape(newSecond)).toEqual(cueShape(oldSecond));
  });
});
