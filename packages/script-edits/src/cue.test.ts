import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  type ContentDocument,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import { applyScriptOperation, applyScriptOperations } from "./apply.ts";
import { ScriptEditError } from "./errors.ts";
import { createTestContext } from "./testing.ts";

function pointScene(document: ContentDocument): PointScene {
  const scene = document.scenes.find((entry) => entry.id === DEFAULT_SCENE_IDS.point1);
  if (scene === undefined || scene.kind !== "point") {
    throw new Error("要点Sceneがありません。");
  }
  return scene;
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

function documentWithLines(): { document: ContentDocument; point: PointScene } {
  const document = createInitialContentDocument();
  const point = pointScene(document);
  point.lines = [
    {
      id: "line-a",
      speakerId: null,
      captionText: "A",
      speechText: "A",
      selectedAudioTakeId: null,
      expressionId: null,
    },
    {
      id: "line-b",
      speakerId: null,
      captionText: "B",
      speechText: "B",
      selectedAudioTakeId: null,
      expressionId: null,
    },
  ];
  return { document, point };
}

const TEXT_BLOCK = { id: "text.block", version: 1 } as const;

describe("cue operations", () => {
  it("cue.addでCueを追加し、key参照のsetInputで部分更新する", () => {
    const { document, point } = documentWithLines();
    const merged = applyScriptOperations(
      document,
      [
        {
          op: "cue.add",
          key: "new-cue",
          sceneId: point.id,
          template: TEXT_BLOCK,
          range: {
            kind: "lines",
            startLineId: "line-a",
            endLineId: "line-b",
          },
          layer: "overlay",
          order: 10,
          input: { text: "T", role: "body", anchor: "left" },
        },
        {
          op: "cue.setInput",
          sceneId: point.id,
          cueId: { key: "new-cue" },
          input: { text: "U" },
        },
      ],
      createTestContext(),
    );
    const cueId = merged.created.cueIds[0]!;
    const mergedScene = merged.document.scenes[1]!;
    if (mergedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const mergedCue = mergedScene.visualCues.find((entry) => entry.id === cueId);
    expect(mergedCue?.input).toEqual({
      text: "U",
      role: "body",
      anchor: "left",
    });

    const result = applyScriptOperation(
      merged.document,
      {
        op: "cue.setInput",
        sceneId: point.id,
        cueId,
        input: { text: "V", role: "body" },
        replace: true,
      },
      createTestContext(),
    );
    const scene = result.document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const cue = scene.visualCues.find((entry) => entry.id === cueId);
    expect(cue).toBeDefined();
    expect(cue?.range).toEqual({
      kind: "lines",
      startLineId: "line-a",
      endLineId: "line-b",
    });
    expect(cue?.input).toEqual({ text: "V", role: "body" });
    expect(cue?.transition).toEqual({
      enter: { preset: "none", durationMs: 0 },
      exit: { preset: "none", durationMs: 0 },
    });
    expect(merged.created.cueIds).toHaveLength(1);
    expect(contentDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it("未対応テンプレートとorder重複を拒否する", () => {
    const { document, point } = documentWithLines();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "cue.add",
            sceneId: point.id,
            template: { id: "unknown.template", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            input: {},
          },
          createTestContext(),
        ),
      "EDIT_UNSUPPORTED_TEMPLATE",
    );
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "cue.add",
            sceneId: point.id,
            template: TEXT_BLOCK,
            range: { kind: "scene" },
            layer: "overlay",
            order: 0,
            input: { text: "T", role: "body" },
          },
          createTestContext(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "cue.add",
            sceneId: point.id,
            template: TEXT_BLOCK,
            range: {
              kind: "lines",
              startLineId: "line-b",
              endLineId: "line-a",
            },
            layer: "overlay",
            input: { text: "T", role: "body" },
          },
          createTestContext(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });

  it("Cueの行参照がScene外なら拒否する", () => {
    const { document, point } = documentWithLines();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          {
            op: "cue.add",
            sceneId: point.id,
            template: { id: "list.callout", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            input: {
              items: [
                {
                  text: "A",
                  trigger: {
                    kind: "lines",
                    startLineId: "line-missing",
                    endLineId: "line-missing",
                  },
                  effect: { kind: "appear", preset: "fade", durationMs: 100 },
                },
              ],
            },
          },
          createTestContext(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });

  it("cue.setRangeでoffset範囲の警告を返す", () => {
    const { document, point } = documentWithLines();
    const added = applyScriptOperation(
      document,
      {
        op: "cue.add",
        sceneId: point.id,
        template: TEXT_BLOCK,
        range: { kind: "scene" },
        layer: "overlay",
        order: 10,
        input: { text: "T", role: "body" },
      },
      createTestContext(),
    );
    const scene = added.document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    const cueId = added.created.cueIds[0]!;

    const ranged = applyScriptOperation(
      added.document,
      {
        op: "cue.setRange",
        sceneId: point.id,
        cueId,
        range: { kind: "offset", startMs: 5000, endMs: 9000 },
      },
      createTestContext(),
    );
    expect(
      ranged.warnings.some((warning) => warning.code === "offset_range_clamped"),
    ).toBe(true);

    const outOfScene = applyScriptOperation(
      added.document,
      {
        op: "cue.setRange",
        sceneId: point.id,
        cueId,
        range: { kind: "offset", startMs: 9000, endMs: 9500 },
      },
      createTestContext(),
    );
    expect(
      outOfScene.warnings.some(
        (warning) => warning.code === "offset_range_out_of_scene",
      ),
    ).toBe(true);

    expectEditError(
      () =>
        applyScriptOperation(
          added.document,
          {
            op: "cue.setRange",
            sceneId: point.id,
            cueId,
            range: {
              kind: "lines",
              startLineId: "line-a",
              endLineId: "line-missing",
            },
          },
          createTestContext(),
        ),
      "EDIT_INVALID_INPUT",
    );
  });

  it("cue.setPlacement・setTransition・removeを反映する", () => {
    const { document, point } = documentWithLines();
    const added = applyScriptOperation(
      document,
      {
        op: "cue.add",
        sceneId: point.id,
        template: TEXT_BLOCK,
        range: { kind: "scene" },
        layer: "overlay",
        order: 10,
        input: { text: "T", role: "body" },
      },
      createTestContext(),
    );
    const cueId = added.created.cueIds[0]!;

    expectEditError(
      () =>
        applyScriptOperation(
          added.document,
          {
            op: "cue.setPlacement",
            sceneId: point.id,
            cueId,
            layer: "overlay",
            order: 0,
          },
          createTestContext(),
        ),
      "EDIT_PRECONDITION_FAILED",
    );

    const placed = applyScriptOperation(
      added.document,
      {
        op: "cue.setPlacement",
        sceneId: point.id,
        cueId,
        layer: "overlay",
        order: 20,
      },
      createTestContext(),
    );
    const placedScene = placed.document.scenes[1]!;
    if (placedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(placedScene.visualCues.find((cue) => cue.id === cueId)?.order).toBe(20);

    const transitioned = applyScriptOperation(
      added.document,
      {
        op: "cue.setTransition",
        sceneId: point.id,
        cueId,
        enter: { preset: "fade", durationMs: 200 },
      },
      createTestContext(),
    );
    const transitionedScene = transitioned.document.scenes[1]!;
    if (transitionedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(
      transitionedScene.visualCues.find((cue) => cue.id === cueId)?.transition
        .enter,
    ).toEqual({ preset: "fade", durationMs: 200 });

    expectEditError(
      () =>
        applyScriptOperation(
          added.document,
          {
            op: "cue.setTransition",
            sceneId: point.id,
            cueId,
            enter: { preset: "fade", durationMs: 2000 },
          },
          createTestContext(),
        ),
      "EDIT_INVALID_INPUT",
    );

    const removed = applyScriptOperation(
      added.document,
      { op: "cue.remove", sceneId: point.id, cueId },
      createTestContext(),
    );
    const removedScene = removed.document.scenes[1]!;
    if (removedScene.kind !== "point") {
      throw new Error("要点Sceneではありません。");
    }
    expect(
      removedScene.visualCues.some((cue: VisualCue) => cue.id === cueId),
    ).toBe(false);
  });

  it("insert SceneのCue操作を拒否する", () => {
    const document = createInitialContentDocument();
    const context = createTestContext({
      "asset-video": {
        kind: "video",
        status: "ready",
        durationMs: 3000,
        hasAudio: false,
      },
    });
    const withInsert = applyScriptOperation(
      document,
      {
        op: "scene.add",
        kind: "insert",
        assetId: "asset-video",
        durationMs: 3000,
        embeddedAudio: false,
      },
      context,
    );
    const insert = withInsert.document.scenes.find(
      (scene) => scene.kind === "insert",
    );
    expect(insert).toBeDefined();
    expectEditError(
      () =>
        applyScriptOperation(
          withInsert.document,
          {
            op: "cue.remove",
            sceneId: insert!.id,
            cueId: (insert as { mainVisualCueId: string }).mainVisualCueId,
          },
          context,
        ),
      "EDIT_PRECONDITION_FAILED",
    );
  });
});
