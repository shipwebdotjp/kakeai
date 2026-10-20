import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  type ContentDocument,
  type ScriptOperation,
} from "@kakeai/contracts";
import { applyScriptOperation, applyScriptOperations } from "./apply.ts";
import type { ScriptAssetInfo, ScriptContext } from "./context.ts";
import { ScriptEditError } from "./errors.ts";

function createContext(
  assets: Record<string, ScriptAssetInfo> = {},
): ScriptContext {
  let sceneCount = 0;
  let lineCount = 0;
  return {
    assets: { get: (assetId) => assets[assetId] ?? null },
    ids: {
      scene: () => `scene-point-new-${(sceneCount += 1)}`,
      line: (sceneId) => `line-${sceneId}-${(lineCount += 1)}`,
      cue: (sceneId, suffix) => `visual-${sceneId}-${suffix}`,
      audioTake: (lineId) => `take-${lineId}-1`,
    },
  };
}

function sceneIds(document: ContentDocument): string[] {
  return document.scenes.map((scene) => scene.id);
}

function expectEditError(
  callback: () => unknown,
  code: ScriptEditError["code"],
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ScriptEditError);
    expect((error as ScriptEditError).code).toBe(code);
    return;
  }
  throw new Error(`エラーが発生しませんでした: ${code}`);
}

