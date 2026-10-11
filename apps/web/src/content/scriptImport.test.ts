import { describe, expect, it } from "vitest";
import { createInitialContentDocument } from "@kakeai/contracts";
import {
  buildImportedScenes,
  parseScript,
  splitDialogueLine,
  unresolvedSpeakerNames,
} from "./scriptImport";
import { toFormValues, type SceneFormValue } from "./form";

function baseScenes(): SceneFormValue[] {
  return toFormValues(createInitialContentDocument()).scenes;
}

function pointScenes(scenes: readonly SceneFormValue[]): SceneFormValue[] {
  return scenes.filter((scene) => scene.kind === "point");
}

function headingText(scene: SceneFormValue): string {
  return scene.cues.find((cue) => cue.fields.role === "heading")?.fields.text ?? "";
}

describe("splitDialogueLine", () => {
  it("splits on the first half-width or full-width colon", () => {
    expect(splitDialogueLine("リン:こんにちは")).toEqual({
      speakerName: "リン",
      text: "こんにちは",
    });
    expect(splitDialogueLine("レン：やっほー")).toEqual({
      speakerName: "レン",
      text: "やっほー",
    });
    expect(splitDialogueLine(" リン ： やっほー ")).toEqual({
      speakerName: "リン",
      text: "やっほー",
    });
    expect(splitDialogueLine("リン:やっほー:つづき")).toEqual({
      speakerName: "リン",
      text: "やっほー:つづき",
    });
    expect(splitDialogueLine("書式に合わない行")).toBeNull();
  });
});

describe("parseScript", () => {
  it("parses chapters, mixed colons, and multiple speakers", () => {
    const parsed = parseScript(
      "## 第一章\nリン:こんにちは\nレン：やっほー\n\n## 第二章\nレン:あわわ・・・",
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.chapters.map((chapter) => chapter.heading)).toEqual(["第一章", "第二章"]);
    expect(
      parsed.chapters[0]!.lines.map((line) => [line.speakerName, line.text]),
    ).toEqual([
      ["リン", "こんにちは"],
      ["レン", "やっほー"],
    ]);
    expect(parsed.chapters[1]!.lines[0]!.text).toBe("あわわ・・・");
  });

  it("collects each distinct speaker name once regardless of repetition", () => {
    const parsed = parseScript("## 章\nリン:a\nリン:b\nレン:c\nリン:d");
    expect(parsed.speakerNames).toEqual(["リン", "レン"]);
  });

  it("reports a line before the first heading", () => {
    const parsed = parseScript("リン:先にセリフ\n## 章\nレン:こんにちは");
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.lineNumber)).toEqual([1]);
  });

  it("reports malformed lines and empty heading, speaker, and text", () => {
    const parsed = parseScript(
      "## 章\nリン:ok\nこれはメモ\n## \n: x\nレン:",
    );
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.lineNumber)).toEqual([
      3, 4, 5, 6,
    ]);
  });

  it("reports a chapter without lines", () => {
    const parsed = parseScript("## 章\n## 別\nリン:ok");
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.lineNumber)).toEqual([1]);
  });

  it("reports a missing chapter heading", () => {
    const parsed = parseScript("");
    expect(parsed.chapters).toEqual([]);
    expect(parsed.diagnostics).toHaveLength(1);
  });
});

