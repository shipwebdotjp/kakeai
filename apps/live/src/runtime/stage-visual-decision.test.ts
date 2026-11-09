import { describe, expect, it } from "vitest";
import { CardErrorReporter, cardErrorMessage } from "../../web/stage/card-errors.ts";
import {
  decideStageVisual,
  shouldAnimateStageVisual,
  StageVisualTracker,
} from "../../web/stage/visual-decision.ts";

describe("shouldAnimateStageVisual", () => {
  it("animates only live program updates", () => {
    expect(
      shouldAnimateStageVisual({ snapshot: true, preview: false, program: true }),
    ).toBe(false);
    expect(
      shouldAnimateStageVisual({ snapshot: false, preview: true, program: true }),
    ).toBe(false);
    expect(
      shouldAnimateStageVisual({ snapshot: false, preview: false, program: false }),
    ).toBe(false);
    expect(
      shouldAnimateStageVisual({ snapshot: false, preview: false, program: true }),
    ).toBe(true);
  });
});

describe("decideStageVisual", () => {
  // A null visual has no sequence. Hiding is only safe because the stage
  // socket delivers states in order, so every received null is the latest.
  it("always hides a null visual because ordering relies on the transport", () => {
    expect(
      decideStageVisual({
        visual: null,
        applied: { kind: "card", cardId: "card-a", stateId: "state-1" },
        lastSequence: 4,
        animate: true,
      }),
    ).toEqual({ type: "hide" });
    expect(
      decideStageVisual({
        visual: null,
        applied: { kind: "material", materialId: "material-1", focus: true },
        lastSequence: 99,
        animate: false,
      }),
    ).toEqual({ type: "hide" });
  });

  it("uses enter for the first card and honours the animate flag", () => {
    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-a", stateId: "state-1", sequence: 1 },
        applied: null,
        lastSequence: null,
        animate: false,
      }),
    ).toEqual({
      type: "card",
      cardId: "card-a",
      stateId: "state-1",
      transition: "enter",
      animate: false,
    });
    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-a", stateId: "state-1", sequence: 1 },
        applied: null,
        lastSequence: null,
        animate: true,
      }),
    ).toMatchObject({ transition: "enter", animate: true });
  });

  it("uses update for a same-card state change and ignores a repeated state", () => {
    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-a", stateId: "state-2", sequence: 2 },
        applied: { kind: "card", cardId: "card-a", stateId: "state-1" },
        lastSequence: 1,
        animate: true,
      }),
    ).toEqual({
      type: "card",
      cardId: "card-a",
      stateId: "state-2",
      transition: "update",
      animate: true,
    });
    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-a", stateId: "state-1", sequence: 1 },
        applied: { kind: "card", cardId: "card-a", stateId: "state-1" },
        lastSequence: 1,
        animate: true,
      }),
    ).toEqual({ type: "none" });
  });

  it("uses enter when switching to a different card", () => {
    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-b", stateId: "state-1", sequence: 3 },
        applied: { kind: "card", cardId: "card-a", stateId: "state-1" },
        lastSequence: 2,
        animate: true,
      }),
    ).toMatchObject({ type: "card", cardId: "card-b", transition: "enter" });
  });

  it("ignores a stale non-null sequence but accepts an equal one with a new state", () => {
    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-a", stateId: "state-1", sequence: 2 },
        applied: { kind: "card", cardId: "card-a", stateId: "state-2" },
        lastSequence: 3,
        animate: true,
      }),
    ).toEqual({ type: "none" });

    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-a", stateId: "state-3", sequence: 3 },
        applied: { kind: "card", cardId: "card-a", stateId: "state-2" },
        lastSequence: 3,
        animate: true,
      }),
    ).toMatchObject({ type: "card", stateId: "state-3", transition: "update" });
  });

  it("switches between a material and a card without keeping both", () => {
    const material = decideStageVisual({
      visual: { kind: "material", materialId: "material-1", focus: true, sequence: 2 },
      applied: { kind: "card", cardId: "card-a", stateId: "state-1" },
      lastSequence: 1,
      animate: true,
    });
    expect(material).toEqual({
      type: "material",
      materialId: "material-1",
      focus: true,
    });

    expect(
      decideStageVisual({
        visual: { kind: "material", materialId: "material-1", focus: true, sequence: 2 },
        applied: { kind: "material", materialId: "material-1", focus: true },
        lastSequence: 2,
        animate: true,
      }),
    ).toEqual({ type: "none" });

    expect(
      decideStageVisual({
        visual: { kind: "card", cardId: "card-a", stateId: "state-1", sequence: 3 },
        applied: { kind: "material", materialId: "material-1", focus: true },
        lastSequence: 2,
        animate: true,
      }),
    ).toMatchObject({ type: "card", transition: "enter" });
  });
});

