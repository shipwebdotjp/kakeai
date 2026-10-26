import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  type ContentDocument,
  type ScriptOperation,
} from "@kakeai/contracts";
import type { ScriptContext } from "@kakeai/script-edits";
import {
  applyAndValidateScriptOperations,
  validateEditedScriptContent,
  type ScriptValidationReferences,
} from "./script-edits.ts";
import type { AssetWithRenditions, FaceSetDetails } from "./script-versions.ts";

function fakeAsset(
  id: string,
  kind: "image" | "video" | "audio",
  durationMs: number | null,
): AssetWithRenditions {
  return {
    id,
    kind,
    status: "ready",
    durationMs,
    widthPx: kind === "audio" ? null : 1920,
    heightPx: kind === "audio" ? null : 1080,
    hasAudio: kind === "video",
    renditions: [],
  } as unknown as AssetWithRenditions;
}

function references(): ScriptValidationReferences {
  return {
    assetById: new Map([
      ["asset-audio", fakeAsset("asset-audio", "audio", 5000)],
      ["asset-image", fakeAsset("asset-image", "image", null)],
    ]),
    faceSetByKey: new Map<string, FaceSetDetails>(),
    compositionDurations: new Map(),
    compositionProfiles: new Map(),
  };
}

function createContext(): ScriptContext {
  let sceneCount = 0;
  let lineCount = 0;
  let cueCount = 0;
  let takeCount = 0;
  let audioCount = 0;
  let characterCount = 0;
  let appearanceCount = 0;
  let speakerCount = 0;
  return {
    assets: {
      get: (assetId) => {
        if (assetId === "asset-audio") {
          return {
            kind: "audio",
            status: "ready",
            durationMs: 5000,
            hasAudio: true,
          };
        }
        if (assetId === "asset-image") {
          return {
            kind: "image",
            status: "ready",
            durationMs: null,
            hasAudio: false,
          };
        }
        return null;
      },
    },
    ids: {
      scene: () => `scene-edit-${(sceneCount += 1)}`,
      line: (sceneId) => `line-${sceneId}-${(lineCount += 1)}`,
      cue: (sceneId, suffix) => `visual-${sceneId}-${suffix}-${(cueCount += 1)}`,
      audioCue: () => `audio-edit-${(audioCount += 1)}`,
      audioTake: (lineId) => `take-${lineId}-${(takeCount += 1)}`,
      character: () => `character-edit-${(characterCount += 1)}`,
      appearance: () => `appearance-edit-${(appearanceCount += 1)}`,
      speaker: () => `speaker-edit-${(speakerCount += 1)}`,
    },
  };
}

function documentWithCast(): ContentDocument {
  const document = createInitialContentDocument();
  document.speakers = [
    {
      id: "speaker-1",
      name: "話者",
      characterId: null,
      voiceProfileId: null,
    },
  ];
  document.characters = [
    {
      id: "char-1",
      name: "キャラクター",
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
      ],
    },
  ];
  return document;
}

