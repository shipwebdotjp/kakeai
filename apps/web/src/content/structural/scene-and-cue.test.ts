import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  DEFAULT_TRANSITION_POLICY,
  type ContentDocument,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import {
  createCueFormValue,
  toFormValues,
} from "../form";
import {
  applyStructuralOperation,
  applyStructuralOperations,
  commitBgmStructural,
  commitCueStructural,
  commitSceneAudioStructural,
  commitStandingStructural,
  copyCueStructural,
  copyStandingsStructural,
  moveCueStructural,
  removeCueStructural,
  transferStandingsStructural,
} from "../structural";
import { pointScene, textCue, lines } from "./test-helpers";

describe("structural operation adapter", () => {
  it("要点Sceneを既定の形で追加する", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const outroIndex = values.scenes.findIndex((scene) => scene.kind === "outro");
    const { document } = applyStructuralOperation(
      base,
      values,
      { op: "scene.add", kind: "point", index: outroIndex },
      [],
    );

    expect(document.scenes.map((scene) => scene.kind)).toEqual([
      "intro",
      "point",
      "point",
      "outro",
    ]);
    const added = document.scenes[outroIndex]!;
    expect(added.label).toBe("要点 2");
    expect(added.visualCues).toHaveLength(2);
  });

  it("行の移動・削除でCue範囲を更新する", () => {
    const base = createInitialContentDocument();
    lines(base, ["line-a", "line-b", "line-c"]);
    pointScene(base).visualCues.push(
      textCue(
        { kind: "lines", startLineId: "line-a", endLineId: "line-c" },
        "T",
      ),
    );
    const values = toFormValues(base);

    const moved = applyStructuralOperation(
      base,
      values,
      {
        op: "line.move",
        sceneId: DEFAULT_SCENE_IDS.point1,
        lineId: "line-c",
        index: 0,
      },
      [],
    );
    const movedScene = moved.document.scenes[1]!;
    expect(movedScene.lines.map((line) => line.id)).toEqual([
      "line-c",
      "line-a",
      "line-b",
    ]);
    expect(
      movedScene.visualCues.find((cue) => cue.id === "cue-text")?.range,
    ).toEqual({
      kind: "lines",
      startLineId: "line-c",
      endLineId: "line-a",
    });

    const removed = applyStructuralOperation(
      base,
      values,
      {
        op: "line.remove",
        sceneId: DEFAULT_SCENE_IDS.point1,
        lineId: "line-a",
      },
      [],
    );
    const removedScene = removed.document.scenes[1]!;
    expect(removedScene.lines.map((line) => line.id)).toEqual([
      "line-b",
      "line-c",
    ]);
    expect(
      removedScene.visualCues.find((cue) => cue.id === "cue-text")?.range,
    ).toEqual({
      kind: "lines",
      startLineId: "line-b",
      endLineId: "line-c",
    });
  });

  it("Scene分割がプレビュー応答なしでCueを振り分ける", () => {
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

    expect(document.scenes.map((scene) => scene.kind)).toEqual([
      "intro",
      "point",
      "point",
      "outro",
    ]);
    const first = document.scenes[1]!;
    const second = document.scenes[2]!;
    expect(first.lines.map((line) => line.id)).toEqual(["line-a", "line-b"]);
    expect(second.lines.map((line) => line.id)).toEqual(["line-c"]);
    expect(second.label).toBe("要点 2");

    expect(first.visualCues.find((cue) => cue.id === "cue-text")?.range).toEqual({
      kind: "lines",
      startLineId: "line-a",
      endLineId: "line-b",
    });
    expect(
      second.visualCues.find(
        (cue) => cue.range.kind === "lines" && cue.id !== "cue-text",
      )?.range,
    ).toEqual({
      kind: "lines",
      startLineId: "line-c",
      endLineId: "line-c",
    });
    expect(
      first.visualCues.find((cue) => cue.id === "cue-offset")?.range,
    ).toEqual({ kind: "offset", startMs: 4000, endMs: 5500 });
    expect(
      second.visualCues.find((cue) => cue.range.kind === "offset")?.range,
    ).toEqual({ kind: "offset", startMs: 0, endMs: 1500 });
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

});
