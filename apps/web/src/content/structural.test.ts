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
} from "./form";
import {
  applyStructuralOperation,
  applyStructuralOperations,
  commitBgmStructural,
  commitCueStructural,
  commitSceneAudioStructural,
  commitStandingStructural,
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

  it("立ち絵設定を操作コア経由で確定・削除できる", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "char-1",
        name: "キャラクター",
        voices: [],
        appearances: [
          {
            id: "app-1",
            assetId: "asset-image",
            expression: "normal",
            pose: "default",
            faceSetId: null,
          },
        ],
      },
    ];
    const values = toFormValues(base);
    const slot = values.scenes[1]!.standings.find(
      (entry) => entry.side === "left",
    )!;
    slot.characterId = "char-1";
    slot.appearanceId = "app-1";
    slot.scale = 1.5;
    slot.enterPreset = "fade";
    slot.enterDurationMs = 200;

    const result = commitStandingStructural(
      base,
      values,
      DEFAULT_SCENE_IDS.point1,
      "left",
      [],
    );
    expect(result).not.toBeNull();
    const cue = result?.document.scenes[1]?.visualCues.find(
      (entry) => entry.template.id === "character.standing",
    );
    expect(cue?.input).toMatchObject({
      characterId: "char-1",
      appearanceId: "app-1",
      side: "left",
      scale: 1.5,
    });
    expect(cue?.transition.enter).toEqual({
      preset: "fade",
      durationMs: 200,
    });
    expect(
      result?.values.scenes[1]?.standings.find((entry) => entry.side === "left")
        ?.cueId,
    ).toBe(cue?.id);

    const removeSlot = result!.values.scenes[1]!.standings.find(
      (entry) => entry.side === "left",
    )!;
    removeSlot.characterId = null;
    removeSlot.appearanceId = null;
    const removed = commitStandingStructural(
      base,
      result!.values,
      DEFAULT_SCENE_IDS.point1,
      "left",
      [],
    );
    expect(removed).not.toBeNull();
    expect(
      removed?.document.scenes[1]?.visualCues.some(
        (entry) => entry.template.id === "character.standing",
      ),
    ).toBe(false);
  });

  it("シーン音声の追加・更新・削除を操作コア経由で確定できる", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.audioCues.push({
      cueId: null,
      assetId: "asset-audio",
      role: "sfx",
      gainDb: -6,
      loop: true,
    });
    const audioAssets = [
      {
        id: "asset-audio",
        kind: "audio" as const,
        status: "ready" as const,
        durationMs: 5000,
        hasAudio: true,
      },
    ];

    const added = commitSceneAudioStructural(
      base,
      values,
      DEFAULT_SCENE_IDS.point1,
      0,
      audioAssets,
    );
    expect(added).not.toBeNull();
    expect(added?.document.audioCues).toHaveLength(1);
    expect(added?.document.audioCues[0]).toMatchObject({
      role: "sfx",
      assetId: "asset-audio",
      gainDb: -6,
      loop: true,
      range: { kind: "scene", sceneId: DEFAULT_SCENE_IDS.point1 },
    });
    const cueId = added?.values.scenes[1]?.audioCues[0]?.cueId;
    expect(cueId).toBe(added?.document.audioCues[0]?.id);

    const slot = added!.values.scenes[1]!.audioCues[0]!;
    slot.gainDb = -3;
    slot.loop = false;
    const updated = commitSceneAudioStructural(
      base,
      added!.values,
      DEFAULT_SCENE_IDS.point1,
      0,
      audioAssets,
    );
    expect(updated?.document.audioCues[0]).toMatchObject({
      gainDb: -3,
      loop: false,
    });

    updated!.values.scenes[1]!.audioCues[0]!.assetId = null;
    const removed = commitSceneAudioStructural(
      base,
      updated!.values,
      DEFAULT_SCENE_IDS.point1,
      0,
      audioAssets,
    );
    expect(removed?.document.audioCues).toEqual([]);
  });

  it("作品全体BGMを操作コア経由で確定・削除できる", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.bgm = {
      cueId: null,
      assetId: "asset-audio",
      gainDb: -6,
      loop: true,
    };
    const audioAssets = [
      {
        id: "asset-audio",
        kind: "audio" as const,
        status: "ready" as const,
        durationMs: 5000,
        hasAudio: true,
      },
    ];
    const added = commitBgmStructural(base, values, audioAssets);
    expect(added?.document.audioCues).toHaveLength(1);
    expect(added?.document.audioCues[0]).toMatchObject({
      role: "bgm",
      assetId: "asset-audio",
      range: { kind: "work" },
      gainDb: -6,
      loop: true,
    });
    expect(added?.values.bgm.cueId).toBe(added?.document.audioCues[0]?.id);

    added!.values.bgm.gainDb = -3;
    const updated = commitBgmStructural(base, added!.values, audioAssets);
    expect(updated?.document.audioCues[0]?.gainDb).toBe(-3);

    updated!.values.bgm.assetId = null;
    const removed = commitBgmStructural(base, updated!.values, audioAssets);
    expect(removed?.document.audioCues).toEqual([]);
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