describe("StageVisualTracker", () => {
  it("retries the same card/state after a render failure", () => {
    const tracker = new StageVisualTracker();
    const visual = { kind: "card" as const, cardId: "card-a", stateId: "state-1", sequence: 5 };

    expect(tracker.decide(visual, true)).toMatchObject({ type: "card", stateId: "state-1" });
    // Without markFailed this would be "none" because the visual is applied.
    tracker.markFailed();
    expect(tracker.decide(visual, true)).toMatchObject({
      type: "card",
      cardId: "card-a",
      stateId: "state-1",
    });

    // A failed visual still orders later states; an older reset cannot rewind.
    expect(tracker.decide({ ...visual, stateId: "state-0", sequence: 4 }, true)).toEqual({
      type: "none",
    });
  });

  it("resets ordering for a new show or reconnect that restarts at sequence 0", () => {
    const tracker = new StageVisualTracker();
    const visual = { kind: "card" as const, cardId: "card-a", stateId: "state-9", sequence: 9 };
    expect(tracker.decide(visual, true)).toMatchObject({ type: "card" });

    tracker.reset();

    expect(
      tracker.decide(
        { kind: "card", cardId: "card-a", stateId: "state-0", sequence: 0 },
        false,
      ),
    ).toEqual({
      type: "card",
      cardId: "card-a",
      stateId: "state-0",
      transition: "enter",
      animate: false,
    });
  });
});

describe("CardErrorReporter", () => {
  it("reports once per card/state/reason", () => {
    const reporter = new CardErrorReporter();
    const visual = { cardId: "card-a", stateId: "state-1", sequence: 1 };

    const first = reporter.report(visual, new Error("画像を読み込めませんでした"));
    expect(first).toMatchObject({
      cardId: "card-a",
      stateId: "state-1",
      sequence: 1,
      message: "画像を読み込めませんでした",
    });
    expect(reporter.report(visual, new Error("画像を読み込めませんでした"))).toBeNull();

    expect(
      reporter.report({ ...visual, stateId: "state-2" }, new Error("画像を読み込めませんでした")),
    ).not.toBeNull();
    expect(reporter.report(visual, new Error("別の理由"))).not.toBeNull();
  });

  it("normalizes unknown errors without throwing", () => {
    expect(cardErrorMessage(new Error(" 失敗 "))).toBe("失敗");
    expect(cardErrorMessage("文字列の失敗")).toBe("文字列の失敗");
    expect(cardErrorMessage(undefined)).toBe("カードの表示に失敗しました。");
    expect(cardErrorMessage({ weird: true })).toBe("カードの表示に失敗しました。");

    const reporter = new CardErrorReporter();
    const first = reporter.report(null, undefined);
    expect(first).toMatchObject({
      cardId: null,
      stateId: null,
      sequence: null,
    });
    expect(reporter.report(null, undefined)).toBeNull();
  });

  it("reports the same failure again after a reset", () => {
    const reporter = new CardErrorReporter();
    const visual = { cardId: "card-a", stateId: "state-1", sequence: 1 };

    expect(reporter.report(visual, new Error("失敗"))).not.toBeNull();
    expect(reporter.report(visual, new Error("失敗"))).toBeNull();

    reporter.reset();

    expect(reporter.report(visual, new Error("失敗"))).not.toBeNull();
  });
});
