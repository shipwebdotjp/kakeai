import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { CompositionCompileError } from "./compile-error";
import { buildSrt, formatSrtTimestamp } from "./subtitles";

describe("formatSrtTimestamp", () => {
  it("formats zero and sub-second values", () => {
    expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(5)).toBe("00:00:00,005");
  });

  it("formats minutes and hours", () => {
    expect(formatSrtTimestamp(4500)).toBe("00:00:04,500");
    expect(formatSrtTimestamp(3723456)).toBe("01:02:03,456");
  });

  it("floors fractional milliseconds", () => {
    expect(formatSrtTimestamp(1500.9)).toBe("00:00:01,500");
  });

  it("maps non-finite input to zero", () => {
    expect(formatSrtTimestamp(Number.NaN)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(Number.POSITIVE_INFINITY)).toBe("00:00:00,000");
  });
});

describe("buildSrt", () => {
  it("emits one cue per captioned line with resolved timings", () => {
    expect(buildSrt(validContentDocument())).toBe(
      "1\n00:00:04,500 --> 00:00:07,500\n最初の要点です。\n",
    );
  });

  it("places silent lines after voiced lines", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.timing.mode !== "auto") {
      throw new Error("fixture changed");
    }
    scene.lines.push({
      id: "line-p1-2",
      speakerId: null,
      captionText: "字幕のみ",
      speechText: "じまくのみ",
      selectedAudioTakeId: null,
      expressionId: null,
    });
    expect(buildSrt(document)).toBe(
      "1\n00:00:04,500 --> 00:00:07,500\n最初の要点です。\n\n2\n00:00:07,500 --> 00:00:10,000\n字幕のみ\n",
    );
  });

  it("skips empty captions and keeps numbering continuous", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.lines[0] === undefined) {
      throw new Error("fixture changed");
    }
    scene.lines[0].captionText = "   ";
    scene.lines.push({
      id: "line-p1-2",
      speakerId: null,
      captionText: "二行目",
      speechText: "にぎょうめ",
      selectedAudioTakeId: null,
      expressionId: null,
    });
    expect(buildSrt(document)).toBe("1\n00:00:07,500 --> 00:00:10,000\n二行目\n");
  });

  it("collapses blank lines and trims outer newlines", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.lines[0] === undefined) {
      throw new Error("fixture changed");
    }
    scene.lines[0].captionText = "\n一行目\r\n\r\n二行目\n";
    expect(buildSrt(document)).toBe(
      "1\n00:00:04,500 --> 00:00:07,500\n一行目\n二行目\n",
    );
  });

  it("trims each line and drops whitespace-only lines", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.lines[0] === undefined) {
      throw new Error("fixture changed");
    }
    scene.lines[0].captionText = "  一行目  \n 　 \n二行目  ";
    expect(buildSrt(document)).toBe(
      "1\n00:00:04,500 --> 00:00:07,500\n一行目\n二行目\n",
    );
  });

  it("skips zero-duration lines from fixed timing", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.timing.mode !== "auto") {
      throw new Error("fixture changed");
    }
    scene.timing = { mode: "fixed", durationMs: 3000 };
    scene.lines.push({
      id: "line-p1-2",
      speakerId: null,
      captionText: "尺なし",
      speechText: "しゃくなし",
      selectedAudioTakeId: null,
      expressionId: null,
    });
    expect(buildSrt(document)).toBe(
      "1\n00:00:04,000 --> 00:00:07,000\n最初の要点です。\n",
    );
  });

  it("throws the same compile error as rendering on fixed duration overflow", () => {
    const document = validContentDocument();
    const scene = document.scenes[1];
    if (scene === undefined || scene.timing.mode !== "auto") {
      throw new Error("fixture changed");
    }
    scene.timing = { mode: "fixed", durationMs: 1 };
    expect(() => buildSrt(document)).toThrow(CompositionCompileError);
  });
});
