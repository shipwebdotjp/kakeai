import { describe, expect, it } from "vitest";
import type { VisualCue } from "@kakeai/contracts";
import {
  countLineCueReferences,
  lineOptionLabel,
  lineRangeEndCandidates,
  moveLineInScene,
  nextEndLineId,
  normalizeLineRangeCues,
  removeLineInScene,
  splitPointScene,
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
  return { id, speakerId, captionText, speechText, selectedAudioTakeId, expressionId, takes };
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
  };
}

describe("moveLineInScene", () => {
  it("reorders lines while preserving ids, speakers, and audio", () => {
    const scene = makeScene([
      line("l1", "speaker-a", "A", "a", [take("t1")], "t1"),
      line("l2", null, "B", "b"),
      line("l3", "speaker-a", "C", "c", [take("t3")], "t3"),
    ]);

    const moved = moveLineInScene(scene, 0, 2);

    expect(moved.lines.map((entry) => entry.id)).toEqual(["l2", "l3", "l1"]);
    const movedLine = moved.lines.find((entry) => entry.id === "l1")!;
    expect(movedLine).toMatchObject({
      speakerId: "speaker-a",
      captionText: "A",
      speechText: "a",
      selectedAudioTakeId: "t1",
    });
    expect(movedLine.takes.map((entry) => entry.id)).toEqual(["t1"]);
  });

  it("returns the scene unchanged for an out-of-range move", () => {
    const scene = makeScene([line("l1", null, "A", "a"), line("l2", null, "B", "b")]);
    expect(moveLineInScene(scene, 0, 0)).toBe(scene);
    expect(moveLineInScene(scene, 0, 5)).toBe(scene);
  });

  it("normalizes a line-range cue that becomes reversed", () => {
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")],
      [lineCue("c1", "l1", "l3")],
    );

    const moved = moveLineInScene(scene, 2, 0);

    expect(moved.lines.map((entry) => entry.id)).toEqual(["l3", "l1", "l2"]);
    expect(moved.cues[0]).toMatchObject({ startLineId: "l3", endLineId: "l1" });
  });
});

describe("normalizeLineRangeCues", () => {
  it("swaps only reversed, resolvable line ranges", () => {
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b")],
      [
        lineCue("reversed", "l2", "l1"),
        lineCue("ordered", "l1", "l2"),
        lineCue("missing", "l2", "l9"),
        cue("scene"),
      ],
    );

    const normalized = normalizeLineRangeCues(scene);

    expect(normalized.cues.find((entry) => entry.id === "reversed")).toMatchObject({
      startLineId: "l1",
      endLineId: "l2",
    });
    expect(normalized.cues.find((entry) => entry.id === "ordered")).toMatchObject({
      startLineId: "l1",
      endLineId: "l2",
    });
    expect(normalized.cues.find((entry) => entry.id === "missing")).toMatchObject({
      startLineId: "l2",
      endLineId: "l9",
    });
    expect(normalized.cues.find((entry) => entry.id === "scene")?.rangeKind).toBe("scene");
  });
});

