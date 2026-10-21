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
  createCueFormValue,
  moveLineInScene,
  nextPointLabel,
  removeLineInScene,
  splitPointScene,
  toFormValues,
} from "./form";
import {
  applyStructuralOperation,
  applyStructuralOperations,
  commitCueStructural,
  removeCueStructural,
} from "./structural";

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

  it("未確定Cueがあっても構造操作でき、Cueはフォームに残る", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const draft = createCueFormValue({
      sceneId: DEFAULT_SCENE_IDS.point1,
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 10,
    });
    values.scenes[1]!.cues.push(draft);

    const result = applyStructuralOperation(
      base,
      values,
      { op: "line.add", sceneId: DEFAULT_SCENE_IDS.point1, captionText: "追加" },
      [],
    );

    const scene = result.values.scenes[1]!;
    expect(scene.lines).toHaveLength(1);
    expect(scene.cues.some((cue) => cue.id === draft.id)).toBe(true);
    expect(
      result.document.scenes[1]?.visualCues.some((cue) => cue.id === draft.id),
    ).toBe(false);
  });

  it("Cueの入力・配置変更を操作コア経由で確定できる", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const cue = values.scenes[1]!.cues[0]!;
    cue.fields = { ...cue.fields, text: "更新後", role: "heading" };
    cue.order = 15;

    const result = commitCueStructural(
      base,
      values,
      DEFAULT_SCENE_IDS.point1,
      cue.id,
      [],
    );
    expect(result).not.toBeNull();
    const committed = result?.document.scenes[1]?.visualCues.find(
      (entry) => entry.id === cue.id,
    );
    expect(committed?.input).toMatchObject({ text: "更新後", role: "heading" });
    expect(committed?.order).toBe(15);
    expect(
      result?.values.scenes[1]?.cues.find((entry) => entry.id === cue.id)?.fields
        .text,
    ).toBe("更新後");
  });

  it("未確定Cueのコミットは行わない", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const draft = createCueFormValue({
      sceneId: DEFAULT_SCENE_IDS.point1,
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 10,
    });
    values.scenes[1]!.cues.push(draft);

    expect(
      commitCueStructural(
        base,
        values,
        DEFAULT_SCENE_IDS.point1,
        draft.id,
        [],
      ),
    ).toBeNull();
  });

  it("行フィールドの変更をまとめて適用できる", () => {
    const base = createInitialContentDocument();
    lines(base, ["line-a"]);
    const values = toFormValues(base);

    const result = applyStructuralOperations(
      base,
      values,
      [
        {
          op: "line.setText",
          sceneId: DEFAULT_SCENE_IDS.point1,
          lineId: "line-a",
          captionText: "変更後",
          speechText: "へんこうご",
        },
        {
          op: "line.setSpeaker",
          sceneId: DEFAULT_SCENE_IDS.point1,
          lineId: "line-a",
          speakerId: null,
        },
        {
          op: "line.setGap",
          sceneId: DEFAULT_SCENE_IDS.point1,
          lineId: "line-a",
          gapBeforeMs: 250,
        },
      ],
      [],
    );
    expect(result.values.scenes[1]?.lines[0]).toMatchObject({
      captionText: "変更後",
      speechText: "へんこうご",
      speakerId: null,
      expressionId: null,
      gapBeforeMs: 250,
    });
  });

  it("未確定Cueは構造操作後も元の行位置に戻る", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const draft = createCueFormValue({
      sceneId: DEFAULT_SCENE_IDS.point1,
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 10,
    });
    values.scenes[1]!.cues.splice(1, 0, draft);

    const result = applyStructuralOperation(
      base,
      values,
      { op: "line.add", sceneId: DEFAULT_SCENE_IDS.point1, captionText: "追加" },
      [],
    );
    expect(result.values.scenes[1]!.cues[1]?.id).toBe(draft.id);
  });

  it("未確定Cueの行範囲は行削除後にScene範囲へ戻し、警告を返す", () => {
    const base = createInitialContentDocument();
    lines(base, ["line-a", "line-b"]);
    const values = toFormValues(base);
    const draft = createCueFormValue({
      sceneId: DEFAULT_SCENE_IDS.point1,
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 10,
    });
    values.scenes[1]!.cues.push({
      ...draft,
      rangeKind: "lines",
      startLineId: "line-a",
      endLineId: "line-b",
    });

    const result = applyStructuralOperation(
      base,
      values,
      { op: "line.remove", sceneId: DEFAULT_SCENE_IDS.point1, lineId: "line-a" },
      [],
    );
    const cue = result.values.scenes[1]!.cues.find((entry) => entry.id === draft.id);
    expect(cue?.rangeKind).toBe("scene");
    expect(
      result.result.warnings.some(
        (warning) => warning.code === "draft_cue_range_reset",
      ),
    ).toBe(true);
  });

  it("未確定Cueは操作コアを通さずフォームから削除できる", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const draft = createCueFormValue({
      sceneId: DEFAULT_SCENE_IDS.point1,
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 10,
    });
    values.scenes[1]!.cues.push(draft);

    const result = removeCueStructural(
      base,
      values,
      DEFAULT_SCENE_IDS.point1,
      draft.id,
      [],
    );
    expect(result).not.toBeNull();
    expect(
      result?.values.scenes[1]?.cues.some((cue) => cue.id === draft.id),
    ).toBe(false);
  });
});
