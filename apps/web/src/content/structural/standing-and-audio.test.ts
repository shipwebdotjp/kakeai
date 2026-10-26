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
  it("立ち絵設定を操作コア経由で確定・削除できる", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "char-1",
        name: "キャラクター",
        names: [],
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
      edge: "margin",
      vertical: "standard",
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

});
