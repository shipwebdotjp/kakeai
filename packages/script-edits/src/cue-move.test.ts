import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  type ContentDocument,
} from "@kakeai/contracts";
import { applyScriptOperation, applyScriptOperations } from "./apply.ts";
import type { ScriptContext } from "./context.ts";
import { ScriptEditError } from "./errors.ts";

function createContext(): ScriptContext {
  let cueCount = 0;
  return {
    assets: { get: () => null },
    ids: {
      scene: () => `scene-test-${Math.random()}`,
      line: (sceneId) => `line-${sceneId}-new`,
      cue: () => `visual-copied-${(cueCount += 1)}`,
      audioCue: () => `audio-test`,
      audioTake: (lineId) => `take-${lineId}-1`,
      character: () => "character-new-1",
      appearance: () => "appearance-new-1",
      speaker: () => "speaker-new-1",
    },
  };
}

function addLine(document: ContentDocument, sceneId: string, lineId: string): ContentDocument {
  return applyScriptOperation(
    document,
    {
      op: "line.add",
      sceneId,
      captionText: "テスト",
      speechText: "てすと",
    },
    createContext(),
  ).document;
}

function lineIdsOf(document: ContentDocument, sceneId: string): string[] {
  return (
    document.scenes.find((scene) => scene.id === sceneId)?.lines.map((line) => line.id) ?? []
  );
}

function addTableCue(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
): ContentDocument {
  return applyScriptOperation(
    document,
    {
      op: "cue.add",
      sceneId,
      template: { id: "table.simple", version: 1 },
      range: { kind: "lines", startLineId: lineId, endLineId: lineId },
      layer: "card",
      input: {
        data: {
          columns: [{ key: "name", label: "項目", type: "text" }],
          rows: [{ name: "a" }],
        },
        effects: [
          {
            target: { kind: "row", index: 0 },
            trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      },
    },
    createContext(),
  ).document;
}

function expectEditError(callback: () => unknown, code: ScriptEditError["code"]): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ScriptEditError);
    expect((error as ScriptEditError).code).toBe(code);
    return;
  }
  throw new Error(`エラーが発生しませんでした: ${code}`);
}

describe("cue.move", () => {
  it("lines範囲とトリガーを初期化して別Sceneへ移動する", () => {
    let document = createInitialContentDocument();
    document = addLine(document, DEFAULT_SCENE_IDS.point1, "line-1");
    const [lineId] = lineIdsOf(document, DEFAULT_SCENE_IDS.point1);
    document = addTableCue(document, DEFAULT_SCENE_IDS.point1, lineId!);
    const cueId =
      document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.at(-1)?.id ?? "";

    const result = applyScriptOperation(
      document,
      { op: "cue.move", sceneId: DEFAULT_SCENE_IDS.point1, cueId, toSceneId: DEFAULT_SCENE_IDS.outro },
      createContext(),
    );

    const source = result.document.scenes.find(
      (scene) => scene.id === DEFAULT_SCENE_IDS.point1,
    )!;
    expect(source.visualCues.some((cue) => cue.id === cueId)).toBe(false);
    const target = result.document.scenes.find(
      (scene) => scene.id === DEFAULT_SCENE_IDS.outro,
    )!;
    const moved = target.visualCues.find((cue) => cue.id === cueId)!;
    expect(moved.range).toEqual({ kind: "scene" });
    expect(moved.input).toMatchObject({
      effects: [{ trigger: { kind: "cue" } }],
    });
    expect(result.warnings.some((warning) => warning.code === "cue_line_refs_reset")).toBe(true);
  });

  it("同一Sceneとinsert Sceneへの移動を拒否する", () => {
    let document = createInitialContentDocument();
    document = addLine(document, DEFAULT_SCENE_IDS.point1, "line-1");
    const [lineId] = lineIdsOf(document, DEFAULT_SCENE_IDS.point1);
    document = addTableCue(document, DEFAULT_SCENE_IDS.point1, lineId!);
    const cueId =
      document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.at(-1)?.id ?? "";
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "cue.move",
            sceneId: DEFAULT_SCENE_IDS.point1,
            cueId,
            toSceneId: DEFAULT_SCENE_IDS.point1,
          },
          createContext(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });

  it("立ち絵Cueの移動を拒否する", () => {
    let document = createInitialContentDocument();
    document = applyScriptOperation(
      document,
      {
        op: "cue.add",
        sceneId: DEFAULT_SCENE_IDS.point1,
        template: { id: "character.standing", version: 1 },
        range: { kind: "scene" },
        layer: "standing",
        input: {
          side: "left",
          characterId: "character-1",
          appearanceId: "appearance-1",
          scale: 1,
        },
      },
      createContext(),
    ).document;
    const cueId =
      document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.at(-1)?.id ?? "";
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "cue.move",
            sceneId: DEFAULT_SCENE_IDS.point1,
            cueId,
            toSceneId: DEFAULT_SCENE_IDS.outro,
          },
          createContext(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });
});

