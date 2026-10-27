import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  type ContentDocument,
  type PointScene,
} from "@kakeai/contracts";
import { applyScriptOperation } from "./apply.ts";
import { createTestContext } from "./testing.ts";

function pointScene(document: ContentDocument): PointScene {
  const scene = document.scenes.find((entry) => entry.id === DEFAULT_SCENE_IDS.point1);
  if (scene === undefined || scene.kind !== "point") {
    throw new Error("要点Sceneがありません。");
  }
  return scene;
}

function documentWithCharacter(): { document: ContentDocument; point: PointScene } {
  const document = createInitialContentDocument();
  document.characters = [
    {
      id: "char-1",
      name: "A",
      names: [],
      voices: [],
      libraryCharacterId: null,
      appearances: [
        {
          id: "app-1",
          assetId: "asset-image",
          expression: "normal",
          pose: "default",
          faceSetId: null,
          faceSetVersion: null,
          libraryAppearanceId: null,
        },
        {
          id: "app-2",
          assetId: "asset-image-2",
          expression: "smile",
          pose: "default",
          faceSetId: null,
          faceSetVersion: null,
          libraryAppearanceId: null,
        },
      ],
    },
  ];
  return { document, point: pointScene(document) };
}

describe("standing operations", () => {
  it("左右の立ち絵を追加・更新・削除する", () => {
    const { document, point } = documentWithCharacter();
    const left = applyScriptOperation(
      document,
      {
        op: "standing.upsert",
        sceneId: point.id,
        side: "left",
        characterId: "char-1",
        appearanceId: "app-1",
        transition: {
          enter: { preset: "fade", durationMs: 200 },
          exit: { preset: "none", durationMs: 0 },
        },
      },
      createTestContext(),
    );
    const leftScene = left.document.scenes[1]!;
    if (leftScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const leftCue = leftScene.visualCues.find(
      (cue) => cue.template.id === "character.standing",
    );
    expect(leftCue).toBeDefined();
    expect(leftCue?.layer).toBe("standing");
    expect(leftCue?.range).toEqual({ kind: "scene" });
    expect(leftCue?.input).toEqual({
      characterId: "char-1",
      appearanceId: "app-1",
      side: "left",
      scale: 1,
      edge: "margin",
      vertical: "standard",
    });
    expect(leftCue?.transition.enter).toEqual({
      preset: "fade",
      durationMs: 200,
    });
    expect(left.created.cueIds).toHaveLength(1);
    expect(contentDocumentSchema.safeParse(left.document).success).toBe(true);

    const updated = applyScriptOperation(
      left.document,
      {
        op: "standing.upsert",
        sceneId: point.id,
        side: "left",
        characterId: "char-1",
        appearanceId: "app-2",
        scale: 1.5,
      },
      createTestContext(),
    );
    const updatedScene = updated.document.scenes[1]!;
    if (updatedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const updatedCues = updatedScene.visualCues.filter(
      (cue) => cue.template.id === "character.standing",
    );
    expect(updatedCues).toHaveLength(1);
    expect(updatedCues[0]?.id).toBe(leftCue?.id);
    expect(updatedCues[0]?.input).toMatchObject({
      appearanceId: "app-2",
      scale: 1.5,
      edge: "margin",
      vertical: "standard",
    });
    expect(updatedCues[0]?.transition.enter).toEqual({
      preset: "fade",
      durationMs: 200,
    });
    expect(updated.created.cueIds).toHaveLength(0);

    const right = applyScriptOperation(
      updated.document,
      {
        op: "standing.upsert",
        sceneId: point.id,
        side: "right",
        characterId: "char-1",
        appearanceId: "app-1",
      },
      createTestContext(),
    );
    const removed = applyScriptOperation(
      right.document,
      { op: "standing.remove", sceneId: point.id, side: "left" },
      createTestContext(),
    );
    const removedScene = removed.document.scenes[1]!;
    if (removedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(removedScene.visualCues).toHaveLength(3);
    expect(
      removedScene.visualCues.some(
        (cue) =>
          cue.template.id === "character.standing" &&
          (cue.input as { side?: string }).side === "left",
      ),
    ).toBe(false);
    expect(contentDocumentSchema.safeParse(removed.document).success).toBe(true);
  });

  it("立ち絵の端寄せと高さを設定し、省略時は既存値を保つ", () => {
    const { document, point } = documentWithCharacter();
    const created = applyScriptOperation(
      document,
      {
        op: "standing.upsert",
        sceneId: point.id,
        side: "left",
        characterId: "char-1",
        appearanceId: "app-1",
        edge: "tight",
        vertical: "up",
      },
      createTestContext(),
    );
    const scene = created.document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const cue = scene.visualCues.find(
      (entry) => entry.template.id === "character.standing",
    );
    expect(cue?.input).toMatchObject({ edge: "tight", vertical: "up", scale: 1 });

    const kept = applyScriptOperation(
      created.document,
      {
        op: "standing.upsert",
        sceneId: point.id,
        side: "left",
        characterId: "char-1",
        appearanceId: "app-2",
      },
      createTestContext(),
    );
    const keptScene = kept.document.scenes[1]!;
    if (keptScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const keptCue = keptScene.visualCues.find(
      (entry) => entry.template.id === "character.standing",
    );
    expect(keptCue?.input).toMatchObject({ edge: "tight", vertical: "up" });
    expect(contentDocumentSchema.safeParse(kept.document).success).toBe(true);
  });

  it("存在しない立ち絵を拒否する", () => {
    const { document, point } = documentWithCharacter();
    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "standing.upsert",
          sceneId: point.id,
          side: "left",
          characterId: "char-1",
          appearanceId: "missing",
        },
        createTestContext(),
      ),
    ).toThrow(/立ち絵/);
  });
});

describe("audio operations", () => {
  function audioContext() {
    return createTestContext({
      "asset-audio": {
        kind: "audio",
        status: "ready",
        durationMs: 5000,
        hasAudio: true,
      },
      "asset-processing": {
        kind: "audio",
        status: "processing",
        durationMs: null,
        hasAudio: true,
      },
    });
  }

  it("BGMの追加・変更・削除とScene音声を扱う", () => {
    const document = createInitialContentDocument();
    const context = audioContext();
    const bgm = applyScriptOperation(
      document,
      {
        op: "audio.add",
        role: "bgm",
        assetId: "asset-audio",
        range: { kind: "work" },
        gainDb: -6,
        loop: true,
      },
      context,
    );
    expect(bgm.created.audioCueIds).toHaveLength(1);
    expect(bgm.document.audioCues[0]).toMatchObject({
      role: "bgm",
      assetId: "asset-audio",
      range: { kind: "work" },
      gainDb: -6,
      loop: true,
    });
    expect(contentDocumentSchema.safeParse(bgm.document).success).toBe(true);

    expect(() =>
      applyScriptOperation(
        bgm.document,
        {
          op: "audio.add",
          role: "bgm",
          assetId: "asset-audio",
          range: { kind: "work" },
        },
        context,
      ),
    ).toThrow(/BGM/);
    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "audio.add",
          role: "sfx",
          assetId: "asset-audio",
          range: { kind: "work" },
        },
        context,
      ),
    ).toThrow(/bgm/);

    const sceneBgm = applyScriptOperation(
      bgm.document,
      {
        op: "audio.add",
        role: "bgm",
        assetId: "asset-audio",
        range: { kind: "scene", sceneId: DEFAULT_SCENE_IDS.point1 },
      },
      context,
    );
    expect(sceneBgm.document.audioCues).toHaveLength(2);

    const sceneAudio = applyScriptOperation(
      bgm.document,
      {
        op: "audio.add",
        role: "sfx",
        assetId: "asset-audio",
        range: { kind: "scene", sceneId: DEFAULT_SCENE_IDS.point1 },
      },
      context,
    );
    const audioCueId = sceneAudio.created.audioCueIds[0]!;
    const updated = applyScriptOperation(
      sceneAudio.document,
      {
        op: "audio.update",
        audioCueId,
        gainDb: null,
        loop: null,
        role: "program",
      },
      context,
    );
    const cue = updated.document.audioCues.find((entry) => entry.id === audioCueId);
    expect(cue?.role).toBe("program");
    expect(cue?.gainDb).toBeUndefined();
    expect(cue?.loop).toBeUndefined();

    const removed = applyScriptOperation(
      updated.document,
      { op: "audio.remove", audioCueId },
      context,
    );
    expect(removed.document.audioCues).toHaveLength(1);
  });

  it("未readyのAssetと存在しないSceneを拒否する", () => {
    const document = createInitialContentDocument();
    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "audio.add",
          role: "sfx",
          assetId: "asset-processing",
          range: { kind: "scene", sceneId: DEFAULT_SCENE_IDS.point1 },
        },
        audioContext(),
      ),
    ).toThrow(/Asset/);
    expect(() =>
      applyScriptOperation(
        document,
        {
          op: "audio.add",
          role: "sfx",
          assetId: "asset-audio",
          range: { kind: "scene", sceneId: "missing" },
        },
        audioContext(),
      ),
    ).toThrow(/Scene/);
  });
});

describe("document.setVisualTheme", () => {
  it("既知のテーマだけを設定できる", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperation(
      document,
      {
        op: "document.setVisualTheme",
        id: SOFT_EDITORIAL_THEME_ID,
        version: SOFT_EDITORIAL_THEME_VERSION,
      },
      createTestContext(),
    );
    expect(result.document.visualTheme).toEqual({
      id: SOFT_EDITORIAL_THEME_ID,
      version: SOFT_EDITORIAL_THEME_VERSION,
    });
    expect(() =>
      applyScriptOperation(
        document,
        { op: "document.setVisualTheme", id: "missing", version: 1 },
        createTestContext(),
      ),
    ).toThrow(/VisualTheme/);
  });
});
