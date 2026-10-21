import { describe, expect, it } from "vitest";
import type { VisualCue } from "@kakeai/contracts";
import {
  countLineCueReferences,
  lineOptionLabel,
  lineRangeEndCandidates,
  nextEndLineId,
  type CueFormValue,
  type LineFormValue,
  type SceneFormValue,
  type SpeakerFormValue,
  type TakeFormValue,
} from "./form";

function take(id: string): TakeFormValue {
  return { id, assetId: `asset-${id}`, durationMs: 1000, source: "tts" };
}

function line(
  id: string,
  speakerId: string | null,
  captionText: string,
  speechText: string,
  takes: TakeFormValue[] = [],
  selectedAudioTakeId: string | null = null,
  expressionId: string | null = null,
): LineFormValue {
  return { id, speakerId, captionText, speechText, selectedAudioTakeId, expressionId, gapBeforeMs: 0, takes };
}

function speaker(id: string, name: string): SpeakerFormValue {
  return { id, name, characterId: null, voiceProfileId: null };
}

function cue(id: string, overrides: Partial<CueFormValue> = {}): CueFormValue {
  return {
    id,
    baseCue: null,
    templateId: "text.block",
    templateVersion: 1,
    layer: "overlay",
    order: 0,
    rangeKind: "scene",
    startLineId: "",
    endLineId: "",
    startMs: 0,
    endMs: 0,
    enterPreset: "fade",
    enterDurationMs: 350,
    exitPreset: "none",
    exitDurationMs: 0,
    fields: {},
    ...overrides,
  };
}

function lineCue(id: string, startLineId: string, endLineId: string): CueFormValue {
  return cue(id, { rangeKind: "lines", startLineId, endLineId });
}

function makeScene(lines: LineFormValue[], cues: CueFormValue[] = []): SceneFormValue {
  return {
    id: "scene-point-1",
    kind: "point",
    label: "要点 1",
    accentKind: "theme",
    accentToken: "primary",
    accentColor: "",
    timingMode: "auto",
    durationMs: 4000,
    transitionPreset: "cut",
    transitionDurationMs: 0,
    lines,
    cues,
    standings: [
      {
        cueId: null,
        characterId: null,
        appearanceId: null,
        side: "left",
        scale: 1,
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
      {
        cueId: null,
        characterId: null,
        appearanceId: null,
        side: "right",
        scale: 1,
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
    ],
    audioCues: [],
    mainVisualCueId: "",
    embeddedAudio: true,
    embeddedAudioGainDb: 0,
  };
}

describe("countLineCueReferences", () => {
  it("counts cues whose start or end is the line", () => {
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")],
      [lineCue("a", "l2", "l3"), lineCue("b", "l1", "l2"), cue("scene")],
    );
    expect(countLineCueReferences(scene, "l2")).toBe(2);
    expect(countLineCueReferences(scene, "l3")).toBe(1);
    expect(countLineCueReferences(scene, "l9")).toBe(0);
  });

  it("counts cues whose effect trigger references the line", () => {
    const effects = JSON.stringify([
      {
        target: { kind: "row", index: 0 },
        trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
      },
    ]);
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b")],
      [cue("vc", { templateId: "table.simple", fields: { effects } })],
    );
    expect(countLineCueReferences(scene, "l2")).toBe(1);
    expect(countLineCueReferences(scene, "l1")).toBe(0);
  });
});

describe("line labels", () => {
  it("shows ordinal, speaker, and caption", () => {
    const lines = [
      line("l1", "sp", "やっほー", "やっほー"),
      line("l2", null, "こんにちは", "こんにちは"),
      line("l3", "sp", "", ""),
    ];
    const speakers = [speaker("sp", "レン")];
    expect(lineOptionLabel(lines, 0, speakers)).toBe("1. レン — やっほー");
    expect(lineOptionLabel(lines, 1, speakers)).toBe("2. 話者なし — こんにちは");
    expect(lineOptionLabel(lines, 2, speakers)).toBe("3. レン — （字幕なし）");
  });

  it("truncates a long caption", () => {
    const lines = [line("l1", "sp", "あ".repeat(40), "あ")];
    const label = lineOptionLabel(lines, 0, [speaker("sp", "リン")]);
    expect(label.startsWith("1. リン — ")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThan(30);
  });
});

describe("line range candidates", () => {
  const lines = [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")];

  it("lists only lines at or after the start", () => {
    expect(lineRangeEndCandidates(lines, "l2").map((entry) => entry.id)).toEqual(["l2", "l3"]);
    expect(lineRangeEndCandidates(lines, "l1").map((entry) => entry.id)).toEqual([
      "l1",
      "l2",
      "l3",
    ]);
    expect(lineRangeEndCandidates(lines, "").map((entry) => entry.id)).toEqual([
      "l1",
      "l2",
      "l3",
    ]);
  });

  it("corrects an end that is before the start", () => {
    expect(nextEndLineId(lines, "l3", "l1")).toBe("l3");
    expect(nextEndLineId(lines, "l1", "l2")).toBe("l2");
    expect(nextEndLineId(lines, "l2", "")).toBe("");
  });
});