describe("removeLineInScene", () => {
  it("drops the line and adjusts line-range cues", () => {
    const scene = makeScene(
      [
        line("l1", null, "A", "a"),
        line("l2", null, "B", "b", [take("t2")], "t2"),
        line("l3", null, "C", "c"),
        line("l4", null, "D", "d"),
      ],
      [
        lineCue("before", "l1", "l2"),
        lineCue("after", "l3", "l4"),
        lineCue("span", "l2", "l4"),
        lineCue("single", "l3", "l3"),
      ],
    );

    const next = removeLineInScene(scene, 2);

    expect(next.lines.map((entry) => entry.id)).toEqual(["l1", "l2", "l4"]);
    expect(next.cues.find((entry) => entry.id === "before")).toMatchObject({
      startLineId: "l1",
      endLineId: "l2",
    });
    expect(next.cues.find((entry) => entry.id === "after")).toMatchObject({
      startLineId: "l4",
      endLineId: "l4",
    });
    expect(next.cues.find((entry) => entry.id === "span")).toMatchObject({
      startLineId: "l2",
      endLineId: "l4",
    });
    expect(next.cues.some((entry) => entry.id === "single")).toBe(false);
  });

  it("drops a cue when its only line is removed", () => {
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b")],
      [lineCue("only", "l2", "l2"), lineCue("other", "l1", "l1")],
    );
    const next = removeLineInScene(scene, 1);
    expect(next.lines.map((entry) => entry.id)).toEqual(["l1"]);
    expect(next.cues.map((entry) => entry.id)).toEqual(["other"]);
  });

  it("drops a cue that references the deleted line but has an unresolvable end", () => {
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b")],
      [lineCue("broken", "l2", "l9"), lineCue("kept", "l9", "l9")],
    );
    const next = removeLineInScene(scene, 1);
    expect(next.cues.map((entry) => entry.id)).toEqual(["kept"]);
  });

  it("returns the scene unchanged for an out-of-range index", () => {
    const scene = makeScene([line("l1", null, "A", "a")]);
    expect(removeLineInScene(scene, 3)).toBe(scene);
  });

  it("drops effect triggers that reference the deleted line", () => {    const effects = JSON.stringify([
      {
        target: { kind: "row", index: 0 },
        trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
      },
      {
        target: { kind: "row", index: 1 },
        trigger: { kind: "lines", startLineId: "l3", endLineId: "l3" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
      },
      {
        target: { kind: "rows" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "fade", durationMs: 400 },
      },
    ]);
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")],
      [cue("vc-effects", { templateId: "table.simple", fields: { effects } })],
    );

    const next = removeLineInScene(scene, 1);
    const remaining = JSON.parse(next.cues[0]!.fields.effects!) as { trigger: { kind: string } }[];
    expect(remaining).toHaveLength(2);
    expect(
      remaining.some(
        (entry) =>
          entry.trigger.kind === "lines" &&
          (entry.trigger as { startLineId?: string }).startLineId === "l2",
      ),
    ).toBe(false);
    expect(
      remaining.some(
        (entry) =>
          entry.trigger.kind === "lines" &&
          (entry.trigger as { startLineId?: string }).startLineId === "l3",
      ),
    ).toBe(true);
  });

  it("preserves effect fields for an unknown template when dropping deleted-line triggers", () => {
    const effects = JSON.stringify([
      {
        target: { kind: "row", index: 0 },
        trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
      },
    ]);
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b")],
      [cue("vc", { templateId: "unknown.template", fields: { effects } })],
    );
    const next = removeLineInScene(scene, 1);
    expect(next.cues[0]!.fields.effects).toBe(effects);
  });

  it("drops a non-editable appear trigger held in baseCue when its line is removed", () => {
    const baseCue: VisualCue = {
      id: "vc-callout",
      template: { id: "list.callout", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 0,
      transition: {
        enter: { preset: "none", durationMs: 0 },
        exit: { preset: "none", durationMs: 0 },
      },
      input: {
        items: [{ text: "a" }],
        appear: {
          trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
          effect: { kind: "appear", preset: "fade", durationMs: 400 },
        },
      },
    };
    const items = JSON.stringify([{ text: "a" }]);
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b")],
      [cue("vc", { templateId: "list.callout", baseCue, fields: { items } })],
    );
    const next = removeLineInScene(scene, 1);
    const input = next.cues[0]!.baseCue!.input as { appear?: unknown; items: unknown };
    expect(input.appear).toBeUndefined();
    expect(input.items).toEqual([{ text: "a" }]);
  });
});

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

