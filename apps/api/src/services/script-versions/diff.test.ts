import { describe, expect, it } from "vitest";
import type { ContentDocument, NarrationSegment } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { diffScriptContents } from "./diff.ts";

function documentWithMutator(
  mutate: (document: ContentDocument) => void,
): ContentDocument {
  const document = validContentDocument();
  mutate(document);
  return document;
}

function lineById(document: ContentDocument, lineId: string): NarrationSegment {
  for (const scene of document.scenes) {
    const line = scene.lines.find((entry) => entry.id === lineId);
    if (line !== undefined) {
      return line;
    }
  }
  throw new Error(`missing line: ${lineId}`);
}

describe("diffScriptContents", () => {
  it("returns an empty diff for the same document", () => {
    const document = validContentDocument();
    expect(diffScriptContents(document, validContentDocument())).toEqual({
      scenes: { added: [], removed: [], updated: [], moved: [] },
      lines: { added: [], removed: [], updated: [], moved: [] },
      cues: { added: [], removed: [], updated: [], moved: [] },
      outsideScopeChangedFields: [],
    });
  });

  it("reports line content changes and moves separately", () => {
    const from = validContentDocument();
    const to = documentWithMutator((document) => {
      const scene = document.scenes.find((entry) => entry.id === "scene-point-1");
      const target = document.scenes.find((entry) => entry.id === "scene-point-2");
      if (scene === undefined || target === undefined) {
        throw new Error("fixture scenes missing");
      }
      const [line] = scene.lines.splice(0, 1);
      if (line === undefined) {
        throw new Error("fixture line missing");
      }
      line.captionText = "変更後の字幕です。";
      target.lines.push(line);
    });

    const diff = diffScriptContents(from, to);
    expect(diff.lines.updated).toEqual([
      {
        id: "line-p1-1",
        sceneId: "scene-point-2",
        changedFields: ["captionText"],
      },
    ]);
    expect(diff.lines.moved).toEqual([
      {
        id: "line-p1-1",
        fromSceneId: "scene-point-1",
        toSceneId: "scene-point-2",
        fromIndex: 0,
        toIndex: 0,
      },
    ]);
    // Position is only reported as `moved`, never as a content change.
    expect(diff.lines.added).toEqual([]);
    expect(diff.lines.removed).toEqual([]);
    expect(diff.scenes.updated).toEqual([]);
  });

  it("does not repeat the children of an added or removed scene", () => {
    const from = validContentDocument();
    const addedScene = { ...structuredClone(from.scenes[1]!) };
    addedScene.id = "scene-point-new";
    addedScene.label = "追加の要点";
    addedScene.lines = [];
    addedScene.visualCues = [];
    const to = documentWithMutator((document) => {
      document.scenes.splice(2, 0, addedScene);
    });

    const added = diffScriptContents(from, to);
    expect(added.scenes.added).toEqual([
      { id: "scene-point-new", index: 2, lineCount: 0, cueCount: 0 },
    ]);
    expect(added.lines.added).toEqual([]);
    expect(added.cues.added).toEqual([]);

    const removed = diffScriptContents(to, from);
    expect(removed.scenes.removed).toEqual([
      { id: "scene-point-new", index: 2, lineCount: 0, cueCount: 0 },
    ]);
    expect(removed.lines.removed).toEqual([]);
    expect(removed.cues.removed).toEqual([]);
  });

  it("reports scene reordering and cue updates", () => {
    const to = documentWithMutator((document) => {
      const scene = document.scenes.find((entry) => entry.id === "scene-point-2");
      const cue = scene?.visualCues.find((entry) => entry.id === "vc-p2-body");
      if (cue === undefined) {
        throw new Error("fixture cue missing");
      }
      cue.input = { text: "差し替えた本文" };
      const point1 = document.scenes.findIndex(
        (entry) => entry.id === "scene-point-1",
      );
      const point2 = document.scenes.findIndex(
        (entry) => entry.id === "scene-point-2",
      );
      const [moved] = document.scenes.splice(point2, 1);
      if (moved !== undefined) {
        document.scenes.splice(point1, 0, moved);
      }
    });

    const diff = diffScriptContents(validContentDocument(), to);
    expect(diff.scenes.moved).toEqual([
      { id: "scene-point-2", fromIndex: 2, toIndex: 1 },
      { id: "scene-point-1", fromIndex: 1, toIndex: 2 },
    ]);
    expect(diff.cues.updated).toEqual([
      {
        id: "vc-p2-body",
        sceneId: "scene-point-2",
        changedFields: ["input"],
      },
    ]);
    expect(diff.lines.moved).toEqual([]);
  });

  it("lists only field names of top-level changes outside the compared scope", () => {
    const to = documentWithMutator((document) => {
      document.speakers.push({
        id: "speaker-extra",
        name: "追加の話者",
        characterId: null,
        voiceProfileId: null,
      });
      document.audioCues[0]!.gainDb = -12;
    });

    const diff = diffScriptContents(validContentDocument(), to);
    expect(diff.outsideScopeChangedFields).toEqual(["audioCues", "speakers"]);
    expect(diff.scenes).toEqual({
      added: [],
      removed: [],
      updated: [],
      moved: [],
    });
  });

  it("reports an added line only when its scene exists on both sides", () => {
    const to = documentWithMutator((document) => {
      const scene = document.scenes.find((entry) => entry.id === "scene-point-1");
      if (scene === undefined) {
        throw new Error("fixture scene missing");
      }
      scene.lines.push({
        id: "line-p1-2",
        speakerId: "speaker-narrator",
        captionText: "二行目の字幕です。",
        speechText: "にぎょうめのじまくです。",
        selectedAudioTakeId: null,
        expressionId: null,
      });
    });

    const diff = diffScriptContents(validContentDocument(), to);
    expect(diff.lines.added).toEqual([
      { id: "line-p1-2", sceneId: "scene-point-1", index: 1 },
    ]);
    expect(lineById(to, "line-p1-2").captionText).toBe("二行目の字幕です。");
  });
});
