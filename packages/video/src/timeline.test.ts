import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { VisualCue } from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";
import {
  collectCompositionWindowIssues,
  collectOffsetRangeWarnings,
  collectSceneTransitionIssues,
  resolveTimeline,
  sceneTransitionOf,
} from "./timeline";

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
      expressionId: null,
    });
    scene.lines.push({
      id: "line-p1-3",
      speakerId: null,
      captionText: "字幕のみ2",
      speechText: "じまくのみ2",
      selectedAudioTakeId: null,
      expressionId: null,
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
      expressionId: null,
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

describe("offset range warnings", () => {
  function withOffsetCue(startMs: number, endMs: number) {
    const document = validContentDocument();
    const base = document.scenes[1]!.visualCues[0]!;
    document.scenes[1]!.visualCues.push({
      ...base,
      id: "vc-p1-offset",
      range: { kind: "offset", startMs, endMs },
    });
    return document;
  }

  it("returns no warnings for cues inside the scene", () => {
    expect(collectOffsetRangeWarnings(withOffsetCue(500, 3500))).toEqual([]);
    expect(collectOffsetRangeWarnings(validContentDocument())).toEqual([]);
  });

  it("warns when the offset end exceeds the scene duration", () => {
    const warnings = collectOffsetRangeWarnings(withOffsetCue(500, 5000));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("offset_range_clamped");
    expect(warnings[0]!.path).toEqual(["scenes", 1, "visualCues", 2, "range", "endMs"]);
  });

  it("warns when the offset window is outside the scene", () => {
    const warnings = collectOffsetRangeWarnings(withOffsetCue(4500, 5000));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("offset_range_out_of_scene");
    expect(warnings[0]!.path).toEqual(["scenes", 1, "visualCues", 2]);
  });

  it("warns when the offset window is empty", () => {
    const warnings = collectOffsetRangeWarnings(withOffsetCue(1000, 1000));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("offset_range_out_of_scene");
    expect(warnings[0]!.path).toEqual(["scenes", 1, "visualCues", 2]);
  });
});

describe("scene transitions", () => {
  it("defaults to cut when a scene has no transition", () => {
    const scene = validContentDocument().scenes[1]!;
    expect(sceneTransitionOf(scene)).toEqual({ preset: "cut", durationMs: 0 });
  });

  it("accepts a transition within the adjacent scene durations", () => {
    const document = validContentDocument();
    document.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 300 } };
    expect(collectSceneTransitionIssues(document)).toEqual([]);
  });

  it("rejects a transition longer than the shorter adjacent scene", () => {
    const document = validContentDocument();
    document.scenes[2]!.transition = { enter: { preset: "fade", durationMs: 1500 } };
    const issues = collectSceneTransitionIssues(document);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("scene_transition_overflow");
    expect(issues[0]!.path).toEqual(["scenes", 2, "transition", "enter", "durationMs"]);
  });

  it("ignores the first scene transition", () => {
    const document = validContentDocument();
    document.scenes[0]!.transition = { enter: { preset: "crossfade", durationMs: 5000 } };
    expect(collectSceneTransitionIssues(document)).toEqual([]);
  });
});

describe("collectCompositionWindowIssues", () => {
  function compositionCue(
    id: string,
    range: VisualCue["range"],
    transition: VisualCue["transition"] = {
      enter: { preset: "none", durationMs: 0 },
      exit: { preset: "none", durationMs: 0 },
    },
  ): VisualCue {
    return {
      id,
      template: { id: "composition.full-bleed", version: 1 },
      range,
      layer: "background",
      order: 0,
      transition,
      input: { compositionVersionId: "ver-1" },
    };
  }

  it("accepts a composition window covered by the child duration", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [compositionCue("vc-comp", { kind: "scene" })];
    expect(collectCompositionWindowIssues(document, new Map([["ver-1", 5000]]))).toEqual([]);
  });

  it("flags a transition that exceeds the effective window", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      compositionCue("vc-comp", { kind: "scene" }, {
        enter: { preset: "fade", durationMs: 300 },
        exit: { preset: "none", durationMs: 0 },
      }),
    ];
    const issues = collectCompositionWindowIssues(document, new Map([["ver-1", 200]]));
    expect(issues.map((issue) => issue.code)).toEqual(["transition_range_overflow"]);
  });

  it("flags a crossfade that needs a longer window than the child", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [compositionCue("vc-comp", { kind: "scene" })];
    document.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 1000 } };
    const issues = collectCompositionWindowIssues(document, new Map([["ver-1", 4000]]));
    expect(issues.map((issue) => issue.code)).toEqual([
      "composition_crossfade_window_insufficient",
    ]);
  });

  it("ignores cues whose composition version cannot be resolved", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [compositionCue("vc-comp", { kind: "scene" })];
    expect(collectCompositionWindowIssues(document, new Map())).toEqual([]);
  });
});
