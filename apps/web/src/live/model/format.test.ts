import { describe, expect, it } from "vitest";
import { liveFormatDocumentV1Schema } from "@kakeai/contracts";
import {
  addFormatCard,
  addFormatCue,
  addFormatCueSegment,
  addFormatCutInSegment,
  createDefaultLiveFormatDocument,
  createFormatCue,
  moveFormatSegment,
  patchFormatSegment,
  removeFormatCardState,
  removeFormatSegment,
} from "./format";
import { makeListCard } from "./test-helpers";

function defaultFormat() {
  return createDefaultLiveFormatDocument({
    name: "ニュース 30分",
    theme: { id: "theme-news", version: 1 },
    cast: {
      left: { characterId: "char-left", voiceProfileId: "voice-left" },
      right: null,
    },
  });
}

describe("live format model", () => {
  it("creates a valid starter format with all generic cue roles", () => {
    const document = defaultFormat();
    const parsed = liveFormatDocumentV1Schema.safeParse(document);
    expect(parsed.success).toBe(true);
    expect(document.cues.map((cue) => cue.role).sort()).toEqual([
      "closing",
      "fallback",
      "opening",
    ]);
  });

  it("keeps a segment visual when unrelated fields are patched", () => {
    let document = addFormatCard(defaultFormat(), makeListCard());
    document = {
      ...document,
      segments: document.segments.map((segment) =>
        segment.kind === "script"
          ? { ...segment, visual: { kind: "card", cardId: "card-1", stateId: "state-1" } }
          : segment,
      ),
    };
    const next = patchFormatSegment(document, "fs-script", { label: "変更" });
    const script = next.segments.find((segment) => segment.kind === "script");
    expect(script !== undefined && "visual" in script && script.visual).toEqual({
      kind: "card",
      cardId: "card-1",
      stateId: "state-1",
    });
  });

  it("clears segment visuals when a format card state is removed", () => {
    let document = addFormatCard(defaultFormat(), makeListCard());
    document = {
      ...document,
      segments: document.segments.map((segment) =>
        segment.kind === "script"
          ? { ...segment, visual: { kind: "card", cardId: "card-1", stateId: "state-2" } }
          : segment,
      ),
    };
    const next = removeFormatCardState(document, "card-1", "state-2");
    const script = next.segments.find((segment) => segment.kind === "script");
    expect(script !== undefined && "visual" in script).toBe(false);
    expect(next.cards[0]?.states.map((state) => state.id)).toEqual(["state-1"]);
  });

  it("refuses to create a second opening or closing segment", () => {
    const document = defaultFormat();
    expect(
      addFormatCueSegment(document, { id: "second-opening", kind: "opening" }),
    ).toBe(document);
    expect(
      addFormatCueSegment(document, { id: "second-closing", kind: "closing" }),
    ).toBe(document);
  });

  it("keeps a CutIn between opening and closing", () => {
    const document = defaultFormat();
    const withCutIn = addFormatCutInSegment(document, { id: "format-seg-cut" });
    expect(withCutIn.segments[0]?.kind).toBe("opening");
    expect(withCutIn.segments.at(-1)?.kind).toBe("closing");
    expect(withCutIn.segments.some((segment) => segment.kind === "cut_in")).toBe(true);

    expect(
      addFormatCutInSegment(document, { id: "cut-first", index: 0 }),
    ).toBe(document);
    expect(
      addFormatCutInSegment(document, { id: "cut-last", index: document.segments.length }),
    ).toBe(document);
  });

  it("refuses to remove or move spine anchors", () => {
    const document = defaultFormat();
    const opening = document.segments.find((segment) => segment.kind === "opening")!;
    const closing = document.segments.find((segment) => segment.kind === "closing")!;
    const script = document.segments.find((segment) => segment.kind === "script")!;

    expect(removeFormatSegment(document, opening.id)).toBe(document);
    expect(removeFormatSegment(document, closing.id)).toBe(document);
    expect(removeFormatSegment(document, script.id)).toBe(document);
    expect(moveFormatSegment(document, opening.id, 1)).toBe(document);
    expect(moveFormatSegment(document, closing.id, -1)).toBe(document);
    expect(moveFormatSegment(document, script.id, -1)).toBe(document);
    expect(moveFormatSegment(document, script.id, 1)).toBe(document);
  });

  it("allows moving and removing a script when another script remains", () => {
    const document = addFormatCueSegment(defaultFormat(), {
      id: "format-seg-script-2",
      kind: "script",
    });
    const moved = moveFormatSegment(document, "format-seg-script-2", -1);
    expect(moved.segments.map((segment) => segment.id)).toEqual([
      "format-seg-opening",
      "format-seg-script-2",
      "format-seg-script",
      "format-seg-closing",
    ]);
    const removed = removeFormatSegment(moved, "format-seg-script-2");
    expect(removed.segments.some((segment) => segment.id === "format-seg-script-2")).toBe(
      false,
    );
  });

  it("refuses a second cue for the same generic role", () => {
    const document = defaultFormat();
    const duplicate = createFormatCue({
      id: "format-cue-opening-2",
      role: "opening",
      caption: "もう一度",
      speech: "もういちど",
    });
    expect(addFormatCue(document, duplicate)).toBe(document);
  });
});
