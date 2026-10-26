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

  it("Cueを別Sceneへ移動すると行参照が初期化される", () => {
    const base = createInitialContentDocument();
    lines(base, ["line-a", "line-b"]);
    pointScene(base).visualCues.push({
      id: "cue-table",
      template: { id: "table.simple", version: 1 },
      range: { kind: "lines", startLineId: "line-a", endLineId: "line-b" },
      layer: "card",
      order: 10,
      transition: {
        enter: { ...DEFAULT_TRANSITION_POLICY.defaultEnter },
        exit: { ...DEFAULT_TRANSITION_POLICY.defaultExit },
      },
      input: {
        data: {
          columns: [{ key: "name", label: "項目", type: "text" }],
          rows: [{ name: "a" }],
        },
        effects: [
          {
            target: { kind: "row", index: 0 },
            trigger: { kind: "lines", startLineId: "line-a", endLineId: "line-b" },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      },
    });
    const values = toFormValues(base);

    const result = moveCueStructural(
      base,
      values,
      DEFAULT_SCENE_IDS.point1,
      "cue-table",
      DEFAULT_SCENE_IDS.outro,
      [],
    );
    expect(result).not.toBeNull();
    const sourceCues =
      result?.document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues ?? [];
    expect(sourceCues.some((cue) => cue.id === "cue-table")).toBe(false);
    const moved = result?.document.scenes
      .find((scene) => scene.id === DEFAULT_SCENE_IDS.outro)
      ?.visualCues.find((cue) => cue.id === "cue-table");
    expect(moved?.range).toEqual({ kind: "scene" });
    expect(moved?.input).toMatchObject({
      effects: [{ trigger: { kind: "cue" } }],
    });
    expect(
      result?.result.warnings.some(
        (warning) => warning.code === "cue_line_refs_reset",
      ),
    ).toBe(true);
    expect(
      result?.values.scenes
        .find((scene) => scene.id === DEFAULT_SCENE_IDS.outro)
        ?.cues.some((cue) => cue.id === "cue-table"),
    ).toBe(true);
  });

  it("Cueを複数Sceneへ複製するとIDが採番し直される", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const cueId = values.scenes[1]!.cues[0]!.id;

    const result = copyCueStructural(
      base,
      values,
      DEFAULT_SCENE_IDS.point1,
      cueId,
      [DEFAULT_SCENE_IDS.intro, DEFAULT_SCENE_IDS.outro],
      [],
    );
    expect(result).not.toBeNull();
    expect(result?.result.created.cueIds).toHaveLength(2);
    expect(new Set(result?.result.created.cueIds).size).toBe(2);
    const sourceCues =
      result?.document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues ?? [];
    expect(sourceCues.some((cue) => cue.id === cueId)).toBe(true);
  });

});