describe("cue.copy", () => {
  it("複数のSceneへ複製しIDを採番し直す", () => {
    let document = createInitialContentDocument();
    document = addLine(document, DEFAULT_SCENE_IDS.point1, "line-1");
    const [lineId] = lineIdsOf(document, DEFAULT_SCENE_IDS.point1);
    document = addTableCue(document, DEFAULT_SCENE_IDS.point1, lineId!);
    const cueId =
      document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.at(-1)?.id ?? "";

    const result = applyScriptOperation(
      document,
      {
        op: "cue.copy",
        sceneId: DEFAULT_SCENE_IDS.point1,
        cueId,
        toSceneIds: [DEFAULT_SCENE_IDS.intro, DEFAULT_SCENE_IDS.outro],
      },
      createContext(),
    );

    const source = result.document.scenes.find(
      (scene) => scene.id === DEFAULT_SCENE_IDS.point1,
    )!;
    expect(source.visualCues.some((cue) => cue.id === cueId)).toBe(true);
    expect(result.created.cueIds).toHaveLength(2);
    expect(new Set(result.created.cueIds).size).toBe(2);
    for (const [index, sceneId] of [DEFAULT_SCENE_IDS.intro, DEFAULT_SCENE_IDS.outro].entries()) {
      const target = result.document.scenes.find((scene) => scene.id === sceneId)!;
      const copied = target.visualCues.find(
        (cue) => cue.id === result.created.cueIds[index],
      )!;
      expect(copied.range).toEqual({ kind: "scene" });
      expect(copied.input).toMatchObject({
        effects: [{ trigger: { kind: "cue" } }],
      });
    }
  });

  it("複製先の重複を拒否する", () => {
    let document = createInitialContentDocument();
    document = addLine(document, DEFAULT_SCENE_IDS.point1, "line-1");
    const [lineId] = lineIdsOf(document, DEFAULT_SCENE_IDS.point1);
    document = addTableCue(document, DEFAULT_SCENE_IDS.point1, lineId!);
    const cueId =
      document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.at(-1)?.id ?? "";
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "cue.copy",
            sceneId: DEFAULT_SCENE_IDS.point1,
            cueId,
            toSceneIds: [DEFAULT_SCENE_IDS.intro, DEFAULT_SCENE_IDS.intro],
          },
          createContext(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });

  it("失敗時は1件も複製しない", () => {
    let document = createInitialContentDocument();
    document = addLine(document, DEFAULT_SCENE_IDS.point1, "line-1");
    const [lineId] = lineIdsOf(document, DEFAULT_SCENE_IDS.point1);
    document = addTableCue(document, DEFAULT_SCENE_IDS.point1, lineId!);
    const cueId =
      document.scenes.find((scene) => scene.id === DEFAULT_SCENE_IDS.point1)
        ?.visualCues.at(-1)?.id ?? "";
    const before = JSON.stringify(document);
    expectEditError(
      () =>
        applyScriptOperations(
          document,
          [
            {
              op: "cue.copy",
              sceneId: DEFAULT_SCENE_IDS.point1,
              cueId,
              toSceneIds: [DEFAULT_SCENE_IDS.intro, "scene-missing"],
            },
          ],
          createContext(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
    expect(JSON.stringify(document)).toBe(before);
  });
});