describe("script edit validation service", () => {
  it("代表的な追加・更新操作の結果が保存検証を通る", () => {
    const document = documentWithCast();
    const operations: ScriptOperation[] = [
      { op: "scene.add", kind: "point", key: "scene-a" },
      {
        op: "scene.setLabel",
        sceneId: { key: "scene-a" },
        label: "検証用Scene",
      },
      {
        op: "line.add",
        key: "line-a",
        sceneId: { key: "scene-a" },
        captionText: "前半",
        speechText: "ぜんはん",
      },
      {
        op: "line.split",
        key: "line-b",
        sceneId: { key: "scene-a" },
        lineId: { key: "line-a" },
        first: { captionText: "前半", speechText: "ぜんはん" },
        second: { captionText: "後半", speechText: "こうはん" },
      },
      {
        op: "line.setGap",
        sceneId: { key: "scene-a" },
        lineId: { key: "line-a" },
        gapBeforeMs: 100,
      },
      {
        op: "line.setSpeaker",
        sceneId: { key: "scene-a" },
        lineId: { key: "line-a" },
        speakerId: "speaker-1",
      },
      {
        op: "line.assignTake",
        key: "take-a",
        sceneId: { key: "scene-a" },
        lineId: { key: "line-a" },
        assetId: "asset-audio",
        source: "manual",
      },
      {
        op: "cue.add",
        key: "cue-a",
        sceneId: { key: "scene-a" },
        template: { id: "text.block", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 10,
        input: { text: "T", role: "body" },
      },
      {
        op: "cue.setInput",
        sceneId: { key: "scene-a" },
        cueId: { key: "cue-a" },
        input: { text: "U" },
      },
      {
        op: "cue.setRange",
        sceneId: { key: "scene-a" },
        cueId: { key: "cue-a" },
        range: { kind: "offset", startMs: 0, endMs: 500 },
      },
      {
        op: "standing.set",
        key: "standing-left",
        sceneId: { key: "scene-a" },
        side: "left",
        characterId: "char-1",
        appearanceId: "app-1",
      },
      {
        op: "audio.add",
        key: "bgm",
        role: "bgm",
        assetId: "asset-audio",
        range: { kind: "work" },
      },
      {
        op: "document.setVisualTheme",
        id: SOFT_EDITORIAL_THEME_ID,
        version: SOFT_EDITORIAL_THEME_VERSION,
      },
    ];

    const result = applyAndValidateScriptOperations(
      document,
      operations,
      createContext(),
      references(),
    );

    expect(result.created.sceneIds).toHaveLength(1);
    expect(result.created.lineIds).toHaveLength(2);
    expect(result.created.cueIds).toHaveLength(4);
    expect(result.created.audioTakeIds).toHaveLength(1);
    expect(result.created.audioCueIds).toHaveLength(1);
    expect(result.warnings).toEqual(expect.any(Array));

    const edited = result.document.scenes.find(
      (scene) => scene.id === result.created.sceneIds[0],
    );
    expect(edited?.kind).toBe("point");
    if (edited?.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(edited.label).toBe("検証用Scene");
    expect(edited.lines).toHaveLength(2);
    expect(edited.lines[0]).toMatchObject({
      id: result.created.lineIds[0],
      speakerId: "speaker-1",
      gapBeforeMs: 100,
      selectedAudioTakeId: result.created.audioTakeIds[0],
    });
    expect(edited.visualCues).toHaveLength(4);
    const textCue = edited.visualCues.find(
      (cue) => (cue.input as { text?: string }).text === "U",
    );
    expect(textCue?.input).toEqual({ text: "U", role: "body" });
    expect(result.document.audioCues).toHaveLength(1);
  });

  it("分割・削除後の文書も保存検証を通る", () => {
    const document = documentWithCast();
    const operations: ScriptOperation[] = [
      {
        op: "line.add",
        key: "line-1",
        sceneId: DEFAULT_SCENE_IDS.point1,
        captionText: "1",
        speechText: "いち",
      },
      {
        op: "line.add",
        key: "line-2",
        sceneId: DEFAULT_SCENE_IDS.point1,
        captionText: "2",
        speechText: "に",
      },
      {
        op: "line.add",
        key: "line-3",
        sceneId: DEFAULT_SCENE_IDS.point1,
        captionText: "3",
        speechText: "さん",
      },
      {
        op: "cue.add",
        key: "cue-span",
        sceneId: DEFAULT_SCENE_IDS.point1,
        template: { id: "text.block", version: 1 },
        range: {
          kind: "lines",
          startLineId: { key: "line-1" },
          endLineId: { key: "line-3" },
        },
        layer: "overlay",
        order: 10,
        input: { text: "T", role: "body" },
      },
      {
        op: "scene.splitAtLine",
        key: "scene-2",
        sceneId: DEFAULT_SCENE_IDS.point1,
        lineId: { key: "line-3" },
      },
      {
        op: "line.remove",
        sceneId: DEFAULT_SCENE_IDS.point1,
        lineId: { key: "line-1" },
      },
    ];

    const result = applyAndValidateScriptOperations(
      document,
      operations,
      createContext(),
      references(),
    );

    const first = result.document.scenes.find(
      (scene) => scene.id === DEFAULT_SCENE_IDS.point1,
    );
    const second = result.document.scenes.find(
      (scene) => scene.id === result.created.sceneIds[0],
    );
    expect(first?.kind).toBe("point");
    expect(second?.kind).toBe("point");
    if (first?.kind !== "point" || second?.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(first.lines.map((line) => line.id)).toEqual([
      result.created.lineIds[1],
    ]);
    expect(second.lines.map((line) => line.id)).toEqual([
      result.created.lineIds[2],
    ]);
    expect(result.warnings).toEqual(expect.any(Array));
  });

  it("保存検証と同じ警告コードを返す", () => {
    const document = createInitialContentDocument();
    const operations: ScriptOperation[] = [
      {
        op: "cue.add",
        sceneId: DEFAULT_SCENE_IDS.point1,
        template: { id: "text.block", version: 1 },
        range: { kind: "offset", startMs: 9000, endMs: 9500 },
        layer: "overlay",
        order: 10,
        input: { text: "T", role: "body" },
      },
    ];
    const result = applyAndValidateScriptOperations(
      document,
      operations,
      createContext(),
      references(),
    );
    expect(
      result.warnings.some(
        (warning) => warning.code === "offset_range_out_of_scene",
      ),
    ).toBe(true);
    const warning = result.warnings.find(
      (entry) => entry.code === "offset_range_out_of_scene",
    );
    expect(Array.isArray(warning?.path)).toBe(true);
    expect(warning?.message.length).toBeGreaterThan(0);
  });

  it("後続操作で解消したoffset警告を残さない", () => {
    const document = createInitialContentDocument();
    const operations: ScriptOperation[] = [
      {
        op: "cue.add",
        sceneId: DEFAULT_SCENE_IDS.point1,
        template: { id: "text.block", version: 1 },
        range: { kind: "offset", startMs: 9000, endMs: 9500 },
        layer: "overlay",
        order: 10,
        input: { text: "T", role: "body" },
      },
      ...Array.from({ length: 4 }, (): ScriptOperation => ({
        op: "line.add",
        sceneId: DEFAULT_SCENE_IDS.point1,
      })),
    ];
    const result = applyAndValidateScriptOperations(
      document,
      operations,
      createContext(),
      references(),
    );
    expect(
      result.warnings.some(
        (warning) => warning.code === "offset_range_out_of_scene",
      ),
    ).toBe(false);
  });

  it("保存検証の失敗を検出する", () => {
    const document = createInitialContentDocument();
    const point = document.scenes[1]!;
    point.lines = [
      {
        id: "line-a",
        speakerId: null,
        captionText: "A",
        speechText: "A",
        selectedAudioTakeId: "take-a",
        expressionId: null,
      },
    ];
    document.audioTakes = [
      {
        id: "take-a",
        narrationSegmentId: "line-a",
        source: "manual",
        assetId: "asset-audio",
        durationMs: 999,
      },
    ];

    const messages = (() => {
      try {
        validateEditedScriptContent(document, references());
        return [];
      } catch (error) {
        const details = (error as { details?: { issues?: { message?: string }[] } })
          .details;
        return (details?.issues ?? []).map((issue) => issue.message ?? "");
      }
    })();
    expect(messages.join("\n")).toMatch(/尺/);
  });
});