describe("splitPointScene", () => {
  it("splits lines and keeps the later lines' ids and audio", () => {
    const scene = makeScene([
      line("l1", "speaker-a", "A", "a", [take("t1")], "t1"),
      line("l2", null, "B", "b"),
      line("l3", "speaker-b", "C", "c", [take("t3")], "t3"),
      line("l4", null, "D", "d"),
    ]);

    const { first, second } = splitPointScene(scene, 2, "要点 2", new Set(), null);

    expect(first.id).toBe("scene-point-1");
    expect(first.lines.map((entry) => entry.id)).toEqual(["l1", "l2"]);
    expect(second.id).not.toBe("scene-point-1");
    expect(second.lines.map((entry) => entry.id)).toEqual(["l3", "l4"]);
    expect(second.lines[0]).toMatchObject({
      speakerId: "speaker-b",
      captionText: "C",
      selectedAudioTakeId: "t3",
    });
    expect(second.lines[0]!.takes.map((entry) => entry.id)).toEqual(["t3"]);
    expect(second.kind).toBe("point");
    expect(second.transitionPreset).toBe("cut");
    expect(second.cues.some((entry) => entry.fields.role === "heading")).toBe(true);
  });

  it("drops effect triggers whose lines move to the other scene", () => {
    const effects = JSON.stringify([
      {
        target: { kind: "row", index: 0 },
        trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
      },
      {
        target: { kind: "row", index: 1 },
        trigger: { kind: "lines", startLineId: "l3", endLineId: "l3" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
      },
    ]);
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")],
      [cue("vc", { templateId: "table.simple", rangeKind: "scene", fields: { effects } })],
    );

    const { first } = splitPointScene(scene, 2, "要点 2", new Set(), null);
    const remaining = JSON.parse(first.cues.find((entry) => entry.id === "vc")!.fields.effects!) as {
      trigger: { startLineId: string };
    }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.trigger.startLineId).toBe("l1");
  });

  it("keeps callout items without a trigger when splitting", () => {
    const items = JSON.stringify([
      { text: "常時表示" },
      {
        text: "同期する",
        trigger: { kind: "lines", startLineId: "l3", endLineId: "l3" },
        effect: { kind: "emphasize", style: "frame", tone: "primary" },
      },
    ]);
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")],
      [cue("vc", { templateId: "list.callout", rangeKind: "scene", fields: { items } })],
    );

    const { first } = splitPointScene(scene, 2, "要点 2", new Set(), null);
    const remaining = JSON.parse(
      first.cues.find((entry) => entry.id === "vc")!.fields.items!,
    ) as { text: string }[];
    expect(remaining.map((entry) => entry.text)).toEqual(["常時表示"]);
  });

  it("routes cues by their line range", () => {
    const scene = makeScene(
      [
        line("l1", null, "A", "a"),
        line("l2", null, "B", "b"),
        line("l3", null, "C", "c"),
        line("l4", null, "D", "d"),
      ],
      [
        cue("scene", { rangeKind: "scene" }),
        cue("offset", { rangeKind: "offset", startMs: 0, endMs: 100 }),
        lineCue("before", "l1", "l2"),
        lineCue("after", "l3", "l4"),
        lineCue("span", "l2", "l3"),
      ],
    );

    const { first, second } = splitPointScene(scene, 2, "要点 2", new Set(), null);

    expect(first.cues.map((entry) => entry.id)).toEqual(["scene", "offset", "before", "span"]);
    expect(first.cues.find((entry) => entry.id === "span")).toMatchObject({
      startLineId: "l2",
      endLineId: "l2",
    });
    expect(second.cues.find((entry) => entry.id === "after")).toMatchObject({
      startLineId: "l3",
      endLineId: "l4",
    });
    const secondSpan = second.cues.find(
      (entry) => entry.rangeKind === "lines" && entry.id !== "after",
    );
    expect(secondSpan?.id).not.toBe("span");
    expect(secondSpan).toMatchObject({ startLineId: "l3", endLineId: "l3" });
    expect(second.cues.some((entry) => entry.id === "scene")).toBe(false);
    expect(second.cues.some((entry) => entry.id === "offset")).toBe(false);
  });

  it("clones fields and baseCue id for a split span", () => {
    const span = lineCue("span", "l2", "l3");
    span.fields = { text: "本文" };
    span.baseCue = {
      id: "span",
      template: { id: "x.y", version: 1 },
      range: { kind: "lines", startLineId: "l2", endLineId: "l3" },
      layer: "overlay",
      order: 0,
      transition: {
        enter: { preset: "none", durationMs: 0 },
        exit: { preset: "none", durationMs: 0 },
      },
      input: {},
    } as VisualCue;
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")],
      [span],
    );

    const { first, second } = splitPointScene(scene, 2, "要点 2", new Set(), null);
    const firstSpan = first.cues.find((entry) => entry.id === "span")!;
    const secondSpan = second.cues.find((entry) => entry.rangeKind === "lines")!;

    expect(secondSpan.fields).not.toBe(firstSpan.fields);
    expect(secondSpan.baseCue?.id).toBe(secondSpan.id);
    expect(firstSpan.baseCue?.id).toBe("span");
  });

  it("splits and moves offset cues at the split time", () => {
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b"), line("l3", null, "C", "c")],
      [
        cue("before", { rangeKind: "offset", startMs: 0, endMs: 100 }),
        cue("after", { rangeKind: "offset", startMs: 300, endMs: 400 }),
        cue("span", { rangeKind: "offset", startMs: 50, endMs: 350 }),
      ],
    );

    const { first, second } = splitPointScene(scene, 1, "要点 2", new Set(), 200);

    expect(first.cues.find((entry) => entry.id === "before")).toMatchObject({
      startMs: 0,
      endMs: 100,
    });
    expect(first.cues.find((entry) => entry.id === "span")).toMatchObject({
      startMs: 50,
      endMs: 200,
    });
    expect(second.cues.find((entry) => entry.id === "after")).toMatchObject({
      startMs: 100,
      endMs: 200,
    });
    const secondSpan = second.cues.find(
      (entry) => entry.rangeKind === "offset" && entry.id !== "after",
    )!;
    expect(secondSpan.id).not.toBe("span");
    expect(secondSpan).toMatchObject({ startMs: 0, endMs: 150 });
    expect(first.cues.some((entry) => entry.id === "after")).toBe(false);
    expect(second.cues.some((entry) => entry.id === "span")).toBe(false);
  });

  it("keeps offset cues in the first scene when the split time is unknown", () => {
    const scene = makeScene(
      [line("l1", null, "A", "a"), line("l2", null, "B", "b")],
      [cue("offset", { rangeKind: "offset", startMs: 0, endMs: 100 })],
    );

    const { first, second } = splitPointScene(scene, 1, "要点 2", new Set(), null);

    expect(first.cues.some((entry) => entry.id === "offset")).toBe(true);
    expect(second.cues.some((entry) => entry.id === "offset")).toBe(false);
  });

  it("rejects splits at the first line or beyond the last line", () => {
    const scene = makeScene([line("l1", null, "A", "a"), line("l2", null, "B", "b")]);
    expect(() => splitPointScene(scene, 0, "要点 2", new Set(), null)).toThrow();
    expect(() => splitPointScene(scene, 2, "要点 2", new Set(), null)).toThrow();
    const single = makeScene([line("l1", null, "A", "a")]);
    expect(() => splitPointScene(single, 1, "要点 2", new Set(), null)).toThrow();
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
