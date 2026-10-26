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
  it("立ち絵を別Sceneへ移動・複製・入れ替えできる", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "char-1",
        name: "一人目",
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
      {
        id: "char-2",
        name: "二人目",
        names: [],
        voices: [],
        appearances: [
          {
            id: "app-2",
            assetId: "asset-image",
            expression: "normal",
            pose: "default",
            faceSetId: null,
          },
        ],
      },
    ];
    const withStanding = commitStandingStructural(
      base,
      (() => {
        const form = toFormValues(base);
        const slot = form.scenes[1]!.standings.find(
          (entry) => entry.side === "left",
        )!;
        slot.characterId = "char-1";
        slot.appearanceId = "app-1";
        return form;
      })(),
      DEFAULT_SCENE_IDS.point1,
      "left",
      [],
    )!;
    const outroForm = withStanding.values;
    const outroSlot = outroForm.scenes[2]!.standings.find(
      (entry) => entry.side === "left",
    )!;
    outroSlot.characterId = "char-2";
    outroSlot.appearanceId = "app-2";
    const bothSet = commitStandingStructural(
      withStanding.document,
      outroForm,
      DEFAULT_SCENE_IDS.outro,
      "left",
      [],
    )!;

    const swapped = transferStandingsStructural(
      bothSet.document,
      bothSet.values,
      DEFAULT_SCENE_IDS.point1,
      DEFAULT_SCENE_IDS.outro,
      "swap",
      [],
    );
    expect(swapped).not.toBeNull();
    const pointCue = swapped?.document.scenes
      .find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
      ?.visualCues.find((cue) => cue.template.id === "character.standing");
    const outroCue = swapped?.document.scenes
      .find((scene) => scene.id === DEFAULT_SCENE_IDS.outro)
      ?.visualCues.find((cue) => cue.template.id === "character.standing");
    expect(pointCue?.input).toMatchObject({ characterId: "char-2" });
    expect(outroCue?.input).toMatchObject({ characterId: "char-1" });

    const moved = transferStandingsStructural(
      bothSet.document,
      bothSet.values,
      DEFAULT_SCENE_IDS.point1,
      DEFAULT_SCENE_IDS.outro,
      "move",
      [],
    );
    expect(moved).not.toBeNull();
    expect(
      moved?.document.scenes
        .find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.some((cue) => cue.template.id === "character.standing"),
    ).toBe(false);
    expect(
      moved?.document.scenes
        .find((scene) => scene.id === DEFAULT_SCENE_IDS.outro)
        ?.visualCues.find((cue) => cue.template.id === "character.standing")
        ?.input,
    ).toMatchObject({ characterId: "char-1" });

    const copied = transferStandingsStructural(
      bothSet.document,
      bothSet.values,
      DEFAULT_SCENE_IDS.point1,
      DEFAULT_SCENE_IDS.outro,
      "copy",
      [],
    );
    expect(copied).not.toBeNull();
    expect(
      copied?.document.scenes
        .find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.some((cue) => cue.template.id === "character.standing"),
    ).toBe(true);
    expect(
      copied?.document.scenes
        .find((scene) => scene.id === DEFAULT_SCENE_IDS.outro)
        ?.visualCues.find((cue) => cue.template.id === "character.standing")
        ?.input,
    ).toMatchObject({ characterId: "char-1" });
  });

  it("立ち絵を複数のSceneへまとめて複製できる", () => {
    const base = createInitialContentDocument();
    base.characters = [
      {
        id: "char-1",
        name: "一人目",
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
    const form = toFormValues(base);
    const slot = form.scenes[1]!.standings.find(
      (entry) => entry.side === "left",
    )!;
    slot.characterId = "char-1";
    slot.appearanceId = "app-1";
    const committed = commitStandingStructural(
      base,
      form,
      DEFAULT_SCENE_IDS.point1,
      "left",
      [],
    )!;

    const copied = copyStandingsStructural(
      committed.document,
      committed.values,
      DEFAULT_SCENE_IDS.point1,
      [DEFAULT_SCENE_IDS.intro, DEFAULT_SCENE_IDS.outro],
      [],
    );
    expect(copied).not.toBeNull();
    for (const sceneId of [DEFAULT_SCENE_IDS.intro, DEFAULT_SCENE_IDS.outro]) {
      expect(
        copied?.document.scenes
          .find((scene) => scene.id === sceneId)
          ?.visualCues.find((cue) => cue.template.id === "character.standing")
          ?.input,
      ).toMatchObject({ characterId: "char-1" });
    }
    expect(
      copied?.document.scenes
        .find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.some((cue) => cue.template.id === "character.standing"),
    ).toBe(true);
  });

  it("立ち絵のないSceneからの移動・複製は行わない", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    expect(
      transferStandingsStructural(
        base,
        values,
        DEFAULT_SCENE_IDS.point1,
        DEFAULT_SCENE_IDS.outro,
        "move",
        [],
      ),
    ).toBeNull();
    expect(
      transferStandingsStructural(
        base,
        values,
        DEFAULT_SCENE_IDS.point1,
        DEFAULT_SCENE_IDS.outro,
        "copy",
        [],
      ),
    ).toBeNull();
  });
});