describe("applyScriptOperations", () => {
  it("要点Sceneを末尾へ追加し、既定のCueとラベルを付ける", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperations(
      document,
      [
        {
          op: "scene.add",
          kind: "point",
          key: "new-scene",
          lines: [{ captionText: "最初の行", speechText: "さいしょのぎょう" }],
        },
      ],
      createContext(),
    );

    expect(sceneIds(result.document)).toEqual([
      DEFAULT_SCENE_IDS.intro,
      DEFAULT_SCENE_IDS.point1,
      "scene-point-new-1",
      DEFAULT_SCENE_IDS.outro,
    ]);
    const added = result.document.scenes[2]!;
    expect(added.label).toBe("要点 2");
    expect(added.kind).toBe("point");
    expect(added.visualCues).toHaveLength(2);
    expect(added.lines).toEqual([
      {
        id: "line-scene-point-new-1-1",
        speakerId: null,
        captionText: "最初の行",
        speechText: "さいしょのぎょう",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ]);
    expect(result.created.sceneIds).toEqual(["scene-point-new-1"]);
    expect(result.created.lineIds).toEqual(["line-scene-point-new-1-1"]);
    expect(result.created.cueIds).toHaveLength(2);
  });

  it("同じ呼び出し内のkey参照で作成したSceneを操作できる", () => {
    const document = createInitialContentDocument();
    const operations: ScriptOperation[] = [
      { op: "scene.add", kind: "point", key: "created" },
      { op: "scene.setLabel", sceneId: { key: "created" }, label: "追加" },
    ];
    const result = applyScriptOperations(document, operations, createContext());

    expect(result.document.scenes[2]!.label).toBe("追加");
    expect(sceneIds(result.document)).toHaveLength(4);
  });

  it("未解決のkeyを拒否する", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "scene.remove", sceneId: { key: "missing" } },
          createContext(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });

  it("導入と結びは削除できない", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "scene.remove", sceneId: DEFAULT_SCENE_IDS.intro },
          createContext(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("Sceneの削除で行の音声とScene範囲のAudioCueも削除する", () => {
    const document = createInitialContentDocument();
    const point = document.scenes[1]!;
    point.lines.push({
      id: "line-point-1-a",
      speakerId: null,
      captionText: "行",
      speechText: "ぎょう",
      selectedAudioTakeId: "take-1",
      expressionId: null,
    });
    document.audioTakes.push({
      id: "take-1",
      narrationSegmentId: "line-point-1-a",
      source: "manual",
      assetId: "asset-audio",
      durationMs: 1000,
    });
    document.audioCues.push({
      id: "audio-scene",
      role: "sfx",
      assetId: "asset-audio",
      range: { kind: "scene", sceneId: point.id },
    });

    const result = applyScriptOperation(
      document,
      { op: "scene.remove", sceneId: point.id },
      createContext(),
    );

    expect(sceneIds(result.document)).toEqual([
      DEFAULT_SCENE_IDS.intro,
      DEFAULT_SCENE_IDS.outro,
    ]);
    expect(result.document.audioTakes).toEqual([]);
    expect(result.document.audioCues).toEqual([]);
  });

  it("Sceneの移動は導入と結びの間へ丸める", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperation(
      document,
      { op: "scene.move", sceneId: DEFAULT_SCENE_IDS.point1, index: 99 },
      createContext(),
    );

    expect(sceneIds(result.document)).toEqual([
      DEFAULT_SCENE_IDS.intro,
      DEFAULT_SCENE_IDS.point1,
      DEFAULT_SCENE_IDS.outro,
    ]);
  });

  it("挿入位置は文書全体の位置として扱う", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperation(
      document,
      { op: "scene.add", kind: "point", index: 1 },
      createContext(),
    );

    expect(sceneIds(result.document)).toEqual([
      DEFAULT_SCENE_IDS.intro,
      "scene-point-new-1",
      DEFAULT_SCENE_IDS.point1,
      DEFAULT_SCENE_IDS.outro,
    ]);
  });

  it("readyな動画Assetだけをinsert Sceneへ追加できる", () => {
    const document = createInitialContentDocument();
    const context = createContext({
      "asset-video": {
        kind: "video",
        status: "ready",
        durationMs: 3000,
        hasAudio: true,
      },
    });

    const result = applyScriptOperation(
      document,
      {
        op: "scene.add",
        kind: "insert",
        assetId: "asset-video",
        durationMs: 3000,
      },
      context,
    );

    expect(sceneIds(result.document)).toEqual([
      DEFAULT_SCENE_IDS.intro,
      DEFAULT_SCENE_IDS.point1,
      "scene-point-new-1",
      DEFAULT_SCENE_IDS.outro,
    ]);
    const insert = result.document.scenes[2]!;
    expect(insert.kind).toBe("insert");
    if (insert.kind !== "insert") {
      throw new Error("insert Sceneではありません。");
    }
    expect(insert.timing).toEqual({ mode: "fixed", durationMs: 3000 });
    expect(insert.embeddedAudio).toBe(true);
    expect(result.created.cueIds).toEqual(insert.visualCues.map((cue) => cue.id));
    expect(result.document.scenes[2]!.visualCues[0]?.input).toEqual({
      assetId: "asset-video",
      fit: "cover",
    });
  });

  it("音声のない動画をembeddedAudio:trueで追加できない", () => {
    const document = createInitialContentDocument();
    const context = createContext({
      "asset-video": {
        kind: "video",
        status: "ready",
        durationMs: 3000,
        hasAudio: false,
      },
    });

    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "scene.add",
            kind: "insert",
            assetId: "asset-video",
            durationMs: 3000,
          },
          context,
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("insert Sceneの尺がAssetと一致しなければ拒否する", () => {
    const document = createInitialContentDocument();
    const context = createContext({
      "asset-video": {
        kind: "video",
        status: "ready",
        durationMs: 3000,
        hasAudio: false,
      },
    });

    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "scene.add",
            kind: "insert",
            assetId: "asset-video",
            durationMs: 2999,
          },
          context,
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("固定尺が音声と間の合計を下回る変更を拒否する", () => {
    const document = createInitialContentDocument();
    const point = document.scenes[1]!;
    point.lines.push({
      id: "line-point-1-a",
      speakerId: null,
      captionText: "行",
      speechText: "ぎょう",
      selectedAudioTakeId: "take-1",
      expressionId: null,
      gapBeforeMs: 500,
    });
    document.audioTakes.push({
      id: "take-1",
      narrationSegmentId: "line-point-1-a",
      source: "manual",
      assetId: "asset-audio",
      durationMs: 1000,
    });

    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "scene.setTiming",
            sceneId: point.id,
            timing: { mode: "fixed", durationMs: 1400 },
          },
          createContext(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("先頭Sceneのトランジションは尺0に限る", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "scene.setTransition",
            sceneId: DEFAULT_SCENE_IDS.intro,
            enter: { preset: "fade", durationMs: 100 },
          },
          createContext(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });

  it("存在しないSceneを拒否する", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "scene.setLabel", sceneId: "missing", label: "x" },
          createContext(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
  });
});