describe("buildImportedScenes", () => {
  it("maps chapters to point scenes with heading cues and speaker-bound lines", () => {
    const script = parseScript("## 第一章\nリン:a\nレン:b\n## 第二章\nリン:c");
    const assignments = { リン: "speaker-rin", レン: "speaker-ren" };
    const scenes = buildImportedScenes({
      script,
      assignments,
      mode: "replace",
      existingScenes: baseScenes(),
    });
    const points = pointScenes(scenes);
    expect(points).toHaveLength(2);
    expect(points.map(headingText)).toEqual(["第一章", "第二章"]);
    expect(points[0]!.lines.map((line) => line.speakerId)).toEqual([
      "speaker-rin",
      "speaker-ren",
    ]);
    expect(points[0]!.lines.map((line) => line.captionText)).toEqual(["a", "b"]);
    expect(points[0]!.lines.map((line) => line.speechText)).toEqual(["a", "b"]);
    expect(points[0]!.lines.every((line) => line.selectedAudioTakeId === null)).toBe(true);
    expect(points[0]!.lines.every((line) => line.takes.length === 0)).toBe(true);
  });

  it("assigns the same speaker id to every line of that speaker", () => {
    const script = parseScript("## 章\nリン:a\nリン:b\nリン:c");
    const scenes = buildImportedScenes({
      script,
      assignments: { リン: "speaker-rin" },
      mode: "replace",
      existingScenes: baseScenes(),
    });
    expect(pointScenes(scenes)[0]!.lines.every((line) => line.speakerId === "speaker-rin")).toBe(
      true,
    );
  });

  it("keeps a deliberate no-speaker assignment as null", () => {
    const script = parseScript("## 章\nリン:a");
    const scenes = buildImportedScenes({
      script,
      assignments: { リン: null },
      mode: "replace",
      existingScenes: baseScenes(),
    });
    expect(pointScenes(scenes)[0]!.lines[0]!.speakerId).toBeNull();
  });

  it("generates unique scene, cue, and line ids", () => {
    const script = parseScript("## 一\nリン:a\n## 二\nレン:b\nレン:c");
    const scenes = buildImportedScenes({
      script,
      assignments: { リン: null, レン: null },
      mode: "replace",
      existingScenes: baseScenes(),
    });
    const sceneIds = scenes.map((scene) => scene.id);
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
    const cueIds = scenes.flatMap((scene) => scene.cues.map((cue) => cue.id));
    expect(new Set(cueIds).size).toBe(cueIds.length);
    const lineIds = scenes.flatMap((scene) => scene.lines.map((line) => line.id));
    expect(new Set(lineIds).size).toBe(lineIds.length);
  });

  it("replaces existing point scenes while keeping intro and outro", () => {
    const existing = baseScenes();
    const script = parseScript("## 新しい章\nリン:a");
    const scenes = buildImportedScenes({
      script,
      assignments: { リン: null },
      mode: "replace",
      existingScenes: existing,
    });
    expect(scenes[0]!.kind).toBe("intro");
    expect(scenes[scenes.length - 1]!.kind).toBe("outro");
    expect(pointScenes(scenes)).toHaveLength(1);
    expect(headingText(pointScenes(scenes)[0]!)).toBe("新しい章");
  });

  it("appends after the last point scene while keeping existing points", () => {
    const existing = baseScenes();
    const existingPointIds = pointScenes(existing).map((scene) => scene.id);
    const script = parseScript("## 追記\nリン:a");
    const scenes = buildImportedScenes({
      script,
      assignments: { リン: null },
      mode: "append",
      existingScenes: existing,
    });
    expect(pointScenes(scenes)).toHaveLength(existingPointIds.length + 1);
    expect(scenes[scenes.length - 1]!.kind).toBe("outro");
    expect(scenes[scenes.length - 2]!.kind).toBe("point");
    for (const id of existingPointIds) {
      expect(scenes.some((scene) => scene.id === id)).toBe(true);
    }
  });

  it("refuses to apply when the script has errors", () => {
    const script = parseScript("## 章\nこれはメモ");
    expect(() =>
      buildImportedScenes({
        script,
        assignments: {},
        mode: "replace",
        existingScenes: baseScenes(),
      }),
    ).toThrow();
  });

  it("refuses to apply when a speaker assignment is unresolved", () => {
    const script = parseScript("## 章\nリン:a\nレン:b");
    expect(unresolvedSpeakerNames(script, { リン: "speaker-rin" })).toEqual(["レン"]);
    expect(() =>
      buildImportedScenes({
        script,
        assignments: { リン: "speaker-rin" },
        mode: "replace",
        existingScenes: baseScenes(),
      }),
    ).toThrow();
  });
});
