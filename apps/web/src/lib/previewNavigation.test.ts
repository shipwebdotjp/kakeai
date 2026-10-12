import { describe, expect, it } from "vitest";
import type { PreviewTimeline } from "@kakeai/contracts";
import {
  adjacentStartSeconds,
  cueStartSeconds,
  lineStartSeconds,
  lineStartTimesSeconds,
  nextTime,
  previewKeyAction,
  sceneStartSeconds,
  sceneStartTimesSeconds,
} from "./previewNavigation";

const timeline: PreviewTimeline = {
  totalDurationMs: 9000,
  fps: 30,
  scenes: [
    {
      sceneId: "scene-intro",
      startMs: 0,
      durationMs: 3000,
      lines: [{ lineId: "line-intro-1", startMs: 500, durationMs: 1000 }],
      cues: [{ cueId: "cue-intro-bg", startMs: 0 }],
    },
    {
      sceneId: "scene-point-1",
      startMs: 3000,
      durationMs: 3000,
      lines: [
        { lineId: "line-point-1", startMs: 3100, durationMs: 1000 },
        { lineId: "line-point-2", startMs: 4100, durationMs: 1500 },
      ],
      cues: [],
    },
    {
      sceneId: "scene-outro",
      startMs: 6000,
      durationMs: 3000,
      lines: [],
      cues: [{ cueId: "cue-outro-title", startMs: 6500 }],
    },
  ],
};

describe("timeline lookups", () => {
  it("flattens scene and line start times", () => {
    expect(sceneStartTimesSeconds(timeline)).toEqual([0, 3, 6]);
    expect(lineStartTimesSeconds(timeline)).toEqual([0.5, 3.1, 4.1]);
  });

  it("resolves scene, line, and cue starts by id", () => {
    expect(sceneStartSeconds(timeline, "scene-point-1")).toBe(3);
    expect(sceneStartSeconds(timeline, "scene-missing")).toBeNull();
    expect(lineStartSeconds(timeline, "line-point-2")).toBe(4.1);
    expect(lineStartSeconds(timeline, "line-missing")).toBeNull();
    expect(cueStartSeconds(timeline, "cue-outro-title")).toBe(6.5);
    expect(cueStartSeconds(timeline, "cue-missing")).toBeNull();
  });
});

describe("nextTime", () => {
  const lines = lineStartTimesSeconds(timeline);
  const scenes = sceneStartTimesSeconds(timeline);

  it("moves forward from before, inside, and just after a start", () => {
    expect(nextTime(lines, 0, 1)).toBe(0.5);
    expect(nextTime(lines, 0.7, 1)).toBe(3.1);
    expect(nextTime(lines, 0.5005, 1)).toBe(3.1);
  });

  it("moves forward across a scene boundary", () => {
    expect(nextTime(lines, 3, 1)).toBe(3.1);
    expect(nextTime(scenes, 3, 1)).toBe(6);
  });

  it("returns null past the last line and backward from the start", () => {
    expect(nextTime(lines, 4.1, 1)).toBeNull();
    expect(nextTime(lines, 10, 1)).toBeNull();
    expect(nextTime(lines, 0, -1)).toBeNull();
  });

  it("moves backward to the current line start from inside it", () => {
    expect(nextTime(lines, 4.5, -1)).toBe(4.1);
    expect(nextTime(lines, 0.7, -1)).toBe(0.5);
  });

  it("moves backward to the previous scene", () => {
    expect(nextTime(scenes, 6.5, -1)).toBe(6);
    expect(nextTime(scenes, 3, -1)).toBe(0);
  });
});

describe("adjacentStartSeconds", () => {
  const frame = 1 / 30;

  it("moves forward to the next line and scene", () => {
    expect(adjacentStartSeconds(timeline, 0, "line", 1)).toBe(0.5);
    expect(adjacentStartSeconds(timeline, 0.5 + frame, "line", 1)).toBe(3.1);
    expect(adjacentStartSeconds(timeline, 4.1 + frame, "line", 1)).toBeNull();
    expect(adjacentStartSeconds(timeline, 3 + frame, "scene", 1)).toBe(6);
    expect(adjacentStartSeconds(timeline, 6 + frame, "scene", 1)).toBeNull();
  });

  it("moves backward from a corrected jump position to the previous start", () => {
    expect(adjacentStartSeconds(timeline, 0.5 + frame, "line", -1)).toBeNull();
    expect(adjacentStartSeconds(timeline, 3.1 + frame, "line", -1)).toBe(0.5);
    expect(adjacentStartSeconds(timeline, 3 + frame, "scene", -1)).toBe(0);
    expect(adjacentStartSeconds(timeline, 6 + frame, "scene", -1)).toBe(3);
  });

  it("moves backward to the current start from deeper inside it", () => {
    expect(adjacentStartSeconds(timeline, 4.5, "line", -1)).toBe(4.1);
    expect(adjacentStartSeconds(timeline, 4.5, "scene", -1)).toBe(3);
  });
});

describe("previewKeyAction", () => {
  it("toggles play on space", () => {
    expect(previewKeyAction({ key: " ", shiftKey: false, target: { tagName: "DIV" } }, 5)).toEqual({
      kind: "toggle-play",
    });
  });

  it("steps and frame-steps with arrows", () => {
    const target = { tagName: "DIV" };
    expect(previewKeyAction({ key: "ArrowLeft", shiftKey: false, target }, 5)).toEqual({
      kind: "step-seconds",
      seconds: -5,
    });
    expect(previewKeyAction({ key: "ArrowRight", shiftKey: false, target }, 5)).toEqual({
      kind: "step-seconds",
      seconds: 5,
    });
    expect(previewKeyAction({ key: "ArrowLeft", shiftKey: true, target }, 5)).toEqual({
      kind: "frame-step",
      frames: -1,
    });
    expect(previewKeyAction({ key: "ArrowRight", shiftKey: true, target }, 5)).toEqual({
      kind: "frame-step",
      frames: 1,
    });
  });

  it("moves lines and scenes with j, l, and shift", () => {
    const target = { tagName: "DIV" };
    expect(previewKeyAction({ key: "j", shiftKey: false, target }, 5)).toEqual({
      kind: "line",
      direction: -1,
    });
    expect(previewKeyAction({ key: "l", shiftKey: false, target }, 5)).toEqual({
      kind: "line",
      direction: 1,
    });
    expect(previewKeyAction({ key: "J", shiftKey: true, target }, 5)).toEqual({
      kind: "scene",
      direction: -1,
    });
    expect(previewKeyAction({ key: "L", shiftKey: true, target }, 5)).toEqual({
      kind: "scene",
      direction: 1,
    });
  });

  it("ignores unhandled keys", () => {
    expect(
      previewKeyAction({ key: "a", shiftKey: false, target: { tagName: "DIV" } }, 5),
    ).toBeNull();
    expect(previewKeyAction({ key: " ", shiftKey: false, target: null }, 5)).toBeNull();
  });

  it("does not steal keyboard input from controls", () => {
    for (const tagName of ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY", "A", "input"]) {
      expect(
        previewKeyAction({ key: " ", shiftKey: false, target: { tagName } }, 5),
      ).toBeNull();
      expect(
        previewKeyAction({ key: "ArrowLeft", shiftKey: false, target: { tagName } }, 5),
      ).toBeNull();
      expect(previewKeyAction({ key: "j", shiftKey: false, target: { tagName } }, 5)).toBeNull();
    }
    expect(
      previewKeyAction(
        { key: " ", shiftKey: false, target: { tagName: "DIV", isContentEditable: true } },
        5,
      ),
    ).toBeNull();
  });
});
