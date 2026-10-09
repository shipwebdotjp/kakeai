import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { CompositionCompileError } from "./compile-error";
import { resolveTimeline } from "./timeline";

describe("resolveTimeline", () => {
  it("resolves scene starts and total duration for the default document", () => {
    const timeline = resolveTimeline(validContentDocument());
    expect(timeline.scenes.map((scene) => [scene.startMs, scene.durationMs])).toEqual([
      [0, 4000],
      [4000, 4000],
      [8000, 1000],
      [9000, 1000],
      [10000, 4000],
    ]);
    expect(timeline.totalDurationMs).toBe(14000);
  });

  it("places auto lines after the head padding", () => {
    const timeline = resolveTimeline(validContentDocument());
    expect(timeline.scenes[1]?.lines).toEqual([
      { lineId: "line-p1-1", startMs: 4500, durationMs: 3000, endMs: 7500 },
    ]);
  });

  it("distributes fixed remainder across silent lines in order", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.timing.mode !== "auto") {
      throw new Error("fixture changed");
    }
    scene.timing = { mode: "fixed", durationMs: 5001 };
    scene.lines.push({
      id: "line-p1-2",
      speakerId: null,
      captionText: "字幕のみ",
      speechText: "じまくのみ",
      selectedAudioTakeId: null,
    });
    scene.lines.push({
      id: "line-p1-3",
      speakerId: null,
      captionText: "字幕のみ2",
      speechText: "じまくのみ2",
      selectedAudioTakeId: null,
    });
    const timeline = resolveTimeline(document);
    expect(timeline.scenes[1]?.lines.map((line) => [line.startMs, line.durationMs])).toEqual([
      [4000, 3000],
      [7000, 1001],
      [8001, 1000],
    ]);
  });

  it("rejects fixed scenes whose audio total exceeds the duration", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.timing.mode !== "auto") {
      throw new Error("fixture changed");
    }
    scene.timing = { mode: "fixed", durationMs: 1000 };
    try {
      resolveTimeline(document);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.path).toEqual([
        "scenes",
        1,
        "timing",
      ]);
    }
  });

  it("rejects lines referencing a missing audio take", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined) {
      throw new Error("fixture changed");
    }
    scene.lines.push({
      id: "line-missing-take",
      speakerId: null,
      captionText: "欠落",
      speechText: "けつらく",
      selectedAudioTakeId: "take-missing",
    });
    try {
      resolveTimeline(document);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe("unknown_take");
    }
  });
});
